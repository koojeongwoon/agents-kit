import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {gunzipSync} from 'node:zlib';
import {domainError} from '../domain/errors.js';
import {normalizeUpstreamSource, publicHttpsUrl, safeResourceRelativePath} from '../domain/upstream-source.js';
import {assertImportContentSafe} from './import-source-reader.js';
import {extractNativeMcpSource} from '../adapters/mcp/import.js';
import {sourceInventory} from './kit-source-snapshot.js';

const MiB = 1024 * 1024;
const execute = promisify(execFile);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => {throw domainError(code, 'The pinned upstream could not be read safely; the Kit copy and installed resources are preserved');};
const safePath = name => safeResourceRelativePath(name) && name.split('/').length <= 16
  && !name.split('/').some(part => ['.git', '.agent-kit', '.agents-kit', '.kit-sources'].includes(part.toLowerCase()));

function readHttpsBytes(value, limit) {
  if (!publicHttpsUrl(value)) fail('UPSTREAM_TRANSPORT_UNSUPPORTED');
  return new Promise((resolve, reject) => {
    const request = https.get(value, {headers: {'user-agent': 'agents-kit-source-reader', accept: 'application/json, application/octet-stream'},
      signal: AbortSignal.timeout(30000)}, response => {
      if (response.statusCode !== 200) {response.resume(); reject(domainError('UPSTREAM_UNAVAILABLE', 'The pinned upstream is unavailable; redirects and authentication are unsupported')); return;}
      let size = 0;
      const chunks = [];
      response.on('data', bytes => {
        size += bytes.length;
        if (size > limit) {response.destroy(domainError('IMPORT_SOURCE_LIMIT_EXCEEDED', 'Upstream download exceeds the source limit')); return;}
        chunks.push(bytes);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', error => reject(error.code === 'IMPORT_SOURCE_LIMIT_EXCEEDED' ? error
      : domainError('UPSTREAM_UNAVAILABLE', 'The pinned upstream is unavailable')));
  });
}

function snapshotOf(entries, locator, record, unsafeCode) {
  const selected = entries.filter(file => record.kind === 'skills' ? file.path.startsWith(`${locator.subpath}/`) : file.path === locator.subpath);
  if (!selected.length || record.kind !== 'skills' && selected.length !== 1) fail('UPSTREAM_SOURCE_NOT_FOUND');
  let bytes = 0;
  const names = new Set(), files = [];
  for (const file of selected) {
    const name = record.kind === 'skills' ? file.path.slice(locator.subpath.length + 1) : record.files[0].path;
    const portable = name.normalize('NFC').toLowerCase();
    if (!safePath(name) || names.has(portable) || file.mode < 0 || file.mode > 0o777) fail(unsafeCode);
    names.add(portable);
    if (file.content.length > MiB || (bytes += file.content.length) > 8 * MiB || files.length >= 256) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    let content = file.content;
    if (record.kind === 'mcpServers') {
      let text;
      try {text = new TextDecoder('utf-8', {fatal: true}).decode(content);} catch {fail(unsafeCode);}
      content = extractNativeMcpSource({text, nativeId: record.nativeId, format: record.format});
    }
    assertImportContentSafe(content);
    files.push({path: name, content, mode: file.mode, sha256: hash(content)});
  }
  for (const name of names) if ([...names].some(other => other !== name && other.startsWith(`${name}/`))) fail(unsafeCode);
  if (record.kind === 'skills' && !files.some(file => file.path === 'SKILL.md')) fail('SOURCE_PRIMARY_FILE_REQUIRED');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const inventory = sourceInventory(files);
  return {files, inventory, byteCount: files.reduce((size, file) => size + file.content.length, 0), fingerprint: hash(JSON.stringify({files: inventory, linkText: null})), linkText: null};
}

function gitEnvironment(root) {
  return {PATH: process.env.PATH || '/usr/bin:/bin', HOME: root, XDG_CONFIG_HOME: root,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ATTR_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0'};
}
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'protocol.allow=never',
  '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false'];
function git(args, {root, limit = MiB} = {}) {
  try {
    return execFileSync('git', [...gitOptions, ...args],
    {cwd: root, env: gitEnvironment(root), timeout: 30000, maxBuffer: limit, stdio: ['ignore', 'pipe', 'pipe']});
  } catch (error) {fail(error.code === 'ENOBUFS' ? 'IMPORT_SOURCE_LIMIT_EXCEEDED' : 'UPSTREAM_UNAVAILABLE');}
}
async function acquireGitRepository(locator, consume) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-upstream-'));
  try {
    git(['init', '--quiet', '--bare', '--template=', ...(locator.commit.length === 64 ? ['--object-format=sha256'] : []), root], {root});
    try {
      await execute('git', [...gitOptions, '--git-dir', root, 'fetch', '--quiet', '--no-tags', '--depth=1', '--no-recurse-submodules', '--', locator.repository, locator.commit],
        {cwd: root, env: gitEnvironment(root), timeout: 30000, maxBuffer: MiB});
    } catch {fail('UPSTREAM_UNAVAILABLE');}
    return consume(root);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
}

export function readGitSourceTree({gitDir, locator: value, record}) {
  const locator = normalizeUpstreamSource(value), root = path.dirname(gitDir);
  if (locator.type !== 'git') fail('INVALID_UPSTREAM_SOURCE');
  const run = (args, limit) => git(['--git-dir', gitDir, ...args], {root, limit});
  if (run(['rev-parse', '--verify', `${locator.commit}^{commit}`]).toString().trim() !== locator.commit) fail('UPSTREAM_IDENTITY_MISMATCH');
  const tree = run(['ls-tree', '-r', '-l', '-z', '--full-tree', locator.commit, '--', locator.subpath], 512 * 1024);
  let rows;
  try {rows = new TextDecoder('utf-8', {fatal: true}).decode(tree).split('\0').filter(Boolean);}
  catch {fail('UPSTREAM_TREE_UNSAFE');}
  if (rows.length > 512) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
  const entries = [];
  let bytes = 0;
  for (const row of rows) {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64}) +([0-9]+)\t(.+)$/.exec(row);
    if (!match || !safePath(match[4])) fail('UPSTREAM_TREE_UNSAFE');
    const size = Number(match[3]);
    if (size > MiB || (bytes += size) > 8 * MiB) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    const content = run(['cat-file', 'blob', match[2]], MiB + 1);
    if (content.length !== size) fail('UPSTREAM_IDENTITY_MISMATCH');
    entries.push({path: match[4], content, mode: match[1] === '100755' ? 0o755 : 0o644});
  }
  return snapshotOf(entries, locator, record, 'UPSTREAM_TREE_UNSAFE');
}

export function readNpmArchive(bytes, value, record) {
  const locator = normalizeUpstreamSource(value);
  if (locator.type !== 'npm') fail('INVALID_UPSTREAM_SOURCE');
  if (bytes.length > 8 * MiB) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
  if (`sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` !== locator.integrity) fail('UPSTREAM_INTEGRITY_MISMATCH');
  let tar;
  try {tar = gunzipSync(bytes, {maxOutputLength: 16 * MiB});} catch (error) {
    fail(error.code === 'ERR_BUFFER_TOO_LARGE' ? 'IMPORT_SOURCE_LIMIT_EXCEEDED' : 'UPSTREAM_ARCHIVE_UNSAFE');
  }
  const entries = [], names = new Set(), types = new Map();
  const field = (header, from, size) => {
    const bytes = header.subarray(from, from + size), end = bytes.indexOf(0);
    try {return new TextDecoder('utf-8', {fatal: true}).decode(end === -1 ? bytes : bytes.subarray(0, end));} catch {fail('UPSTREAM_ARCHIVE_UNSAFE');}
  };
  const octal = text => {
    const clean = text.trim();
    if (!/^[0-7]+$/.test(clean)) fail('UPSTREAM_ARCHIVE_UNSAFE');
    return parseInt(clean, 8);
  };
  let offset = 0, count = 0, ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      if (tar.length - offset < 512 || !tar.subarray(offset).every(byte => byte === 0)) fail('UPSTREAM_ARCHIVE_UNSAFE');
      ended = true; break;
    }
    if (++count > 512) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    const checksum = octal(field(header, 148, 8)), check = Buffer.from(header); check.fill(32, 148, 156);
    if (check.reduce((sum, byte) => sum + byte, 0) !== checksum) fail('UPSTREAM_ARCHIVE_UNSAFE');
    const type = field(header, 156, 1) || '0', prefix = field(header, 345, 155);
    let name = `${prefix ? `${prefix}/` : ''}${field(header, 0, 100)}`;
    if (type === '5' && name.endsWith('/')) name = name.slice(0, -1);
    const portable = name.normalize('NFC').toLowerCase();
    if (!['0', '5'].includes(type) || !safePath(name) || !(name === 'package' || name.startsWith('package/'))
      || names.has(portable) || field(header, 157, 100)) fail('UPSTREAM_ARCHIVE_UNSAFE');
    names.add(portable); types.set(portable, type);
    const size = octal(field(header, 124, 12)), mode = octal(field(header, 100, 8));
    if (mode > 0o777 || type === '5' && size !== 0) fail('UPSTREAM_ARCHIVE_UNSAFE');
    if (size > MiB) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    if (offset + Math.ceil(size / 512) * 512 > tar.length) fail('UPSTREAM_ARCHIVE_UNSAFE');
    if (type === '0') entries.push({path: name.slice(8), mode, content: tar.subarray(offset, offset + size)});
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended || tar.length % 512) fail('UPSTREAM_ARCHIVE_UNSAFE');
  for (const name of names) for (let index = name.indexOf('/'); index !== -1; index = name.indexOf('/', index + 1)) {
    if (types.get(name.slice(0, index)) === '0') fail('UPSTREAM_ARCHIVE_UNSAFE');
  }
  let metadata;
  try {metadata = JSON.parse(entries.find(file => file.path === 'package.json')?.content.toString('utf8'));} catch {fail('UPSTREAM_IDENTITY_MISMATCH');}
  if (metadata.name !== locator.package || metadata.version !== locator.version) fail('UPSTREAM_IDENTITY_MISMATCH');
  return snapshotOf(entries, locator, record, 'UPSTREAM_ARCHIVE_UNSAFE');
}

export function createUpstreamSourceReader({readUrl = readHttpsBytes, acquireGit = acquireGitRepository} = {}) {
  return async (value, record) => {
    const locator = normalizeUpstreamSource(value);
    if (locator.type === 'git') return acquireGit(locator, gitDir => readGitSourceTree({gitDir, locator, record}));
    const metadataBytes = await readUrl(`https://registry.npmjs.org/${encodeURIComponent(locator.package)}/${encodeURIComponent(locator.version)}`, MiB);
    if (metadataBytes.length > MiB) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    let metadata;
    try {metadata = JSON.parse(metadataBytes.toString('utf8'));} catch {fail('UPSTREAM_IDENTITY_MISMATCH');}
    if (metadata.name !== locator.package || metadata.version !== locator.version) fail('UPSTREAM_IDENTITY_MISMATCH');
    if (metadata.dist?.integrity !== locator.integrity) fail('UPSTREAM_INTEGRITY_MISMATCH');
    const url = publicHttpsUrl(metadata.dist?.tarball);
    if (!url || url.hostname !== 'registry.npmjs.org') fail('UPSTREAM_TRANSPORT_UNSUPPORTED');
    return readNpmArchive(await readUrl(url.href, 8 * MiB), locator, record);
  };
}
