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
import {preparePhysicalResourceDeployment} from './prepare-physical-resource-deployment.js';
import {deploymentPathDriftBlocks} from './deployment-path-drift.js';
import {createDeploymentLocators} from './deployment-locator-evidence.js';
import {prepareResourcePathMigration} from './prepare-resource-path-migration.js';
import {readPathImage, imageFingerprint} from '../infrastructure/path-image.js';
import {createResourceImportService} from './resource-import-service.js';
import {readResourceCatalog, registryProjection} from './resource-catalog-service.js';
import {observeResourceCatalog} from './observe-resource-catalog.js';
import {observeNativeInventory} from '../infrastructure/native-inventory-observer.js';
import {describeInstallationResources} from './installation-receipt-service.js';
import {inspectCatalogInstallations} from './inspect-catalog-installations.js';
import {inspectDependencyDependents} from './inspect-dependency-dependents.js';
import {compileScopedDeployment} from './scoped-deployment-compiler.js';
import {planGlobalDependencyMutation,executeGlobalDependencyMutation,planGlobalDependencyRecovery,applyGlobalDependencyRecovery} from './global-dependency-mutation.js';
import {readCoordinationJson,coordinationExists} from '../infrastructure/dependency-coordination-io.js';
import {createScopedDeploymentExecution} from './scoped-deployment-execution.js';
import {compileScopedResourceRemoval} from './scoped-resource-removal.js';
import {compileScopedDeploymentRollback} from './scoped-deployment-rollback.js';
import {validateScopedManifest,scopedDiagnostics,scopedDependencyProjection} from './scoped-manifest-management.js';
import {planDependencyCoordinationRecovery,applyDependencyCoordinationRecovery} from './dependency-coordination-service.js';
import {skillDistributionReviews,describeSkillSelections} from './skill-distribution-deployment.js';
import {loadNativeSkillPolicy,nativeSkillPolicyContext} from '../infrastructure/native-skill-policy-loader.js';
const SKILL_STRATEGY_MIGRATION = Symbol('explicit Skill strategy migration');
const RESOURCE_PATH_MIGRATION = Symbol('explicit resource path migration');

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
    ...(operation.affectedTargets ? {affectedTargets: structuredClone(operation.affectedTargets), configStore: operation.configStore, storeEffect: operation.storeEffect} : {}),
    ...(operation.connection ? {connection: structuredClone(operation.connection), snapshotStatus: operation.snapshotStatus,
      snapshotChanges: operation.snapshotChanges, retainedSnapshots: operation.retainedSnapshots, previewOnly: operation.previewOnly === true} : {}),
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
  nativeInventoryObserver = observeNativeInventory,
  upstreamReader,
  onDeploymentPhase,
  clock = () => Date.now()
}) {
  const plans = new Map();
  const rollbackPlans = new Map();
  const editPlans = new Map();
  const recoveryPlans = new Map();
  const scopedExecution=createScopedDeploymentExecution({homeDir,definitionsDir,binaryObserver,nativeInventoryObserver,clock});
  const savedStore = new SavedDeploymentPlanStore({root: planStoreRoot || path.join(homeDir, '.agents-kit/plans'), clock});
  const baseFingerprint = entry => entry.scopedState?scopedExecution.fingerprint(entry.scopedState):entry.reviewContext ? canonicalDigest({prepared: entry.prepared, runtimeChecks: entry.runtimeChecks, reviewContext: entry.reviewContext}) : canonicalDigest(entry.runtimeChecks?.length
    ? {prepared: entry.prepared, runtimeChecks: entry.runtimeChecks} : entry.prepared || entry.rollback);
  const fingerprint=entry=>entry.globalMutation?canonicalDigest({base:baseFingerprint(entry),globalMutation:entry.globalMutation.digest}):baseFingerprint(entry);
  const contextDigest = () => canonicalDigest({homeDir: resolveForAuthorization(homeDir), definitionsDir: resolveForAuthorization(definitionsDir),
    nativeSkills:nativeSkillPolicyContext(definitionsDir),
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
    stateStore.homeDir = resolveForAuthorization(homeDir);
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
    if(entry?.inProgress)throw domainError('DEPLOYMENT_PLAN_BUSY','Plan observation is still running');
    registry.delete(planId);
    if (!entry) throw domainError('DEPLOYMENT_PLAN_NOT_FOUND', 'Deployment plan was not found');
    if (entry.expiresAtMs < clock()) {
      throw domainError('DEPLOYMENT_PLAN_EXPIRED', 'Deployment plan has expired');
    }
    return entry;
  }

  function verifyRuntime(entry) {
    if (entry.reviewContext) {
      const loaded = discoverAndLoadManifest({scopeRoot: entry.reviewContext.scopeRoot, resolveSources: false});
      if (loaded.manifestPath !== entry.reviewContext.manifestPath || canonicalDigest(loaded.manifest) !== entry.reviewContext.manifestDigest
        || contextDigest() !== entry.reviewContext.definitionDigest) throw domainError('STALE_DEPLOYMENT_PLAN', 'Manifest or client policy changed after reviewing the deployment plan');
      if(entry.reviewContext.skillMetadataDigest&&entry.reviewContext.skillMetadataDigest!==canonicalDigest(entry.prepared.map(plan=>({locators:plan.locators,installationDescriptors:plan.installationDescriptors,skillSelectionDescriptors:plan.skillSelectionDescriptors}))))throw domainError('STALE_DEPLOYMENT_PLAN','Selected Skill installation metadata changed after review');
      for(const {assetId,selection} of entry.reviewContext.skillSources||[])try {
        resolveAssetSources(loaded.manifest,entry.reviewContext.scopeRoot,[assetId],{skillSelections:new Map([[assetId,selection]])});
      }catch{throw domainError('STALE_SOURCE_REVISION','Selected Skill source changed after reviewing the deployment plan');}
    }
    for (const check of entry.runtimeChecks || []) {
      const observed = binaryObserver(check.profile);
      if (!observed || observed.binaryPath !== check.observed.binaryPath || observed.sha256 !== check.observed.sha256) {
        throw domainError('CLIENT_BINARY_CHANGED', 'Client executable changed after planning; create a new plan');
      }
    }
  }

  function globalOptions(entry) {
    return {globalStore:entry.stateStore,backupStore:entry.backupStore,definitionsDir,...(entry.rollback?{rollback:entry.rollback}:{plans:entry.prepared})};
  }
  function protectGlobal(entry,{scope,supported=true}) {
    if(scope!=='global')return;
    const state=entry.stateStore.load();
    if(!state.dependencyIndex?.projects.length)return;
    const prepared=entry.rollback?[entry.rollback]:entry.prepared,issues=[];
    if(!supported)issues.push({code:'GLOBAL_MUTATION_ACTION_UNSUPPORTED'});
    else if(!prepared.some(plan=>plan.blocked.length))try{entry.globalMutation=planGlobalDependencyMutation(globalOptions(entry));issues.push(...entry.globalMutation.blocked);}catch(error){if(error.name!=='DomainError')throw error;issues.push({code:error.code});}
    const blocked=prepared.some(plan=>plan.blocked.length)||issues.length>0;
    entry.dependencyProtection={schemaVersion:1,scope:'global',status:blocked?'blocked':'ready',registeredProjects:state.dependencyIndex.projects.length,issues:structuredClone(issues)};
    if(issues.length) {
      const additions=issues.map(({code,...details})=>({...details,reason:code}));
      if(entry.rollback)entry.rollback={...entry.rollback,blocked:[...entry.rollback.blocked,...additions],automatic:false};
      else entry.prepared.push({operations:[],blocked:additions});
    }
  }
  function protectionView(entry) {return entry.dependencyProtection?{dependencyProtection:structuredClone(entry.dependencyProtection),fulfilled:false}:{};}
  function scopedView(entry) {
    const view=scopedExecution.view(entry.scopedState);
    return {...view,...protectionView(entry),...(entry.dependencyProtection?.status==='blocked'?{automatic:false,blocked:[...view.blocked,...entry.prepared.flatMap(plan=>plan.blocked)]}:{} )};
  }
  function scopedEntry({compiled,input,replay}) {
    const {backupStore}=stores({scope:input.scope,targetRoot:compiled.stateStore.targetRoot});
    const entry={prepared:compiled.plans,stateStore:compiled.stateStore,backupStore,scoped:true,scopedState:scopedExecution.prepare({compiled,input}),runtimeChecks:compiled.runtimeCheck?[compiled.runtimeCheck]:[],replay};
    protectGlobal(entry,{scope:input.scope});return entry;
  }
  function executeEntry(entry,{validate,createTransactionId,assertReview=()=>{}}={}) {
    assertReview();
    if(entry.dependencyProtection?.status==='blocked')throw domainError('GLOBAL_MUTATION_PLAN_BLOCKED','Review registered project dependencies before applying');
    if(entry.scoped&&!entry.scopedState)throw domainError('SCOPED_DEPLOYMENT_NOT_ENABLED','Scoped execution requires a prepared application service');
    if(entry.scopedState) {
      if(scopedView(entry).execution.status==='blocked')throw domainError(entry.scopedState.compiled.rollback?'ROLLBACK_PLAN_BLOCKED':'SCOPED_DEPLOYMENT_PLAN_BLOCKED','Resolve the scoped deployment conflicts before applying');
      if(entry.scopedState.input.scope==='project')return scopedExecution.apply(entry.scopedState,{backupStore:entry.backupStore,validate,createTransactionId,onPhase:onDeploymentPhase,assertReview});
      scopedExecution.assertCurrent(entry.scopedState);scopedExecution.runtime(entry.scopedState);
    }
    verifyRuntime(entry);
    const runtime=()=>{assertReview();if(entry.scopedState)scopedExecution.runtime(entry.scopedState);else if(entry.reviewContext)verifyRuntime(entry);};
    const options={stateStore:entry.stateStore,backupStore:entry.backupStore,validate,createTransactionId,onPhase:onDeploymentPhase,
      preflight:runtime,beforeCommit:runtime};
    if(entry.globalMutation)return executeGlobalDependencyMutation({...options,...globalOptions(entry),plan:entry.globalMutation});
    return entry.rollback?applyDeploymentRollback({...options,plan:entry.rollback}):applyDeployment({...options,plans:entry.prepared});
  }

  const service = {
    planVariantRegistration(input) {return importService.planVariantRegistration(input);},
    applyVariantRegistration({planId}) {return importService.apply({planId,kind:'variant-register'});},
    planImport(input) { return importService.planImport(input); },
    applyImport({planId}) { return importService.apply({planId, kind: 'import'}); },
    planDetach(input) { return importService.planDetach(input); },
    applyDetach({planId}) { return importService.apply({planId, kind: 'detach'}); },
    planSourceRecovery(input) { return importService.planRecovery(input); },
    recoverSources({planId}) { return importService.apply({planId, kind: 'source-recovery'}); },
    source(input) { return importService.source(input); },
    checkUpstream(input) { return importService.checkUpstream(input); },
    planSourceEdit(input) { return importService.planSourceEdit(input); },
    applySourceEdit({planId}) { return importService.apply({planId, kind: 'source-edit'}); },
    planRefresh(input) { return importService.planRefresh(input); },
    applyRefresh({planId}) { return importService.apply({planId, kind: 'refresh'}); },
    planSourceRollback(input) { return importService.planSourceRollback(input); },
    applySourceRollback({planId}) { return importService.apply({planId, kind: 'source-rollback'}); },
    installation(input) { return importService.installation(input); },
    planInstallation(input) { return importService.planInstallation(input); },
    applyInstallation(input) { return importService.applyInstallation(input); },
    localDiscovery({pathValue = process.env.PATH || '', scope = 'global', projectPath} = {}) {
      if (scope === 'project' && (typeof projectPath !== 'string' || !path.isAbsolute(projectPath))) {
        throw domainError('PROJECT_PATH_REQUIRED', 'Project discovery requires an absolute project path');
      }
      if (scope === 'project') authorizeReplay({scope, targetRoot: projectPath});
      return discoverLocalInstallations({
        definitions: loadClientDefinitions({ definitionsDir }),
        homeDir,
        pathValue, scope, projectPath
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

    plan({scopeRoot, targetRoot, clientId, scope = 'project', clientVersion, surface, previewOptIn = false, targets, [SKILL_STRATEGY_MIGRATION]: migrationAssetIds, [RESOURCE_PATH_MIGRATION]: pathMigrationIds}) {
      if (!targets && !clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      if (targets && clientId) throw domainError('INVALID_DEPLOYMENT_TARGETS', 'Use clientId or explicit targets, not both');
      const requests = targets || [{clientId, clientVersion, surface, previewOptIn}];
      if (!Array.isArray(requests) || !requests.length || requests.length > 8
        || requests.some(item => !item || typeof item.clientId !== 'string' || !item.clientId)) {
        throw domainError('INVALID_DEPLOYMENT_TARGETS', 'Select one to eight distinct client surfaces');
      }
      const loaded = discoverAndLoadManifest({scopeRoot, resolveSources: false,allowScopedPreview:true});
      if(loaded.manifest.schemaVersion===3) {
        if(migrationAssetIds||pathMigrationIds)throw domainError('SCOPED_DEPLOYMENT_NOT_ENABLED','Scoped migration requires coordinated ownership and recovery');
        if(requests.length!==1)throw domainError('INVALID_DEPLOYMENT_TARGETS','Scoped preview currently requires one explicit client surface');
        const sourceRoot=resolveForAuthorization(scopeRoot),projectName=scope==='project'?path.basename(sourceRoot):'default';
        if(scope==='project'?path.basename(path.dirname(sourceRoot))!=='projects':scope!=='global'||path.basename(sourceRoot)!=='global')throw domainError('INVALID_SCOPED_KIT_LAYOUT','Scoped plans require the canonical Kit global or projects/name layout');
        stores({scope,targetRoot});
        const kitRoot=scope==='global'?path.dirname(sourceRoot):path.dirname(path.dirname(sourceRoot)),request=requests[0];
        const compiled=compileScopedDeployment({kitRoot,projectName,scope,projectPath:scope==='project'?targetRoot:undefined,clientId:request.clientId,surface:request.surface,
          clientVersion:request.clientVersion,previewOptIn:request.previewOptIn===true,homeDir,definitions:loadClientDefinitions({definitionsDir}),definitionsDir,binaryObserver});
        const input={kitRoot,projectName,scope,projectPath:scope==='project'?targetRoot:undefined,clientId:request.clientId,surface:request.surface,clientVersion:request.clientVersion,previewOptIn:request.previewOptIn===true};
        const entry=scopedEntry({compiled,input,replay:{method:'plan',input:{scopeRoot,targetRoot,clientId,scope,clientVersion,surface,previewOptIn,targets}}}),remembered=remember(plans,entry);
        return {...scopedView(entry),...remembered};
      }
      const definitionDigest = contextDigest();
      const definitions = loadClientDefinitions({definitionsDir});
      const {stateStore, backupStore} = stores({scope, targetRoot, clientId: requests[0].clientId});
      const state = stateStore.load();
      const prepared = [], previews = [], selections = [], targetProfiles = [], contributions = [], runtimeChecks = [], strategyInputs = [], locationInputs = [];
      const skillDistributions=[],skillSources=[];
      const profiles = new Set();
      for (const request of requests) {
        const definition = definitions.get(request.clientId);
        if (!definition) throw domainError('CLIENT_DEFINITION_NOT_FOUND', `Client definition '${request.clientId}' was not found`);
        let selection = selectManifestDeployment(loaded.manifest, {clientId: request.clientId,surface:selectClientSurface(definition,request.surface).id, scope});
        if (migrationAssetIds) {
          if (migrationAssetIds.some(id => !selection.selectedAssetIds.includes(id) || !loaded.manifest.assets.skills.some(asset => asset.id === id && asset.definition))) throw domainError('INVALID_MIGRATION_ASSETS', 'Skill strategy migration requires explicitly selected common Skills');
          const dependencies = resolveManifestDependencies(loaded.manifest, {selectedAssetIds: migrationAssetIds, targetScope: {type: scope, projectName: loaded.manifest.targets?.[request.clientId]?.projectName || 'default'}});
          if (!dependencies.valid) throw domainError('MANIFEST_DEPENDENCY_INVALID', 'Migration dependencies are invalid');
          selection = {...selection, rootAssetIds: migrationAssetIds, selectedAssetIds: dependencies.assetIds, dependencyAssetIds: dependencies.assetIds.filter(id => !migrationAssetIds.includes(id)), toolBindings: dependencies.toolBindings};
        }
        if (pathMigrationIds) {
          if (pathMigrationIds.some(id => !selection.selectedAssetIds.includes(id))) throw domainError('INVALID_MIGRATION_ASSETS', 'Path migration assets must be selected in the requested scope');
          const dependencies = resolveManifestDependencies(loaded.manifest, {selectedAssetIds: pathMigrationIds, targetScope: {type: scope, projectName: loaded.manifest.targets?.[request.clientId]?.projectName || 'default'}});
          if (!dependencies.valid) throw domainError('MANIFEST_DEPENDENCY_INVALID', 'Migration dependencies are invalid');
          selection = {...selection, rootAssetIds: pathMigrationIds, selectedAssetIds: dependencies.assetIds, dependencyAssetIds: dependencies.assetIds.filter(id => !pathMigrationIds.includes(id)), toolBindings: dependencies.toolBindings};
        }
        const profile=selectClientSurface(definition,request.surface);
        const {plan: capabilityPlan, runtimeCheck} = planVerifiedClientDeployment({
          manifest: loaded.manifest, definition, clientVersion: request.clientVersion, surface: request.surface,
          platform: process.platform, arch: process.arch, previewOptIn: request.previewOptIn === true,
          selectedAssetIds: selection.selectedAssetIds, binaryObserver,nativeSkillPolicy:loadNativeSkillPolicy({definitionsDir,clientId:request.clientId,surface:profile.id,configStore:profile.configStore})
        });
        if (runtimeCheck) runtimeChecks.push(runtimeCheck);
        const boundedAssetIds = [...new Set([...(migrationAssetIds || []), ...[...capabilityPlan.operations, ...capabilityPlan.blocked]
          .filter(item => ['snapshot-link', 'discovery-reference'].includes(item.strategy)).map(item => item.assetId)])];
        const skillSelections=new Map([...capabilityPlan.operations,...capabilityPlan.blocked].filter(item=>item.skillSelection).map(item=>[item.assetId,item.skillSelection]));
        const sources = resolveAssetSources(loaded.manifest, scopeRoot, selection.selectedAssetIds, {boundedAssetIds,skillSelections});
        skillDistributions.push(...skillDistributionReviews({plan:capabilityPlan,definitions,homeDir,targetRoot,scope}));
        skillSources.push(...capabilityPlan.operations.filter(item=>item.skillSelection).map(item=>({assetId:item.assetId,selection:item.skillSelection})));
        const profileKey = `${request.clientId}:${capabilityPlan.targetProfile.surface || 'default'}`;
        if (profiles.has(profileKey)) throw domainError('INVALID_DEPLOYMENT_TARGETS', 'Duplicate client surface selected');
        profiles.add(profileKey);
        selections.push({clientId: request.clientId, ...selection}); targetProfiles.push(capabilityPlan.targetProfile);
        const consumerId = sharedConsumerId(loaded.manifest.kit.id, request.clientId, capabilityPlan.targetProfile.surface);
        locationInputs.push(...capabilityPlan.operations.map(planned => {
          const source = sources.get(planned.assetId);
          return {planned, kitId: loaded.manifest.kit.id, consumerId,
            ...(pathMigrationIds && source ? {sourceEvidence: {path: source, fingerprint: imageFingerprint(readPathImage(source, {authorizedRoot: scopeRoot}))}} : {})};
        }));
        for (const planned of [...capabilityPlan.operations, ...capabilityPlan.blocked.filter(item => ['snapshot-link', 'discovery-reference'].includes(item.strategy)
          && !item.skillSelection
          && !['IMPORTED_RESOURCE_DEPLOYMENT_NOT_ENABLED', 'COMMON_SOURCE_CLIENT_UNSUPPORTED', 'COMMON_SOURCE_CONTRACT_MISMATCH'].includes(item.reason))].filter(item => item.commonSource)) {
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
        strategyInputs.push(input);
      }
      prepared.push({operations: [], blocked: deploymentPathDriftBlocks({state, desired: locationInputs, targetRoot, homeDir, scope})});
      const physical = preparePhysicalResourceDeployment({contributions: strategyInputs.flatMap(input => input.capabilityPlan.operations.filter(item => item.rendered && item.resource)), state, targetRoot, homeDir, scope, sourceRoot: scopeRoot});
      prepared.push({operations: physical.operations, blocked: physical.blocked});
      for (const input of strategyInputs) {
        const remaining = {...input, capabilityPlan: {...input.capabilityPlan, operations: input.capabilityPlan.operations.filter(item => !physical.handled.has(item))}};
        prepared.push(prepareCopyDeployment(remaining), prepareMergeDeployment(remaining), prepareManagedLinkDeployment(remaining));
      }
      prepared.push(prepareSharedDeployment({contributions, state, targetRoot, scope, homeDir, sourceRoot: scopeRoot, migrationAssetIds}));
      if (migrationAssetIds) {
        for (const operation of prepared.flatMap(plan => plan.operations)) if (!migrationAssetIds.includes(operation.assetId) && operation.operation !== 'SKIP') prepared[0].blocked.push({...operation, reason: 'SKILL_MIGRATION_DEPENDENCY_UNREADY'});
      }
      const paths = new Set();
      for (const operation of prepared.flatMap(plan => plan.operations)) {
        if (paths.has(operation.target)) prepared[0].blocked.push({...operation, reason: 'DUPLICATE_DEPLOYMENT_TARGET'});
        paths.add(operation.target);
      }
      const locators = createDeploymentLocators({desired: locationInputs, definitions, targetRoot, homeDir, scope});
      const installationDescriptors=describeInstallationResources({manifest:loaded.manifest,scopeRoot,locators});
      const skillSelectionDescriptors=describeSkillSelections({manifest:loaded.manifest,locators,desired:locationInputs});
      const migration = pathMigrationIds ? prepareResourcePathMigration({plans: prepared, state, locators, assetIds: pathMigrationIds, targetRoot, homeDir, scope, sourceRoot: scopeRoot,
        definitions, sourceEvidence: [...new Map(locationInputs.filter(item => item.sourceEvidence).map(item => [item.sourceEvidence.path, item.sourceEvidence])).values()]}) : null;
      const stamped = (migration ? [migration] : prepared).map((plan, index) => ({...plan, ...(index === 0 && locators.length ? {locators,installationDescriptors,...(skillSelectionDescriptors.length?{skillSelectionDescriptors}:{})} : {}), ...(migrationAssetIds || pathMigrationIds ? {intent: 'migration'} : {}), stateHash: deploymentStateHash(state)}));
      const replayInput = {scopeRoot, targetRoot, clientId, scope, clientVersion, surface, previewOptIn, targets};
      const reviewContext = locationInputs.some(item => item.planned.commonSource || item.planned.resource)
        || stamped.some(plan => plan.operations.some(operation => ['shared-snapshot', 'physical-resource'].includes(operation.strategy)))
        ? {scopeRoot, manifestPath: loaded.manifestPath, manifestDigest: canonicalDigest(loaded.manifest), definitionDigest,...(skillSources.length?{skillSources,skillMetadataDigest:canonicalDigest(stamped.map(plan=>({locators:plan.locators,installationDescriptors:plan.installationDescriptors,skillSelectionDescriptors:plan.skillSelectionDescriptors})))}:{})} : undefined;
      if (reviewContext && definitionDigest !== contextDigest()) throw domainError('STALE_DEPLOYMENT_PLAN', 'Client policy changed while preparing the deployment plan');
      const entry={prepared: stamped, stateStore, backupStore, runtimeChecks, reviewContext,...(skillDistributions.length?{skillDistributions}:{}), replay: migrationAssetIds || pathMigrationIds
        ? {method: 'planMigration', input: {...replayInput, migration: pathMigrationIds ? 'resource-path' : 'skill-strategy', assetIds: pathMigrationIds || migrationAssetIds}} : {method: 'plan', input: replayInput}};
      protectGlobal(entry,{scope,supported:!migrationAssetIds&&!pathMigrationIds});
      const remembered = remember(plans,entry);
      const mutable = stamped.flatMap(plan => plan.operations).filter(operation => operation.operation !== 'SKIP');
      const schema = migration ? migration.requiredStateSchema : mutable.some(operation => operation.strategy === 'physical-resource') ? 7 : mutable.some(operation => operation.connection) ? 6 : mutable.some(operation => operation.resource || Object.values(operation.owners || {}).some(owner => owner.resource)) ? 4
        : mutable.some(operation => operation.strategy === 'shared') ? 2 : state.schemaVersion;
      return Object.freeze({...publicPlan(remembered.planId, migrationAssetIds || pathMigrationIds ? 'migration' : 'apply', stamped, remembered.expiresAt, targetProfiles[0], previews),
        ...protectionView(entry),
        ...(skillDistributions.length?{skillDistributions}:{}),
        ...(installationDescriptors.length?{installationEvidence:{mode:'audit-only',resources:installationDescriptors.map(({assetId,assetKind,sourceRoot,clientId,surface,scope,declaration})=>({assetId,assetKind,sourceRoot,clientId,surface,scope,declaration:structuredClone(declaration)}))}}:{}),
        ...(migrationAssetIds ? {migration: 'skill-strategy'} : {}),
        ...(migration ? {migration: 'resource-path', pathMigrations: migration.pathMigrations} : {}),
        ...(schema > state.schemaVersion ? {stateUpgrade: {from: state.schemaVersion, to: schema}} : {}),
        ...(requests.length === 1 ? {selection: selections[0]} : {selections, targetProfiles})});
    },

    planRemoval({scopeRoot, targetRoot, clientId, surface, scope = 'project', assetIds}) {
      if (!Array.isArray(assetIds) || !assetIds.length || new Set(assetIds).size !== assetIds.length
        || assetIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) {
        throw domainError('INVALID_REMOVAL_ASSETS', 'Removal requires explicit unique asset IDs');
      }
      const loaded = discoverAndLoadManifest({scopeRoot, resolveSources: false,allowScopedPreview:true});
      if(loaded.manifest.schemaVersion===3) {
        authorizeReplay({scopeRoot,targetRoot,scope});stores({scope,targetRoot});
        const sourceRoot=resolveForAuthorization(scopeRoot),projectName=scope==='project'?path.basename(sourceRoot):'default',kitRoot=scope==='global'?path.dirname(sourceRoot):path.dirname(path.dirname(sourceRoot));
        if(scope==='project'?path.basename(path.dirname(sourceRoot))!=='projects':path.basename(sourceRoot)!=='global')throw domainError('INVALID_SCOPED_KIT_LAYOUT','Scoped removal requires the canonical Kit layout');
        const input={kitRoot,projectName,projectPath:scope==='project'?targetRoot:undefined,scope,clientId,surface,assetIds,removal:true},compiled=compileScopedResourceRemoval({...input,homeDir,definitions:loadClientDefinitions({definitionsDir})});
        const entry=scopedEntry({compiled,input,replay:{method:'planRemoval',input:{scopeRoot,targetRoot,clientId,surface,scope,assetIds}}}),remembered=remember(plans,entry);
        return {...scopedView(entry),...remembered};
      }
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
      const removal = prepareSharedRemoval({state, targetRoot, kitId, consumerIds: [consumerId], assetIds: sharedIds, homeDir});
      const resourceIds = assetIds.filter(id => !sharedIds.includes(id));
      const typed = prepareResourceRemoval({state, targetRoot, kitId, clientId, profile, assetIds: resourceIds,backupStore});
      removal.operations.push(...typed.operations); removal.blocked.push(...typed.blocked);
      for (const assetId of resourceIds) if (!typed.found.has(assetId)) removal.blocked.push({assetId, reason: 'SHARED_RESOURCE_NOT_MANAGED'});
      removal.blocked.push(...removalDependencyBlocks({state, operations: removal.operations, kitId, clientId, removedIds: assetIds}));
      const prepared = [{...removal, clientId, intent: 'remove', stateHash: deploymentStateHash(state)}];
      const entry={prepared, stateStore, backupStore, replay: {method: 'planRemoval', input: {scopeRoot, targetRoot, clientId, surface, scope, assetIds}}};protectGlobal(entry,{scope});
      const remembered = remember(plans,entry);
      return {...publicPlan(remembered.planId, 'remove', prepared, remembered.expiresAt),...protectionView(entry)};
    },

    planMigration({scopeRoot, targetRoot, clientId, surface, scope = 'project', assetIds, migration, clientVersion, targets, previewOptIn}) {
      if (migration === 'resource-path') {
        if (!Array.isArray(assetIds) || !assetIds.length || new Set(assetIds).size !== assetIds.length || assetIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) throw domainError('INVALID_MIGRATION_ASSETS', 'Path migration requires explicit unique resource IDs');
        return service.plan({scopeRoot, targetRoot, clientId, surface, scope, clientVersion, targets, previewOptIn, [RESOURCE_PATH_MIGRATION]: assetIds});
      }
      if (migration === 'skill-strategy') {
        if (!Array.isArray(assetIds) || !assetIds.length || new Set(assetIds).size !== assetIds.length || assetIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) throw domainError('INVALID_MIGRATION_ASSETS', 'Strategy migration requires explicit unique Skill IDs');
        return service.plan({scopeRoot, targetRoot, clientId, surface, scope, clientVersion, targets, previewOptIn, [SKILL_STRATEGY_MIGRATION]: assetIds});
      }
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
      const entry={prepared:stamped,stateStore,backupStore,replay:{method:'planMigration',input:{scopeRoot,targetRoot,clientId,surface,scope,assetIds,migration}}};protectGlobal(entry,{scope,supported:false});
      const remembered = remember(plans,entry);
      return Object.freeze({...publicPlan(remembered.planId, 'migration', stamped, remembered.expiresAt), migration,...protectionView(entry),
        ...(state.schemaVersion === 1 ? {stateUpgrade: {from: 1, to: 2}} : {})});
    },

    savePlan({planId}) {
      const entry = plans.get(planId) || rollbackPlans.get(planId);
      if (!entry || entry.expiresAtMs < clock()) throw domainError('DEPLOYMENT_PLAN_NOT_FOUND', 'A current reviewed plan is required');
      if(entry.inProgress)throw domainError('DEPLOYMENT_PLAN_BUSY','Wait for the current observation');
      if(entry.scopedState&&scopedView(entry).execution.status!=='ready')throw domainError('SAVED_PLAN_UNSUPPORTED','A ready scoped review is required before saving');
      const prepared = entry.prepared || (entry.rollback ? [entry.rollback] : []);
      const treePlan = prepared.some(plan => plan.treeTransaction || plan.operations.some(item => ['shared-snapshot', 'resource-path'].includes(item.strategy)));
      const physicalPlan = entry.stateStore?.load().schemaVersion >= 7 || prepared.some(plan => plan.requiredStateSchema >= 7 || plan.operations.some(item => item.strategy === 'physical-resource'));
      if (!entry.replay || prepared.some(plan => plan.blocked.length || plan.operations.some(item => item.previewOnly || item.strategy === 'link'
        || item.strategy !== 'shared-snapshot' && (item.operation === 'RESTORE_LINK' || String(item.beforeHash).startsWith('symlink:'))))) {
        throw domainError('SAVED_PLAN_UNSUPPORTED', 'Only applicable regular-file deployment, removal, ownership migration and rollback plans can be saved');
      }
      authorizeReplay(entry.replay.input);
      const saved = savedStore.create({schemaVersion: entry.scopedState ? 5 : entry.globalMutation ? 4 : physicalPlan ? 3 : treePlan ? 2 : 1,
        ...((entry.scopedState?.compiled.review.skillDistributions||entry.skillDistributions)?.length?{skillDistributions:structuredClone(entry.scopedState?.compiled.review.skillDistributions||entry.skillDistributions)}:{}),
        ...(entry.scopedState ? {contract:'scoped-deployment-v1',scopedReviewDigest:entry.scopedState.compiled.review.digest,observeProviders:entry.scopedState.observeProviders===true} : entry.globalMutation ? {contract: 'global-dependency-mutation-v1', globalMutationDigest: entry.globalMutation.digest} : physicalPlan ? {contract: 'physical-resource-v1'} : treePlan ? {contract: 'tree-deployment-v1'} : {}), id: planId, expiresAtMs: clock() + savedPlanTtlMs,
        kind: entry.replay.method === 'planRollback' ? 'rollback' : entry.replay.method === 'planRemoval' ? 'remove' : entry.replay.method === 'planMigration' ? 'migration' : 'apply',
        replay: entry.replay, contextDigest: contextDigest(), snapshotDigest: fingerprint(entry),
        ...(prepared.some(plan => plan.pathMigrations?.length) ? {pathMigrations: prepared.flatMap(plan => plan.pathMigrations || [])} : {}),
        operations: prepared.flatMap(plan => plan.operations).map(({target, operation, assetId, clientId, connection, retainedSnapshots, affectedTargets, configStore, storeEffect}) => ({target, operation, assetId, clientId,
          ...(affectedTargets ? {affectedTargets: structuredClone(affectedTargets), configStore, storeEffect} : {}),
          ...(connection ? {connection, retainedSnapshots} : {})}))});
      plans.delete(planId); rollbackPlans.delete(planId);
      return saved;
    },

    savedPlans() { return savedStore.list(); },

    async observeDeploymentPrerequisites({planId,observeProviders=false}) {
      const entry=plans.get(planId)||rollbackPlans.get(planId);if(!entry)throw domainError('DEPLOYMENT_PLAN_NOT_FOUND','A current scoped deployment plan is required');
      if(entry.expiresAtMs<clock())throw domainError('DEPLOYMENT_PLAN_EXPIRED','The reviewed plan has expired');
      if(!entry.scopedState)throw domainError('SCOPED_MANIFEST_REQUIRED','Native prerequisites belong to a scoped plan');
      if(entry.inProgress)throw domainError('DEPLOYMENT_PLAN_BUSY','Plan observation is already running');
      entry.inProgress=true;
      try{await scopedExecution.observe(entry.scopedState,{observeProviders});if(entry.expiresAtMs<clock())throw domainError('DEPLOYMENT_PLAN_EXPIRED','The reviewed plan expired during observation');return {...scopedView(entry),planId,expiresAt:new Date(entry.expiresAtMs).toISOString()};}
      finally{entry.inProgress=false;}
    },

    resumeSavedPlan({planId, digest, validate}) {
      if(!/^[a-f0-9]{64}$/.test(digest||''))throw domainError('SAVED_PLAN_DIGEST_REQUIRED','Supply the reviewed saved plan digest');
      const scoped=savedStore.read(planId,digest).body.schemaVersion===5;
      return savedStore[scoped?'runAsync':'run'](planId, digest, (body,assertReview) => {
        if (body.contextDigest !== contextDigest()) throw domainError('STALE_SAVED_PLAN', 'Client definitions or host context changed; create a new plan');
        if (!['plan', 'planRemoval', 'planMigration', 'planRollback'].includes(body.replay?.method)) throw domainError('INVALID_SAVED_PLAN', 'Saved plan method is unsupported');
        authorizeReplay(body.replay.input);
        const rebuilt = service[body.replay.method](body.replay.input);
        const entry = take(body.kind === 'rollback' ? rollbackPlans : plans, rebuilt.planId);
        if(entry.scopedState&&body.schemaVersion!==5)throw domainError('STALE_SAVED_PLAN','A scoped deployment requires its versioned saved review');
        if(body.schemaVersion===5) {
          if(!entry.scopedState||entry.scopedState.compiled.review.digest!==body.scopedReviewDigest)throw domainError('STALE_SAVED_PLAN','Scoped sources, installations or ownership changed after review');
          return scopedExecution.observe(entry.scopedState,{observeProviders:body.observeProviders}).then(()=>{
            if(fingerprint(entry)!==body.snapshotDigest)throw domainError('STALE_SAVED_PLAN','The native context or reviewed scoped deployment changed');
            return executeEntry(entry,{validate,createTransactionId:()=>`tx-plan-${body.id}`,assertReview});
          });
        }
        if (fingerprint(entry) !== body.snapshotDigest || body.schemaVersion === 4 && entry.globalMutation?.digest !== body.globalMutationDigest) throw domainError('STALE_SAVED_PLAN', 'Sources, target files, ownership or registered project context changed since review');
        const createTransactionId = () => `tx-plan-${body.id}`;
        return executeEntry(entry,{validate,createTransactionId,assertReview});
      }, body => {
        // The process may die after journal cleanup but before the saved receipt is written.
        // Only a recorded transaction with no pending deployment can settle that uncertainty.
        authorizeReplay(body.replay.input);
        const {stateStore} = stores(body.replay.input);
        if (fs.existsSync(`${stateStore.statePath}.journal.json`) || fs.existsSync(`${stateStore.statePath}.lock`)) return null;
        if(body.schemaVersion===5&&body.replay.input.scope==='project') {
          const globalStore=new GlobalDeploymentStateStore({homeDir});
          if(coordinationExists(`${globalStore.statePath}.journal.json`)||coordinationExists(`${globalStore.statePath}.lock`))return null;
        }
        const transaction = stateStore.load().transactions.find(item => item.id === `tx-plan-${body.id}`);
        return transaction ? {transactionId: transaction.id, status: transaction.status, reconciled: true} : null;
      });
    },

    planRecovery({scopeRoot,scope = 'project', targetRoot, clientId}) {
      authorizeReplay({scopeRoot,scope, targetRoot});
      const {stateStore, backupStore} = stores({scope, targetRoot, clientId});
      if(scope==='project') {
        const globalStore=new GlobalDeploymentStateStore({homeDir}),journalPath=`${globalStore.statePath}.journal.json`;
        if(coordinationExists(journalPath)) {
          const {value:journal}=readCoordinationJson(journalPath,homeDir);
          if(journal.schemaVersion===4&&journal.kind==='dependency-coordination') {
            if(journal.plan?.project?.targetRoot!==stateStore.targetRoot||scopeRoot&&journal.plan.project.sourceRoot!==resolveForAuthorization(scopeRoot))throw domainError('DEPENDENCY_COORDINATION_SCOPE_INVALID','Select the interrupted project origin');
            const coordinated=planDependencyCoordinationRecovery({globalStore,projectStore:stateStore}),entry={coordinated,globalStore,stateStore,backupStore,interruptedTransactionId:journal.plan.transactionId},remembered=remember(recoveryPlans,entry);
            const operations=(coordinated.childPlan?.operations||[]).map(item=>({target:item.target,operation:item.operation,reason:'SCOPED_RECOVERY_REVIEW'}));
            return {...publicPlan(remembered.planId,'recovery',[{operations,blocked:[]}],remembered.expiresAt),coordination:true,fulfilled:false,interruptedTransactionId:entry.interruptedTransactionId,outcome:coordinated.outcome==='committed'?'keep-committed':'restore-original'};
          }
        }
      }
      const journalPath=`${stateStore.statePath}.journal.json`;
      const guarded=scope==='global'&&coordinationExists(journalPath)&&readCoordinationJson(journalPath,stateStore.homeDir).value.dependencyGuard!==undefined;
      const globalRecovery=guarded?planGlobalDependencyRecovery({globalStore:stateStore,backupStore,definitionsDir}):undefined;
      const recovery=globalRecovery?.recovery||planJournalRecovery({stateStore,backupStore});
      const entry={recovery,globalRecovery,stateStore,backupStore,...(guarded?{dependencyProtection:{schemaVersion:1,scope:'global',status:'ready',registeredProjects:stateStore.load().dependencyIndex.projects.length,issues:[]}}:{})};
      const remembered = remember(recoveryPlans, entry);
      return {...publicPlan(remembered.planId, 'recovery', [recovery], remembered.expiresAt),
        ...protectionView(entry),
        interruptedTransactionId: recovery.journal.id, outcome: recovery.committed ? 'keep-committed' : 'restore-original'};
    },

    recover({planId}) {
      const entry = take(recoveryPlans, planId);
      const result = entry.coordinated
        ? {...applyDependencyCoordinationRecovery({plan:entry.coordinated,globalStore:entry.globalStore,projectStore:entry.stateStore}),transactionId:entry.interruptedTransactionId}
        : entry.globalRecovery
        ? applyGlobalDependencyRecovery({plan:entry.globalRecovery,globalStore:entry.stateStore,backupStore:entry.backupStore,definitionsDir,onPhase:onDeploymentPhase})
        : applyJournalRecovery({plan: entry.recovery, stateStore: entry.stateStore, backupStore: entry.backupStore});
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
      return executeEntry(entry,{validate});
    },

    history({ scope = 'project', targetRoot, clientId }) {
      if (!clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      return stores({ scope, targetRoot, clientId }).stateStore.load().transactions;
    },

    planRollback({ transactionId, scope = 'project', targetRoot, clientId }) {
      if (!clientId) throw domainError('CLIENT_ID_REQUIRED', 'Client ID is required');
      const { stateStore, backupStore } = stores({ scope, targetRoot, clientId });
      let rollback = planDeploymentRollback({ transactionId, stateStore, backupStore });
      const registration=scope==='project'?stateStore.load().dependencyRegistration:null;
      if(registration) {
        const sourceRoot=registration.project.sourceRoot,projectName=registration.project.projectName;
        if(path.basename(path.dirname(sourceRoot))==='projects'&&path.basename(sourceRoot)===projectName) {
          const input={rollback:true,transactionId,kitRoot:path.dirname(path.dirname(sourceRoot)),projectName,scope:'project',projectPath:targetRoot,clientId},compiled=compileScopedDeploymentRollback({...input,homeDir,definitions:loadClientDefinitions({definitionsDir})}),entry=scopedEntry({compiled,input,replay:{method:'planRollback',input:{transactionId,scope,targetRoot,clientId}}}),remembered=remember(rollbackPlans,entry);
          return {...scopedView(entry),...remembered};
        }
        if(registration.status==='active')rollback={...rollback,automatic:false,blocked:[...rollback.blocked,{reason:'DEPENDENCY_COORDINATED_ROLLBACK_REQUIRED'}]};
      }
      const entry={rollback,stateStore,backupStore,replay:{method:'planRollback',input:{transactionId,scope,targetRoot,clientId}}};protectGlobal(entry,{scope});
      const remembered = remember(rollbackPlans,entry);
      return {...publicPlan(remembered.planId,'rollback',[entry.rollback],remembered.expiresAt),...protectionView(entry)};
    },

    rollback({ planId, validate }) {
      const entry = take(rollbackPlans, planId);
      return executeEntry(entry,{validate});
    },

    validate({ scopeRoot }) {
      try {
        let loaded = discoverAndLoadManifest({ scopeRoot,resolveSources:false,allowScopedPreview:true });
        if(loaded.manifest.schemaVersion===3)return validateScopedManifest({scopeRoot,homeDir});
        loaded=discoverAndLoadManifest({scopeRoot});
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
      let loaded;try{loaded=discoverAndLoadManifest({scopeRoot,resolveSources:false,allowScopedPreview:true});}catch{/* The ordinary diagnostics path reports invalid documents. */}
      if(loaded?.manifest.schemaVersion===3) {
        let validation,review,error;
        try {
          validation=validateScopedManifest({scopeRoot,homeDir});
          if(scope==='project'&&targetRoot)authorizeReplay({scopeRoot,scope,targetRoot});
          if(targetRoot&&(!fs.statSync(targetRoot).isDirectory()))throw domainError('TARGET_PATH_NOT_FOUND','Select an existing target directory');
          if(clientId) {review=service.plan({scopeRoot,targetRoot,clientId,scope,clientVersion,surface});plans.delete(review.planId);}
        }catch(caught){error=caught;}
        return scopedDiagnostics({validation:validation||{valid:false,issues:[],dependencyGraph:null},review,error});
      }
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

    catalog(input) {
      const definitions=loadClientDefinitions({definitionsDir});
      const catalog=readResourceCatalog({...input,...(input.includeInstallations?{includeDependencies:true,...(input.includeOtherClients?{clientId:undefined,surface:undefined}:{})}:{}),homeDir,definitions});
      const installed=input.includeInstallations?inspectCatalogInstallations({catalog,homeDir,definitions,clientId:input.clientId,surface:input.surface,clock}):catalog;
      return input.includeDependents?{...installed,dependencyDependents:inspectDependencyDependents({homeDir,clock})}:installed;
    },

    async observeCatalog(input) {
      const definitions = loadClientDefinitions({definitionsDir});
      const catalog=await observeResourceCatalog({input, definitions, homeDir, binaryObserver, nativeInventoryObserver, clock,
        readCatalog: value => readResourceCatalog({...value,...(input.includeInstallations?{includeDependencies:true}:{}), ...(input.includeOtherClients === true ? {clientId: undefined, surface: undefined} : {}), homeDir, definitions})});
      const installed=input.includeInstallations?inspectCatalogInstallations({catalog,homeDir,definitions,clientId:input.clientId,surface:input.surface,clock}):catalog;
      return input.includeDependents?{...installed,dependencyDependents:inspectDependencyDependents({homeDir,clock})}:installed;
    },

    registryView({ scopeRoot }) {
      let loaded = discoverAndLoadManifest({ scopeRoot,resolveSources:false,allowScopedPreview:true });
      if(loaded.manifest.schemaVersion!==3)loaded=discoverAndLoadManifest({scopeRoot});
      const projections = [];
      for (const kind of ASSET_KINDS) {
        for (const asset of loaded.manifest.assets[kind] || []) {
          projections.push(registryProjection(asset, loaded.manifest));
        }
      }
      return {registry:projections,manifestSchemaVersion:loaded.manifest.schemaVersion};
    },

    registry(input) {return service.registryView(input).registry;},

    resource({ scopeRoot, assetId }) {
      let loaded = discoverAndLoadManifest({ scopeRoot,resolveSources:false,allowScopedPreview:true });
      if(loaded.manifest.schemaVersion!==3)loaded=discoverAndLoadManifest({scopeRoot});
      for (const kind of ASSET_KINDS) {
        const asset = (loaded.manifest.assets[kind] || []).find(candidate => candidate.id === assetId);
        if (asset) return asset;
      }
      throw domainError('ASSET_NOT_FOUND', `Asset '${assetId}' was not found`, { assetId });
    },

    dependencies({ scopeRoot }) {
      let loaded = discoverAndLoadManifest({ scopeRoot,resolveSources:false,allowScopedPreview:true });
      if(loaded.manifest.schemaVersion===3)return scopedDependencyProjection({scopeRoot,homeDir});
      loaded=discoverAndLoadManifest({scopeRoot});
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
        homeDir,
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
        homeDir,
        take,
        editPlans,
        stringifyYaml
      });
    }
  };
  const importService = createResourceImportService({definitionsDir, homeDir, clock, planTtlMs, deploymentStores: stores, binaryObserver, upstreamReader,
    discover: input => service.localDiscovery(input), authorizeProject: authorizeReplay});
  return Object.freeze(service);
}
