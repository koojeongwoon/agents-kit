import {beginDeploymentJournal} from '../infrastructure/deployment-journal.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FileTransaction } from '../infrastructure/file-transaction.js';
import { domainError } from '../domain/errors.js';
import {authorizeSharedTarget, deploymentStateHash} from './shared-resource-deployment.js';
import {hasNativeOwnership} from '../domain/native-installation.js';
import {applySharedSnapshotDeployment,applySharedSnapshotDeploymentAsync} from './apply-shared-snapshot-deployment.js';
import {runTransactionWorkflow} from '../infrastructure/transaction-workflow.js';
import {deploymentOperationContent as operationContent} from './deployment-operation-content.js';
import {nextDeploymentLocators} from './deployment-locator-evidence.js';
import {applyResourcePathMigration} from './apply-resource-path-migration.js';
import {attachInstallationReceipts,installationContextForStore} from './installation-receipt-service.js';
import {prepareDependencyStateCommit,dependencyMutationCanRestore,authorizeDependencyMutations} from '../infrastructure/dependency-store-session.js';
import {readPathImage} from '../infrastructure/path-image.js';
import {nextDeploymentManagedRecord} from '../domain/deployment-managed-record.js';
import {deploymentOperationImage} from './deployment-command.js';
import {assertPredictedInstallation,assertDeploymentPredictionInputs} from './deployment-installation-prediction.js';

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

function defaultTransactionId() {
  return `tx-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
}

export const applyDeployment=input=>deploy(input,false);
export const applyDeploymentAsync=async input=>deploy(input,true);
function deploy(input,async) {
  const execute=()=>runTransactionWorkflow(applyWorkflow(input),{async});
  if (input.plans.some(plan => plan.blocked?.length || plan.operations?.some(operation => operation.previewOnly))) return execute();
  assertDeploymentPredictionInputs(input);
  installationContextForStore(input);
  if (input.plans.some(plan => plan.operations?.some(operation => operation.strategy === 'resource-path'))) {
    if(async)throw domainError('ASYNC_PATH_MIGRATION_NOT_ENABLED','Asynchronous path migration requires its own native context transition');
    return applyResourcePathMigration(input);
  }
  if (input.plans.some(plan => plan.operations?.some(operation => operation.strategy === 'shared-snapshot'))) return (async?applySharedSnapshotDeploymentAsync:applySharedSnapshotDeployment)(input);
  return input.stateStore.withLock ? input.stateStore.withLock(execute) : execute();
}

function* applyWorkflow({
  plans,
  stateStore,
  backupStore,
  validate = () => ({ valid: true, results: [] }),
  now = () => new Date().toISOString(),
  createTransactionId = defaultTransactionId,
  preflight = () => {},
  beforeCommit = () => {}
}) {
  if (plans.some(plan => (plan.operations || []).some(operation => operation.previewOnly))) {
    throw domainError('DEPLOYMENT_PREVIEW_ONLY', 'Preview operations cannot be applied');
  }
  const blocked = plans.flatMap(plan => plan.blocked || []);
  if (blocked.length > 0) {
    throw domainError('DEPLOYMENT_PLAN_BLOCKED', 'Blocked operations must be resolved before apply', { blocked });
  }
  assertDeploymentPredictionInputs({plans});
  const operations = plans.flatMap(plan => plan.operations || []);
  const previousState = stateStore.load();
  yield preflight();
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
    if (previousState.managed[operation.target]?.physicalVersion && !['physical-resource', 'resource-removal'].includes(operation.strategy)) throw domainError('PHYSICAL_RESOURCE_REQUIRES_COMPOSED_PLAN', 'Use the physical resource planner for this recorded store');
    if (operation.strategy !== 'native-source' && hasNativeOwnership(previousState.managed[operation.target])) throw domainError('NATIVE_OWNERSHIP_CONFLICT', 'Use the registered native installation workflow for this target');
    if (observed !== operation.beforeHash) {
      throw domainError('STALE_DEPLOYMENT_PLAN', 'Target changed after the deployment plan was created', {
        target: operation.target,
        expected: operation.beforeHash,
        actual: observed
      });
    }
    if (operation.modeAware && observed !== null && (fs.lstatSync(operation.target).mode & 0o777) !== operation.beforeMode) throw domainError('STALE_DEPLOYMENT_PLAN', 'Installation permissions changed after planning');
  }

  authorizeDependencyMutations(stateStore,()=>mutable.map(operation=>{
    const beforeImage=readPathImage(operation.target,{authorizedRoot:operation.authorizedRoot||stateStore.targetRoot});
    const afterImage=deploymentOperationImage(operation,beforeImage,{newFileMode:0o666&~process.umask()});
    return {target:operation.target,beforeImage,afterImage};
  }));
  const id = createTransactionId();
  const nextState = structuredClone(previousState);
  // Older Kit versions must reject rather than overwrite shared ownership.
  if (mutable.some(operation => operation.strategy === 'shared')) nextState.schemaVersion = Math.max(nextState.schemaVersion, 2);
  if (mutable.some(operation => operation.resource || Object.values(operation.owners || {}).some(owner => owner.resource))) nextState.schemaVersion = Math.max(nextState.schemaVersion, 4);
  if (mutable.some(operation => operation.strategy === 'native-source')) nextState.schemaVersion = Math.max(nextState.schemaVersion, 5);
  if (mutable.some(operation => operation.strategy === 'physical-resource')) nextState.schemaVersion = Math.max(nextState.schemaVersion, 7);
  const backup = backupStore.create({ transactionId: id, operations: mutable });
  let journal;
  const fileTransaction = new FileTransaction();
  const applied = [];
  const canRestoreNativeTargets = () => mutable.filter(item => item.modeAware && fileTransaction.mutations.has(item.target)).every(item => {
    try {
      authorizeSharedTarget(item.target, item.authorizedRoot);
      const observed = hashTarget(item.target), mode = observed === null ? null : fs.lstatSync(item.target).mode & 0o777;
      return observed === item.beforeHash && mode === item.beforeMode || observed === item.expectedHash && mode === item.afterMode;
    } catch {return false;}
  })&&dependencyMutationCanRestore(stateStore);
  try {
    journal = beginDeploymentJournal({stateStore, id, operations: mutable, backup, state: previousState, targetRoot: stateStore.targetRoot});
    mutable.forEach((operation, index) => {
      if (operation.authorizedRoot) authorizeSharedTarget(operation.target, operation.authorizedRoot);
      if (operation.metadataOnly) { /* Ownership-only change; retain file bytes and mode. */ }
      else if (['shared', 'resource-removal', 'native-source', 'physical-resource'].includes(operation.strategy) && operation.expectedHash === null) fileTransaction.remove(operation.target);
      else if (operation.strategy === 'link') fileTransaction.link(operation.linkSource, operation.target);
      else {
        const identity = fileTransaction.write(operation.target, operationContent(operation), journal?.writeMode?.(index)|| (operation.modeAware ? {mode: operation.afterMode, exclusiveTarget: operation.beforeHash === null} : undefined));
        if (operation.beforeHash === null && (operation.modeAware||journal?.requiresCreatedIdentity?.(index))) journal?.recordCreated?.(index, identity);
      }
      const writtenHash = hashTarget(operation.target);
      if (writtenHash !== operation.expectedHash) {
        throw domainError('DEPLOYMENT_WRITE_MISMATCH', 'Written content does not match the plan', {
          target: operation.target
        });
      }
      if (operation.modeAware && writtenHash !== null && (fs.lstatSync(operation.target).mode & 0o777) !== operation.afterMode) throw domainError('DEPLOYMENT_WRITE_MISMATCH', 'Installation permissions differ from the plan');
      const previousManaged = previousState.managed[operation.target] || null;
      const nextManaged=nextDeploymentManagedRecord(operation);
      if(nextManaged)nextState.managed[operation.target]={...nextManaged,transactionId:id};else delete nextState.managed[operation.target];
      const locators = nextDeploymentLocators({state: previousState, managedAfter: nextState.managed[operation.target] ? {[operation.target]: nextState.managed[operation.target]} : {}, requested: plans.flatMap(plan => plan.locators || [])});
      applied.push({
        target: operation.target,
        beforeHash: operation.beforeHash,
        afterHash: writtenHash,
        backup: backup.entries[index],
        previousManaged,
        afterManaged: nextState.managed[operation.target] || null,
        ...(locators.length ? {locators} : {}),
        ...(operation.authorizedRoot ? {authorizedRoot: operation.authorizedRoot, metadataOnly: operation.metadataOnly} : {}),
        ...(journal?.reviewedMode?.(index)?{...journal.reviewedMode(index),authorizedRoot:stateStore.targetRoot}:operation.modeAware ? {modeAware: true, beforeMode: operation.beforeMode, afterMode: operation.afterMode} : {})
      });
    });
    const validation = yield validate({ plans, applied: Object.freeze(applied.map(item => item.target)) });
    if (!validation?.valid) {
      throw domainError('DEPLOYMENT_VALIDATION_FAILED', 'Post-apply validation failed', {
        results: validation?.results || []
      });
    }
    for (const operation of operations.filter(item => item.modeAware)) {
      authorizeSharedTarget(operation.target, operation.authorizedRoot);
      const observed = hashTarget(operation.target);
      if (observed !== operation.expectedHash || observed !== null && (fs.lstatSync(operation.target).mode & 0o777) !== operation.afterMode) {
        throw domainError('DEPLOYMENT_WRITE_MISMATCH', 'Installation changed during validation');
      }
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
    attachInstallationReceipts({previousState,nextState,transaction:nextState.transactions.at(-1),plans,...installationContextForStore({stateStore,plans}),homeDir:stateStore.homeDir,targetRoot:stateStore.targetRoot});
    assertPredictedInstallation({plans,nextState});
    prepareDependencyStateCommit(stateStore,nextState);
    if (mutable.some(operation => operation.strategy === 'physical-resource')) preflight();
    yield beforeCommit();
    if(deploymentStateHash(stateStore.load())!==deploymentStateHash(previousState))throw domainError('STALE_DEPLOYMENT_STATE','Ownership changed while deployment validation was running');
    if (mutable.some(operation => operation.strategy === 'physical-resource') && plans.some(plan => plan.stateHash) && deploymentStateHash(stateStore.load()) !== deploymentStateHash(previousState)) {
      throw domainError('STALE_DEPLOYMENT_STATE', 'Deployment ownership changed during validation');
    }
    const targetSnapshot = fileTransaction.commit();
    try {
      journal?.expectState(nextState);
      stateStore.commit(nextState);
    } catch (error) {
      if (!canRestoreNativeTargets()) throw domainError('NATIVE_DEPLOYMENT_RECOVERY_REQUIRED', 'Concurrent installation changes require reviewed recovery');
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
    if (!canRestoreNativeTargets()) {
      if (!fileTransaction.closed) fileTransaction.commit();
      throw domainError('NATIVE_DEPLOYMENT_RECOVERY_REQUIRED', 'Concurrent installation changes were preserved; review the pending deployment journal');
    }
    fileTransaction.rollback();
    backupStore.rollbackCreation(backup.snapshot);
    journal?.finish();
    throw error;
  }
}

export function deploymentTargetHash(target) {
  return hashTarget(target);
}
