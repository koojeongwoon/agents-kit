import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {resourcePathPreparation} from './prepare-resource-path-migration.js';
import {nextDeploymentLocators} from './deployment-locator-evidence.js';
import {deploymentStateHash} from './shared-resource-deployment.js';
import {readPathImage, imageFingerprint} from '../infrastructure/path-image.js';
import {executeTreeDeployment, assertTreeMetadataScope} from '../infrastructure/tree-deployment-transaction.js';
import {verifyManagedSnapshots} from '../infrastructure/skill-snapshot-store.js';
import {attachInstallationReceipts,installationContextForStore} from './installation-receipt-service.js';

const fail = code => {throw domainError(code, 'Path migration requires a fresh reviewed plan preserving both locations');};
export function applyResourcePathMigration(input) {
  installationContextForStore(input);
  const {plans, stateStore, backupStore, preflight = () => {}, validate = () => ({valid: true}), now = () => new Date().toISOString()} = input;
  const all = plans.flatMap(plan => plan.operations);
  if (plans.some(plan => plan.blocked.length) || all.some(op => op.strategy !== 'resource-path' || op.previewOnly)) fail('DEPLOYMENT_PLAN_BLOCKED');
  assertTreeMetadataScope(input); all.forEach(resourcePathPreparation);
  return stateStore.withLock(() => {
    const state = stateStore.load(), id = input.createTransactionId?.() || `tx-${crypto.randomUUID()}`;
    const revalidate = () => {
      preflight();
      if (plans.some(plan => plan.stateHash && plan.stateHash !== deploymentStateHash(stateStore.load()))) fail('STALE_DEPLOYMENT_STATE');
      verifyManagedSnapshots({homeDir: stateStore.homeDir, records: Object.values(state.managed)});
      for (const plan of plans) for (const source of plan.sourceEvidence || []) {
        if (imageFingerprint(readPathImage(source.path, {authorizedRoot: plan.sourceRoot})) !== source.fingerprint) fail('STALE_SOURCE_REVISION');
      }
      for (const plan of plans) for (const source of plan.guardEvidence || []) {
        const current = imageFingerprint(readPathImage(source.path, {authorizedRoot: source.authorizedRoot}));
        const controlled = all.find(op => op.target === source.path);
        if (current !== source.fingerprint && (!controlled || current !== imageFingerprint(resourcePathPreparation(controlled).afterImage))) fail('STALE_SOURCE_REVISION');
      }
    };
    revalidate();
    const requested = plans.flatMap(plan => plan.locators || []);
    const commands = all.map(op => {
      const p = resourcePathPreparation(op), locators = nextDeploymentLocators({state, managedAfter: p.managedAfter, requested});
      return {target: op.target, authorizedRoot: op.authorizedRoot, beforeImage: p.beforeImage, afterImage: p.afterImage, metadataOnly: op.metadataOnly,
        receipt: {beforeHash: op.beforeHash, afterHash: op.expectedHash, managedBefore: p.managedBefore, managedAfter: p.managedAfter,
          previousManaged: p.managedBefore[op.target] || null, afterManaged: p.managedAfter[op.target] || null,
          ...(locators.length ? {locators} : {}), migrationPhase: op.migrationPhase}};
    });
    const publications = [...new Map(all.map(resourcePathPreparation).filter(p => p.publication?.publishSnapshot && p.publication.sources)
      .map(p => [p.publication.snapshot.descriptor.treeDigest, p.publication])).values()].map((p, index) => ({reference: {snapshot: p.snapshot.descriptor, stageName: `${id}-${index}`},
      publish: onPhase => p.store.publish(p.snapshot, {stageName: `${id}-${index}`, onPhase})}));
    const result = executeTreeDeployment({stateStore, backupStore, commands, id, publications, revalidate, onPhase: input.onPhase,
      validate: () => {
        const result = validate({plans, applied: all.map(op => op.target)});
        verifyManagedSnapshots({homeDir: stateStore.homeDir, records: commands.flatMap(command => Object.values(command.receipt.managedAfter))}); return result;
      },
      buildNextState: ({beforeState, operations, validation}) => {
        const next = structuredClone(beforeState); next.schemaVersion = Math.max(next.schemaVersion, commands.some(command => Object.values(command.receipt.managedAfter).some(record => record.physicalVersion)) ? 7 : 6);
        for (const operation of operations) {
          for (const target of Object.keys(operation.managedBefore)) delete next.managed[target];
          operation.managedAfter = Object.fromEntries(Object.entries(operation.managedAfter).map(([target, record]) => [target, {...record, transactionId: id}]));
          Object.assign(next.managed, operation.managedAfter); operation.afterManaged = operation.managedAfter[operation.target] || null;
        }
        next.transactions.push({id, type: 'apply', intent: 'migration', migration: 'resource-path', status: 'committed', createdAt: now(),
          clientIds: [...new Set(requested.map(locator => locator.clientId))], operations, validation: validation.results || [], treeTransaction: true});
        attachInstallationReceipts({previousState:beforeState,nextState:next,transaction:next.transactions.at(-1),plans,...installationContextForStore({stateStore,plans}),homeDir:stateStore.homeDir,targetRoot:stateStore.targetRoot});return next;
      }});
    return {transactionId: result.transactionId, applied: all.map(op => op.target), skipped: [], validation: result.validation.results || []};
  });
}
