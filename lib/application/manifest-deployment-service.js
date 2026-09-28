import {SavedDeploymentPlanStore, canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {planJournalRecovery, applyJournalRecovery} from '../infrastructure/deployment-journal.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {prepareGlobalLedgerMigration, applyGlobalLedgerMigration} from './global-ledger-migration.js';
import {resolveForAuthorization, assertSafeProjectTarget} from '../security-boundary.js';
import {prepareResourceRemoval, removalDependencyBlocks} from './prepare-resource-removal.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {deploymentStateHash, prepareSharedDeployment, prepareSharedRemoval, prepareSharedOwnershipMigration, sharedConsumerId} from './shared-resource-deployment.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { applyDeployment } from './apply-deployment.js';
import { planClientDeployment } from './plan-client-deployment.js';
import { prepareCopyDeployment } from './prepare-copy-deployment.js';
import { prepareManagedLinkDeployment } from './prepare-managed-link-deployment.js';
import { prepareMergeDeployment } from './prepare-merge-deployment.js';
import { applyDeploymentRollback, planDeploymentRollback } from './rollback-deployment.js';
import {
  resolveManifestDependencies,
  ASSET_KINDS,
  directReferences,
  toolRequirements,
  providedTools,
  createAgentKitManifest,
  validateManifestAssetContracts
} from '../domain/manifest.js';
import { domainError } from '../domain/errors.js';
import { DeploymentBackupStore } from '../infrastructure/deployment-backup-store.js';
import { DeploymentStateStore } from '../infrastructure/deployment-state-store.js';
import { loadClientDefinitions } from '../infrastructure/client-definition-loader.js';
import { selectManifestDeployment } from '../domain/manifest-targets.js';
import { discoverAndLoadManifest, resolveAssetSources } from '../infrastructure/manifest-loader.js';
import { planEdit, applyEdit } from './manifest-editing-service.js';
import { runDiagnostics } from './client-diagnostics-service.js';
import { discoverLocalInstallations } from './local-installation-discovery-service.js';
import {observeClientBinary} from '../infrastructure/client-binary-observer.js';
import {planVerifiedClientDeployment} from './plan-verified-client-deployment.js';

function publicPlan(planId, kind, plans, expiresAt, targetProfile, previews = []) {
  const operations = plans.flatMap(plan => plan.operations).map(operation => ({
    clientId: operation.clientId,
    assetId: operation.assetId,
    assetKind: operation.assetKind,
    operation: operation.operation,
    reason: operation.reason,
    strategy: operation.strategy,
    format: operation.format || '',
    target: operation.target,
    beforeHash: operation.beforeHash,
    expectedHash: operation.expectedHash,
    ...(operation.changes ? {changes: operation.changes} : {}),
    ...(operation.consumers ? {consumers: Object.freeze([...operation.consumers]), metadataOnly: operation.metadataOnly} : {}),
    ownership: operation.ownership
  }));
  const blocked = plans.flatMap(plan => plan.blocked);
  return Object.freeze({
    planId,
    ...(targetProfile ? { targetProfile } : {}),
    kind,
    ...(previews.length ? {previews: Object.freeze(previews)} : {}),
    automatic: blocked.length === 0,
    expiresAt,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}

function stateLocations({targetRoot}) {
  targetRoot = resolveForAuthorization(targetRoot);
  return {
    statePath: path.join(targetRoot, '.agent-kit', 'state.json'),
    backupsRoot: path.join(targetRoot, '.agent-kit', 'backups')
  };
}

export function createManifestDeploymentService({
  definitionsDir,
  homeDir = os.homedir(),
  planTtlMs = 5 * 60 * 1000,
  savedPlanTtlMs = 24 * 60 * 60 * 1000,
  planStoreRoot,
  binaryObserver = observeClientBinary,
  clock = () => Date.now()
}) {
  const plans = new Map();
  const rollbackPlans = new Map();
  const editPlans = new Map();
  const recoveryPlans = new Map();
  const savedStore = new SavedDeploymentPlanStore({root: planStoreRoot || path.join(homeDir, '.agents-kit/plans'), clock});
  const fingerprint = entry => canonicalDigest(entry.runtimeChecks?.length
    ? {prepared: entry.prepared, runtimeChecks: entry.runtimeChecks} : entry.prepared || entry.rollback);
  const contextDigest = () => canonicalDigest({homeDir: resolveForAuthorization(homeDir), definitionsDir: resolveForAuthorization(definitionsDir),
    definitions: fs.readdirSync(definitionsDir).filter(name => /\.(yaml|yml|json)$/.test(name)).sort().map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(definitionsDir, name))).digest('hex')])});
  function authorizeReplay(input) {
    if (input.scope === 'project') {
      const scopeRoot = path.resolve(input.scopeRoot || '.');
      const kitRoot = path.basename(path.dirname(scopeRoot)) === 'projects' ? path.dirname(path.dirname(scopeRoot)) : scopeRoot;
      assertSafeProjectTarget({targetDir: input.targetRoot, homeDir, projectRoot: path.resolve(import.meta.dirname, '../..'), kitRoot: input.scopeRoot ? kitRoot : undefined});
    }
  }

  function manifestFileHash(manifestPath) {
    if (!fs.existsSync(manifestPath)) return '';
    const content = fs.readFileSync(manifestPath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  function stores(input) {
    if (!['global', 'project'].includes(input.scope)) throw domainError('INVALID_SCOPE', 'Scope must be global or project');
    if (input.scope === 'global') {
      if (resolveForAuthorization(input.targetRoot) !== resolveForAuthorization(homeDir)) throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Global deployment must target the configured home');
      const stateStore = new GlobalDeploymentStateStore({homeDir});
      stateStore.targetRoot = resolveForAuthorization(input.targetRoot);
      return {stateStore, backupStore: new DeploymentBackupStore({backupsRoot: stateStore.backupsRoot})};
    }
    const locations = stateLocations({ ...input, homeDir });
    const stateStore = new DeploymentStateStore({statePath: locations.statePath});
    stateStore.targetRoot = resolveForAuthorization(input.targetRoot);
    return {
      stateStore,
      backupStore: new DeploymentBackupStore({ backupsRoot: locations.backupsRoot })
    };
  }

  function remember(registry, value) {
    for (const [existingId, existing] of registry) {
      if (existing.expiresAtMs < clock()) registry.delete(existingId);
    }
    const planId = crypto.randomUUID();
    const expiresAtMs = clock() + planTtlMs;
    registry.set(planId, { ...value, expiresAtMs });
    return { planId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  function take(registry, planId) {
    const entry = registry.get(planId);
    registry.delete(planId);
    if (!entry) throw domainError('DEPLOYMENT_PLAN_NOT_FOUND', 'Deployment plan was not found');
    if (entry.expiresAtMs < clock()) {
      throw domainError('DEPLOYMENT_PLAN_EXPIRED', 'Deployment plan has expired');
    }
    return entry;
  }

  function verifyRuntime(entry) {
    for (const check of entry.runtimeChecks || []) {
      const observed = binaryObserver(check.profile);
      if (!observed || observed.binaryPath !== check.observed.binaryPath || observed.sha256 !== check.observed.sha256) {
        throw domainError('CLIENT_BINARY_CHANGED', 'Client executable changed after planning; create a new plan');
      }
    }
  }

  const service = {
    localDiscovery({ pathValue = process.env.PATH || '' } = {}) {
      return discoverLocalInstallations({
        definitions: loadClientDefinitions({ definitionsDir }),
        homeDir,
        pathValue
      });
    },

    clients() {
      return Object.freeze([...loadClientDefinitions({ definitionsDir }).values()].map(definition => Object.freeze({
        id: definition.id,
        displayName: definition.displayName,
        ...(definition.schemaVersion === 2 ? {
          schemaVersion: 2,
          defaultSurface: definition.defaultSurface,
          surfaces: definition.surfaces.map(surface => ({
            id: surface.id,
            displayName: surface.displayName,
            configStore: surface.configStore,
            runtimeState: surface.runtimeEvidence.length ? 'partially-verified' : 'unverified',
            runtimeEvidence: surface.runtimeEvidence,
            capabilities: surface.capabilities.map(capability => ({
              id: capability.id, assetKind: capability.assetKind, scope: capability.scope,
              path: capability.path, status: capability.status,
              documentation: capability.evidence
            }))
          }))
        } : {}),
        detection: Object.freeze({
          commands: Object.freeze([...(definition.detection.commands || [])]),
          userRoot: String(definition.detection.userRoot || '')
        }),
        capabilities: Object.freeze(definition.capabilities.map(capability => Object.freeze({
          assetKind: capability.assetKind,
          scope: capability.scope,
          status: capability.status
        })))
      })));
    },

    plan({scopeRoot, targetRoot, clientId, scope = 'project', clientVersion, surface, previewOptIn = false, targets}) {
      if (!targets && !clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      if (targets && clientId) throw domainError('INVALID_DEPLOYMENT_TARGETS', 'Use clientId or explicit targets, not both');
      const requests = targets || [{clientId, clientVersion, surface, previewOptIn}];
      if (!Array.isArray(requests) || !requests.length || requests.length > 8
        || requests.some(item => !item || typeof item.clientId !== 'string' || !item.clientId)) {
        throw domainError('INVALID_DEPLOYMENT_TARGETS', 'Select one to eight distinct client surfaces');
      }
      const loaded = discoverAndLoadManifest({scopeRoot, resolveSources: false});
      const definitions = loadClientDefinitions({definitionsDir});
      const {stateStore, backupStore} = stores({scope, targetRoot, clientId: requests[0].clientId});
      const state = stateStore.load();
      const prepared = [], previews = [], selections = [], targetProfiles = [], contributions = [], runtimeChecks = [];
      const profiles = new Set();
      for (const request of requests) {
        const definition = definitions.get(request.clientId);
        if (!definition) throw domainError('CLIENT_DEFINITION_NOT_FOUND', `Client definition '${request.clientId}' was not found`);
        const selection = selectManifestDeployment(loaded.manifest, {clientId: request.clientId, scope});
        const sources = resolveAssetSources(loaded.manifest, scopeRoot, selection.selectedAssetIds);
        const {plan: capabilityPlan, runtimeCheck} = planVerifiedClientDeployment({
          manifest: loaded.manifest, definition, clientVersion: request.clientVersion, surface: request.surface,
          platform: process.platform, arch: process.arch, previewOptIn: request.previewOptIn === true,
          selectedAssetIds: selection.selectedAssetIds, binaryObserver
        });
        if (runtimeCheck) runtimeChecks.push(runtimeCheck);
        const profileKey = `${request.clientId}:${capabilityPlan.targetProfile.surface || 'default'}`;
        if (profiles.has(profileKey)) throw domainError('INVALID_DEPLOYMENT_TARGETS', 'Duplicate client surface selected');
        profiles.add(profileKey);
        selections.push({clientId: request.clientId, ...selection}); targetProfiles.push(capabilityPlan.targetProfile);
        const consumerId = sharedConsumerId(loaded.manifest.kit.id, request.clientId, capabilityPlan.targetProfile.surface);
        for (const planned of capabilityPlan.operations.filter(item => item.commonSource)) {
          contributions.push({planned, source: sources.get(planned.assetId), kitId: loaded.manifest.kit.id, consumerId});
        }
        const strategyPlan = {...capabilityPlan, blocked: [], operations: capabilityPlan.operations.filter(item => !item.commonSource)};
        for (const item of [...capabilityPlan.operations, ...capabilityPlan.blocked].filter(item => item.rendered)) {
          const preparePreview = item.strategy === 'copy' ? prepareCopyDeployment : prepareMergeDeployment;
          const preview = preparePreview({capabilityPlan: {...capabilityPlan, operations: [item], blocked: []}, sources, targetRoot, homeDir, state, previewOnly: true});
          const change = preview.operations[0];
          previews.push(Object.freeze({
            clientId: request.clientId, assetId: item.assetId, target: change?.target || item.target,
            format: item.rendered.format, desired: item.rendered.content,
            ...(item.rendered.notices ? {notices: item.rendered.notices} : {}), previewOnly: true, supportReason: item.reason,
            operation: change?.operation || 'BLOCKED', beforeHash: change?.beforeHash ?? null, expectedHash: change?.expectedHash ?? null,
            changes: change?.changes || [], conflicts: preview.blocked.map(block => ({reason: block.reason, selector: block.selector}))
          }));
        }
        prepared.push({clientId: request.clientId, operations: [], blocked: [...capabilityPlan.blocked]});
        const input = {capabilityPlan: strategyPlan, sources, targetRoot, homeDir, state};
        prepared.push(prepareCopyDeployment(input), prepareMergeDeployment(input), prepareManagedLinkDeployment(input));
      }
      prepared.push(prepareSharedDeployment({contributions, state, targetRoot, scope, homeDir}));
      const paths = new Set();
      for (const operation of prepared.flatMap(plan => plan.operations)) {
        if (paths.has(operation.target)) prepared[0].blocked.push({...operation, reason: 'DUPLICATE_DEPLOYMENT_TARGET'});
        paths.add(operation.target);
      }
      const stamped = prepared.map(plan => ({...plan, stateHash: deploymentStateHash(state)}));
      const remembered = remember(plans, {prepared: stamped, stateStore, backupStore, runtimeChecks, replay: {method: 'plan', input: {scopeRoot, targetRoot, clientId, scope, clientVersion, surface, previewOptIn, targets}}});
      const mutable = stamped.flatMap(plan => plan.operations).filter(operation => operation.operation !== 'SKIP');
      const schema = mutable.some(operation => operation.resource || Object.values(operation.owners || {}).some(owner => owner.resource)) ? 4
        : mutable.some(operation => operation.strategy === 'shared') ? 2 : state.schemaVersion;
      return Object.freeze({...publicPlan(remembered.planId, 'apply', stamped, remembered.expiresAt, targetProfiles[0], previews),
        ...(schema > state.schemaVersion ? {stateUpgrade: {from: state.schemaVersion, to: schema}} : {}),
        ...(requests.length === 1 ? {selection: selections[0]} : {selections, targetProfiles})});
    },

    planRemoval({scopeRoot, targetRoot, clientId, surface, scope = 'project', assetIds}) {
      if (!Array.isArray(assetIds) || !assetIds.length || new Set(assetIds).size !== assetIds.length
        || assetIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) {
        throw domainError('INVALID_REMOVAL_ASSETS', 'Removal requires explicit unique asset IDs');
      }
      const loaded = discoverAndLoadManifest({scopeRoot, resolveSources: false});
      const definition = loadClientDefinitions({definitionsDir}).get(clientId);
      if (!definition) throw domainError('CLIENT_DEFINITION_NOT_FOUND', 'Client definition was not found');
      const profile = selectClientSurface(definition, surface);
      if (!profile.eligible) throw domainError('INVALID_CLIENT_SURFACE', 'Client surface was not found');
      const consumerId = sharedConsumerId(loaded.manifest.kit.id, clientId, profile.id);
      const {stateStore, backupStore} = stores({scope, targetRoot, clientId});
      const state = stateStore.load();
      const kitId = loaded.manifest.kit.id;
      const sharedIds = assetIds.filter(id => Object.values(state.managed).some(record => record.sharedVersion
        && (record.shared?.assetId === id || record.owners?.[id])));
      const removal = prepareSharedRemoval({state, targetRoot, kitId, consumerIds: [consumerId], assetIds: sharedIds});
      const resourceIds = assetIds.filter(id => !sharedIds.includes(id));
      const typed = prepareResourceRemoval({state, targetRoot, kitId, clientId, profile, assetIds: resourceIds});
      removal.operations.push(...typed.operations); removal.blocked.push(...typed.blocked);
      for (const assetId of resourceIds) if (!typed.found.has(assetId)) removal.blocked.push({assetId, reason: 'SHARED_RESOURCE_NOT_MANAGED'});
      removal.blocked.push(...removalDependencyBlocks({state, operations: removal.operations, kitId, clientId, removedIds: assetIds}));
      const prepared = [{...removal, clientId, intent: 'remove', stateHash: deploymentStateHash(state)}];
      const remembered = remember(plans, {prepared, stateStore, backupStore, replay: {method: 'planRemoval', input: {scopeRoot, targetRoot, clientId, surface, scope, assetIds}}});
      return publicPlan(remembered.planId, 'remove', prepared, remembered.expiresAt);
    },

    planMigration({scopeRoot, targetRoot, clientId, surface, scope = 'project', assetIds, migration}) {
      const {stateStore, backupStore} = stores({scope, targetRoot, clientId});
      if (migration === 'global-ledger') {
        if (scope !== 'global') throw domainError('INVALID_MIGRATION_SCOPE', 'Global ledger migration requires global scope');
        const prepared = prepareGlobalLedgerMigration(stateStore);
        const remembered = remember(plans, {globalMigration: prepared});
        return Object.freeze({...publicPlan(remembered.planId, 'migration', [prepared], remembered.expiresAt),
          migration, migratedClients: prepared.legacy.map(item => item.clientId)});
      }
      if (migration !== 'shared-ownership') throw domainError('INVALID_MIGRATION_KIND', 'Select global-ledger or shared-ownership');
      if (!Array.isArray(assetIds) || !assetIds.length || new Set(assetIds).size !== assetIds.length
        || assetIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) {
        throw domainError('INVALID_MIGRATION_ASSETS', 'Ownership migration requires explicit unique asset IDs');
      }
      const loaded = discoverAndLoadManifest({scopeRoot, resolveSources: false});
      const definition = loadClientDefinitions({definitionsDir}).get(clientId);
      if (!definition) throw domainError('CLIENT_DEFINITION_NOT_FOUND', 'Client definition was not found');
      const profile = selectClientSurface(definition, surface);
      if (!profile.eligible) throw domainError('INVALID_CLIENT_SURFACE', 'Client surface was not found');
      const selection = selectManifestDeployment(loaded.manifest, {clientId, scope});
      if (assetIds.some(id => !selection.selectedAssetIds.includes(id))) throw domainError('INVALID_MIGRATION_ASSETS', 'Migration assets must be selected in this client scope');
      const sources = resolveAssetSources(loaded.manifest, scopeRoot, assetIds);
      const capability = planClientDeployment({manifest: loaded.manifest, definition, surface, selectedAssetIds: assetIds});
      // Migration only changes proven metadata. Runtime evidence gates subsequent deployment.
      const candidates = [...capability.operations, ...capability.blocked];
      const usable = candidates.filter(item => item.commonSource && ['CAPABILITY_ELIGIBLE', 'CLIENT_VERSION_REQUIRED', 'CLIENT_PROFILE_UNVERIFIED'].includes(item.reason));
      const blocked = candidates.filter(item => !usable.includes(item)).map(item => ({...item, reason: 'SHARED_MIGRATION_CAPABILITY_UNSUPPORTED'}));
      const state = stateStore.load();
      const prepared = prepareSharedOwnershipMigration({state, scope, targetRoot, homeDir,
        contributions: usable.map(planned => ({planned, source: sources.get(planned.assetId), kitId: loaded.manifest.kit.id,
          consumerId: sharedConsumerId(loaded.manifest.kit.id, clientId, profile.id)}))});
      prepared.blocked.push(...blocked);
      const stamped = [{...prepared, clientId, intent: 'migration', stateHash: deploymentStateHash(state)}];
      const remembered = remember(plans, {prepared: stamped, stateStore, backupStore, replay: {method: 'planMigration', input: {scopeRoot, targetRoot, clientId, surface, scope, assetIds, migration}}});
      return Object.freeze({...publicPlan(remembered.planId, 'migration', stamped, remembered.expiresAt), migration,
        ...(state.schemaVersion === 1 ? {stateUpgrade: {from: 1, to: 2}} : {})});
    },

    savePlan({planId}) {
      const entry = plans.get(planId) || rollbackPlans.get(planId);
      if (!entry || entry.expiresAtMs < clock()) throw domainError('DEPLOYMENT_PLAN_NOT_FOUND', 'A current reviewed plan is required');
      const prepared = entry.prepared || (entry.rollback ? [entry.rollback] : []);
      if (!entry.replay || prepared.some(plan => plan.blocked.length || plan.operations.some(item => item.previewOnly || item.strategy === 'link' || item.operation === 'RESTORE_LINK' || String(item.beforeHash).startsWith('symlink:')))) {
        throw domainError('SAVED_PLAN_UNSUPPORTED', 'Only applicable regular-file deployment, removal, ownership migration and rollback plans can be saved');
      }
      authorizeReplay(entry.replay.input);
      const saved = savedStore.create({schemaVersion: 1, id: planId, expiresAtMs: clock() + savedPlanTtlMs,
        kind: entry.replay.method === 'planRollback' ? 'rollback' : entry.replay.method === 'planRemoval' ? 'remove' : entry.replay.method === 'planMigration' ? 'migration' : 'apply',
        replay: entry.replay, contextDigest: contextDigest(), snapshotDigest: fingerprint(entry),
        operations: prepared.flatMap(plan => plan.operations).map(({target, operation, assetId, clientId}) => ({target, operation, assetId, clientId}))});
      plans.delete(planId); rollbackPlans.delete(planId);
      return saved;
    },

    savedPlans() { return savedStore.list(); },

    resumeSavedPlan({planId, digest, validate}) {
      return savedStore.run(planId, digest, body => {
        if (body.contextDigest !== contextDigest()) throw domainError('STALE_SAVED_PLAN', 'Client definitions or host context changed; create a new plan');
        if (!['plan', 'planRemoval', 'planMigration', 'planRollback'].includes(body.replay?.method)) throw domainError('INVALID_SAVED_PLAN', 'Saved plan method is unsupported');
        authorizeReplay(body.replay.input);
        const rebuilt = service[body.replay.method](body.replay.input);
        const entry = take(body.kind === 'rollback' ? rollbackPlans : plans, rebuilt.planId);
        if (fingerprint(entry) !== body.snapshotDigest) throw domainError('STALE_SAVED_PLAN', 'Sources, target files or ownership changed since review');
        verifyRuntime(entry);
        const createTransactionId = () => `tx-plan-${body.id}`;
        return body.kind === 'rollback'
          ? applyDeploymentRollback({plan: entry.rollback, stateStore: entry.stateStore, backupStore: entry.backupStore, validate, createTransactionId})
          : applyDeployment({plans: entry.prepared, stateStore: entry.stateStore, backupStore: entry.backupStore, validate, createTransactionId});
      }, body => {
        // The process may die after journal cleanup but before the saved receipt is written.
        // Only a recorded transaction with no pending deployment can settle that uncertainty.
        authorizeReplay(body.replay.input);
        const {stateStore} = stores(body.replay.input);
        if (fs.existsSync(`${stateStore.statePath}.journal.json`) || fs.existsSync(`${stateStore.statePath}.lock`)) return null;
        const transaction = stateStore.load().transactions.find(item => item.id === `tx-plan-${body.id}`);
        return transaction ? {transactionId: transaction.id, status: transaction.status, reconciled: true} : null;
      });
    },

    planRecovery({scope = 'project', targetRoot, clientId}) {
      authorizeReplay({scope, targetRoot});
      const {stateStore, backupStore} = stores({scope, targetRoot, clientId});
      const recovery = planJournalRecovery({stateStore, backupStore});
      const remembered = remember(recoveryPlans, {recovery, stateStore, backupStore});
      return {...publicPlan(remembered.planId, 'recovery', [recovery], remembered.expiresAt),
        interruptedTransactionId: recovery.journal.id, outcome: recovery.committed ? 'keep-committed' : 'restore-original'};
    },

    recover({planId}) {
      const entry = take(recoveryPlans, planId);
      const result = applyJournalRecovery({plan: entry.recovery, stateStore: entry.stateStore, backupStore: entry.backupStore});
      // Mark saved executions terminal after recovery; restored attempts need a new review.
      const savedId = result.transactionId.startsWith('tx-plan-') ? result.transactionId.slice(8) : '';
      if (savedId) {
        const record = savedStore.read(savedId);
        record.status = result.outcome === 'committed' ? 'completed' : 'recovered'; record.result = result;
        savedStore.write(record);
      }
      return result;
    },

    apply({ planId, validate }) {
      const entry = take(plans, planId);
      if (entry.globalMigration) return applyGlobalLedgerMigration(entry.globalMigration, validate);
      verifyRuntime(entry);
      return applyDeployment({
        plans: entry.prepared,
        stateStore: entry.stateStore,
        backupStore: entry.backupStore,
        validate
      });
    },

    history({ scope = 'project', targetRoot, clientId }) {
      if (!clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      return stores({ scope, targetRoot, clientId }).stateStore.load().transactions;
    },

    planRollback({ transactionId, scope = 'project', targetRoot, clientId }) {
      if (!clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      const { stateStore, backupStore } = stores({ scope, targetRoot, clientId });
      const rollback = planDeploymentRollback({ transactionId, stateStore });
      const remembered = remember(rollbackPlans, {rollback, stateStore, backupStore, replay: {method: 'planRollback', input: {transactionId, scope, targetRoot, clientId}}});
      return publicPlan(remembered.planId, 'rollback', [rollback], remembered.expiresAt);
    },

    rollback({ planId, validate }) {
      const entry = take(rollbackPlans, planId);
      return applyDeploymentRollback({
        plan: entry.rollback,
        stateStore: entry.stateStore,
        backupStore: entry.backupStore,
        validate
      });
    },

    validate({ scopeRoot }) {
      try {
        const loaded = discoverAndLoadManifest({ scopeRoot });
        if (loaded.mode !== 'manifest') {
          return {
            valid: false,
            issues: [{
              code: 'MANIFEST_REQUIRED',
              severity: 'error',
              message: 'Manifest deployment requires agent-kit.yaml, .yml, or .json'
            }]
          };
        }

        const selectedAssetIds = Object.values(loaded.manifest.assets)
          .flat()
          .map(asset => asset.id);

        const dependencies = resolveManifestDependencies(loaded.manifest, {
          selectedAssetIds,
          targetScope: { type: 'project' }
        });

        return {
          valid: dependencies.valid,
          issues: dependencies.issues.map(iss => ({
            code: iss.code,
            severity: iss.severity || 'error',
            sourceAssetId: iss.sourceAssetId,
            message: iss.message || `Issue with code ${iss.code}`,
            details: iss
          }))
        };
      } catch (error) {
        return {
          valid: false,
          issues: [{
            code: error.code || 'INVALID_MANIFEST',
            severity: 'error',
            message: error.message,
            details: error.details || {}
          }]
        };
      }
    },

    doctor({ scopeRoot, targetRoot, clientId, scope = 'project', clientVersion, surface }) {
      return runDiagnostics({
        binaryObserver,
        scopeRoot,
        targetRoot,
        clientId,
        scope,
        clientVersion,
        surface,
        platform: process.platform,
        arch: process.arch,
        discoverAndLoadManifest,
        resolveManifestDependencies,
        loadClientDefinitions,
        definitionsDir
      });
    },

    registry({ scopeRoot }) {
      const loaded = discoverAndLoadManifest({ scopeRoot });
      const projections = [];
      for (const kind of ASSET_KINDS) {
        for (const asset of loaded.manifest.assets[kind] || []) {
          projections.push({
            id: asset.id,
            kind: asset.kind,
            displayName: asset.displayName || asset.name || asset.id,
            scope: asset.scope,
            providedTools: providedTools(asset),
            requiredTools: toolRequirements(asset).map(tr => tr.id),
            references: directReferences(asset).map(ref => ({ id: ref.id, expectedKind: ref.expectedKind }))
          });
        }
      }
      return projections;
    },

    resource({ scopeRoot, assetId }) {
      const loaded = discoverAndLoadManifest({ scopeRoot });
      for (const kind of ASSET_KINDS) {
        const asset = (loaded.manifest.assets[kind] || []).find(candidate => candidate.id === assetId);
        if (asset) return asset;
      }
      throw domainError('ASSET_NOT_FOUND', `Asset '${assetId}' was not found`, { assetId });
    },

    dependencies({ scopeRoot }) {
      const loaded = discoverAndLoadManifest({ scopeRoot });
      const nodes = [];
      const links = [];
      for (const kind of ASSET_KINDS) {
        for (const asset of loaded.manifest.assets[kind] || []) {
          nodes.push({
            id: asset.id,
            kind: asset.kind,
            displayName: asset.displayName || asset.name || asset.id
          });
          const refs = directReferences(asset);
          for (const ref of refs) {
            links.push({
              source: asset.id,
              target: ref.id,
              relation: ref.relation
            });
          }
          const reqTools = toolRequirements(asset);
          for (const req of reqTools) {
            links.push({
              source: asset.id,
              target: req.id,
              relation: 'requires.tools'
            });
          }
        }
      }
      return { nodes, links };
    },

    planEdit({ scopeRoot, mutations }) {
      return planEdit({
        scopeRoot,
        mutations,
        discoverAndLoadManifest,
        ASSET_KINDS,
        domainError,
        createAgentKitManifest,
        directReferences,
        validateManifestAssetContracts,
        parseYaml,
        remember,
        editPlans
      });
    },

    applyEdit({ planId }) {
      return applyEdit({
        planId,
        take,
        editPlans,
        stringifyYaml
      });
    }
  };
  return Object.freeze(service);
}
