import crypto from 'node:crypto';
import { FileTransaction } from '../infrastructure/file-transaction.js';
import { domainError } from '../domain/errors.js';
import { deploymentTargetHash } from './apply-deployment.js';

export function planDeploymentRollback({ transactionId, stateStore }) {
  const state = stateStore.load();
  const transaction = state.transactions.find(item => item.id === transactionId);
  if (!transaction || transaction.type !== 'apply' || transaction.status !== 'committed') {
    throw domainError('TRANSACTION_NOT_ROLLBACKABLE', 'Committed apply transaction was not found', {
      transactionId
    });
  }
  const operations = transaction.operations.map(operation => {
    const currentHash = deploymentTargetHash(operation.target);
    const currentManaged = state.managed[operation.target];
    const superseded = currentManaged?.transactionId !== transactionId;
    const modified = currentHash !== operation.afterHash;
    return Object.freeze({
      target: operation.target,
      operation: operation.backup.kind === 'absent' ? 'REMOVE' : 'RESTORE',
      beforeHash: currentHash,
      expectedCurrentHash: operation.afterHash,
      expectedAfterHash: operation.beforeHash,
      backup: operation.backup,
      previousManaged: operation.previousManaged,
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
    automatic: blocked.length === 0,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}

export function applyDeploymentRollback({
  plan,
  stateStore,
  backupStore,
  validate = () => ({ valid: true, results: [] }),
  now = () => new Date().toISOString()
}) {
  if (plan.blocked.length > 0) {
    throw domainError('ROLLBACK_PLAN_BLOCKED', 'Rollback conflicts must be resolved before apply', {
      blocked: plan.blocked
    });
  }
  for (const operation of plan.operations) {
    if (deploymentTargetHash(operation.target) !== operation.expectedCurrentHash) {
      throw domainError('STALE_ROLLBACK_PLAN', 'Rollback target changed after planning', {
        target: operation.target
      });
    }
  }
  const state = stateStore.load();
  const nextState = structuredClone(state);
  const transaction = new FileTransaction();
  const rollbackId = `tx-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    for (const operation of plan.operations) {
      if (operation.operation === 'REMOVE') transaction.remove(operation.target);
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
      stateStore.commit(nextState);
    } catch (error) {
      FileTransaction.restore(snapshot);
      throw error;
    }
    return Object.freeze({
      transactionId: rollbackId,
      rolledBackTransactionId: plan.transactionId,
      targets: Object.freeze(plan.operations.map(item => item.target))
    });
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}
