import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {AtomicPathMover} from '../lib/infrastructure/atomic-path-mover.js';
import {readPathImage, imageFingerprint, materializePathImage} from '../lib/infrastructure/path-image.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-atomic-tree-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true})); return root;
}
test('exclusive rename never overwrites existing files, links or empty directories', t => {
  const root = fixture(t), mover = new AtomicPathMover();
  for (const kind of ['file', 'link', 'directory']) {
    const source = path.join(root, `source-${kind}`), target = path.join(root, `target-${kind}`); fs.writeFileSync(source, 'new');
    if (kind === 'file') fs.writeFileSync(target, 'user'); else if (kind === 'link') fs.symlinkSync('/external/ego-skills', target); else fs.mkdirSync(target);
    const before = readPathImage(target, {authorizedRoot: root});
    assert.throws(() => mover.moveExclusive(source, target), {code: 'ATOMIC_PATH_COLLISION'});
    assert.equal(imageFingerprint(readPathImage(target, {authorizedRoot: root})), imageFingerprint(before)); assert.equal(fs.readFileSync(source, 'utf8'), 'new');
  }
  mover.moveExclusive(path.join(root, 'source-file'), path.join(root, 'absent'));
  assert.equal(fs.readFileSync(path.join(root, 'absent'), 'utf8'), 'new');
});
test('atomic exchange swaps a populated directory and a symlink and preserves original directory identity and modes', t => {
  const root = fixture(t), directory = path.join(root, 'directory'), link = path.join(root, 'link'); fs.mkdirSync(directory, {mode: 0o750});
  fs.writeFileSync(path.join(directory, 'SKILL.md'), 'user bytes', {mode: 0o640}); fs.symlinkSync('/private/snapshot/tree', link);
  const original = fs.lstatSync(directory), mover = new AtomicPathMover(); mover.exchange(directory, link);
  assert.equal(fs.readlinkSync(directory), '/private/snapshot/tree'); assert.equal(fs.lstatSync(link).ino, original.ino);
  assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'user bytes'); assert.equal(fs.statSync(link).mode & 0o777, 0o750);
  mover.exchange(directory, link); assert.equal(fs.lstatSync(directory).ino, original.ino);
});
test('path images preserve directory/file modes, binary bytes and empty directories without following internal links', t => {
  const root = fixture(t), source = path.join(root, 'source'), restored = path.join(root, 'restored'); fs.mkdirSync(path.join(source, 'empty'), {recursive: true});
  fs.writeFileSync(path.join(source, 'binary'), Buffer.from([0, 255, 1]), {mode: 0o640}); fs.chmodSync(source, 0o750); fs.chmodSync(path.join(source, 'empty'), 0o710);
  const image = readPathImage(source, {authorizedRoot: root}); materializePathImage(restored, image, {authorizedRoot: root});
  assert.equal(imageFingerprint(readPathImage(restored, {authorizedRoot: root})), imageFingerprint(image));
  assert.deepEqual(fs.readFileSync(path.join(restored, 'binary')), Buffer.from([0, 255, 1]));
  fs.symlinkSync('/external/ego-skills', path.join(source, 'external')); assert.throws(() => readPathImage(source, {authorizedRoot: root}), {code: 'TREE_IMAGE_UNSAFE'});
  assert.throws(() => materializePathImage(restored, image, {authorizedRoot: root}), {code: 'ATOMIC_PATH_COLLISION'});
});

test('malformed or overlarge images fail before creating any restoration path', t => {
  const root = fixture(t), target = path.join(root, 'target');
  for (const image of [{kind: 'directory', entries: [{path: '', kind: 'directory', mode: 0o755}, {path: '../escape', kind: 'file', mode: 0o644, content: 'eA=='}]},
    {kind: 'file', mode: 0o4644, content: 'eA=='}, {kind: 'file', mode: 0o644, content: 'invalid'},
    {kind: 'directory', entries: [{path: '', kind: 'directory', mode: 0o755}, {path: 'a', kind: 'file', mode: 0o644, content: 'eA=='}, {path: 'a/x', kind: 'file', mode: 0o644, content: 'eA=='}]}]) {
    assert.throws(() => materializePathImage(target, image, {authorizedRoot: root}), {code: 'TREE_IMAGE_UNSAFE'}); assert.equal(fs.existsSync(target), false);
  }
});
