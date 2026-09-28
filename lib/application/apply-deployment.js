import {beginDeploymentJournal} from '../infrastructure/deployment-journal.js';
import {resourceRemovalContent} from './prepare-resource-removal.js';
import { contentForCopyOperation } from './prepare-copy-deployment.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FileTransaction } from '../infrastructure/file-transaction.js';
import { domainError } from '../domain/errors.js';
import { contentForMergeOperation } from './prepare-merge-deployment.js';
import {authorizeSharedTarget, contentForSharedOperation, deploymentStateHash} from './shared-resource-deployment.js';

function hashTarget(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      return `symlink:${fs.readlinkSync(target)}`;
    }
    if (!stat.isFile()) return `non-file:${stat.mode}`;
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function operationContent(operation) {
  if (operation.strategy === 'resource-removal') return resourceRemovalContent(operation);
  if (operation.strategy === 'shared') return contentForSharedOperation(operation);
  return operation.strategy === 'merge'
    ? contentForMergeOperation(operation)
    : contentForCopyOperation(operation);
}

function defaultTransactionId() {
  return `tx-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
}

export function applyDeployment(input) {
  if (input.plans.some(plan => plan.blocked?.length || plan.operations?.some(operation => operation.previewOnly))) return applyUnlocked(input);
  return input.stateStore.withLock ? input.stateStore.withLock(() => applyUnlocked(input)) : applyUnlocked(input);
}

function applyUnlocked({
  plans,
  stateStore,
  backupStore,
  validate = () => ({ valid: true, results: [] }),
  now = () => new Date().toISOString(),
  createTransactionId = defaultTransactionId
}) {
  if (plans.some(plan => (plan.operations || []).some(operation => operation.previewOnly))) {
    throw domainError('DEPLOYMENT_PREVIEW_ONLY', 'Preview operations cannot be applied');
  }
  const blocked = plans.flatMap(plan => plan.blocked || []);
  if (blocked.length > 0) {
    throw domainError('DEPLOYMENT_PLAN_BLOCKED', 'Blocked operations must be resolved before apply', { blocked });
  }
  const operations = plans.flatMap(plan => plan.operations || []);
  const previousState = stateStore.load();
  if (plans.some(plan => plan.stateHash && plan.stateHash !== deploymentStateHash(previousState))) {
    throw domainError('STALE_DEPLOYMENT_STATE', 'Deployment ownership changed after planning');
  }
  const mutable = operations.filter(operation => operation.operation !== 'SKIP');
  const targets = new Set();
  for (const operation of operations) {
    if (operation.authorizedRoot) authorizeSharedTarget(operation.target, operation.authorizedRoot);
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
  const nextState = structuredClone(previousState);
  // Older Kit versions must reject rather than overwrite shared ownership.
  if (mutable.some(operation => operation.strategy === 'shared')) nextState.schemaVersion = Math.max(nextState.schemaVersion, 2);
  if (mutable.some(operation => operation.resource || Object.values(operation.owners || {}).some(owner => owner.resource))) nextState.schemaVersion = 4;
  const backup = backupStore.create({ transactionId: id, operations: mutable });
  let journal;
  const fileTransaction = new FileTransaction();
  const applied = [];
  try {
    journal = beginDeploymentJournal({stateStore, id, operations: mutable, backup, state: previousState, targetRoot: stateStore.targetRoot});
    mutable.forEach((operation, index) => {
      if (operation.metadataOnly) { /* Ownership-only change; retain file bytes and mode. */ }
      else if (['shared', 'resource-removal'].includes(operation.strategy) && operation.expectedHash === null) fileTransaction.remove(operation.target);
      else if (operation.strategy === 'link') fileTransaction.link(operation.linkSource, operation.target);
      else fileTransaction.write(operation.target, operationContent(operation));
      const writtenHash = hashTarget(operation.target);
      if (writtenHash !== operation.expectedHash) {
        throw domainError('DEPLOYMENT_WRITE_MISMATCH', 'Written content does not match the plan', {
          target: operation.target
        });
      }
      const previousManaged = previousState.managed[operation.target] || null;
      if (['shared', 'resource-removal'].includes(operation.strategy)) {
        if (operation.nextManaged) nextState.managed[operation.target] = {...operation.nextManaged, transactionId: id};
        else delete nextState.managed[operation.target];
      } else nextState.managed[operation.target] = operation.strategy === 'merge'
        ? {
            clientId: operation.clientId,
            strategy: 'merge',
            ownership: operation.ownership,
            hash: writtenHash,
            owners: operation.owners,
            transactionId: id
          }
        : operation.strategy === 'link'
          ? {
              clientId: operation.clientId,
              assetId: operation.assetId,
              strategy: 'link',
              ownership: 'link',
              hash: writtenHash,
              linkSource: operation.linkSource,
              transactionId: id
            }
          : {
            clientId: operation.clientId,
            assetId: operation.assetId,
            ...(operation.resource ? {resource: operation.resource} : {}),
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
        previousManaged,
        afterManaged: nextState.managed[operation.target] || null,
        ...(operation.authorizedRoot ? {authorizedRoot: operation.authorizedRoot, metadataOnly: operation.metadataOnly} : {})
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
      intent: plans.find(plan => plan.intent)?.intent || 'apply',
      clientIds: [...new Set(plans.map(plan => plan.clientId).filter(Boolean))],
      createdAt: now(),
      status: 'committed',
      operations: applied,
      validation: validation.results || []
    });
    const targetSnapshot = fileTransaction.commit();
    try {
      journal?.expectState(nextState);
      stateStore.commit(nextState);
    } catch (error) {
      FileTransaction.restore(targetSnapshot);
      backupStore.rollbackCreation(backup.snapshot);
      throw error;
    }
    try { journal?.finish(); } catch { /* Keep the journal and lock for reviewed recovery. */ }
    return Object.freeze({
      transactionId: id,
      applied: Object.freeze(applied.map(item => item.target)),
      skipped: Object.freeze(operations.filter(item => item.operation === 'SKIP').map(item => item.target)),
      validation: Object.freeze([...(validation.results || [])])
    });
  } catch (error) {
    fileTransaction.rollback();
    backupStore.rollbackCreation(backup.snapshot);
    journal?.finish();
    throw error;
  }
}

export function deploymentTargetHash(target) {
  return hashTarget(target);
}
