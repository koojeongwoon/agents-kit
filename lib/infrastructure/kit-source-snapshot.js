import path from 'node:path';
import {readImportSource} from './import-source-reader.js';
import {kitSourcePath} from './kit-source-transaction.js';
import {domainError} from '../domain/errors.js';

export const sourceDirectory = record => record.kind === 'skills' ? record.source : path.posix.dirname(record.source);
export const sourceInventory = files => files.map(file => ({path: file.path, mode: file.mode, sha256: file.sha256})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
export function sameInventory(left, right) {
  const expected = new Map(right.map(file => [file.path, file]));
  return left.length === right.length && left.every(file => file.sha256 === expected.get(file.path)?.sha256 && file.mode === expected.get(file.path)?.mode);
}
export function readKitSourceSnapshot(root, relative, expected) {
  try {
    const snapshot = readImportSource({source: kitSourcePath(root, relative), authorizedRoot: root, kind: 'bundle'});
    if (!sameInventory(snapshot.inventory, expected)) throw new Error('mismatch');
    return snapshot;
  } catch { throw domainError('IMPORT_ARTIFACT_MODIFIED', 'A recorded Kit artifact is missing, changed or untracked'); }
}
export function assertSourceArtifacts(root, record) {
  readKitSourceSnapshot(root, sourceDirectory(record), record.kitFiles || record.files);
  readKitSourceSnapshot(root, record.baseline, record.files);
}
