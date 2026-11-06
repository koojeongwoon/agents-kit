import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createSkillSnapshotDescriptor, validateSkillSnapshotDescriptor, diffSkillSnapshots} from '../lib/domain/skill-snapshot.js';
import {SkillSnapshotStore, prepareSkillSnapshot} from '../lib/infrastructure/skill-snapshot-store.js';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const file = (name, text, mode = 0o644) => ({path: name, content: Buffer.from(text), bytes: Buffer.byteLength(text), sha256: hash(text), mode});
const inventory = files => files.map(({path, sha256, mode, bytes}) => ({path, sha256, mode, bytes}));
const code = expected => error => error.code === expected;
function removeFixture(root) {
  const visit = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) visit(path.join(file, name));}
    else fs.chmodSync(file, 0o600);
  };
  visit(root); fs.rmSync(root, {recursive: true, force: true});
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-snapshot-')));
  t.after(() => removeFixture(root));
  const homeDir = path.join(root, 'home'), source = path.join(root, 'kit/review');
  fs.mkdirSync(source, {recursive: true}); fs.mkdirSync(homeDir);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '# Skill\n');
  fs.mkdirSync(path.join(source, 'scripts')); fs.writeFileSync(path.join(source, 'scripts/run.sh'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  return {root, homeDir, source, store: new SkillSnapshotStore({homeDir})};
}

test('snapshot digest is canonical, includes bytes and modes, and diff describes updates/additions/deletions', () => {
  const files = [file('SKILL.md', '# Skill\n'), file('scripts/run.sh', 'exit 0\n', 0o755)];
  const first = createSkillSnapshotDescriptor(inventory(files));
  assert.deepEqual(createSkillSnapshotDescriptor(inventory([...files].reverse())), first);
  assert.deepEqual(validateSkillSnapshotDescriptor(first), first);
  const next = createSkillSnapshotDescriptor(inventory([file('SKILL.md', '# Updated\n', 0o600), file('new.bin', '\0binary')]));
  assert.notEqual(first.treeDigest, next.treeDigest);
  assert.deepEqual(diffSkillSnapshots(first, next).map(item => [item.path, item.operation]), [['SKILL.md', 'UPDATE'], ['new.bin', 'CREATE'], ['scripts/run.sh', 'REMOVE']]);
  assert.notEqual(createSkillSnapshotDescriptor(inventory([file('SKILL.md', '# Skill\n', 0o600), files[1]])).treeDigest, first.treeDigest);
  assert.throws(() => validateSkillSnapshotDescriptor({...first, treeDigest: '0'.repeat(64)}), code('INVALID_SKILL_SNAPSHOT'));
});

test('descriptor validation rejects aliases, file/directory conflicts, unsafe names, special modes and resource overflow', () => {
  const primary = file('SKILL.md', '# Skill\n');
  for (const entries of [[primary, file('skill.md', 'alias')], [primary, file('../escape', 'x')], [primary, file('a', 'x'), file('a/b', 'x')],
    [primary, file('A/x', 'x'), file('a/y', 'x')], [primary, file('.git/config', 'x')], [primary, file('bad\\name', 'x')],
    [primary, {...file('special', 'x'), mode: 0o4644}], [primary, {...file('large', 'x'), bytes: 1024 * 1024 + 1}]]) {
    assert.throws(() => createSkillSnapshotDescriptor(inventory(entries)), error => ['INVALID_SKILL_SNAPSHOT', 'SKILL_SNAPSHOT_LIMIT_EXCEEDED'].includes(error.code));
  }
  assert.throws(() => createSkillSnapshotDescriptor(inventory([file('other', 'x')])), code('INVALID_SKILL_SNAPSHOT'));
  assert.throws(() => createSkillSnapshotDescriptor(inventory([primary, ...Array.from({length: 256}, (_, index) => file(`file-${index}`, 'x'))])), code('SKILL_SNAPSHOT_LIMIT_EXCEEDED'));
});

test('snapshot preparation never creates the store; publish seals bytes, reuses exact contents, and detects mode/content drift', t => {
  const f = fixture(t);
  const prepared = prepareSkillSnapshot({source: f.source, authorizedRoot: path.dirname(f.source), store: f.store});
  assert.equal(prepared.status, 'absent'); assert.equal(fs.existsSync(f.store.root), false);
  const altered = {...prepared, files: prepared.files.map(file => ({...file, content: Buffer.from('changed')}))};
  assert.throws(() => f.store.publish(altered), code('SKILL_SNAPSHOT_INPUT_CHANGED')); assert.equal(fs.existsSync(f.store.root), false);
  const stored = f.store.publish(prepared);
  assert.equal(stored.reused, false); assert.equal(fs.readFileSync(path.join(stored.tree, 'SKILL.md'), 'utf8'), '# Skill\n');
  assert.equal(fs.statSync(path.join(stored.tree, 'SKILL.md')).mode & 0o777, 0o444);
  assert.equal(fs.statSync(path.join(stored.tree, 'scripts/run.sh')).mode & 0o777, 0o555);
  assert.equal(f.store.inspect(prepared.descriptor).status, 'present');
  assert.equal(f.store.publish(prepared).reused, true);
  fs.appendFileSync(path.join(f.source, 'SKILL.md'), 'Local editing\n');
  assert.equal(fs.readFileSync(path.join(stored.tree, 'SKILL.md'), 'utf8'), '# Skill\n');
  fs.chmodSync(path.join(stored.tree, 'SKILL.md'), 0o644);
  assert.throws(() => f.store.inspect(prepared.descriptor), code('SKILL_SNAPSHOT_DRIFT'));
  fs.chmodSync(path.join(stored.tree, 'SKILL.md'), 0o444);
  fs.chmodSync(path.join(stored.tree, 'SKILL.md'), 0o644); fs.writeFileSync(path.join(stored.tree, 'SKILL.md'), '# Tampered\n'); fs.chmodSync(path.join(stored.tree, 'SKILL.md'), 0o444);
  assert.throws(() => f.store.publish(prepared), code('SKILL_SNAPSHOT_DRIFT'));
});

test('snapshot reads reject internal links, extra entries, escaping store parents and descriptor collisions', t => {
  const f = fixture(t);
  fs.symlinkSync('/external/ego-skills', path.join(f.source, 'external'));
  assert.throws(() => prepareSkillSnapshot({source: f.source, authorizedRoot: path.dirname(f.source), store: f.store}), code('IMPORT_SOURCE_UNSAFE'));
  fs.unlinkSync(path.join(f.source, 'external'));
  const prepared = prepareSkillSnapshot({source: f.source, authorizedRoot: path.dirname(f.source), store: f.store});
  const stored = f.store.publish(prepared);
  fs.chmodSync(stored.tree, 0o700); fs.writeFileSync(path.join(stored.tree, 'untracked'), 'keep'); fs.chmodSync(stored.tree, 0o500);
  assert.throws(() => f.store.inspect(prepared.descriptor), code('SKILL_SNAPSHOT_DRIFT'));
  const otherHome = path.join(f.root, 'other-home'); fs.mkdirSync(otherHome);
  fs.symlinkSync(path.join(f.homeDir, '.agents-kit'), path.join(otherHome, '.agents-kit'));
  assert.throws(() => new SkillSnapshotStore({homeDir: otherHome}).inspect(prepared.descriptor), code('SKILL_SNAPSHOT_STORE_UNSAFE'));
});

test('snapshot integrity includes hard-link aliases and private store parent permissions', t => {
  const f = fixture(t), prepared = prepareSkillSnapshot({source: f.source, authorizedRoot: path.dirname(f.source), store: f.store});
  const stored = f.store.publish(prepared), alias = path.join(f.root, 'alias');
  fs.linkSync(path.join(stored.tree, 'SKILL.md'), alias);
  assert.throws(() => f.store.inspect(prepared.descriptor), code('SKILL_SNAPSHOT_DRIFT')); fs.unlinkSync(alias);
  fs.linkSync(path.join(stored.directory, 'descriptor.json'), alias);
  assert.throws(() => f.store.inspect(prepared.descriptor), code('SKILL_SNAPSHOT_DRIFT')); fs.unlinkSync(alias);
  fs.chmodSync(path.dirname(f.store.root), 0o755);
  assert.throws(() => f.store.inspect(prepared.descriptor), code('SKILL_SNAPSHOT_STORE_UNSAFE'));
});

test('publication collision preserves an empty digest directory created after inspection', t => {
  const f = fixture(t), prepared = prepareSkillSnapshot({source: f.source, authorizedRoot: path.dirname(f.source), store: f.store});
  let identity;
  assert.throws(() => f.store.publish(prepared, {onPhase: phase => {if (phase === 'stage-created') {fs.mkdirSync(prepared.directory); identity = fs.lstatSync(prepared.directory).ino;}}}), code('SKILL_SNAPSHOT_DRIFT'));
  assert.equal(fs.lstatSync(prepared.directory).ino, identity); assert.deepEqual(fs.readdirSync(prepared.directory), []);
});
