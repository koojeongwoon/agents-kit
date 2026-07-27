import crypto from 'node:crypto';
import { FileTransaction } from '../infrastructure/file-transaction.js';
import { domainError } from '../domain/errors.js';
import {
  contentForMergeOperation,
  hashMergeTarget
} from './prepare-merge-deployment.js';

function transactionId() {
  return `tx-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
}

export function applyMergeDeployment({
  plan,
  stateStore,
  validate = () => ({ valid: true, results: [] }),
  now = () => new Date().toISOString()
}) {
  if (plan.blocked.length > 0) {
    throw domainError('DEPLOYMENT_PLAN_BLOCKED', 'Blocked operations must be resolved before apply', {
      blocked: plan.blocked
    });
  }
  const transaction = new FileTransaction();
  const nextState = structuredClone(stateStore.load());
  const applied = [];
  const id = transactionId();
  try {
    for (const operation of plan.operations) {
      const observed = hashMergeTarget(operation.target);
      if (observed !== operation.beforeHash) {
        throw domainError('STALE_DEPLOYMENT_PLAN', 'Target changed after the deployment plan was created', {
          target: operation.target,
          expected: operation.beforeHash,
          actual: observed
        });
      }
      if (operation.operation === 'SKIP') continue;
      transaction.write(operation.target, contentForMergeOperation(operation));
      if (hashMergeTarget(operation.target) !== operation.expectedHash) {
        throw domainError('DEPLOYMENT_WRITE_MISMATCH', 'Written content does not match the plan', {
          target: operation.target
        });
      }
      nextState.managed[operation.target] = {
        clientId: operation.clientId,
        strategy: 'merge',
        ownership: operation.ownership,
        hash: operation.expectedHash,
        owners: operation.owners,
        transactionId: id
      };
      applied.push(operation.target);
    }
    const validation = validate({ plan, applied: Object.freeze([...applied]) });
    if (!validation?.valid) {
      throw domainError('DEPLOYMENT_VALIDATION_FAILED', 'Post-apply validation failed', {
        results: validation?.results || []
      });
    }
    nextState.transactions.push({
      id,
      type: 'apply',
      clientId: plan.clientId,
      createdAt: now(),
      targets: [...applied],
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
      transactionId: id,
      applied: Object.freeze([...applied]),
      skipped: Object.freeze(plan.operations.filter(item => item.operation === 'SKIP').map(item => item.target)),
      validation: Object.freeze([...(validation.results || [])])
    });
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}
