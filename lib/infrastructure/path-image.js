import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {safeResourceRelativePath} from '../domain/resource-management.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {boundedRead} from './import-source-reader.js';

const fail = code => {throw domainError(code, 'The reviewed filesystem image is unsafe or changed');};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const validMode = mode => Number.isInteger(mode) && mode >= 0 && mode <= 0o777;
export function validatePathImage(image) {
  if (!fields(image, image?.kind === 'directory' ? ['kind', 'entries'] : image?.kind === 'file' ? ['kind', 'mode', 'content'] : image?.kind === 'symlink' ? ['kind', 'source'] : ['kind'])) fail('TREE_IMAGE_UNSAFE');
  if (image.kind === 'absent') return image;
  if (image.kind === 'symlink') {
    if (typeof image.source !== 'string' || !image.source || image.source.length > 4096 || /[\u0000-\u001f\u007f]/.test(image.source)) fail('TREE_IMAGE_UNSAFE');
    return image;
  }
  if (image.kind === 'file') {
    if (!validMode(image.mode) || typeof image.content !== 'string' || image.content.length > 1398104
      || Buffer.from(image.content, 'base64').toString('base64') !== image.content) fail('TREE_IMAGE_UNSAFE');
    if (Buffer.from(image.content, 'base64').length > 1024 * 1024) fail('TREE_IMAGE_LIMIT_EXCEEDED');
    return image;
  }
  if (image.kind !== 'directory' || !Array.isArray(image.entries) || !image.entries.length || image.entries.length > 512) fail('TREE_IMAGE_UNSAFE');
  const names = new Map(), aliases = new Map(); let files = 0, bytes = 0;
  for (const entry of image.entries) {
    if (!fields(entry, entry.kind === 'directory' ? ['path', 'kind', 'mode'] : ['path', 'kind', 'mode', 'content']) || !validMode(entry.mode)
      || entry.path !== '' && !safeResourceRelativePath(entry.path) || names.has(entry.path) || entry.path.split('/').length > 16) fail('TREE_IMAGE_UNSAFE');
    const canonical = entry.path.normalize('NFC'), folded = canonical.toLowerCase();
    if (aliases.has(folded)) fail('TREE_IMAGE_UNSAFE'); aliases.set(folded, canonical); names.set(entry.path, entry);
    if (entry.kind === 'file') {
      validatePathImage({kind: 'file', mode: entry.mode, content: entry.content}); bytes += Buffer.from(entry.content, 'base64').length; files++;
    } else if (entry.kind !== 'directory') fail('TREE_IMAGE_UNSAFE');
  }
  if (names.get('')?.kind !== 'directory' || files > 256 || bytes > 8 * 1024 * 1024) fail('TREE_IMAGE_LIMIT_EXCEEDED');
  for (const entry of image.entries.filter(item => item.path)) {
    const parent = path.posix.dirname(entry.path);
    if (names.get(parent === '.' ? '' : parent)?.kind !== 'directory') fail('TREE_IMAGE_UNSAFE');
  }
  return image;
}
export function authorizeImagePath(target, root) {
  const base = resolveForAuthorization(root), resolved = path.resolve(target);
  if (!isWithinRoot(resolved, base) || resolved === base || resolveForAuthorization(path.dirname(resolved)) !== path.dirname(resolved)) fail('DEPLOYMENT_TARGET_OUTSIDE_SCOPE');
  let cursor = base;
  for (const part of path.relative(base, path.dirname(resolved)).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {if (!fs.lstatSync(cursor).isDirectory()) fail('DEPLOYMENT_TARGET_OUTSIDE_SCOPE');} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return resolved;
}
export function pathIdentity(target) {
  try {const stat = fs.lstatSync(target); return {dev: stat.dev, ino: stat.ino};} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}
export function readPathImage(target, {authorizedRoot}) {
  authorizeImagePath(target, authorizedRoot);
  let stat;
  try {stat = fs.lstatSync(target);} catch (error) {if (error.code === 'ENOENT') return {kind: 'absent'}; throw error;}
  if (stat.isSymbolicLink()) return {kind: 'symlink', source: fs.readlinkSync(target)};
  if (stat.isFile()) {const file = boundedRead(target); return {kind: 'file', mode: file.mode, content: file.bytes.toString('base64')};}
  if (!stat.isDirectory()) fail('TREE_IMAGE_UNSAFE');
  const entries = [], prefixes = new Map(); let count = 0, bytes = 0;
  const walk = (directory, relative = '', depth = 0) => {
    if (++count > 512 || depth > 16) fail('TREE_IMAGE_LIMIT_EXCEEDED');
    const info = fs.lstatSync(directory);
    if (!info.isDirectory()) fail('TREE_IMAGE_UNSAFE');
    entries.push({path: relative, kind: 'directory', mode: info.mode & 0o777});
    for (const name of fs.readdirSync(directory).sort()) {
      const child = relative ? `${relative}/${name}` : name, canonical = child.normalize('NFC'), folded = canonical.toLowerCase();
      if (!safeResourceRelativePath(child) || prefixes.has(folded) && prefixes.get(folded) !== canonical) fail('TREE_IMAGE_UNSAFE');
      prefixes.set(folded, canonical);
      const file = path.join(directory, name), type = fs.lstatSync(file);
      if (type.isDirectory()) walk(file, child, depth + 1);
      else if (type.isFile()) {
        if (type.nlink !== 1) fail('TREE_IMAGE_UNSAFE');
        if (++count > 512 || entries.filter(item => item.kind === 'file').length >= 256) fail('TREE_IMAGE_LIMIT_EXCEEDED');
        const read = boundedRead(file); bytes += read.bytes.length; if (bytes > 8 * 1024 * 1024) fail('TREE_IMAGE_LIMIT_EXCEEDED');
        entries.push({path: child, kind: 'file', mode: read.mode, content: read.bytes.toString('base64')});
      } else fail('TREE_IMAGE_UNSAFE');
    }
  };
  walk(target); return {kind: 'directory', entries: entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)};
}
export function imageSummary(image) {
  validatePathImage(image);
  if (image.kind === 'file') {const bytes = Buffer.from(image.content, 'base64'); return {kind: 'file', mode: image.mode, bytes: bytes.length, sha256: hash(bytes)};}
  if (image.kind === 'directory') return {kind: 'directory', entries: image.entries.map(entry => entry.kind === 'directory' ? {...entry}
    : {path: entry.path, ...imageSummary({kind: 'file', mode: entry.mode, content: entry.content})})};
  return {...image};
}
export const imageFingerprint = image => hash(JSON.stringify(imageSummary(image)));
export function materializePathImage(target, image, {authorizedRoot}) {
  validatePathImage(image);
  authorizeImagePath(target, authorizedRoot);
  try {fs.lstatSync(target); fail('ATOMIC_PATH_COLLISION');} catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (image.kind === 'absent') return;
  if (image.kind === 'symlink') {fs.symlinkSync(image.source, target); return;}
  if (image.kind === 'file') {fs.writeFileSync(target, Buffer.from(image.content, 'base64'), {flag: 'wx', mode: 0o600}); fs.chmodSync(target, image.mode); return;}
  if (image.kind !== 'directory') fail('TREE_IMAGE_UNSAFE');
  fs.mkdirSync(target, {mode: 0o700});
  for (const entry of image.entries.filter(item => item.kind === 'directory' && item.path).sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
    if (!safeResourceRelativePath(entry.path)) fail('TREE_IMAGE_UNSAFE'); fs.mkdirSync(path.join(target, entry.path), {mode: 0o700});
  }
  for (const entry of image.entries.filter(item => item.kind === 'file')) {
    if (!safeResourceRelativePath(entry.path)) fail('TREE_IMAGE_UNSAFE'); materializePathImage(path.join(target, entry.path), {kind: 'file', mode: entry.mode, content: entry.content}, {authorizedRoot: target});
  }
  for (const entry of image.entries.filter(item => item.kind === 'directory').sort((a, b) => b.path.split('/').length - a.path.split('/').length)) fs.chmodSync(path.join(target, entry.path), entry.mode);
}
