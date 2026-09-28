import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {loadManifestFile, validateManifestDocument, resolveAssetSources} from './manifest-loader.js';
import {resolveManifestDependencies} from '../domain/manifest.js';

export const BUNDLE_LIMITS = Object.freeze({bytes: 8 * 1024 * 1024, fileBytes: 1024 * 1024, files: 256});
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = ['instructions', 'skills', 'agents', 'mcpServers'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code = 'INVALID_RESOURCE_BUNDLE') => { throw domainError(code, 'Resource bundle does not satisfy the bounded v1 contract'); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail();
}
function safePath(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^sources\/[A-Za-z0-9_./-]+$/.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) fail('UNSAFE_BUNDLE_PATH');
}
function text(bytes) {
  if (bytes.length > BUNDLE_LIMITS.fileBytes) fail('RESOURCE_BUNDLE_LIMIT');
  let value;
  try { value = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); } catch { fail('INVALID_BUNDLE_TEXT'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\ud800-\udfff]/u.test(value)) fail('INVALID_BUNDLE_TEXT');
  if (/(?:\b(?:sk-(?:ant-)?|gh[pousr]_|github_pat_|AIza)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(value)) fail('LITERAL_SECRET');
  return value;
}

// Every component must be a real file/directory. Symlinks and special files are
// rejected before reads, including a source's intermediate directories.
export function readBundleFile(root, relative, limit = BUNDLE_LIMITS.fileBytes) {
  if (!path.isAbsolute(root) || fs.realpathSync(root) !== root) fail('UNSAFE_BUNDLE_PATH');
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail('UNSAFE_BUNDLE_PATH');
  let cursor = root;
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) fail('UNSAFE_BUNDLE_PATH');
  }
  const fd = fs.openSync(cursor, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > limit) fail('RESOURCE_BUNDLE_LIMIT');
    // Bounded descriptor read: a concurrently growing file cannot allocate freely.
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0, count;
    while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null))) length += count;
    const after = fs.fstatSync(fd), current = fs.lstatSync(cursor);
    if (length !== before.size || before.ino !== current.ino || before.dev !== current.dev || !current.isFile()
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || fs.realpathSync(cursor) !== cursor) fail('RESOURCE_BUNDLE_CHANGED');
    return buffer.subarray(0, length);
  } finally { fs.closeSync(fd); }
}

export function validateResourceBundle(bundle) {
  fields(bundle, ['schemaVersion', 'kind', 'resource', 'manifest', 'files']);
  if (bundle.schemaVersion !== 1 || bundle.kind !== 'agent-kit-resource-bundle') fail();
  fields(bundle.resource, ['id', 'version']);
  if (typeof bundle.resource.id !== 'string' || !ID.test(bundle.resource.id)
    || !Number.isSafeInteger(bundle.resource.version) || bundle.resource.version < 1) fail();
  fields(bundle.manifest, ['schemaVersion', 'kit', 'assets', 'targets', 'defaults']);
  fields(bundle.manifest.kit, ['id', 'displayName', 'description']);
  fields(bundle.manifest.defaults || {}, ['mcpBindings']);
  fields(bundle.manifest.assets, KINDS);
  const manifest = validateManifestDocument(bundle.manifest);
  const assets = KINDS.flatMap(kind => manifest.assets[kind]);
  if (!assets.length || assets.length > 64) fail('RESOURCE_BUNDLE_LIMIT');
  for (const asset of assets) {
    fields(asset, ['id', 'kind', 'scope', 'displayName', 'definition', 'source', 'dependsOn', 'requires', 'uses', 'provides', 'tools', 'policies', 'allow', 'deny', 'policy']);
    if (!asset.definition) fail('BUNDLE_NATIVE_SOURCE_UNSUPPORTED');
    if (['instructions', 'skills'].includes(asset.kind)) {
      if (asset.source !== `sources/${asset.id}${asset.kind === 'instructions' ? '.md' : ''}`) fail('UNSAFE_BUNDLE_PATH');
    } else if (asset.source !== undefined) fail('BUNDLE_NATIVE_SOURCE_UNSUPPORTED');
  }
  for (const asset of assets) {
    const dependencies = resolveManifestDependencies(manifest, {selectedAssetIds: [asset.id], targetScope: asset.scope});
    if (!dependencies.valid) fail('MANIFEST_DEPENDENCY_INVALID');
  }
  if (!Array.isArray(bundle.files) || bundle.files.length > BUNDLE_LIMITS.files) fail('RESOURCE_BUNDLE_LIMIT');
  const paths = new Set(), folded = new Set(), prefixes = new Map();
  let previous = '';
  for (const file of bundle.files) {
    fields(file, ['path', 'content', 'sha256']); safePath(file.path);
    if (typeof file.content !== 'string' || typeof file.sha256 !== 'string' || !HASH.test(file.sha256)) fail();
    const bytes = Buffer.from(file.content);
    if (text(bytes) !== file.content || hash(bytes) !== file.sha256) fail('RESOURCE_BUNDLE_HASH_MISMATCH');
    if (file.path <= previous || folded.has(file.path.toLowerCase())) fail('UNSAFE_BUNDLE_PATH');
    const parts = file.path.split('/');
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join('/'), key = prefix.toLowerCase();
      if (prefixes.has(key) && prefixes.get(key) !== prefix) fail('UNSAFE_BUNDLE_PATH');
      prefixes.set(key, prefix);
    }
    previous = file.path; paths.add(file.path); folded.add(file.path.toLowerCase());
    if (!assets.some(asset => asset.kind === 'skills' ? file.path.startsWith(`${asset.source}/`) : file.path === asset.source)) fail('UNREFERENCED_BUNDLE_FILE');
  }
  for (const file of paths) {
    if (file.split('/').slice(0, -1).some((_, i, parts) => paths.has(parts.slice(0, i + 1).join('/')))) fail('UNSAFE_BUNDLE_PATH');
  }
  for (const asset of assets.filter(asset => asset.source)) {
    if (!paths.has(asset.kind === 'skills' ? `${asset.source}/SKILL.md` : asset.source)) fail('BUNDLE_SOURCE_MISSING');
  }
  text(Buffer.from(JSON.stringify(bundle.manifest)));
  const bytes = Buffer.from(canonical(bundle));
  if (bytes.length > BUNDLE_LIMITS.bytes) fail('RESOURCE_BUNDLE_LIMIT');
  return {bundle, bytes, sha256: hash(bytes)};
}

export function decodeResourceBundle(bytes, expectedSha256) {
  if (!Buffer.isBuffer(bytes) || bytes.length > BUNDLE_LIMITS.bytes) fail('RESOURCE_BUNDLE_LIMIT');
  if (typeof expectedSha256 !== 'string' || !HASH.test(expectedSha256) || hash(bytes) !== expectedSha256) fail('RESOURCE_BUNDLE_HASH_MISMATCH');
  let bundle;
  try { bundle = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); } catch { fail(); }
  const validated = validateResourceBundle(bundle);
  if (!validated.bytes.equals(bytes)) fail('NONCANONICAL_RESOURCE_BUNDLE');
  return validated;
}

export function createResourceBundle({manifestPath, resourceId, version}) {
  const scopeRoot = fs.realpathSync(path.dirname(manifestPath));
  // Reject an oversized or linked manifest before the ordinary loader parses it.
  readBundleFile(scopeRoot, path.basename(manifestPath));
  const loaded = loadManifestFile({manifestPath, scopeRoot, resolveSources: false});
  const manifest = structuredClone(loaded.manifest), files = [];
  let entriesVisited = 0;
  const append = (relative, target) => {
    safePath(target);
    if (files.length >= BUNDLE_LIMITS.files) fail('RESOURCE_BUNDLE_LIMIT');
    const content = text(readBundleFile(scopeRoot, relative));
    files.push({path: target, content, sha256: hash(Buffer.from(content))});
    if (files.reduce((size, file) => size + Buffer.byteLength(file.content), 0) > BUNDLE_LIMITS.bytes) fail('RESOURCE_BUNDLE_LIMIT');
  };
  for (const [kind, assets] of Object.entries(manifest.assets)) {
    if (!KINDS.includes(kind)) { if (assets.length) fail('BUNDLE_ASSET_UNSUPPORTED'); delete manifest.assets[kind]; continue; }
    for (const asset of assets) {
      if (!asset.definition) fail('BUNDLE_NATIVE_SOURCE_UNSUPPORTED');
      if (!['instructions', 'skills'].includes(kind)) continue;
      const source = asset.source;
      if (typeof source !== 'string' || path.isAbsolute(source) || source.split('/').some(part => !part || part === '.' || part === '..')) fail('UNSAFE_BUNDLE_PATH');
      asset.source = `sources/${asset.id}${kind === 'instructions' ? '.md' : ''}`;
      const walk = (relative, target, depth = 0) => {
        if (depth > 16 || ++entriesVisited > BUNDLE_LIMITS.files * 2) fail('RESOURCE_BUNDLE_LIMIT');
        // Check all ancestors before enumerating a directory.
        let cursor = scopeRoot;
        for (const part of relative.split('/')) {
          cursor = path.join(cursor, part);
          if (fs.lstatSync(cursor).isSymbolicLink()) fail('UNSAFE_BUNDLE_PATH');
        }
        const stat = fs.lstatSync(cursor);
        if (stat.isDirectory()) {
          const entries = fs.readdirSync(cursor).sort();
          if (entries.length > BUNDLE_LIMITS.files) fail('RESOURCE_BUNDLE_LIMIT');
          for (const name of entries) walk(`${relative}/${name}`, `${target}/${name}`, depth + 1);
        } else { if (!stat.isFile()) fail('UNSAFE_BUNDLE_PATH'); append(relative, target); }
      };
      walk(source, asset.source);
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return validateResourceBundle({schemaVersion: 1, kind: 'agent-kit-resource-bundle', resource: {id: resourceId, version}, manifest, files});
}

export function verifyStagedBundle(scopeRoot, bundle) {
  const expected = new Map([['agent-kit.json', Buffer.from(canonical(bundle.manifest))], ...bundle.files.map(file => [file.path, Buffer.from(file.content)])]);
  const visit = (relative = '') => {
    for (const name of fs.readdirSync(path.join(scopeRoot, relative))) {
      const file = relative ? `${relative}/${name}` : name;
      if (fs.lstatSync(path.join(scopeRoot, file)).isDirectory()) {
        if (![...expected.keys()].some(item => item.startsWith(`${file}/`))) fail('RESOURCE_BUNDLE_CHANGED');
        visit(file);
      } else {
        const bytes = expected.get(file);
        if (!bytes || !readBundleFile(scopeRoot, file, BUNDLE_LIMITS.bytes).equals(bytes)) fail('RESOURCE_BUNDLE_CHANGED');
        expected.delete(file);
      }
    }
  };
  visit();
  if (expected.size) fail('BUNDLE_SOURCE_MISSING');
  resolveAssetSources(validateManifestDocument(bundle.manifest), scopeRoot);
}

export function stageResourceBundle({parent, bundle}) {
  validateResourceBundle(bundle);
  if (fs.realpathSync(parent) !== parent) fail('UNSAFE_BUNDLE_PATH');
  const scopeRoot = fs.mkdtempSync(path.join(parent, 'bundle-'));
  fs.chmodSync(scopeRoot, 0o700);
  try {
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.json'), canonical(bundle.manifest), {flag: 'wx', mode: 0o600});
    for (const file of bundle.files) {
      const target = path.join(scopeRoot, file.path);
      fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
      fs.writeFileSync(target, file.content, {flag: 'wx', mode: 0o600});
    }
    verifyStagedBundle(scopeRoot, bundle);
    return scopeRoot;
  } catch (error) { fs.rmSync(scopeRoot, {recursive: true, force: true}); throw error; }
}
