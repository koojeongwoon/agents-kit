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
