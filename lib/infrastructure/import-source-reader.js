import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {extractNativeMcpSource} from '../adapters/mcp/import.js';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const LIMITS = {bytes: 8 * 1024 * 1024, fileBytes: 1024 * 1024, files: 256, entries: 512, depth: 16};

function fail(code = 'IMPORT_SOURCE_UNSAFE') {
  throw domainError(code, 'The selected source cannot be safely imported without changing the original');
}

export function assertImportContentSafe(bytes) {
  const text = bytes.toString('utf8');
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-(?:ant-)?|gh[pousr]_|github_pat_|AIza)[A-Za-z0-9_-]{8,}|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/i.test(text)) {
    throw domainError('LITERAL_SECRET', 'The selected source contains a credential-like literal');
  }
  for (const line of text.split(/\r?\n/)) {
    const assignment = /^\s*["']?([A-Za-z0-9_-]*(?:token|password|passwd|secret|api[-_]?key|credential|authorization|cookie)[A-Za-z0-9_-]*)["']?\s*[:=]\s*["']?(.+?)\s*[,;]?\s*$/i.exec(line);
    if (assignment && !/^\$\{[A-Za-z_][A-Za-z0-9_]*}|^\{\{[A-Za-z_][A-Za-z0-9_]*}}|^env:[A-Za-z_][A-Za-z0-9_]*/.test(assignment[2])) {
      throw domainError('LITERAL_SECRET', 'The selected source requires a credential reference');
    }
  }
  for (const value of text.match(/https?:\/\/[^\s"'<>]+/g) || []) {
    try {
      const url = new URL(value);
      if (url.username || url.password || [...url.searchParams.keys()].some(key => /token|password|secret|api[-_]?key|credential/i.test(key))) {
        throw domainError('LITERAL_SECRET', 'The selected source contains an authenticated URL');
      }
    } catch (error) { if (error.code === 'LITERAL_SECRET') throw error; }
  }
}

export function boundedRead(file) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size > LIMITS.fileBytes) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    const bytes = Buffer.alloc(LIMITS.fileBytes + 1);
    let size = 0, count;
    while ((count = fs.readSync(descriptor, bytes, size, bytes.length - size, null))) {
      size += count;
      if (size > LIMITS.fileBytes) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    }
    const after = fs.fstatSync(descriptor);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || size !== after.size) fail('IMPORT_SOURCE_CHANGED');
    return {bytes: bytes.subarray(0, size), mode: before.mode & 0o777};
  } finally { fs.closeSync(descriptor); }
}

export function readImportSource({source, authorizedRoot, kind, nativeId, format}) {
  const root = resolveForAuthorization(authorizedRoot);
  const original = fs.lstatSync(source);
  const linkText = original.isSymbolicLink() ? fs.readlinkSync(source) : null;
  const resolved = fs.realpathSync(source);
  if (!isWithinRoot(path.resolve(source), path.resolve(authorizedRoot)) || !isWithinRoot(resolved, root)) fail();
  const files = [];
  let entries = 0, bytes = 0;
  function visit(file, relative, depth) {
    if (++entries > LIMITS.entries || depth > LIMITS.depth) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    if (!isWithinRoot(fs.realpathSync(file), root)) fail();
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail();
    if (stat.isDirectory()) {
      const children = fs.readdirSync(file).sort();
      if (relative && !children.length) fail('IMPORT_EMPTY_DIRECTORY_UNSUPPORTED');
      for (const entry of children) {
        if (['.git', '.agent-kit', '.agents-kit', '.kit-sources'].includes(entry) || /[\u0000-\u001f\u007f\\]/.test(entry)) fail();
        visit(path.join(file, entry), relative ? `${relative}/${entry}` : entry, depth + 1);
      }
      return;
    }
    if (files.length >= LIMITS.files) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    let read = boundedRead(file);
    if (kind === 'mcpServers') read = {...read, bytes: extractNativeMcpSource({text: new TextDecoder('utf-8', {fatal: true}).decode(read.bytes), nativeId, format})};
    assertImportContentSafe(read.bytes);
    bytes += read.bytes.length;
    if (bytes > LIMITS.bytes) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    files.push({path: relative, mode: read.mode, sha256: hash(read.bytes), content: read.bytes});
  }
  const directory = fs.statSync(resolved).isDirectory();
  if ((kind === 'skills' || kind === 'bundle') !== directory) fail();
  visit(resolved, directory ? '' : path.basename(source), 0);
  if (!files.length || (kind === 'skills' && !files.some(file => file.path === 'SKILL.md'))) fail();
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) fail();
  const inventory = files.map(({path, mode, sha256}) => ({path, mode, sha256}));
  return {files, inventory, byteCount: bytes, fingerprint: hash(JSON.stringify({files: inventory, linkText})), linkText};
}
