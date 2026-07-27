import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { FileTransaction } from '../lib/infrastructure/file-transaction.js';
import { createMemoryFileSystem } from '../lib/utils/memory-file-system.js';

const ROOT = '/test-root';

test('file transaction rolls back created and overwritten files atomically', () => {
  const memfs = createMemoryFileSystem({
    [`${ROOT}/existing.txt`]: 'before'
  });

  const created = `${ROOT}/nested/created.txt`;
  const existing = `${ROOT}/existing.txt`;

  const transaction = new FileTransaction({ fileSystem: memfs });
  transaction.write(existing, 'after');
  transaction.write(created, 'created');
  transaction.rollback();

  assert.equal(memfs.readFileSync(existing, 'utf8'), 'before');
  assert.equal(memfs.existsSync(created), false);
});

test('committed snapshot can be restored by the deployment coordinator', () => {
  const target = `${ROOT}/settings.json`;
  const memfs = createMemoryFileSystem({ [target]: 'before' });

  const transaction = new FileTransaction({ fileSystem: memfs });
  transaction.write(target, 'after');
  const snapshot = transaction.commit();
  assert.equal(memfs.readFileSync(target, 'utf8'), 'after');

  FileTransaction.restore(snapshot, { fileSystem: memfs });
  assert.equal(memfs.readFileSync(target, 'utf8'), 'before');
});

test('remove participates in rollback and rejects directories', () => {
  const target = `${ROOT}/managed.txt`;
  const memfs = createMemoryFileSystem({ [target]: 'before' });

  const transaction = new FileTransaction({ fileSystem: memfs });
  transaction.remove(target);
  assert.equal(memfs.existsSync(target), false);
  transaction.rollback();
  assert.equal(memfs.readFileSync(target, 'utf8'), 'before');

  // directory rejection
  const directory = `${ROOT}/directory`;
  memfs.mkdirSync(directory);
  assert.throws(
    () => new FileTransaction({ fileSystem: memfs }).remove(directory),
    /cannot remove a directory/
  );
});

test('link participates in rollback for created and replaced symlinks', () => {
  const first = `${ROOT}/first`;
  const second = `${ROOT}/second`;
  const target = `${ROOT}/target`;
  const memfs = createMemoryFileSystem({
    [first]: 'first',
    [second]: 'second'
  });

  // create new symlink then rollback → target disappears
  let transaction = new FileTransaction({ fileSystem: memfs });
  transaction.link(first, target);
  assert.equal(memfs.lstatSync(target).isSymbolicLink(), true);
  assert.equal(memfs.readlinkSync(target), first);
  transaction.rollback();
  assert.equal(memfs.existsSync(target), false);

  // replace existing symlink then rollback → original symlink restored
  memfs.symlinkSync(first, target);
  transaction = new FileTransaction({ fileSystem: memfs });
  transaction.link(second, target);
  assert.equal(memfs.readlinkSync(target), second);
  transaction.rollback();
  assert.equal(memfs.readlinkSync(target), first);
});
