import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {FileTransaction} from './file-transaction.js';
import {domainError} from '../domain/errors.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {authorizeSharedTarget, deploymentStateHash} from '../application/shared-resource-deployment.js';

export const journalPath = statePath => `${statePath}.journal.json`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function observeRecoveryTarget(target) {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) throw domainError('RECOVERY_TARGET_UNSUPPORTED', 'Recovery supports regular files only');
    return hash(fs.readFileSync(target));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function write(target, value) {
  const transaction = new FileTransaction();
  try { transaction.write(target, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600}); transaction.commit(); }
  catch (error) { transaction.rollback(); throw error; }
}
export function beginDeploymentJournal({stateStore, id, operations, backup, state, targetRoot}) {
  // Link transactions retain their existing behavior and require manual crash recovery.
  if (!stateStore.lockOwner || !targetRoot || operations.some(item => item.strategy === 'link' || String(item.beforeHash).startsWith('symlink:'))) return null;
  const location = journalPath(stateStore.statePath);
  authorizeSharedTarget(location, path.dirname(stateStore.statePath));
  if (fs.existsSync(location)) throw domainError('DEPLOYMENT_RECOVERY_REQUIRED', 'An earlier transaction requires recovery');
  const journal = {schemaVersion: 1, id, statePath: stateStore.statePath, beforeStateHash: deploymentStateHash(state),
    lockOwner: stateStore.lockOwner, operations: operations.map((item, index) => ({target: item.target,
      authorizedRoot: targetRoot, beforeHash: item.beforeHash, afterHash: item.expectedHash,
      backup: backup.entries[index]}))};
  for (const operation of journal.operations) authorizeSharedTarget(operation.target, targetRoot);
  write(location, journal);
  return {
    expectState(nextState) { journal.afterStateHash = deploymentStateHash(nextState); write(location, journal); },
    finish() { fs.unlinkSync(location); },
    path: location
  };
}

function assertDeadOwner(stateStore, journal) {
  let owner;
  try { owner = JSON.parse(fs.readFileSync(`${stateStore.statePath}.lock`, 'utf8')); }
  catch { throw domainError('RECOVERY_LOCK_UNPROVEN', 'The original deployment lock is missing or cannot be verified'); }
  if (!Number.isInteger(owner.pid) || owner.pid <= 1 || !owner.token || owner.token !== journal.lockOwner?.token || owner.pid !== journal.lockOwner?.pid) {
    throw domainError('RECOVERY_LOCK_UNPROVEN', 'Recovery does not own the abandoned deployment lock');
  }
  try { process.kill(owner.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; throw domainError('RECOVERY_OWNER_UNVERIFIED', 'Deployment process liveness could not be verified'); }
  throw domainError('DEPLOYMENT_STATE_LOCKED', 'The original deployment process is still running');
}

export function planJournalRecovery({stateStore, backupStore}) {
  const location = journalPath(stateStore.statePath);
  authorizeSharedTarget(location, path.dirname(stateStore.statePath));
  authorizeSharedTarget(`${stateStore.statePath}.lock`, path.dirname(stateStore.statePath));
  let bytes, journal;
  try { bytes = fs.readFileSync(location); journal = JSON.parse(bytes); }
  catch { throw domainError('DEPLOYMENT_RECOVERY_NOT_FOUND', 'No readable deployment recovery journal was found'); }
  if (journal.schemaVersion !== 1 || journal.statePath !== stateStore.statePath || !Array.isArray(journal.operations)) throw domainError('INVALID_RECOVERY_JOURNAL', 'Recovery journal is invalid');
  assertDeadOwner(stateStore, journal);
  const stateHash = deploymentStateHash(stateStore.load());
  const committed = journal.afterStateHash && stateHash === journal.afterStateHash;
  if (!committed && stateHash !== journal.beforeStateHash) throw domainError('RECOVERY_STATE_CONFLICT', 'Deployment ownership changed outside the interrupted transaction');
  const seen = new Set();
  const operations = journal.operations.map(operation => {
    if (!stateStore.targetRoot || resolveForAuthorization(operation.authorizedRoot) !== resolveForAuthorization(stateStore.targetRoot)) throw domainError('INVALID_RECOVERY_SCOPE', 'Recovery scope differs from the authorized deployment scope');
    authorizeSharedTarget(operation.target, stateStore.targetRoot);
    if (seen.has(operation.target)) throw domainError('INVALID_RECOVERY_JOURNAL', 'Duplicate recovery target');
    seen.add(operation.target);
    const observed = observeRecoveryTarget(operation.target);
    if (committed ? observed !== operation.afterHash : observed !== operation.beforeHash && observed !== operation.afterHash) {
      throw domainError('RECOVERY_TARGET_CONFLICT', 'A target differs from both reviewed transaction states');
    }
    if (!committed && observed !== operation.beforeHash && operation.beforeHash !== null) {
      if (operation.backup?.kind !== 'file' || hash(backupStore.read(operation.backup)) !== operation.beforeHash) throw domainError('RECOVERY_BACKUP_CONFLICT', 'Recovery backup does not match the original file');
    }
    return {...operation, observed, operation: committed ? 'KEEP_COMMITTED' : observed === operation.beforeHash ? 'KEEP_ORIGINAL' : operation.beforeHash === null ? 'REMOVE' : 'RESTORE'};
  });
  return {journal, journalHash: hash(bytes), stateHash, committed, operations, blocked: [], automatic: true};
}

export function applyJournalRecovery({plan, stateStore, backupStore}) {
  const guardPath = `${stateStore.statePath}.recovery.lock`;
  authorizeSharedTarget(guardPath, path.dirname(stateStore.statePath));
  let descriptor;
  try { descriptor = fs.openSync(guardPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw domainError('DEPLOYMENT_STATE_LOCKED', 'Recovery is already running or needs reviewed lock recovery'); throw error; }
  try {
    const current = planJournalRecovery({stateStore, backupStore});
    if (current.journalHash !== plan.journalHash || current.stateHash !== plan.stateHash
      || JSON.stringify(current.operations) !== JSON.stringify(plan.operations)) throw domainError('STALE_RECOVERY_PLAN', 'Recovery inputs changed after planning');
    const transaction = new FileTransaction();
    try {
      for (const operation of current.operations) {
        if (operation.operation === 'REMOVE') transaction.remove(operation.target);
        else if (operation.operation === 'RESTORE') transaction.write(operation.target, backupStore.read(operation.backup), {mode: operation.backup.mode ?? 0o600});
        const expected = current.committed ? operation.afterHash : operation.beforeHash;
        if (observeRecoveryTarget(operation.target) !== expected) throw domainError('RECOVERY_WRITE_MISMATCH', 'Recovered bytes do not match the plan');
      }
      const result = {transactionId: current.journal.id, outcome: current.committed ? 'committed' : 'restored', targets: current.operations.map(item => item.target)};
      authorizeSharedTarget(`${stateStore.statePath}.recovery-result.json`, path.dirname(stateStore.statePath));
      transaction.write(`${stateStore.statePath}.recovery-result.json`, `${JSON.stringify(result)}\n`, {mode: 0o600});
      transaction.remove(journalPath(stateStore.statePath));
      transaction.remove(`${stateStore.statePath}.lock`);
      transaction.commit();
      return result;
    } catch (error) { transaction.rollback(); throw error; }
  } finally { fs.closeSync(descriptor); fs.unlinkSync(guardPath); }
}
