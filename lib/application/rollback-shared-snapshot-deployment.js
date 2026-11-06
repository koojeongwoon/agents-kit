import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {isWithinRoot} from '../security-boundary.js';
import {readPathImage, imageFingerprint} from '../infrastructure/path-image.js';
import {executeTreeDeployment,executeTreeDeploymentAsync, readTreeBackup, assertTreeMetadataScope} from '../infrastructure/tree-deployment-transaction.js';
import {deploymentStateHash} from './shared-resource-deployment.js';
import {deployedImageHash} from './apply-shared-snapshot-deployment.js';
import {verifyManagedSnapshots} from '../infrastructure/skill-snapshot-store.js';
import {runTransactionWorkflow} from '../infrastructure/transaction-workflow.js';
import {assertDeploymentPredictionInputs,assertPredictedInstallation} from './deployment-installation-prediction.js';

const fail = code => {throw domainError(code, 'Tree rollback requires unchanged installation, ownership and verified backup images');};
export const managedSubtree = (state, target) => Object.fromEntries(Object.entries(state.managed).filter(([name]) => isWithinRoot(name, target)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const sorted = value => Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

export function planTreeDeploymentRollback({transactionId, stateStore, backupStore}) {
  const state = stateStore.load(), transaction = state.transactions.find(item => item.id === transactionId);
  if (!transaction || transaction.type !== 'apply' || transaction.status !== 'committed' || !transaction.treeTransaction) fail('TRANSACTION_NOT_ROLLBACKABLE');
  const operations = transaction.operations.map(original => {
    const current = readPathImage(original.target, {authorizedRoot: stateStore.targetRoot});
    const owners = managedSubtree(state, original.target), expectedOwners = sorted(original.managedAfter);
    const latest = state.transactions.findLast(item => item.status === 'committed' && item.operations?.some(operation => isWithinRoot(operation.target, original.target) || isWithinRoot(original.target, operation.target)));
    const superseded = !original.managedAfter || JSON.stringify(owners) !== JSON.stringify(expectedOwners) || !Object.keys(expectedOwners).length && latest?.id !== transactionId;
    let reason = superseded ? 'ROLLBACK_OWNERSHIP_SUPERSEDED' : imageFingerprint(current) !== original.afterImageFingerprint ? 'ROLLBACK_TARGET_MODIFIED' : 'ROLLBACK_READY';
    let afterImage;
    try {afterImage = readTreeBackup(original.backup, {backupStore});} catch {reason = 'RECOVERY_BACKUP_CONFLICT';}
    try {verifyManagedSnapshots({homeDir: stateStore.homeDir, records: [...Object.values(owners), ...Object.values(original.managedBefore || {})]});} catch {reason = 'SKILL_SNAPSHOT_DRIFT';}
    return {target: original.target, strategy: 'shared-snapshot', operation: !afterImage || afterImage.kind === 'absent' ? 'REMOVE' : afterImage.kind === 'symlink' ? 'RESTORE_LINK' : 'RESTORE_TREE',
      beforeHash: deployedImageHash(current), expectedAfterHash: original.beforeHash, expectedHash: original.beforeHash,
      beforeImage: current, afterImage, expectedCurrentFingerprint: original.afterImageFingerprint,
      backup: original.backup, managedBefore: owners, managedAfter: original.managedBefore || {},
      authorizedRoot: stateStore.targetRoot, metadataOnly: original.metadataOnly === true, reason,
      ...(original.connection ? {connection: original.connection, retainedSnapshots: [original.connection.snapshot.treeDigest]} : {})};
  });
  return {transactionId, treeTransaction: true, stateHash: deploymentStateHash(state), operations, blocked: operations.filter(item => item.reason !== 'ROLLBACK_READY'), automatic: operations.every(item => item.reason === 'ROLLBACK_READY')};
}

export const applyTreeDeploymentRollback=input=>rollbackTree(input,false);
export const applyTreeDeploymentRollbackAsync=async input=>rollbackTree(input,true);
function rollbackTree({plan, stateStore, backupStore, validate = () => ({valid: true}), createTransactionId, onPhase,preflight=()=>{},beforeCommit=()=>{}},async) {
  if (plan.blocked.length) fail('ROLLBACK_PLAN_BLOCKED');
  assertDeploymentPredictionInputs({rollback:plan});
  assertTreeMetadataScope({stateStore, backupStore});
  return stateStore.withLock(() => runTransactionWorkflow((function*(){
    yield preflight();
    const current = planTreeDeploymentRollback({transactionId: plan.transactionId, stateStore, backupStore});
    if (current.blocked.length || current.stateHash !== plan.stateHash) fail('STALE_ROLLBACK_PLAN');
    const id = createTransactionId?.() || `tx-${crypto.randomUUID()}`;
    const commands = current.operations.map(operation => ({target: operation.target, authorizedRoot: operation.authorizedRoot,
      beforeImage: operation.beforeImage, afterImage: operation.afterImage, metadataOnly: operation.metadataOnly,
      receipt: {beforeHash: operation.beforeHash, afterHash: operation.expectedAfterHash, managedBefore: operation.managedBefore, managedAfter: operation.managedAfter,
        ...(operation.connection ? {connection: operation.connection} : {})}}));
    const result = yield (async?executeTreeDeploymentAsync:executeTreeDeployment)({stateStore, backupStore, commands, id, revalidate:preflight,validate: () => runTransactionWorkflow((function*(){const result=yield validate({plan});yield beforeCommit();return result;})(),{async}), onPhase,
      buildNextState: ({beforeState, operations, validation}) => {
        const next = structuredClone(beforeState);
        for (const operation of operations) {
          for (const target of Object.keys(operation.managedBefore)) delete next.managed[target];
          Object.assign(next.managed, operation.managedAfter);
        }
        const original = next.transactions.find(item => item.id === plan.transactionId); original.status = 'rolled-back'; original.rolledBackBy = id;
        next.transactions.push({id, type: 'rollback', transactionId: plan.transactionId, createdAt: new Date().toISOString(), status: 'committed', operations, validation: validation.results || [], treeTransaction: true});
        assertPredictedInstallation({rollback:plan,nextState:next});return next;
      }});
    return {transactionId: result.transactionId, rolledBackTransactionId: plan.transactionId, targets: commands.map(item => item.target)};
  })(),{async}));
}
