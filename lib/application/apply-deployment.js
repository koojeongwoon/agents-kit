import crypto from 'node:crypto';
import fs from 'node:fs';
import { FileTransaction } from '../infrastructure/file-transaction.js';
import { domainError } from '../domain/errors.js';
import { contentForMergeOperation } from './prepare-merge-deployment.js';

function hashTarget(target) {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) return `non-file:${stat.mode}`;
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function operationContent(operation) {
  return operation.strategy === 'merge'
    ? contentForMergeOperation(operation)
    : fs.readFileSync(operation.source);
}

function defaultTransactionId() {
  return `tx-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
}

export function applyDeployment({
  plans,
  stateStore,
  backupStore,
  validate = () => ({ valid: true, results: [] }),
  now = () => new Date().toISOString(),
  createTransactionId = defaultTransactionId
}) {
  const blocked = plans.flatMap(plan => plan.blocked || []);
  if (blocked.length > 0) {
    throw domainError('DEPLOYMENT_PLAN_BLOCKED', 'Blocked operations must be resolved before apply', { blocked });
  }
  const operations = plans.flatMap(plan => plan.operations || []);
  const mutable = operations.filter(operation => operation.operation !== 'SKIP');
  const targets = new Set();
  for (const operation of mutable) {
    if (targets.has(operation.target)) {
      throw domainError('DUPLICATE_DEPLOYMENT_TARGET', 'Prepared plans contain the same target more than once', {
        target: operation.target
      });
    }
    targets.add(operation.target);
    const observed = hashTarget(operation.target);
    if (observed !== operation.beforeHash) {
      throw domainError('STALE_DEPLOYMENT_PLAN', 'Target changed after the deployment plan was created', {
        target: operation.target,
        expected: operation.beforeHash,
        actual: observed
      });
    }
  }

  const id = createTransactionId();
  const previousState = stateStore.load();
  const nextState = structuredClone(previousState);
  const backup = backupStore.create({ transactionId: id, operations: mutable });
  const fileTransaction = new FileTransaction();
  const applied = [];
  try {
    mutable.forEach((operation, index) => {
      fileTransaction.write(operation.target, operationContent(operation));
      const writtenHash = hashTarget(operation.target);
      if (writtenHash !== operation.expectedHash) {
        throw domainError('DEPLOYMENT_WRITE_MISMATCH', 'Written content does not match the plan', {
          target: operation.target
        });
      }
      const previousManaged = previousState.managed[operation.target] || null;
      nextState.managed[operation.target] = operation.strategy === 'merge'
        ? {
            clientId: operation.clientId,
            strategy: 'merge',
            ownership: operation.ownership,
            hash: writtenHash,
            owners: operation.owners,
            transactionId: id
          }
        : {
            clientId: operation.clientId,
            assetId: operation.assetId,
            strategy: operation.strategy,
            ownership: operation.ownership,
            hash: writtenHash,
            transactionId: id
          };
      applied.push({
        target: operation.target,
        beforeHash: operation.beforeHash,
        afterHash: writtenHash,
        backup: backup.entries[index],
        previousManaged
      });
    });
    const validation = validate({ plans, applied: Object.freeze(applied.map(item => item.target)) });
    if (!validation?.valid) {
      throw domainError('DEPLOYMENT_VALIDATION_FAILED', 'Post-apply validation failed', {
        results: validation?.results || []
      });
    }
    nextState.transactions.push({
      id,
      type: 'apply',
      clientIds: [...new Set(plans.map(plan => plan.clientId))],
      createdAt: now(),
      status: 'committed',
      operations: applied,
      validation: validation.results || []
    });
    const targetSnapshot = fileTransaction.commit();
    try {
      stateStore.commit(nextState);
    } catch (error) {
      FileTransaction.restore(targetSnapshot);
      backupStore.rollbackCreation(backup.snapshot);
      throw error;
    }
    return Object.freeze({
      transactionId: id,
      applied: Object.freeze(applied.map(item => item.target)),
      skipped: Object.freeze(operations.filter(item => item.operation === 'SKIP').map(item => item.target)),
      validation: Object.freeze([...(validation.results || [])])
    });
  } catch (error) {
    fileTransaction.rollback();
    backupStore.rollbackCreation(backup.snapshot);
    throw error;
  }
}

export function deploymentTargetHash(target) {
  return hashTarget(target);
}
