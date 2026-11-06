import fs from 'node:fs';
import {assertDependencyRecoveryState,dependencyStoreSession} from './dependency-store-session.js';
import path from 'node:path';
import crypto from 'node:crypto';
import {FileTransaction} from './file-transaction.js';
import {domainError} from '../domain/errors.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {authorizeSharedTarget, deploymentStateHash} from '../application/shared-resource-deployment.js';
import {planTreeJournalRecovery, applyTreeJournalRecovery} from './tree-deployment-transaction.js';
import {acquireCoordinationRecoveryGuard} from './dependency-coordination-io.js';

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
  const session=dependencyStoreSession(stateStore),dependencyGuard=session?.journalEvidence;
  const journal = {schemaVersion: dependencyGuard || operations.some(item => item.modeAware) ? 2 : 1, id, statePath: stateStore.statePath, beforeStateHash: deploymentStateHash(state),
    lockOwner: stateStore.lockOwner, operations: operations.map((item, index) => {
      const reviewed=dependencyGuard?session.journalModes?.find(mode=>mode.target===item.target):null;
      if(dependencyGuard&&!reviewed)throw domainError('GLOBAL_MUTATION_MODE_UNVERIFIED','Global journal modes require the sealed prediction');
      return {target:item.target,authorizedRoot:targetRoot,beforeHash:item.beforeHash,afterHash:item.expectedHash,backup:backup.entries[index],
        ...(reviewed?{modeAware:true,beforeMode:reviewed.beforeMode,afterMode:reviewed.afterMode}:item.modeAware?{modeAware:true,beforeMode:item.beforeMode,afterMode:item.afterMode}:{})};
    })};
  if(dependencyGuard)journal.dependencyGuard=structuredClone(dependencyGuard);
  for (const operation of journal.operations) authorizeSharedTarget(operation.target, targetRoot);
  write(location, journal);
  return {
    recordCreated(index, identity) {journal.operations[index].identity = identity; write(location, journal);},
    writeMode(index) {const operation=journal.operations[index];return dependencyGuard?{mode:operation.afterMode,exclusiveTarget:operation.beforeHash===null}:undefined;},
    reviewedMode(index) {const operation=journal.operations[index];return dependencyGuard?{modeAware:true,beforeMode:operation.beforeMode,afterMode:operation.afterMode}:null;},
    requiresCreatedIdentity(index) {return journal.operations[index].modeAware&&journal.operations[index].beforeHash===null;},
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
  if(dependencyStoreSession(stateStore)?.terminalOwner)return;
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
  if (journal.schemaVersion === 3) return planTreeJournalRecovery({stateStore, backupStore});
  if (![1, 2].includes(journal.schemaVersion) || journal.statePath !== stateStore.statePath || !Array.isArray(journal.operations)) throw domainError('INVALID_RECOVERY_JOURNAL', 'Recovery journal is invalid');
  assertDeadOwner(stateStore, journal);
  const state=stateStore.load();assertDependencyRecoveryState(stateStore,state);
  const stateHash = deploymentStateHash(state);
  const committed = journal.afterStateHash && stateHash === journal.afterStateHash;
  if (!committed && stateHash !== journal.beforeStateHash) throw domainError('RECOVERY_STATE_CONFLICT', 'Deployment ownership changed outside the interrupted transaction');
  const seen = new Set();
  const operations = journal.operations.map(operation => {
    if (operation.modeAware && (journal.schemaVersion !== 2 || operation.modeAware !== true
      || [operation.beforeHash === null ? operation.beforeMode !== null : !Number.isInteger(operation.beforeMode) || operation.beforeMode < 0 || operation.beforeMode > 0o777,
        operation.afterHash === null ? operation.afterMode !== null : !Number.isInteger(operation.afterMode) || operation.afterMode < 0 || operation.afterMode > 0o777].some(Boolean))) throw domainError('INVALID_RECOVERY_JOURNAL', 'Installation mode metadata is malformed');
    if (!stateStore.targetRoot || resolveForAuthorization(operation.authorizedRoot) !== resolveForAuthorization(stateStore.targetRoot)) throw domainError('INVALID_RECOVERY_SCOPE', 'Recovery scope differs from the authorized deployment scope');
    authorizeSharedTarget(operation.target, stateStore.targetRoot);
    if (seen.has(operation.target)) throw domainError('INVALID_RECOVERY_JOURNAL', 'Duplicate recovery target');
    seen.add(operation.target);
    const observed = observeRecoveryTarget(operation.target);
    const observedMode = observed === null ? null : fs.lstatSync(operation.target).mode & 0o777;
    if (operation.modeAware && (committed ? observedMode !== operation.afterMode
      : !(observed === operation.beforeHash && observedMode === operation.beforeMode) && !(observed === operation.afterHash && observedMode === operation.afterMode))) throw domainError('RECOVERY_TARGET_CONFLICT', 'Installation permissions changed outside the transaction');
    if (operation.modeAware && operation.beforeHash === null && observed !== null && (!operation.identity
      || operation.identity.dev !== fs.lstatSync(operation.target).dev || operation.identity.ino !== fs.lstatSync(operation.target).ino)) throw domainError('RECOVERY_TARGET_CONFLICT', 'Installation file creation is unproven');
    if (committed ? observed !== operation.afterHash : observed !== operation.beforeHash && observed !== operation.afterHash) {
      throw domainError('RECOVERY_TARGET_CONFLICT', 'A target differs from both reviewed transaction states');
    }
    if (!committed && observed !== operation.beforeHash && operation.beforeHash !== null) {
      if (operation.backup?.kind !== 'file' || hash(backupStore.read(operation.backup)) !== operation.beforeHash) throw domainError('RECOVERY_BACKUP_CONFLICT', 'Recovery backup does not match the original file');
    }
    return {...operation, observed, operation: committed ? 'KEEP_COMMITTED' : observed === operation.beforeHash && (!operation.modeAware || observedMode === operation.beforeMode) ? 'KEEP_ORIGINAL' : operation.beforeHash === null ? 'REMOVE' : 'RESTORE'};
  });
  return {journal, journalHash: hash(bytes), stateHash, committed, operations, blocked: [], automatic: true};
}

export function applyJournalRecovery({plan, stateStore, backupStore, onPhase=()=>{}}) {
  if (plan.journal.schemaVersion === 3) return applyTreeJournalRecovery({plan, stateStore, backupStore,onPhase});
  const guardPath = `${stateStore.statePath}.recovery.lock`;
  authorizeSharedTarget(guardPath, path.dirname(stateStore.statePath));
  let descriptor;
  try {
    if(dependencyStoreSession(stateStore)?.kind==='global-mutation') {
      descriptor=acquireCoordinationRecoveryGuard(guardPath,stateStore.targetRoot);fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,token:crypto.randomUUID()}));
    }else descriptor = fs.openSync(guardPath, 'wx', 0o600);
  }
  catch (error) { if (error.code === 'EEXIST') throw domainError('DEPLOYMENT_STATE_LOCKED', 'Recovery is already running or needs reviewed lock recovery'); throw error; }
  const guardIdentity=fs.fstatSync(descriptor);
  try {
    const current = planJournalRecovery({stateStore, backupStore});
    if (current.journalHash !== plan.journalHash || current.stateHash !== plan.stateHash
      || JSON.stringify(current.operations) !== JSON.stringify(plan.operations)) throw domainError('STALE_RECOVERY_PLAN', 'Recovery inputs changed after planning');
    const transaction = new FileTransaction();
    try {
      for (const operation of current.operations) {
        if (operation.operation === 'REMOVE') transaction.remove(operation.target);
        else if (operation.operation === 'RESTORE') transaction.write(operation.target, backupStore.read(operation.backup), {mode: operation.modeAware ? operation.beforeMode : operation.backup.mode ?? 0o600});
        const expected = current.committed ? operation.afterHash : operation.beforeHash;
        if (observeRecoveryTarget(operation.target) !== expected) throw domainError('RECOVERY_WRITE_MISMATCH', 'Recovered bytes do not match the plan');
        if (operation.modeAware && expected !== null && (fs.lstatSync(operation.target).mode & 0o777) !== (current.committed ? operation.afterMode : operation.beforeMode)) throw domainError('RECOVERY_WRITE_MISMATCH', 'Recovered permissions do not match the plan');
        onPhase('restored-path',operation);
      }
      const result = {transactionId: current.journal.id, outcome: current.committed ? 'committed' : 'restored', targets: current.operations.map(item => item.target)};
      assertDependencyRecoveryState(stateStore,stateStore.load());
      authorizeSharedTarget(`${stateStore.statePath}.recovery-result.json`, path.dirname(stateStore.statePath));
      transaction.write(`${stateStore.statePath}.recovery-result.json`, `${JSON.stringify(result)}\n`, {mode: 0o600});
      transaction.remove(journalPath(stateStore.statePath));
      if(!dependencyStoreSession(stateStore)?.retainLocks())transaction.remove(`${stateStore.statePath}.lock`);
      transaction.commit();
      return result;
    } catch (error) { transaction.rollback(); throw error; }
  } finally {
    fs.closeSync(descriptor);
    try {const current=fs.lstatSync(guardPath);if(current.isFile()&&current.dev===guardIdentity.dev&&current.ino===guardIdentity.ino)fs.unlinkSync(guardPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
