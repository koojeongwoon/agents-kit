import {beginDeploymentJournal} from '../infrastructure/deployment-journal.js';
import crypto from 'node:crypto';
import { FileTransaction } from '../infrastructure/file-transaction.js';
import { domainError } from '../domain/errors.js';
import { deploymentTargetHash } from './apply-deployment.js';
import {authorizeSharedTarget, deploymentStateHash} from './shared-resource-deployment.js';

export function planDeploymentRollback({ transactionId, stateStore }) {
  const state = stateStore.load();
  const transaction = state.transactions.find(item => item.id === transactionId);
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
    const modified = currentHash !== operation.afterHash;
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

export function applyDeploymentRollback(input) {
  if (input.plan.blocked.length) return rollbackUnlocked(input);
  return input.stateStore.withLock ? input.stateStore.withLock(() => rollbackUnlocked(input)) : rollbackUnlocked(input);
}

function rollbackUnlocked({
  plan,
  stateStore,
  backupStore,
  validate = () => ({ valid: true, results: [] }),
  now = () => new Date().toISOString(),
  createTransactionId = () => `tx-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`
}) {
  if (plan.blocked.length > 0) {
    throw domainError('ROLLBACK_PLAN_BLOCKED', 'Rollback conflicts must be resolved before apply', {
      blocked: plan.blocked
    });
  }
  const state = stateStore.load();
  if (plan.stateHash && plan.stateHash !== deploymentStateHash(state)) throw domainError('STALE_ROLLBACK_PLAN', 'Ownership changed after rollback planning');
  for (const operation of plan.operations) {
    if (operation.authorizedRoot) authorizeSharedTarget(operation.target, operation.authorizedRoot);
    if (deploymentTargetHash(operation.target) !== operation.expectedCurrentHash) {
      throw domainError('STALE_ROLLBACK_PLAN', 'Rollback target changed after planning', {
        target: operation.target
      });
    }
  }
  const nextState = structuredClone(state);
  const transaction = new FileTransaction();
  const rollbackId = createTransactionId();
  const recoveryOperations = plan.operations.map(item => ({...item, expectedHash: item.expectedAfterHash}));
  const recoveryBackup = stateStore.targetRoot && stateStore.lockOwner && recoveryOperations.every(item => !String(item.beforeHash).startsWith('symlink:') && item.operation !== 'RESTORE_LINK')
    ? backupStore.create({transactionId: rollbackId, operations: recoveryOperations}) : null;
  let journal;
  try {
    if (recoveryBackup) journal = beginDeploymentJournal({stateStore, id: rollbackId, operations: recoveryOperations, backup: recoveryBackup, state, targetRoot: stateStore.targetRoot});
    for (const operation of plan.operations) {
      if (operation.metadataOnly) { /* Restore ownership only. */ }
      else if (operation.operation === 'REMOVE') transaction.remove(operation.target);
      else if (operation.operation === 'RESTORE_LINK') transaction.link(operation.backup.source, operation.target);
      else transaction.write(operation.target, backupStore.read(operation.backup));
      if (deploymentTargetHash(operation.target) !== operation.expectedAfterHash) {
        throw domainError('ROLLBACK_WRITE_MISMATCH', 'Rollback result does not match the original state', {
          target: operation.target
        });
      }
      if (operation.previousManaged) nextState.managed[operation.target] = operation.previousManaged;
      else delete nextState.managed[operation.target];
    }
    const validation = validate({ plan });
    if (!validation?.valid) {
      throw domainError('ROLLBACK_VALIDATION_FAILED', 'Rollback validation failed', {
        results: validation?.results || []
      });
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
    const snapshot = transaction.commit();
    try {
      journal?.expectState(nextState);
      stateStore.commit(nextState);
    } catch (error) {
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
    transaction.rollback();
    if (recoveryBackup) backupStore.rollbackCreation(recoveryBackup.snapshot);
    journal?.finish();
    throw error;
  }
}
