import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {normalizeUpstreamSource} from '../lib/domain/upstream-source.js';
import {createUpstreamSourceReader, readGitSourceTree, readNpmArchive} from '../lib/infrastructure/upstream-source-reader.js';

const code = value => error => error.code === value;
const commit = 'a'.repeat(40);
const gitSource = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit, subpath: 'skills/review'};
const record = {kind: 'skills', files: [{path: 'SKILL.md'}]};
function archive(entries) {
  const parts = entries.map(({name, text = '', type = '0', mode = 0o644}) => {
    const content = Buffer.from(text), header = Buffer.alloc(512);
    header.write(name); header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
    header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124);
    header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148);
    return Buffer.concat([header, content, Buffer.alloc((512 - content.length % 512) % 512)]);
  });
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
const pkg = (entries = []) => archive([{name: 'package/package.json', text: JSON.stringify({name: '@example/review', version: '1.0.0', scripts: {postinstall: 'must-never-run'}})},
  {name: 'package/skills/review/SKILL.md', text: '# Review\n'}, ...entries]);
const npmSource = bytes => ({schemaVersion: 1, type: 'npm', package: '@example/review', version: '1.0.0',
  integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`, subpath: 'skills/review'});

test('upstream locators require exact immutable pins and reject credentials, transports, mutable tags and unsafe paths', () => {
  assert.deepEqual(normalizeUpstreamSource(gitSource), gitSource);
  const bytes = pkg(); assert.deepEqual(normalizeUpstreamSource(npmSource(bytes)), npmSource(bytes));
  for (const input of [{...gitSource, commit: 'main'}, {...gitSource, repository: 'ssh://git@github.com/example/review'},
    {...gitSource, repository: 'https://user:password@github.com/example/review'}, {...gitSource, repository: 'https://github.com/example/review?token=secret'},
    {...gitSource, subpath: '../escape'}, {...gitSource, extra: true}, {...npmSource(bytes), version: 'latest'},
    {...npmSource(bytes), version: '^1.0.0'}, {...npmSource(bytes), integrity: 'sha1-legacy'}, {...npmSource(bytes), package: '../evil'}]) {
    assert.throws(() => normalizeUpstreamSource(input), code('INVALID_UPSTREAM_SOURCE'));
  }
});

test('npm fetch checks metadata identity and the selected integrity before parsing, never invoking npm or scripts', async () => {
  const bytes = pkg(), locator = npmSource(bytes), calls = [];
  const read = createUpstreamSourceReader({readUrl: async url => {
    calls.push(url);
    return url.endsWith('.tgz') ? bytes : Buffer.from(JSON.stringify({name: locator.package, version: locator.version,
      dist: {integrity: locator.integrity, tarball: 'https://registry.npmjs.org/@example/review/-/review-1.0.0.tgz'}}));
  }});
  const snapshot = await read(locator, record);
  assert.equal(snapshot.files[0].content.toString(), '# Review\n'); assert.equal(snapshot.files[0].path, 'SKILL.md');
  assert.equal(calls.length, 2); assert.equal(snapshot.inventory.length, 1);
  const corrupt = createUpstreamSourceReader({readUrl: async url => url.endsWith('.tgz') ? Buffer.from('wrong')
    : Buffer.from(JSON.stringify({name: locator.package, version: locator.version, dist: {integrity: locator.integrity, tarball: 'https://registry.npmjs.org/review.tgz'}}))});
  await assert.rejects(corrupt(locator, record), code('UPSTREAM_INTEGRITY_MISMATCH'));
  const mismatch = createUpstreamSourceReader({readUrl: async () => Buffer.from(JSON.stringify({name: 'wrong', version: locator.version}))});
  await assert.rejects(mismatch(locator, record), code('UPSTREAM_IDENTITY_MISMATCH'));
  const redirect = createUpstreamSourceReader({readUrl: async () => Buffer.from(JSON.stringify({name: locator.package, version: locator.version,
    dist: {integrity: locator.integrity, tarball: 'https://elsewhere.example/archive.tgz'}}))});
  await assert.rejects(redirect(locator, record), code('UPSTREAM_TRANSPORT_UNSUPPORTED'));
});

test('archive reading is bounded and rejects traversal, links, special entries, collisions, secrets and malformed tar data', () => {
  for (const entry of [{name: 'package/../escape'}, {name: '/absolute'}, {name: 'package/link', type: '2'},
    {name: 'package/hardlink', type: '1'}, {name: 'package/device', type: '3'}, {name: 'package/pax', type: 'x'},
    {name: 'package/skills/review/skill.md'}, {name: 'package/skills/review/SKILL.md'},
    {name: 'package/skills/review/.git/config'}]) {
    const bytes = pkg([entry]); assert.throws(() => readNpmArchive(bytes, npmSource(bytes), record), code('UPSTREAM_ARCHIVE_UNSAFE'));
  }
  const secret = pkg([{name: 'package/skills/review/secret.txt', text: 'API_TOKEN = "literal"'}]);
  assert.throws(() => readNpmArchive(secret, npmSource(secret), record), code('LITERAL_SECRET'));
  const large = pkg([{name: 'package/skills/review/large', text: 'x'.repeat(1024 * 1024 + 1)}]);
  assert.throws(() => readNpmArchive(large, npmSource(large), record), code('IMPORT_SOURCE_LIMIT_EXCEEDED'));
  assert.throws(() => readNpmArchive(Buffer.from('invalid'), npmSource(Buffer.from('invalid')), record), code('UPSTREAM_ARCHIVE_UNSAFE'));
});

test('single-file upstreams retain the native filename and MCP imports select one server without copying sibling credentials', () => {
  const bytes = pkg([{name: 'package/settings.json', text: JSON.stringify({mcpServers: {docs: {command: 'docs', args: ['--preserved'], extension: true},
    sibling: {env: {API_TOKEN: 'never-copy'}}}})}]);
  const snapshot = readNpmArchive(bytes, {...npmSource(bytes), subpath: 'settings.json'}, {kind: 'mcpServers', format: 'json-section', nativeId: 'docs', files: [{path: 'mcp_config.json'}]});
  assert.equal(snapshot.files[0].path, 'mcp_config.json');
  assert.deepEqual(JSON.parse(snapshot.files[0].content), {mcpServers: {docs: {command: 'docs', args: ['--preserved'], extension: true}}});
  for (const kind of ['agents', 'instructions']) {
    const text = '# Instructions\n', single = pkg([{name: 'package/document.md', text}]);
    const result = readNpmArchive(single, {...npmSource(single), subpath: 'document.md'}, {kind, files: [{path: 'original.md'}]});
    assert.equal(result.files[0].path, 'original.md'); assert.equal(result.files[0].content.toString(), text);
  }
});

test('Git reads committed raw blobs, ignores working edits and export filters, and refuses links and submodules', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-git-source-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (args, input) => execFileSync('git', args, {cwd: root, input, encoding: 'utf8', env: {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'}}).trim();
  git(['init', '--quiet', '--template=']);
  fs.mkdirSync(path.join(root, 'skills/review'), {recursive: true});
  fs.writeFileSync(path.join(root, 'skills/review/SKILL.md'), '# Committed $Format:%H$\n');
  fs.writeFileSync(path.join(root, '.gitattributes'), '* export-subst\n');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  const pinned = {...gitSource, commit: git(['rev-parse', 'HEAD'])};
  fs.writeFileSync(path.join(root, 'skills/review/SKILL.md'), '# Working edit\n');
  const snapshot = readGitSourceTree({gitDir: path.join(root, '.git'), locator: pinned, record});
  assert.equal(snapshot.files[0].content.toString(), '# Committed $Format:%H$\n');
  const read = createUpstreamSourceReader({acquireGit: async (locator, consume) => {
    assert.deepEqual(locator, pinned); return consume(path.join(root, '.git'));
  }});
  assert.deepEqual((await read(pinned, record)).inventory, snapshot.inventory);
  fs.symlinkSync('SKILL.md', path.join(root, 'skills/review/link'));
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'link']);
  assert.throws(() => readGitSourceTree({gitDir: path.join(root, '.git'), locator: {...pinned, commit: git(['rev-parse', 'HEAD'])}, record}), code('UPSTREAM_TREE_UNSAFE'));
  git(['update-index', '--add', '--cacheinfo', `160000,${pinned.commit},skills/submodule`]);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'submodule']);
  assert.throws(() => readGitSourceTree({gitDir: path.join(root, '.git'), locator: {...pinned, commit: git(['rev-parse', 'HEAD']), subpath: 'skills/submodule'}, record}), code('UPSTREAM_TREE_UNSAFE'));
  // Construct the invalid name in a Git object: macOS filesystems cannot create it as a working file.
  const blob = git(['rev-parse', `${pinned.commit}:skills/review/SKILL.md`]);
  const badTree = git(['mktree', '-z'], Buffer.concat([Buffer.from(`100644 blob ${blob}\tSKILL.md\0`), Buffer.from(`100644 blob ${blob}\t`), Buffer.from([255, 0])]));
  const rootTree = git(['mktree', '-z'], Buffer.from(`040000 tree ${badTree}\tbad\0`));
  const badCommit = git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', rootTree, '-m', 'invalid name']);
  assert.throws(() => readGitSourceTree({gitDir: path.join(root, '.git'), locator: {...pinned, commit: badCommit, subpath: 'bad'}, record}), code('UPSTREAM_TREE_UNSAFE'));
});
