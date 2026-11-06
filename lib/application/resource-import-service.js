import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'yaml';
import {domainError} from '../domain/errors.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {resolveManifestDependencies} from '../domain/manifest-dependencies.js';
import {discoverAndLoadManifest, validateManifestDocument} from '../infrastructure/manifest-loader.js';
import {loadClientDefinitions} from '../infrastructure/client-definition-loader.js';
import {readImportSource} from '../infrastructure/import-source-reader.js';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {applyKitSourceMutation, assertSourceManagementReady, kitSourcePath, sourceHash, planKitSourceRecovery, applyKitSourceRecovery} from '../infrastructure/kit-source-transaction.js';
import {assertSourceArtifacts as assertArtifacts} from '../infrastructure/kit-source-snapshot.js';
import {createSourceRevisionService} from './source-revision-service.js';
import {createNativeInstallationService} from './native-installation-service.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {assertSourceDependencyRemovalAllowed} from './source-dependency-guard.js';
import {createSkillVariantSourceService} from './skill-variant-source-service.js';
import {prepareScopedManifestEdit} from './scoped-manifest-management.js';
import {scopedManifestLocation} from './resource-catalog-service.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const fail = (code, message = 'The resource requires a new reviewed source-management plan') => { throw domainError(code, message); };
const encode = (doc, format) => format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : stringify(doc);

function validateDocument(doc) {
  const manifest = validateManifestDocument(doc);
  if(manifest.schemaVersion===3)return manifest; // Qualified references are checked with companion contexts when the plan is remembered.
  const dependencies = resolveManifestDependencies(manifest, {selectedAssetIds: Object.values(manifest.assets).flat().map(asset => asset.id), targetScope: {type: 'project'}});
  if (!dependencies.valid) throw domainError('IMPORT_DEPENDENCY_CONFLICT', 'Registration would leave missing or invalid resource dependencies', {issues: dependencies.issues});
  return manifest;
}

export function createResourceImportService({definitionsDir, homeDir, discover, authorizeProject, clock = () => Date.now(), planTtlMs = 300000, onPhase, deploymentStores, binaryObserver, upstreamReader}) {
  const plans = new Map();
  function remember(value) {
    if(value.content) {
      let location;try{location=scopedManifestLocation(value.scopeRoot);}catch(error){if(error.code!=='INVALID_SCOPED_KIT_LAYOUT')throw error;}
      if(value.manifest.schemaVersion===3||location?.scope==='global')value={...value,scopedGuard:prepareScopedManifestEdit({scopeRoot:value.scopeRoot,homeDir,manifestPath:value.manifestPath,
        beforeManifest:value.manifest,afterManifest:validateManifestDocument(value.format==='json'?JSON.parse(value.content):parse(value.content)),mutations:value.kind==='detach'?[{type:'delete'}]:[]})};
    }
    for (const [id, plan] of plans) if (plan.expires < clock()) plans.delete(id);
    const planId = crypto.randomUUID(), expires = clock() + planTtlMs;
    plans.set(planId, {...value, expires});
    return {planId, expiresAt: new Date(expires).toISOString(), kind: value.kind, automatic: value.automatic !== false,
      ...(value.details ? {details: value.details} : {}), ...(value.reviewHash ? {reviewHash: value.reviewHash} : {}),
      operations: value.operations, ...(value.manifestDiff ? {manifestDiff: value.manifestDiff} : {}),
      ...(value.managementUpgrade ? {managementUpgrade: value.managementUpgrade} : {}),
      ...(value.source ? {source: value.source} : {}), ...(value.outcome ? {outcome: value.outcome} : {}), ...(value.stateUpgrade ? {stateUpgrade: value.stateUpgrade} : {})};
  }
  function context(input, allowPending = false) {
    if (!['global', 'project'].includes(input.scope)) fail('INVALID_SCOPE');
    if (input.scope === 'project') authorizeProject(input);
    else if (resolveForAuthorization(input.targetRoot) !== resolveForAuthorization(homeDir)) fail('DEPLOYMENT_TARGET_OUTSIDE_SCOPE');
    const scopeRoot = fs.realpathSync(input.scopeRoot);
    if (!allowPending) assertSourceManagementReady(scopeRoot);
    return scopeRoot;
  }
  function load(input) {
    const scopeRoot = context(input);
    const loaded = discoverAndLoadManifest({scopeRoot, resolveSources: false,allowScopedPreview:true});
    if(loaded.manifest.schemaVersion===3&&scopedManifestLocation(scopeRoot).scope!==input.scope)fail('SCOPED_DEPLOYMENT_TARGET_MISMATCH');
    const before = fs.readFileSync(loaded.manifestPath, 'utf8');
    const doc = loaded.format === 'json' ? JSON.parse(before) : parse(before);
    return {...loaded, scopeRoot, before, beforeHash: sourceHash(before), doc};
  }
  function candidate(input) {
    const sourceScope = input.sourceScope || input.scope;
    if (!['global', 'project'].includes(sourceScope) || (sourceScope === 'project' && input.scope !== 'project')) fail('IMPORT_SOURCE_SCOPE_UNSUPPORTED');
    const definition = loadClientDefinitions({definitionsDir}).get(input.clientId);
    if (!definition) fail('CLIENT_DEFINITION_NOT_FOUND');
    const profile = selectClientSurface(definition, input.surface);
    if (!profile.eligible) fail(profile.reason);
    const inventory = discover({scope: sourceScope, ...(sourceScope === 'project' ? {projectPath: input.targetRoot} : {})});
    const client = inventory.find(item => item.id === input.clientId);
    const selected = profile.id ? client.surfaces?.find(item => item.id === profile.id) : client;
    const item = selected?.observations?.find(item => item.candidateId === input.candidateId);
    if (!item) fail('IMPORT_CANDIDATE_NOT_FOUND');
    const externallyManaged = inventory.some(client => (client.surfaces?.length
      ? client.surfaces.flatMap(surface => surface.observations || []) : client.observations || [])
      .some(observed => observed.candidateId === input.candidateId && observed.managementMode === 'external'));
    if (item.managementMode === 'external' || externallyManaged) fail('EXTERNAL_RESOURCE_READ_ONLY', 'Externally managed resources are observation-only');
    if (item.linkState && item.linkState !== 'resolved') fail('IMPORT_SOURCE_UNSAFE');
    const capability = profile.capabilities.find(cap => cap.assetKind === (item.kind === 'mcpServers' ? 'mcp' : item.kind) && cap.scope === sourceScope);
    if (!capability || !['instructions', 'skills', 'agents', 'mcpServers'].includes(item.kind)) fail('IMPORT_KIND_UNSUPPORTED');
    const root = sourceScope === 'global' ? homeDir : input.targetRoot;
    const source = item.path.startsWith('~/') ? path.join(homeDir, item.path.slice(2)) : path.resolve(item.path);
    if (!isWithinRoot(source, root) || isWithinRoot(resolveForAuthorization(source), resolveForAuthorization(input.scopeRoot))
      || isWithinRoot(resolveForAuthorization(input.scopeRoot), resolveForAuthorization(source))) fail('IMPORT_SOURCE_UNSAFE');
    const snapshot = readImportSource({source, authorizedRoot: root, kind: item.kind, nativeId: item.id, format: capability.format});
    return {item, profile, capability, source, root, snapshot, sourceScope};
  }
  function assertUnchanged(entry) {
    if (sourceHash(fs.readFileSync(entry.manifestPath)) !== entry.beforeHash) fail('STALE_SOURCE_MANAGEMENT_PLAN');
    if (entry.artifactRecord) assertArtifacts(entry.scopeRoot, entry.artifactRecord);
    if (entry.input) {
      const current = candidate(entry.input);
      if (current.snapshot.fingerprint !== entry.fingerprint) fail('IMPORT_SOURCE_CHANGED');
    }
  }
  function assertNotDeployed(input, kitId, id) {
    const statePath = input.scope === 'project' ? kitSourcePath(input.targetRoot, '.agent-kit/state.json')
      : path.join(homeDir, '.agents-kit/deployments/_global/state.json');
    if (fs.existsSync(`${statePath}.journal.json`)) fail('DEPLOYMENT_RECOVERY_REQUIRED');
    if (fs.existsSync(`${statePath}.lock`)) fail('DEPLOYMENT_STATE_LOCKED');
    const states = input.scope === 'project'
      ? [new DeploymentStateStore({statePath}).load()]
      : [new GlobalDeploymentStateStore({homeDir}).load()];
    for (const state of states) {
      for (const record of Object.values(state.managed)) {
        const owners = [record, record.shared, ...Object.entries(record.owners || {}).map(([assetId, owner]) => ({assetId, ...owner}))].filter(Boolean);
        if (owners.some(owner => (owner.assetId === id || owner.resource?.assetId === id || owner.nativeSource?.assetId === id)
          && (!owner.kitId || owner.kitId === kitId) && (!owner.resource?.kitId || owner.resource.kitId === kitId)
          && (!owner.nativeSource?.kitId || owner.nativeSource.kitId === kitId))) fail('IMPORT_RESOURCE_DEPLOYED', 'Release the deployed ownership before detaching this source');
      }
    }
  }
  const variants=createSkillVariantSourceService({load,candidate,remember});
  const revisionService = createSourceRevisionService({load, candidate, remember, clock, homeDir, upstreamReader,variantAccess:variants.access});
  const installationService = createNativeInstallationService({load:input=>{const entry=load(input);if(entry.manifest.schemaVersion===3)fail('SCOPED_DEPLOYMENT_NOT_ENABLED','Native installation requires scoped writer coordination');return entry;}, discover, definitionsDir, homeDir, deploymentStores, binaryObserver, clock, planTtlMs,
    sourceService: revisionService, applySourcePlan: ({planId}) => service.apply({planId, kind: 'source-edit'})});
  const service = Object.freeze({
    ...revisionService,
    ...installationService,
    planVariantRegistration:variants.planVariantRegistration,
    planImport(input) {
      const loaded = load(input), selected = candidate(input);
      const assetId = input.assetId || selected.item.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
      if (!ID.test(assetId)) fail('INVALID_ASSET_ID');
      const existing = Object.values(loaded.manifest.assets).flat().find(asset => asset.id === assetId);
      const resources = loaded.manifest.management?.resources;
      const previous = resources && Object.hasOwn(resources, assetId) ? resources[assetId] : undefined;
      if (previous?.status === 'detached' && (previous.origin.candidateId !== input.candidateId
        || previous.format !== selected.capability.format || previous.nativeId !== selected.item.id
        || previous.origin.linkHash !== (selected.snapshot.linkText ? sourceHash(selected.snapshot.linkText) : undefined))) fail('SOURCE_BINDING_CHANGED');
      if (previous) assertArtifacts(loaded.scopeRoot, previous);
      if (existing) {
        if (previous?.status !== 'active' || previous.origin.candidateId !== input.candidateId) fail('DUPLICATE_ASSET_ID');
        if ((previous.lastCheck?.fingerprint || previous.fingerprint) !== selected.snapshot.fingerprint) fail('IMPORT_ALREADY_REGISTERED', 'The source is already registered; upstream changes require a refresh plan');
        return remember({kind: 'import', ...loaded, input: {...input, assetId}, artifactRecord: previous, fingerprint: selected.snapshot.fingerprint, skip: true,
          operations: [{operation: 'SKIP', assetId, reason: 'SOURCE_ALREADY_REGISTERED'}]});
      }
      const prefix = `assets/imported/${assetId}`;
      const currentRoot = previous ? (previous.kind === 'skills' ? previous.source : path.posix.dirname(previous.source)) : selected.item.kind === 'skills' ? `${prefix}/bundle` : prefix;
      const source = selected.item.kind === 'skills' ? currentRoot : `${currentRoot}/${selected.snapshot.files[0].path}`;
      const baseline = `.kit-sources/baselines/${assetId}/${selected.snapshot.fingerprint}`;
      const targetScope = input.scope === 'global' ? 'global' : {type: 'project', projectName: loaded.manifest.schemaVersion===3?scopedManifestLocation(loaded.scopeRoot).projectName:loaded.manifest.targets?.[input.clientId]?.projectName || 'default'};
      const asset = {id: assetId, scope: targetScope, source};
      const record = {schemaVersion: 1, status: 'active', kind: selected.item.kind, source, baseline,
        fingerprint: selected.snapshot.fingerprint, files: selected.snapshot.inventory,
        nativeId: selected.item.id, format: selected.capability.format,
        origin: {type: 'local', clientId: input.clientId, surface: selected.profile.id || 'default', scope: selected.sourceScope,
          root: selected.sourceScope === 'global' ? '~' : fs.realpathSync(selected.root),
          path: path.relative(selected.root, selected.source).split(path.sep).join('/'), candidateId: input.candidateId,
          ...(selected.snapshot.linkText ? {linkHash: sourceHash(selected.snapshot.linkText)} : {})}};
      const doc = loaded.doc;
      if(doc.schemaVersion!==3)doc.schemaVersion = 2;
      doc.management ||= {schemaVersion: 1, resources: {}};
      doc.management.resources[assetId] = previous ? {...structuredClone(previous), status: 'active'} : record;
      doc.assets ||= {};
      doc.assets[selected.item.kind] ||= [];
      doc.assets[selected.item.kind].push(asset);
      validateDocument(doc);
      const files = previous ? [] : selected.snapshot.files.flatMap(file => [
        {...file, path: `${currentRoot}/${file.path}`}, {...file, path: `${baseline}/${file.path}`}
      ]).map(file => {
        const target = kitSourcePath(loaded.scopeRoot, file.path);
        let exists = false;
        try { fs.lstatSync(target); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (exists && previous?.status !== 'detached') fail('IMPORT_SOURCE_COLLISION');
        if (exists && (sourceHash(fs.readFileSync(target)) !== file.sha256 || (fs.statSync(target).mode & 0o777) !== file.mode)) fail('IMPORT_ARTIFACT_MODIFIED');
        return {...file, reuse: exists};
      });
      const content = encode(doc, loaded.format);
      return remember({kind: 'import', ...loaded, input: {...input, assetId}, artifactRecord: previous, fingerprint: selected.snapshot.fingerprint, files, content,
        stateUpgrade: loaded.manifest.schemaVersion === 1 ? {from: 1, to: 2} : undefined,
        source: {candidateId: input.candidateId, path: selected.item.path, fingerprint: selected.snapshot.fingerprint, fileCount: selected.snapshot.files.length, byteCount: selected.snapshot.byteCount},
        manifestDiff: {before: loaded.before, after: content},
        operations: [{operation: previous ? 'REATTACH_RETAINED_SOURCE' : 'REGISTER_SOURCE', assetId, assetKind: selected.item.kind, source, originalPreserved: true},
          ...files.map(file => ({operation: file.reuse ? 'REUSE_SOURCE' : 'CREATE_SOURCE', path: file.path, sha256: file.sha256, mode: file.mode}))]});
    },
    planDetach(input) {
      const loaded = load(input), {assetId} = input;
      const record = loaded.manifest.management?.resources[assetId];
      if (!record || record.status !== 'active') fail('IMPORTED_RESOURCE_NOT_FOUND');
      assertNotDeployed(input, loaded.manifest.kit.id, assetId);
      const doc = loaded.doc;
      doc.assets[record.kind] = doc.assets[record.kind].filter(asset => asset.id !== assetId);
      for (const target of Object.values(doc.targets || {})) if (target.assetIds) target.assetIds = target.assetIds.filter(id => id !== assetId);
      doc.management.resources[assetId].status = 'detached';
      validateDocument(doc);
      assertSourceDependencyRemovalAllowed({homeDir,scopeRoot:loaded.scopeRoot,beforeManifest:loaded.manifest,afterManifest:validateManifestDocument(doc)});
      const content = encode(doc, loaded.format);
      return remember({kind: 'detach', ...loaded, content, detachInput: input,
        manifestDiff: {before: loaded.before, after: content},
        operations: [{operation: 'DETACH_SOURCE', assetId, originalPreserved: true, sourceFilesPreserved: true}]});
    },
    planRecovery(input) {
      const scopeRoot = context(input, true), recovery = planKitSourceRecovery(scopeRoot);
      return remember({kind: 'source-recovery', scopeRoot, recovery,
        operations: recovery.operations, outcome: recovery.committed ? 'keep-committed' : 'remove-uncommitted-sources'});
    },
    apply({planId, kind}) {
      const entry = plans.get(planId);
      if (!entry || entry.kind !== kind) fail('DEPLOYMENT_PLAN_NOT_FOUND');
      plans.delete(planId);
      if (entry.expires < clock()) fail('DEPLOYMENT_PLAN_EXPIRED');
      if (entry.automatic === false) fail('SOURCE_MANAGEMENT_PLAN_BLOCKED', 'Resolve or defer every conflict before applying');
      if (kind === 'source-recovery') return applyKitSourceRecovery({scopeRoot: entry.scopeRoot, plan: entry.recovery});
      assertUnchanged(entry);
      entry.revalidate?.();
      if (entry.skip) return {success: true, unchanged: true};
      const assertReferences=()=>assertSourceDependencyRemovalAllowed({homeDir,scopeRoot:entry.scopeRoot,beforeManifest:entry.manifest,
        afterManifest:validateManifestDocument(entry.format==='json'?JSON.parse(entry.content):parse(entry.content))});
      assertReferences();
      const execute=(verify=()=>{})=>{
        const revalidate=()=>{verify();assertUnchanged(entry);entry.revalidate?.();assertReferences();
          if(entry.detachInput)assertNotDeployed(entry.detachInput,entry.manifest.kit.id,entry.detachInput.assetId);};
        revalidate();
        return applyKitSourceMutation({...entry,revalidate,onPhase:(phase,...details)=>{onPhase?.(phase,...details);if(phase==='manifest'){verify();assertReferences();}}});
      };
      return entry.scopedGuard?entry.scopedGuard.run(execute):execute();
    }
  });
  return service;
}
