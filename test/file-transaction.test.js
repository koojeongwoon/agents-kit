import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileTransaction } from '../lib/infrastructure/file-transaction.js';

test('file transaction rolls back created and overwritten files atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-file-transaction-'));
  const existing = path.join(root, 'existing.txt');
  const created = path.join(root, 'nested', 'created.txt');
  fs.writeFileSync(existing, 'before');

  const transaction = new FileTransaction();
  transaction.write(existing, 'after');
  transaction.write(created, 'created');
  transaction.rollback();

  assert.equal(fs.readFileSync(existing, 'utf8'), 'before');
  assert.equal(fs.existsSync(created), false);
});

test('committed snapshot can be restored by the deployment coordinator', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-file-snapshot-'));
  const target = path.join(root, 'settings.json');
  fs.writeFileSync(target, 'before');

  const transaction = new FileTransaction();
  transaction.write(target, 'after');
  const snapshot = transaction.commit();
  assert.equal(fs.readFileSync(target, 'utf8'), 'after');

  FileTransaction.restore(snapshot);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before');
});

test('remove participates in rollback and rejects directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-file-remove-'));
  const target = path.join(root, 'managed.txt');
  fs.writeFileSync(target, 'before');
  const transaction = new FileTransaction();
  transaction.remove(target);
  assert.equal(fs.existsSync(target), false);
  transaction.rollback();
  assert.equal(fs.readFileSync(target, 'utf8'), 'before');

  const directory = path.join(root, 'directory');
  fs.mkdirSync(directory);
  assert.throws(() => new FileTransaction().remove(directory), /cannot remove a directory/);
});

test('link participates in rollback for created and replaced symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-file-link-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  const target = path.join(root, 'target');
  fs.writeFileSync(first, 'first');
  fs.writeFileSync(second, 'second');

  let transaction = new FileTransaction();
  transaction.link(first, target);
  assert.equal(fs.realpathSync(target), fs.realpathSync(first));
  transaction.rollback();
  assert.equal(fs.existsSync(target), false);

  fs.symlinkSync(first, target);
  transaction = new FileTransaction();
  transaction.link(second, target);
  assert.equal(fs.realpathSync(target), fs.realpathSync(second));
  transaction.rollback();
  assert.equal(fs.realpathSync(target), fs.realpathSync(first));
});
