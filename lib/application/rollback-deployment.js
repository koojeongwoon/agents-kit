import {beginDeploymentJournal} from '../infrastructure/deployment-journal.js';
import crypto from 'node:crypto';
import {prepareDependencyStateCommit,dependencyMutationCanRestore,dependencyStoreSession,authorizeDependencyMutations} from '../infrastructure/dependency-store-session.js';
import fs from 'node:fs';
import { FileTransaction } from '../infrastructure/file-transaction.js';
import { domainError } from '../domain/errors.js';
import { deploymentTargetHash } from './apply-deployment.js';
import {authorizeSharedTarget, deploymentStateHash} from './shared-resource-deployment.js';
import {planTreeDeploymentRollback, applyTreeDeploymentRollback,applyTreeDeploymentRollbackAsync} from './rollback-shared-snapshot-deployment.js';
import {prepareRollbackCommands} from './rollback-command.js';
import {runTransactionWorkflow} from '../infrastructure/transaction-workflow.js';
import {assertDeploymentPredictionInputs,assertPredictedInstallation} from './deployment-installation-prediction.js';
const backupStoreMode = target => fs.lstatSync(target).mode & 0o777;

export function planDeploymentRollback({ transactionId, stateStore, backupStore }) {
  const state = stateStore.load();
  const transaction = state.transactions.find(item => item.id === transactionId);
  if (transaction?.treeTransaction) return planTreeDeploymentRollback({transactionId, stateStore, backupStore});
  if (!transaction || transaction.type !== 'apply' || transaction.status !== 'committed') {
    throw domainError('TRANSACTION_NOT_ROLLBACKABLE', 'Committed apply transaction was not found', {
      transactionId
    });
  }
  const operations = transaction.operations.map(operation => {
    if (operation.authorizedRoot) authorizeSharedTarget(operation.target, operation.authorizedRoot);
    const currentHash = deploymentTargetHash(operation.target);
    const currentManaged = state.managed[operation.target];
    const latest = state.transactions.findLast(item => item.status === 'committed' && item.operations?.some(entry => entry.target === operation.target));
    const superseded = operation.afterManaged === null
      ? currentManaged !== undefined || latest?.id !== transactionId
      : currentManaged?.transactionId !== transactionId;
    const modified = currentHash !== operation.afterHash || operation.modeAware && currentHash !== null && (backupStoreMode(operation.target) !== operation.afterMode);
    return Object.freeze({
      target: operation.target,
      operation: operation.backup.kind === 'absent'
        ? 'REMOVE'
        : operation.backup.kind === 'symlink'
          ? 'RESTORE_LINK'
          : 'RESTORE',
      beforeHash: currentHash,
      expectedCurrentHash: operation.afterHash,
      expectedAfterHash: operation.beforeHash,
      backup: operation.backup,
      previousManaged: operation.previousManaged,
      ...(operation.modeAware ? {modeAware: true, beforeMode: operation.afterMode, afterMode: operation.beforeMode} : {}),
      ...(operation.authorizedRoot ? {authorizedRoot: operation.authorizedRoot, metadataOnly: operation.metadataOnly} : {}),
      reason: superseded
        ? 'ROLLBACK_OWNERSHIP_SUPERSEDED'
        : modified
          ? 'ROLLBACK_TARGET_MODIFIED'
          : 'ROLLBACK_READY'
    });
  });
  const blocked = operations.filter(item => item.reason !== 'ROLLBACK_READY');
  return Object.freeze({
    transactionId,
    stateHash: deploymentStateHash(state),
    automatic: blocked.length === 0,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}

export const applyDeploymentRollback=input=>rollback(input,false);
export const applyDeploymentRollbackAsync=async input=>rollback(input,true);
function rollback(input,async) {
  const session=dependencyStoreSession(input.stateStore);
  if(session&&!(session.actionKind==='rollback'&&(session.kind==='global-mutation'||session.kind==='project-coordination'&&session.rollbackTransactionId===input.plan.transactionId)))throw domainError('UNREVIEWED_DEPENDENCY_MUTATION','Coordinated rollback requires its own reviewed prerequisite transition');
  assertDeploymentPredictionInputs({rollback:input.plan});
  if (input.plan.treeTransaction) return (async?applyTreeDeploymentRollbackAsync:applyTreeDeploymentRollback)(input);
  const execute=()=>runTransactionWorkflow(rollbackWorkflow(input),{async});
  if (input.plan.blocked.length) return execute();
  return input.stateStore.withLock ? input.stateStore.withLock(execute) : execute();
}

function* rollbackWorkflow({
  plan,
  stateStore,
  backupStore,
  validate = () => ({ valid: true, results: [] }),
  now = () => new Date().toISOString(),
  preflight = () => {},
  beforeCommit = () => {},
  createTransactionId = () => `tx-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`
}) {
  if (plan.blocked.length > 0) {
    throw domainError('ROLLBACK_PLAN_BLOCKED', 'Rollback conflicts must be resolved before apply', {
      blocked: plan.blocked
    });
  }
  const state = stateStore.load();
  yield preflight();
  if (plan.stateHash && plan.stateHash !== deploymentStateHash(state)) throw domainError('STALE_ROLLBACK_PLAN', 'Ownership changed after rollback planning');
  for (const operation of plan.operations) {
    if (operation.authorizedRoot) authorizeSharedTarget(operation.target, operation.authorizedRoot);
    if (deploymentTargetHash(operation.target) !== operation.expectedCurrentHash || operation.modeAware && operation.beforeHash !== null && backupStoreMode(operation.target) !== operation.beforeMode) {
      throw domainError('STALE_ROLLBACK_PLAN', 'Rollback target changed after planning', {
        target: operation.target
      });
    }
  }

  authorizeDependencyMutations(stateStore,()=>prepareRollbackCommands({plan,state,stateStore,backupStore}).map(({target,beforeImage,afterImage})=>({target,beforeImage,afterImage})));
  const nextState = structuredClone(state);
  const transaction = new FileTransaction();
  const rollbackId = createTransactionId();
  const recoveryOperations = plan.operations.map(item => ({...item, expectedHash: item.expectedAfterHash}));
  const recoveryBackup = stateStore.targetRoot && stateStore.lockOwner && recoveryOperations.every(item => !String(item.beforeHash).startsWith('symlink:') && item.operation !== 'RESTORE_LINK')
    ? backupStore.create({transactionId: rollbackId, operations: recoveryOperations}) : null;
  let journal;
  const canRestoreNativeTargets = () => plan.operations.filter(item => item.modeAware && transaction.mutations.has(item.target)).every(item => {
    try {
      authorizeSharedTarget(item.target, item.authorizedRoot);
      const observed = deploymentTargetHash(item.target), mode = observed === null ? null : backupStoreMode(item.target);
      return observed === item.beforeHash && mode === item.beforeMode || observed === item.expectedAfterHash && mode === item.afterMode;
    } catch {return false;}
  })&&dependencyMutationCanRestore(stateStore);
  try {
    if (recoveryBackup) journal = beginDeploymentJournal({stateStore, id: rollbackId, operations: recoveryOperations, backup: recoveryBackup, state, targetRoot: stateStore.targetRoot});
    for (const [index, operation] of plan.operations.entries()) {
      if (operation.authorizedRoot) authorizeSharedTarget(operation.target, operation.authorizedRoot);
      if (operation.metadataOnly) { /* Restore ownership only. */ }
      else if (operation.operation === 'REMOVE') transaction.remove(operation.target);
      else if (operation.operation === 'RESTORE_LINK') transaction.link(operation.backup.source, operation.target);
      else {
        const options = journal?.writeMode?.(index)||(operation.modeAware ? {mode: operation.afterMode, exclusiveTarget: operation.beforeHash === null} : operation.backup.mode !== undefined ? {mode: operation.backup.mode} : undefined);
        const identity = transaction.write(operation.target, backupStore.read(operation.backup), options);
        if (operation.beforeHash === null && (operation.modeAware||journal?.requiresCreatedIdentity?.(index))) journal?.recordCreated?.(index, identity);
      }
      if (deploymentTargetHash(operation.target) !== operation.expectedAfterHash) {
        throw domainError('ROLLBACK_WRITE_MISMATCH', 'Rollback result does not match the original state', {
          target: operation.target
        });
      }
      if (operation.modeAware && operation.expectedAfterHash !== null && backupStoreMode(operation.target) !== operation.afterMode) throw domainError('ROLLBACK_WRITE_MISMATCH', 'Installation permissions were not restored');
      if (operation.previousManaged) nextState.managed[operation.target] = operation.previousManaged;
      else delete nextState.managed[operation.target];
    }
    const validation = yield validate({ plan });
    if (!validation?.valid) {
      throw domainError('ROLLBACK_VALIDATION_FAILED', 'Rollback validation failed', {
        results: validation?.results || []
      });
    }
    for (const operation of plan.operations.filter(item => item.modeAware)) {
      authorizeSharedTarget(operation.target, operation.authorizedRoot);
      const observed = deploymentTargetHash(operation.target);
      if (observed !== operation.expectedAfterHash || observed !== null && backupStoreMode(operation.target) !== operation.afterMode) {
        throw domainError('ROLLBACK_WRITE_MISMATCH', 'Installation changed during rollback validation');
      }
    }
    const original = nextState.transactions.find(item => item.id === plan.transactionId);
    original.status = 'rolled-back';
    original.rolledBackBy = rollbackId;
    nextState.transactions.push({
      id: rollbackId,
      type: 'rollback',
      transactionId: plan.transactionId,
      createdAt: now(),
      status: 'committed',
      operations: plan.operations.map(item => ({
        target: item.target,
        beforeHash: item.expectedCurrentHash,
        afterHash: item.expectedAfterHash
      })),
      validation: validation.results || []
    });
    yield beforeCommit();
    assertPredictedInstallation({rollback:plan,nextState});
    const snapshot = transaction.commit();
    try {
      prepareDependencyStateCommit(stateStore,nextState);journal?.expectState(nextState);
      stateStore.commit(nextState);
    } catch (error) {
      if (!canRestoreNativeTargets()) throw domainError('NATIVE_DEPLOYMENT_RECOVERY_REQUIRED', 'Concurrent installation changes require reviewed recovery');
      FileTransaction.restore(snapshot);
      throw error;
    }
    try { journal?.finish(); } catch { /* Retain recovery evidence. */ }
    return Object.freeze({
      transactionId: rollbackId,
      rolledBackTransactionId: plan.transactionId,
      targets: Object.freeze(plan.operations.map(item => item.target))
    });
  } catch (error) {
    if (!canRestoreNativeTargets()) {
      if (!transaction.closed) transaction.commit();
      throw domainError('NATIVE_DEPLOYMENT_RECOVERY_REQUIRED', 'Concurrent installation changes were preserved; review the pending deployment journal');
    }
    transaction.rollback();
    if (recoveryBackup) backupStore.rollbackCreation(recoveryBackup.snapshot);
    journal?.finish();
    throw error;
  }
}
