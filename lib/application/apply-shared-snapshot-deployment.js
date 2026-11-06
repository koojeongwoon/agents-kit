import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {snapshotForSharedConnection} from './prepare-shared-snapshot-deployment.js';
import {deploymentStateHash} from './shared-resource-deployment.js';
import {readPathImage} from '../infrastructure/path-image.js';
import {prepareSkillSnapshot, verifyManagedSnapshots} from '../infrastructure/skill-snapshot-store.js';
import {executeTreeDeployment,executeTreeDeploymentAsync, assertTreeMetadataScope} from '../infrastructure/tree-deployment-transaction.js';
import {runTransactionWorkflow} from '../infrastructure/transaction-workflow.js';
import {prepareDeploymentCommand, deployedImageHash} from './deployment-command.js';
import {stampDeploymentManagedRecords} from '../domain/deployment-managed-record.js';
import {assertPredictedInstallation,assertDeploymentPredictionInputs} from './deployment-installation-prediction.js';
import {attachInstallationReceipts,installationContextForStore} from './installation-receipt-service.js';

const fail = code => {throw domainError(code, 'The reviewed shared snapshot deployment no longer matches its inputs');};
export function assertSnapshotExecution(operation) {
  let prepared;
  try {prepared = snapshotForSharedConnection(operation);} catch {fail('SNAPSHOT_LINK_EXECUTION_NOT_ENABLED');}
  if (!prepared.executionEligible) fail('SNAPSHOT_LINK_EXECUTION_NOT_ENABLED'); return prepared;
}
export {deployedImageHash};

export const applySharedSnapshotDeployment=input=>applySnapshot(input,false);
export const applySharedSnapshotDeploymentAsync=async input=>applySnapshot(input,true);
function applySnapshot(input,async) {
  assertDeploymentPredictionInputs(input);
  installationContextForStore(input);
  const all = input.plans.flatMap(plan => plan.operations || []);
  all.filter(item => item.strategy === 'shared-snapshot').forEach(assertSnapshotExecution);
  assertTreeMetadataScope(input);
  return input.stateStore.withLock(() => runTransactionWorkflow((function*() {
    const {stateStore, backupStore, plans, validate = () => ({valid: true}), preflight = () => {}, now = () => new Date().toISOString()} = input;
    const state = stateStore.load(), id = input.createTransactionId?.() || `tx-${crypto.randomUUID()}`;
    if (plans.some(plan => plan.stateHash && plan.stateHash !== deploymentStateHash(state))) fail('STALE_DEPLOYMENT_STATE');
    preflight();
    const revalidate = () => {
      preflight();
      for (const operation of all.filter(item => item.strategy === 'shared-snapshot')) {
        const prepared = assertSnapshotExecution(operation);
        for (const source of prepared.sources || []) {
          const current = prepareSkillSnapshot({source, authorizedRoot: prepared.sourceRoot, store: prepared.store});
          if (current.descriptor.treeDigest !== prepared.snapshot.descriptor.treeDigest) fail('STALE_SOURCE_REVISION');
        }
        for (const record of Object.values(operation.managedBefore || {})) if (record.connection
          && prepared.store.inspect(record.connection.snapshot).status !== 'present') fail('SKILL_SNAPSHOT_DRIFT');
      }
    };
    revalidate();
    const mutable = all.filter(item => item.operation !== 'SKIP');
    const commands = mutable.map(operation => {
      const root = operation.authorizedRoot || stateStore.targetRoot;
      return prepareDeploymentCommand({operation, state, plans, authorizedRoot: root, beforeImage: readPathImage(operation.target, {authorizedRoot: root})});
    });
    const publications = [...new Map(mutable.filter(item => item.strategy === 'shared-snapshot').map(operation => {
      const prepared = assertSnapshotExecution(operation);
      return [prepared.snapshot.descriptor.treeDigest, {prepared, needed: prepared.publishSnapshot === true && !!prepared.sources && operation.expectedHash !== null}];
    })).values()].filter(item => item.needed).map(({prepared}, index) => ({reference: {snapshot: prepared.snapshot.descriptor, stageName: `${id}-${index}`},
      publish: onPhase => prepared.store.publish(prepared.snapshot, {stageName: `${id}-${index}`, onPhase})}));
    const result = yield (async?executeTreeDeploymentAsync:executeTreeDeployment)({stateStore, backupStore, commands, id, publications, revalidate,
      validate: () => runTransactionWorkflow((function*(){const result = yield validate({plans, applied: mutable.map(item => item.target)});
        verifyManagedSnapshots({homeDir: stateStore.homeDir, records: commands.flatMap(command => Object.values(command.receipt.managedAfter))}); yield input.beforeCommit?.();return result;})(),{async}), onPhase: input.onPhase,
      buildNextState: ({beforeState, operations, validation}) => {
        const next = structuredClone(beforeState); next.schemaVersion = Math.max(next.schemaVersion, commands.some(command => Object.values(command.receipt.managedAfter).some(record => record.physicalVersion)) ? 7 : 6);
        for (const operation of operations) {
          for (const target of Object.keys(operation.managedBefore)) delete next.managed[target];
          const managedAfter = stampDeploymentManagedRecords(operation.managedAfter, id);
          Object.assign(next.managed, managedAfter); operation.managedAfter = managedAfter; operation.afterManaged = managedAfter[operation.target] || null;
        }
        next.transactions.push({id, type: 'apply', intent: plans.find(plan => plan.intent)?.intent || 'apply', status: 'committed', createdAt: now(),
          clientIds: [...new Set(plans.map(plan => plan.clientId).filter(Boolean))], operations, validation: validation.results || [], treeTransaction: true});
        attachInstallationReceipts({previousState:beforeState,nextState:next,transaction:next.transactions.at(-1),plans,...installationContextForStore({stateStore,plans}),homeDir:stateStore.homeDir,targetRoot:stateStore.targetRoot});
        assertPredictedInstallation({plans,nextState:next});
        return next;
      }});
    return {transactionId: result.transactionId, applied: mutable.map(item => item.target), skipped: all.filter(item => item.operation === 'SKIP').map(item => item.target), validation: result.validation.results || []};
  })(),{async}));
}
