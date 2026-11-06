import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {resolveManifestDependencies} from '../domain/manifest-dependencies.js';
import {loadClientDefinitions} from '../infrastructure/client-definition-loader.js';
import {boundedRead, assertImportContentSafe} from '../infrastructure/import-source-reader.js';
import {kitSourcePath, sourceHash} from '../infrastructure/kit-source-transaction.js';
import {assertSourceArtifacts, readKitSourceSnapshot, sourceDirectory} from '../infrastructure/kit-source-snapshot.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {canonicalNativeMcpUnit, replaceNativeMcp} from '../adapters/mcp/native-installation.js';
import {nativeRuntimeAsset, NATIVE_EXECUTABLE} from '../adapters/native-runtime-asset.js';
import {deploymentStateHash} from './shared-resource-deployment.js';
import {planVerifiedClientDeployment} from './plan-verified-client-deployment.js';
import {applyDeployment} from './apply-deployment.js';
import {rememberNativeContent} from './native-installation-content.js';
import {mergeSourceFile} from '../domain/source-merge.js';
import {describeNativeInstallationResource} from './native-installation-receipt.js';
import {installationReceiptAudit} from './installation-receipt-service.js';

const fail = (code, message = 'Create a new reviewed native installation plan') => {throw domainError(code, message);};
const own = (map, id) => map && Object.hasOwn(map, id) ? map[id] : undefined;
const text = bytes => {try {return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);} catch {return null;}};
const sensitive = file => {if (!file) return false; try {assertImportContentSafe(file.content); return false;} catch {return true;}};
const view = file => file ? {sha256: sourceHash(file.content), mode: file.mode, text: sensitive(file) ? null : text(file.content), bytes: file.content.length} : null;
const same = (a, b, unit = false) => !a && !b || !!a && !!b && a.sha256 === b.sha256 && (unit || a.mode === b.mode);

function safeTarget(target, root) {
  root = fs.realpathSync(root); target = path.resolve(target);
  if (!isWithinRoot(target, root) || target === root) fail('DEPLOYMENT_TARGET_OUTSIDE_SCOPE');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    try {if (fs.lstatSync(current).isSymbolicLink()) fail('NATIVE_TARGET_LINK_PRESERVED', 'Existing links are preserved; automatic writes through them are disabled');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return target;
}
function observed(target, root) {
  safeTarget(target, root);
  try {const read = boundedRead(target); return {content: read.bytes, mode: read.mode, sha256: sourceHash(read.bytes)};}
  catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}
function unit(file, record, allowAbsent = false) {
  if (!file || record.kind !== 'mcpServers') return file;
  const value = text(file.content); if (value === null) fail('NATIVE_MCP_TARGET_UNSUPPORTED');
  const canonical = canonicalNativeMcpUnit(value, record, allowAbsent);
  if (canonical === null) return null;
  return {...file, content: canonical, sha256: sourceHash(canonical)};
}
function snapshotFile(root, directory, file) {
  const target = kitSourcePath(root, `${directory}/${file.path}`), read = boundedRead(target);
  if (sourceHash(read.bytes) !== file.sha256 || read.mode !== file.mode) fail('NATIVE_LAST_APPLIED_UNAVAILABLE');
  return {path: file.path, mode: read.mode, content: read.bytes, sha256: file.sha256};
}

export function createNativeInstallationService({load, discover, definitionsDir, homeDir, deploymentStores, binaryObserver, clock, planTtlMs, sourceService, applySourcePlan}) {
  const plans = new Map();
  const definitionsHash = () => sourceHash(fs.readdirSync(definitionsDir).filter(name => /\.(yaml|yml|json)$/.test(name)).sort().map(name => `${name}:${sourceHash(fs.readFileSync(path.join(definitionsDir, name)))}`).join('\n'));
  function context(input) {
    const loaded = load(input), record = own(loaded.manifest.management?.resources, input.assetId);
    if (!record || record.status !== 'active') fail('IMPORTED_RESOURCE_NOT_FOUND');
    assertSourceArtifacts(loaded.scopeRoot, record);
    const definitions = loadClientDefinitions({definitionsDir}), clientId = input.clientId || record.origin.clientId;
    if (clientId !== record.origin.clientId || input.scope !== record.origin.scope) fail('NATIVE_ORIGIN_SCOPE_MISMATCH');
    const definition = definitions.get(clientId), surface = input.surface || record.origin.surface;
    if (!definition) fail('CLIENT_DEFINITION_NOT_FOUND');
    const profile = selectClientSurface(definition, surface === 'default' ? undefined : surface);
    const originProfile = selectClientSurface(definition, record.origin.surface === 'default' ? undefined : record.origin.surface);
    if (!profile.eligible || !originProfile.eligible) fail('CLIENT_SURFACE_NOT_DEFINED');
    const configStore = profile.configStore || clientId;
    if (configStore !== (originProfile.configStore || clientId)) fail('NATIVE_PROFILE_MISMATCH');
    const capability = profile.capabilities.find(cap => cap.assetKind === (record.kind === 'mcpServers' ? 'mcp' : record.kind) && cap.scope === input.scope);
    if (!capability || capability.format !== record.format || !['stable', 'version-dependent'].includes(capability.status)
      || capability.evidence.state !== 'verified' || capability.strategy !== (['instructions', 'mcpServers'].includes(record.kind) ? 'merge' : 'copy')) fail('NATIVE_PROFILE_UNSUPPORTED');
    const root = fs.realpathSync(input.targetRoot);
    if (record.origin.scope === 'project' && root !== fs.realpathSync(record.origin.root)) fail('SOURCE_BINDING_CHANGED');
    const template = capability.path.replaceAll('{assetId}', record.nativeId);
    const target = path.resolve(root, template.startsWith('~/') ? template.slice(2) : template);
    const original = path.resolve(record.origin.scope === 'global' ? fs.realpathSync(homeDir) : record.origin.root, record.origin.path);
    if (target !== original) fail('NATIVE_CANONICAL_TARGET_REQUIRED');
    const inventory = discover({scope: input.scope, ...(input.scope === 'project' ? {projectPath: input.targetRoot} : {})});
    if (inventory.some(client => (client.surfaces?.length ? client.surfaces.flatMap(item => item.observations || []) : client.observations || [])
      .some(item => item.candidateId === record.origin.candidateId && item.managementMode === 'external'))) fail('EXTERNAL_RESOURCE_READ_ONLY');
    safeTarget(target, root);
    if (record.kind === 'skills' && fs.existsSync(target) && !fs.lstatSync(target).isDirectory()) fail('NATIVE_TARGET_SHAPE_CHANGED');
    const asset = loaded.manifest.assets[record.kind].find(asset => asset.id === input.assetId);
    const deps = resolveManifestDependencies(loaded.manifest, {selectedAssetIds: [asset.id], targetScope: asset.scope});
    if (!deps.valid) fail('MANIFEST_DEPENDENCY_INVALID');
    const {stateStore, backupStore} = deploymentStores({...input, clientId}), state = stateStore.load();
    if (fs.existsSync(`${stateStore.statePath}.journal.json`)) fail('DEPLOYMENT_RECOVERY_REQUIRED');
    const kit = readKitSourceSnapshot(loaded.scopeRoot, sourceDirectory(record), record.kitFiles || record.files);
    const base = readKitSourceSnapshot(loaded.scopeRoot, record.baseline, record.files);
    return {...loaded, input, record, asset, root, target, clientId, profile, definition, capability, configStore, stateStore, backupStore, state, kit, base,
      dependencyIds: deps.assetIds.filter(id => id !== asset.id), definitionsHash: definitionsHash()};
  }
  function nativeOwner(record, id) {return record?.nativeSource || own(record?.owners, id)?.nativeSource;}
  function assertOwner(entry, owner) {
    if (!owner || owner.kitId !== entry.manifest.kit.id || owner.assetId !== entry.asset.id || owner.sourceRoot !== entry.scopeRoot
      || owner.clientId !== entry.clientId || owner.configStore !== entry.configStore || owner.targetBase !== entry.target || owner.format !== entry.record.format
      || owner.nativeId !== entry.record.nativeId || owner.scope !== entry.input.scope || owner.kind !== entry.record.kind) fail('NATIVE_OWNERSHIP_CONFLICT');
  }
  function installed(entry) {
    const {record, state, target, root} = entry, mcp = record.kind === 'mcpServers';
    const kit = new Map(entry.kit.files.map(file => [file.path, file])), base = new Map(entry.base.files.map(file => [file.path, file]));
    const owned = new Map();
    for (const [location, managed] of Object.entries(state.managed)) {
      const owner = nativeOwner(managed, entry.asset.id);
      if (owner?.kitId === entry.manifest.kit.id && owner.assetId === entry.asset.id && owner.targetBase === target) {
        assertOwner(entry, owner);
        if (location !== (record.kind === 'skills' ? path.join(target, owner.relative) : target)) fail('NATIVE_OWNERSHIP_CONFLICT');
        owned.set(owner.relative, {location, managed, owner});
      }
    }
    const names = [...new Set([...kit.keys(), ...base.keys(), ...owned.keys()])].sort(), rows = [];
    for (const relative of names) {
      const location = record.kind === 'skills' ? path.join(target, relative) : target;
      const managed = state.managed[location], owner = nativeOwner(managed, entry.asset.id);
      if (managed && (!mcp || Object.values(managed.owners || {}).some(item => !item.nativeSource)) && !owner) fail('NATIVE_OWNERSHIP_CONFLICT');
      if (owner) assertOwner(entry, owner);
      if (mcp && managed && Object.entries(managed.owners || {}).some(([id, item]) => id !== entry.asset.id && item.nativeSource?.nativeId === record.nativeId)) fail('NATIVE_OWNERSHIP_CONFLICT');
      const actual = observed(location, root), current = unit(actual, record, true);
      const last = owner ? unit(snapshotFile(entry.scopeRoot, owner.lastApplied.directory, owner.lastApplied.file), record) : null;
      rows.push({relative, location, managed, owner, actual, current, last, desired: unit(kit.get(relative), record), baseline: unit(base.get(relative), record)});
    }
    return rows;
  }
  function gate(entry) {
    const content = entry.record.kind === 'skills' ? '' : entry.kit.files[0].content.toString('utf8');
    const gateAsset = nativeRuntimeAsset(entry.asset, entry.record, content);
    const manifest = {...entry.manifest, management: undefined, assets: {...entry.manifest.assets, [entry.record.kind]: entry.manifest.assets[entry.record.kind].map(item => item.id === entry.asset.id ? gateAsset : item)}};
    if (gateAsset[NATIVE_EXECUTABLE]) manifest.defaults = {...entry.manifest.defaults,
      mcpBindings: {schemaVersion: 1, ...(entry.manifest.defaults?.mcpBindings || {}),
        executables: {...(entry.manifest.defaults?.mcpBindings?.executables || {}), 'native-installation-executable': {command: gateAsset[NATIVE_EXECUTABLE]}}}};
    return planVerifiedClientDeployment({manifest, definition: entry.definition, surface: entry.profile.id,
      clientVersion: entry.input.clientVersion, platform: process.platform, arch: process.arch,
      selectedAssetIds: [entry.asset.id], binaryObserver});
  }
  function checkDependencies(entry) {
    for (const id of entry.dependencyIds) {
      const providers = Object.entries(entry.state.managed).filter(([, managed]) => {
        const owners = [managed.resource, managed.nativeSource, managed.shared, ...Object.values(managed.owners || {}).map(owner => owner.resource || owner.nativeSource || owner)].filter(Boolean);
        return owners.some(owner => owner.assetId === id && owner.kitId === entry.manifest.kit.id
          && (owner.clientId === entry.clientId || owner.targets?.some(target => target.clientId === entry.clientId)
            || owner.consumers?.some(value => value.startsWith(`${entry.manifest.kit.id}:${entry.clientId}:`))));
      });
      if (!providers.length) fail('NATIVE_DEPENDENCY_NOT_INSTALLED');
      for (const [location, managed] of providers) {
        const actual = observed(location, entry.root);
        if (actual?.sha256 !== managed.hash) fail('NATIVE_DEPENDENCY_TARGET_CHANGED');
        const native = [managed.nativeSource, ...Object.values(managed.owners || {}).map(owner => owner.nativeSource)]
          .filter(owner => owner?.assetId === id && owner.kitId === entry.manifest.kit.id);
        for (const owner of native) {
          if (owner.sourceRoot !== entry.scopeRoot || owner.clientId !== entry.clientId || owner.scope !== entry.input.scope) fail('NATIVE_DEPENDENCY_NOT_INSTALLED');
          const record = {kind: owner.kind, format: owner.format, nativeId: owner.nativeId};
          const last = unit(snapshotFile(entry.scopeRoot, owner.lastApplied.directory, owner.lastApplied.file), record);
          if (!same(unit(actual, record, true), last, record.kind === 'mcpServers')) fail('NATIVE_DEPENDENCY_TARGET_CHANGED');
        }
      }
    }
  }
  function identity(entry, relative, directory, file, revisionId) {
    return {schemaVersion: 1, kitId: entry.manifest.kit.id, assetId: entry.asset.id, kind: entry.record.kind,
      clientId: entry.clientId, configStore: entry.configStore, surface: entry.profile.id || 'default', nativeId: entry.record.nativeId,
      scope: entry.input.scope, format: entry.record.format, sourceRoot: entry.scopeRoot, targetBase: entry.target,
      relative, revisionId, dependencyIds: entry.dependencyIds,
      lastApplied: {directory, file: {path: file.path, sha256: file.sha256, mode: file.mode}}};
  }
  function createPlan(input) {
    if (!['adopt', 'apply', 'detach', 'import-installed'].includes(input.mode)) fail('INVALID_INSTALLATION_MODE');
    const entry = context(input), rows = installed(entry), mode = input.mode;
    const reviewHash = sourceHash(JSON.stringify({manifest: entry.beforeHash, definitions: entry.definitionsHash, state: deploymentStateHash(entry.state), targets: rows.map(row => [row.location, row.actual?.sha256 || null, row.actual?.mode ?? null])}));
    const choices = input.choices || {};
    if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).some(key => !rows.some(row => row.relative === key) || !(mode === 'import-installed' ? ['keep-installed', 'use-kit', 'manual'] : ['keep-installed', 'use-kit']).includes(choices[key]))) fail('INVALID_INSTALLATION_CHOICES');
    if (Object.keys(choices).length && input.reviewHash !== reviewHash) fail('STALE_INSTALLATION_REVIEW');
    const operations = [], blocked = [], details = [];
    if (mode === 'import-installed') {
      const files = new Map(entry.kit.files.map(file => [file.path, file]));
      if (!rows.some(row => row.owner)) blocked.push({reason: 'NATIVE_ADOPTION_REQUIRED'});
      for (const row of rows.filter(row => row.owner)) {
        const choice = own(choices, row.relative), mcp = entry.record.kind === 'mcpServers';
        const normalizeMode = file => file && mcp ? {...file, mode: row.desired?.mode ?? row.last.mode} : file;
        const merged = mergeSourceFile(normalizeMode(row.last), normalizeMode(row.desired), normalizeMode(row.current), {json: mcp && ['json', 'json-section'].includes(entry.record.format)});
        let file = merged.file;
        if (choice === 'use-kit') file = row.desired;
        else if (choice === 'keep-installed') file = row.current;
        else if (choice === 'manual') {
          const value = own(input.manualTexts, row.relative);
          if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 * 1024) fail('INVALID_INSTALLATION_CHOICES');
          file = {path: row.relative, content: Buffer.from(value), mode: row.desired?.mode ?? row.last.mode};
        } else if (merged.conflict) blocked.push({target: row.location, reason: 'NATIVE_INSTALLATION_MERGE_CONFLICT'});
        if (!file && !choice && (entry.record.kind !== 'skills' || row.relative === 'SKILL.md')) blocked.push({target: row.location, reason: 'NATIVE_PRIMARY_DELETION_PRESERVED'});
        if (file) files.set(row.relative, {...file, path: row.relative}); else files.delete(row.relative);
        if (!same(row.current, row.last, mcp)) details.push({path: row.relative, installed: view(row.current), lastApplied: view(row.last), kit: view(row.desired), merged: view(file), drift: true, conflict: merged.conflict, choice: choice || null});
      }
      let sourcePlan;
      if (!blocked.length) {
        const source = sourceService.source(input);
        sourcePlan = sourceService.planSourceFiles({...input, revision: source.revision}, {files: [...files.values()], details,
          revalidate: () => {
            if (fs.existsSync(`${entry.stateStore.statePath}.lock`) || fs.existsSync(`${entry.stateStore.statePath}.journal.json`)) fail('DEPLOYMENT_STATE_LOCKED');
            const nextState = entry.stateStore.load(), nextRows = installed({...entry, state: nextState});
            const nextHash = sourceHash(JSON.stringify({manifest: sourceHash(fs.readFileSync(entry.manifestPath)), definitions: definitionsHash(), state: deploymentStateHash(nextState), targets: nextRows.map(row => [row.location, row.actual?.sha256 || null, row.actual?.mode ?? null])}));
            if (nextHash !== reviewHash) fail('STALE_INSTALLATION_REVIEW');
          }});
      }
      return {entry, rows, prepared: {clientId: entry.clientId, operations: [], blocked}, runtime: null, reviewHash, details, sourcePlan};
    }
    const runtime = mode === 'apply' ? gate(entry) : null;
    if (runtime?.plan.blocked.length) blocked.push(...runtime.plan.blocked.map(item => ({assetId: item.assetId, reason: item.reason})));
    if (mode === 'apply') {try {checkDependencies(entry);} catch (error) {if (error.name === 'DomainError') blocked.push({reason: error.code}); else throw error;}}
    for (const row of rows) {
      const {relative, location, managed, owner, actual, current, last, desired, baseline} = row;
      const mcp = entry.record.kind === 'mcpServers';
      let content = actual?.content || null, afterMode = actual?.mode ?? null, nextManaged = managed || null, reason, metadataOnly = true;
      const choice = own(choices, relative);
      if (mode === 'adopt') {
        if (owner) continue;
        if (!baseline) continue;
        if (!same(current, baseline, mcp)) {blocked.push({target: location, reason: 'NATIVE_INITIAL_SNAPSHOT_CHANGED'}); details.push({path: relative, installed: view(current), lastApplied: view(baseline), kit: view(desired)}); continue;}
        const file = entry.base.files.find(file => file.path === relative);
        const marker = identity(entry, relative, entry.record.baseline, file, `accepted-${entry.record.fingerprint}`);
        nextManaged = mcp ? {clientId: entry.clientId, strategy: 'native-source', ownership: 'native-units', hash: actual.sha256,
          owners: {...(managed?.owners || {}), [entry.asset.id]: {nativeSource: marker}}}
          : {clientId: entry.clientId, assetId: entry.asset.id, strategy: 'native-source', ownership: 'file', hash: actual.sha256, nativeSource: marker};
        reason = 'ADOPT_EXISTING_NATIVE_RESOURCE';
      } else if (mode === 'detach') {
        if (!owner) continue;
        if (mcp) {nextManaged = {...structuredClone(managed),hash:actual?.sha256 || null}; delete nextManaged.owners[entry.asset.id]; if (!Object.keys(nextManaged.owners).length) nextManaged = null;}
        else nextManaged = null;
        reason = 'RELEASE_NATIVE_OWNERSHIP_KEEP_CONTENT';
      } else {
        if (!owner && !desired) continue;
        if (!owner && (baseline || actual)) {blocked.push({target: location, reason: baseline ? 'NATIVE_ADOPTION_REQUIRED' : 'UNKNOWN_EXISTING_CONTENT'}); continue;}
        const drift = owner && !same(current, last, mcp);
        details.push({path: relative, installed: view(current), lastApplied: view(last), kit: view(desired), drift, choice: choice || null});
        if (choice === 'keep-installed') continue;
        if (drift && sensitive(current)) {blocked.push({target: location, reason: 'NATIVE_CREDENTIAL_CHANGE_REQUIRES_EXTERNAL_REVIEW'}); continue;}
        const incorporated = drift && desired && mergeSourceFile(last, desired, current, {json: mcp && ['json', 'json-section'].includes(entry.record.format)});
        const containsInstalledChange = incorporated?.file && same(incorporated.file && {...incorporated.file, sha256: sourceHash(incorporated.file.content)}, desired, mcp);
        if (drift && choice !== 'use-kit' && !containsInstalledChange && (desired || current)) {blocked.push({target: location, reason: 'NATIVE_INSTALLATION_MODIFIED_EXTERNALLY'}); continue;}
        if (!desired && drift && current) {blocked.push({target: location, reason: 'NATIVE_DELETE_MODIFIED_FILE'}); continue;}
        if (!desired && input.removeDeleted !== true) {blocked.push({target: location, reason: 'NATIVE_DELETION_REVIEW_REQUIRED'}); continue;}
        if (mcp) {
          if (!actual || !desired) {blocked.push({target: location, reason: 'NATIVE_MCP_TARGET_UNSUPPORTED'}); continue;}
          content = same(current, desired, true) ? actual.content : Buffer.from(replaceNativeMcp(text(actual.content), text(desired.content), entry.record));
        } else {content = desired?.content || null; afterMode = desired?.mode ?? null;}
        metadataOnly = (content ? sourceHash(content) : null) === (actual?.sha256 || null) && afterMode === (actual?.mode ?? null);
        if (desired) {
          const file = entry.kit.files.find(file => file.path === relative), marker = identity(entry, relative, sourceDirectory(entry.record), file, entry.record.revisionId || entry.record.fingerprint);
          nextManaged = mcp ? {clientId: entry.clientId, strategy: 'native-source', ownership: 'native-units', hash: sourceHash(content),
            owners: {...(managed?.owners || {}), [entry.asset.id]: {nativeSource: marker}}}
            : {clientId: entry.clientId, assetId: entry.asset.id, strategy: 'native-source', ownership: 'file', hash: sourceHash(content), nativeSource: marker};
        } else nextManaged = null;
        reason = desired ? 'APPLY_REVIEWED_KIT_NATIVE_SOURCE' : 'REMOVE_REVIEWED_OWNED_NATIVE_FILE';
      }
      const expectedHash = content === null ? null : sourceHash(content);
      const previousMetadata = managed ? structuredClone(managed) : null;
      if (previousMetadata) delete previousMetadata.transactionId;
      const unchanged = metadataOnly && JSON.stringify(nextManaged) === JSON.stringify(previousMetadata);
      const operation = Object.freeze({clientId: entry.clientId, assetId: entry.asset.id, assetKind: entry.record.kind, target: location,
        strategy: 'native-source', ownership: mcp ? 'native-units' : 'file', format: entry.record.format,
        operation: unchanged ? 'SKIP' : metadataOnly ? 'REGISTER' : content === null ? 'REMOVE' : actual ? 'UPDATE' : 'CREATE', reason,
        beforeHash: actual?.sha256 || null, expectedHash, beforeMode: actual?.mode ?? null, afterMode, modeAware: true,
        nextManaged, metadataOnly, authorizedRoot: entry.root});
      if (content !== null) rememberNativeContent(operation, content);
      operations.push(operation);
    }
    const prepared = {clientId: entry.clientId, operations, blocked, stateHash: deploymentStateHash(entry.state), intent: `native-${mode}`};
    let installationEvidence;
    if(['adopt','apply'].includes(mode))try {
      const descriptor=describeNativeInstallationResource(entry),audit=operations.every(item=>item.operation==='SKIP')
        ?installationReceiptAudit({descriptor,state:entry.state,homeDir,targetRoot:entry.root}):{required:true,status:'planned',reason:'AUDIT_METADATA_ONLY'};
      prepared.installationDescriptors=[descriptor];installationEvidence={mode:'audit-only',nativeId:entry.record.nativeId,target:entry.target,...audit,declaration:structuredClone(descriptor.declaration)};
    }catch(error){installationEvidence={mode:'audit-only',required:false,status:'unverified',reason:error.code||'NATIVE_RECEIPT_PROFILE_UNVERIFIED'};}
    return {entry, rows, prepared, runtime, reviewHash, details,installationEvidence};
  }
  return Object.freeze({
    installation(input) {
      const entry = context(input), rows = installed(entry);
      return {assetId: entry.asset.id, clientId: entry.clientId, surface: entry.profile.id || 'default', target: entry.target,
        adopted: rows.some(row => row.owner), installedModified: rows.some(row => row.owner && !same(row.current, row.last, entry.record.kind === 'mcpServers')),
        kitPending: rows.some(row => (row.desired || row.actual) && !same(row.desired, row.last || row.baseline, entry.record.kind === 'mcpServers')),
        files: rows.map(row => ({path: row.relative, owned: !!row.owner, installed: view(row.current), lastApplied: view(row.last), kit: view(row.desired)}))};
    },
    planInstallation(input) {
      const value = createPlan(input), planId = crypto.randomUUID(), expires = clock() + planTtlMs;
      for (const [id, plan] of plans) if (plan.expires < clock()) plans.delete(id);
      plans.set(planId, {...value, input: structuredClone(input), expires});
      return {planId, kind: 'installation', mode: input.mode, automatic: !value.prepared.blocked.length, expiresAt: new Date(expires).toISOString(),
        ...(value.installationEvidence?{installationEvidence:structuredClone(value.installationEvidence)}:{}),
        sourceOnly: input.mode === 'import-installed',
        reviewHash: value.reviewHash, operations: value.sourcePlan ? value.sourcePlan.operations.map(item => ({target: item.path || value.entry.scopeRoot, operation: item.operation, reason: 'MERGE_INSTALLED_INTO_KIT', metadataOnly: false})) : value.prepared.operations.map(({target, operation, reason, beforeHash, expectedHash, beforeMode, afterMode, metadataOnly}) => ({target, operation, reason, beforeHash, expectedHash, beforeMode, afterMode, metadataOnly})),
        blocked: value.prepared.blocked, details: value.details, stateUpgrade: value.entry.state.schemaVersion < 5 ? {from: value.entry.state.schemaVersion, to: 5} : undefined};
    },
    applyInstallation({planId, validate}) {
      const plan = plans.get(planId); plans.delete(planId);
      if (!plan) fail('DEPLOYMENT_PLAN_NOT_FOUND'); if (plan.expires < clock()) fail('DEPLOYMENT_PLAN_EXPIRED');
      if (plan.input.mode === 'import-installed') {
        if (plan.prepared.blocked.length) fail('DEPLOYMENT_PLAN_BLOCKED');
        return {...applySourcePlan({planId: plan.sourcePlan.planId}), sourceOnly: true};
      }
      const verifySource = () => {
        const fresh = load(plan.input);
        if (fresh.beforeHash !== plan.entry.beforeHash || definitionsHash() !== plan.entry.definitionsHash) fail('STALE_INSTALLATION_REVIEW');
        assertSourceArtifacts(fresh.scopeRoot, plan.entry.record);
        if (plan.input.mode === 'apply') checkDependencies(plan.entry);
        if (plan.runtime?.runtimeCheck) {
          const {profile, observed} = plan.runtime.runtimeCheck, next = binaryObserver(profile);
          if (!next || next.sha256 !== observed.sha256 || next.binaryPath !== observed.binaryPath) fail('CLIENT_BINARY_CHANGED');
        }
      };
      if (!plan.prepared.blocked.length && plan.prepared.operations.every(item => item.operation === 'SKIP')&&!plan.installationEvidence?.required) {
        verifySource(); if (createPlan(plan.input).reviewHash !== plan.reviewHash) fail('STALE_INSTALLATION_REVIEW');
        return {success: true, unchanged: true, applied: [], skipped: plan.prepared.operations.map(item => item.target)};
      }
      const result=applyDeployment({plans: [plan.prepared], stateStore: plan.entry.stateStore, backupStore: plan.entry.backupStore,
        preflight: () => {verifySource(); const fresh = createPlan(plan.input); if (fresh.reviewHash !== plan.reviewHash) fail('STALE_INSTALLATION_REVIEW'); if (fresh.prepared.blocked.length) fail('DEPLOYMENT_PLAN_BLOCKED');},
        validate: (...args) => {verifySource(); return validate ? validate(...args) : {valid: true, results: [{type: 'native-write-verification', clientUse: 'not-invoked'}]};}});
      return {...result,metadataOnly:plan.prepared.operations.every(item=>item.metadataOnly)};
    }
  });
}
