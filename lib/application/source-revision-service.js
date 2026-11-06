import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {stringify} from 'yaml';
import {domainError} from '../domain/errors.js';
import {safeResourceRelativePath, validSourceState} from '../domain/resource-management.js';
import {mergeSourceFile, utf8Text} from '../domain/source-merge.js';
import {validateManifestDocument} from '../infrastructure/manifest-loader.js';
import {assertImportContentSafe} from '../infrastructure/import-source-reader.js';
import {extractNativeMcpSource} from '../adapters/mcp/import.js';
import {assertSourceArtifacts, readKitSourceSnapshot, sameInventory, sourceDirectory, sourceInventory} from '../infrastructure/kit-source-snapshot.js';
import {kitSourcePath, sourceHash} from '../infrastructure/kit-source-transaction.js';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {normalizeUpstreamSource} from '../domain/upstream-source.js';
import {createUpstreamSourceReader} from '../infrastructure/upstream-source-reader.js';

const fail = (code, message) => { throw domainError(code, message || 'The source revision requires a new reviewed plan'); };
const fileMap = files => new Map(files.map(file => [file.path, file]));
const digestFile = file => ({...file, sha256: sourceHash(file.content)});
const stateOf = record => ({source: record.source, baseline: record.baseline, fingerprint: record.fingerprint,
  files: record.files, kitFiles: record.kitFiles || record.files,
  ...(record.revisionId ? {revisionId: record.revisionId} : {}), ...(record.lastCheck ? {lastCheck: record.lastCheck} : {}),
  ...(record.upstream ? {upstream: record.upstream} : {})});
const fileView = file => file ? {sha256: file.sha256, mode: file.mode, text: utf8Text(file.content), bytes: file.content.length} : null;

function validateFiles(files, record) {
  const names = new Set(), entries = new Set();
  let bytes = 0;
  if (!files.length) fail('SOURCE_PRIMARY_FILE_REQUIRED');
  if (files.length > 256) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
  for (const file of files) {
    const parts = file.path?.split('/') || [];
    if (!safeResourceRelativePath(file.path) || parts.length > 16 || parts.some(part => ['.git', '.agent-kit', '.agents-kit', '.kit-sources'].includes(part))) fail('INVALID_SOURCE_EDIT_PATH');
    const portable = file.path.normalize('NFC').toLowerCase();
    if (names.has(portable)) fail('INVALID_SOURCE_EDIT_PATH'); names.add(portable);
    parts.forEach((_, index) => entries.add(parts.slice(0, index + 1).join('/')));
    bytes += file.content.length;
    if (file.content.length > 1024 * 1024 || bytes > 8 * 1024 * 1024 || entries.size + 1 > 512) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) fail('INVALID_SOURCE_FILE_MODE');
    assertImportContentSafe(file.content);
  }
  for (const name of names) if ([...names].some(other => other !== name && other.startsWith(`${name}/`))) fail('INVALID_SOURCE_EDIT_PATH');
  if (record.kind === 'skills' ? !names.has('skill.md') || !files.some(file => file.path === 'SKILL.md')
    : files.length !== 1 || files[0].path !== record.files[0].path) fail('SOURCE_PRIMARY_FILE_REQUIRED');
  if (record.kind === 'mcpServers') {
    const text = utf8Text(files[0].content);
    if (text === null) fail('INVALID_SOURCE_TEXT');
    extractNativeMcpSource({text, format: record.format, nativeId: record.nativeId, strictSelection: true});
  }
  return files.map(digestFile);
}

export function createSourceRevisionService({load, candidate, remember, clock, homeDir, variantAccess, upstreamReader = createUpstreamSourceReader()}) {
  function current(input) {
    const loaded = load(input), resources = loaded.manifest.management?.resources;
    const variant=input.variantId===undefined?null:variantAccess(loaded,input);
    const record = variant?variant.record:resources && Object.hasOwn(resources, input.assetId) ? resources[input.assetId] : undefined;
    if (!record || record.status !== 'active') fail('IMPORTED_RESOURCE_NOT_FOUND');
    const kit = readKitSourceSnapshot(loaded.scopeRoot, sourceDirectory(record), record.kitFiles || record.files);
    const base = readKitSourceSnapshot(loaded.scopeRoot, record.baseline, record.files);
    return {...loaded,...variant, record, kit, base, revision: sourceHash(JSON.stringify({manifest: loaded.beforeHash, state: stateOf(record)}))};
  }
  function upstream(input, entry) {
    const {record} = entry, origin = record.origin;
    const binding = input.upstream === undefined ? record.upstream : input.upstream;
    if (binding !== undefined && binding !== null) {
      const locator = normalizeUpstreamSource(binding);
      return Promise.resolve(upstreamReader(locator, record)).then(snapshot => ({snapshot, binding: locator}));
    }
    if(entry.localUpstream)return entry.localUpstream();
    if (origin.scope === 'project' && resolveForAuthorization(input.targetRoot) !== resolveForAuthorization(origin.root)) fail('SOURCE_BINDING_CHANGED');
    const selectedInput = {...input, clientId: origin.clientId, surface: origin.surface === 'default' ? undefined : origin.surface,
      candidateId: origin.candidateId, sourceScope: origin.scope};
    const selected = candidate(selectedInput);
    if (selected.item.id !== record.nativeId || selected.item.kind !== record.kind || selected.capability.format !== record.format
      || path.resolve(selected.root, origin.path) !== path.resolve(selected.source)
      || (selected.snapshot.linkText ? sourceHash(selected.snapshot.linkText) : undefined) !== origin.linkHash) fail('SOURCE_BINDING_CHANGED');
    const targetRoot = origin.scope === 'global' ? homeDir : input.targetRoot;
    const statePath = origin.scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : kitSourcePath(targetRoot, '.agent-kit/state.json');
    if (fs.existsSync(`${statePath}.journal.json`) || fs.existsSync(`${statePath}.lock`)) fail('DEPLOYMENT_RECOVERY_REQUIRED');
    const state = origin.scope === 'global' ? new GlobalDeploymentStateStore({homeDir}).load() : new DeploymentStateStore({statePath}).load();
    for (const target of Object.keys(state.managed)) {
      if (isWithinRoot(resolveForAuthorization(target), resolveForAuthorization(selected.source))
        || isWithinRoot(resolveForAuthorization(selected.source), resolveForAuthorization(target))) fail('SOURCE_UPSTREAM_KIT_MANAGED');
    }
    return {...selected, input: selectedInput, binding: null};
  }
  function checkpoint(entry, item) {
    const file = kitSourcePath(entry.scopeRoot, item.path), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o777) !== 0o600) fail('IMPORT_ARTIFACT_MODIFIED');
    const bytes = fs.readFileSync(file);
    if (sourceHash(bytes) !== item.sha256) fail('IMPORT_ARTIFACT_MODIFIED');
    let value;
    try { value = JSON.parse(bytes); } catch { fail('INVALID_SOURCE_CHECKPOINT'); }
    const variant=value.schemaVersion===3,identity=entry.storageId||entry.inputAssetId;
    if (![1, 2,3].includes(value.schemaVersion) || Object.keys(value).some(key => !['schemaVersion', variant?'subject':'assetId', 'state'].includes(key))
      || Object.keys(value.state || {}).some(key => !['source', 'baseline', 'fingerprint', 'files', 'kitFiles', 'revisionId', 'lastCheck', ...([2,3].includes(value.schemaVersion) ? ['upstream'] : [])].includes(key))
      ||(entry.variantId? !variant||JSON.stringify(value.subject)!==JSON.stringify({assetId:entry.inputAssetId,variantId:entry.variantId}):variant||value.assetId!==entry.inputAssetId)
      ||!validSourceState(value.state,identity)) fail('INVALID_SOURCE_CHECKPOINT');
    const record = {...entry.record, ...value.state};
    assertSourceArtifacts(entry.scopeRoot, record);
    return value.state;
  }
  function prepare(input, entry, {kind, kitFiles, baseFiles = entry.base.files, lastCheck = entry.record.lastCheck, binding = entry.record.upstream || null, details, reviewHash, revalidate = () => {}, restored}) {
    const {record} = entry, assetId = input.assetId,storageId=entry.storageId||assetId;
    kitFiles = validateFiles(kitFiles, record);
    baseFiles = validateFiles(baseFiles, record);
    entry.validateVariantFiles?.(kitFiles);entry.validateVariantFiles?.(baseFiles);
    const kitInventory = sourceInventory(kitFiles), baseInventory = sourceInventory(baseFiles);
    const changedKit = !sameInventory(kitInventory, record.kitFiles || record.files);
    const changedBase = !sameInventory(baseInventory, record.files);
    const changedCheck = JSON.stringify(lastCheck) !== JSON.stringify(record.lastCheck);
    const changedBinding = JSON.stringify(binding) !== JSON.stringify(record.upstream || null);
    if (!changedKit && !changedBase && !changedCheck && !changedBinding && !restored) return remember({kind, ...entry, artifactRecord: record, skip: true,
      operations: [{operation: 'SKIP', assetId, reason: 'SOURCE_UNCHANGED'}], details, reviewHash, revalidate});
    if ((record.history?.length || 0) >= 1024) fail('SOURCE_HISTORY_LIMIT_EXCEEDED');
    const revisionId = crypto.randomUUID(), at = new Date(clock()).toISOString(), files = [];
    let source = record.source, baseline = record.baseline, fingerprint = record.fingerprint;
    if (restored) ({source, baseline, fingerprint} = restored);
    else {
      if (changedKit) {
        const directory = `assets/revisions/${storageId}/${revisionId}`;
        source = record.kind === 'skills' ? directory : `${directory}/${kitFiles[0].path}`;
        files.push(...kitFiles.map(file => ({...file, path: `${directory}/${file.path}`})));
      }
      if (changedBase) {
        fingerprint = sourceHash(JSON.stringify({files: baseInventory, linkHash: record.origin.linkHash || null}));
        baseline = `.kit-sources/baselines/${storageId}/${fingerprint}`;
        const exists = fs.existsSync(kitSourcePath(entry.scopeRoot, baseline));
        if (exists) readKitSourceSnapshot(entry.scopeRoot, baseline, baseInventory);
        files.push(...baseFiles.map(file => ({...file, path: `${baseline}/${file.path}`, reuse: exists})));
      }
    }
    const checkpointId = record.revisionId || record.fingerprint;
    const checkpointPath = `.kit-sources/revisions/${storageId}/${checkpointId}.json`;
    const content = Buffer.from(`${JSON.stringify(entry.variantId?{schemaVersion:3,subject:{assetId,variantId:entry.variantId},state:stateOf(record)}:{schemaVersion: record.schemaVersion === 3 ? 2 : 1, assetId, state: stateOf(record)})}\n`);
    files.push({path: checkpointPath, mode: 0o600, content, sha256: sourceHash(content)});
    const history = [...(record.history || []), {id: checkpointId, path: checkpointPath, sha256: sourceHash(content), at, action: kind === 'source-edit' ? 'edit' : kind === 'source-rollback' ? 'rollback' : 'refresh'}];
    const next = {...structuredClone(record), schemaVersion: binding || record.schemaVersion === 3 ? 3 : 2, source, baseline, fingerprint,
      files: baseInventory, kitFiles: kitInventory, revisionId, history};
    if (binding) next.upstream = binding; else delete next.upstream;
    if (lastCheck) next.lastCheck = lastCheck; else delete next.lastCheck;
    const doc = entry.doc;
    if(entry.updateVariantRecord)entry.updateVariantRecord(doc,next);
    else {doc.management.resources[assetId] = next;
      doc.assets[record.kind].find(asset => asset.id === assetId).source = source;}
    validateManifestDocument(doc);
    const after = entry.format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : stringify(doc);
    return remember({kind, ...entry, artifactRecord: record, files, content: after, revalidate, details, reviewHash,
      ...(record.schemaVersion !== next.schemaVersion ? {managementUpgrade: {from: record.schemaVersion, to: next.schemaVersion}} : {}),
      ...(changedBinding ? {source: {upstream: binding, originalPreserved: true}} : {}),
      manifestDiff: {before: entry.before, after},
      operations: [{operation: kind === 'source-edit' ? 'EDIT_KIT_SOURCE' : kind === 'source-rollback' ? 'RESTORE_SOURCE_REVISION' : 'REFRESH_KIT_SOURCE', assetId, originalPreserved: true},
        ...files.map(file => ({operation: file.reuse ? 'REUSE_SOURCE' : 'CREATE_SOURCE', path: file.path, sha256: file.sha256, mode: file.mode}))]});
  }
  return Object.freeze({
    planSourceFiles(input, {files, details, revalidate}) {
      const entry = current(input);
      if (input.revision !== entry.revision) fail('STALE_SOURCE_REVISION');
      return prepare(input, entry, {kind: 'source-edit', kitFiles: files, details, revalidate});
    },
    source(input) {
      const entry = current(input);
      return {assetId: input.assetId, revision: entry.revision, kind: entry.record.kind,
        ...(entry.variantId?{variantId:entry.variantId,origin:structuredClone(entry.record.origin)}:{}),
        source: entry.record.source, baseline: entry.record.baseline, sourceOnly: true,
        files: entry.kit.files.map(file => ({path: file.path, ...fileView(file)})),
        history: entry.record.history || [], lastCheck: entry.record.lastCheck || null, upstream: entry.record.upstream || null};
    },
    planSourceEdit(input) {
      const entry = current(input);
      if (input.revision !== entry.revision) fail('STALE_SOURCE_REVISION');
      if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 256 || Buffer.byteLength(JSON.stringify(input.changes)) > 2 * 1024 * 1024) fail('INVALID_SOURCE_CHANGES');
      const map = fileMap(entry.kit.files), seen = new Set();
      for (const change of input.changes) {
        if (!change || !safeResourceRelativePath(change.path) || seen.has(change.path)
          || Object.keys(change).some(key => !['path', 'text', 'mode', 'delete'].includes(key))) fail('INVALID_SOURCE_CHANGES');
        seen.add(change.path);
        if (change.delete === true) {
          if (change.text !== undefined || change.mode !== undefined || !map.has(change.path)) fail('INVALID_SOURCE_CHANGES');
          map.delete(change.path); continue;
        }
        if (change.delete !== undefined && change.delete !== false) fail('INVALID_SOURCE_CHANGES');
        const previous = map.get(change.path);
        if (change.text !== undefined && typeof change.text !== 'string' || !previous && change.text === undefined) fail('INVALID_SOURCE_TEXT');
        if (previous && utf8Text(previous.content) === null && change.text !== undefined) fail('SOURCE_BINARY_EDIT_UNSUPPORTED');
        map.set(change.path, {path: change.path, mode: change.mode ?? previous?.mode ?? 0o644,
          content: change.text === undefined ? previous.content : Buffer.from(change.text)});
      }
      const files = validateFiles([...map.values()], entry.record);
      const old = fileMap(entry.kit.files);
      const details = files.filter(file => !old.has(file.path) || file.sha256 !== old.get(file.path).sha256 || file.mode !== old.get(file.path).mode)
        .map(file => ({path: file.path, before: fileView(old.get(file.path)), after: fileView(file)}));
      for (const file of entry.kit.files) if (!map.has(file.path)) details.push({path: file.path, before: fileView(file), after: null});
      return prepare(input, entry, {kind: 'source-edit', kitFiles: files, details});
    },
    checkUpstream(input) {
      const entry = current(input);
      const unavailable = error => {
        if (['IMPORT_CANDIDATE_NOT_FOUND', 'ENOENT', 'EACCES', 'EPERM', 'IMPORT_SOURCE_UNSAFE', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_SOURCE_NOT_FOUND'].includes(error.code)) return {status: 'unavailable', code: error.code, preserved: true, sourceOnly: true};
        throw error;
      };
      const result = next => ({status: sameInventory(next.snapshot.inventory, entry.record.files) ? 'unchanged' : 'changed',
        fingerprint: next.snapshot.fingerprint, kitModified: !sameInventory(entry.kit.inventory, entry.record.files), sourceOnly: true,
        upstream: next.binding, bindingChanged: JSON.stringify(next.binding) !== JSON.stringify(entry.record.upstream || null)});
      try {
        const next = upstream(input, entry);
        return next?.then ? next.then(result).catch(unavailable) : result(next);
      } catch (error) {return unavailable(error);}
    },
    planRefresh(input) {
      const entry = current(input), next = upstream(input, entry);
      return next?.then ? next.then(value => refresh(input, entry, value)) : refresh(input, entry, next);
    },
    planSourceRollback(input) {
      const entry = {...current(input), inputAssetId: input.assetId};
      if (input.revision !== entry.revision) fail('STALE_SOURCE_REVISION');
      const item = entry.record.history?.find(item => item.id === input.checkpointId);
      if (!item) fail('SOURCE_CHECKPOINT_NOT_FOUND');
      const state = checkpoint(entry, item);
      const targetRecord = {...entry.record, ...state};
      const kit = readKitSourceSnapshot(entry.scopeRoot, sourceDirectory(targetRecord), state.kitFiles);
      const base = readKitSourceSnapshot(entry.scopeRoot, state.baseline, state.files);
      const before = fileMap(entry.kit.files), after = fileMap(kit.files);
      const details = [...new Set([...before.keys(), ...after.keys()])].sort().map(filePath => ({path: filePath,
        before: fileView(before.get(filePath)), after: fileView(after.get(filePath)), checkpointId: item.id}));
      return prepare(input, entry, {kind: 'source-rollback', kitFiles: kit.files, baseFiles: base.files, lastCheck: state.lastCheck || null,
        binding: state.upstream || null, restored: state, details, revalidate: () => checkpoint(entry, item)});
    }
  });
  function refresh(input, entry, next) {
    validateFiles(next.snapshot.files, entry.record);
    const reviewHash = sourceHash(JSON.stringify({revision: entry.revision, upstream: next.snapshot.fingerprint, binding: next.binding}));
    const resolutions = input.resolutions || {};
    if (!resolutions || typeof resolutions !== 'object' || Array.isArray(resolutions)) fail('INVALID_SOURCE_RESOLUTIONS');
    if (Object.keys(resolutions).length && input.reviewHash !== reviewHash) fail('STALE_SOURCE_REVIEW');
    const base = fileMap(entry.base.files), kit = fileMap(entry.kit.files), incoming = fileMap(next.snapshot.files);
    const paths = [...new Set([...base.keys(), ...kit.keys(), ...incoming.keys()])].sort();
    if (Object.keys(resolutions).some(key => !paths.includes(key))) fail('INVALID_SOURCE_RESOLUTIONS');
    const result = [], accepted = [], details = [], deferred = [];
    let automatic = true;
    for (const filePath of paths) {
      const b = base.get(filePath), k = kit.get(filePath), u = incoming.get(filePath);
      const merged = mergeSourceFile(b, k, u, {json: entry.record.kind === 'mcpServers' && ['json', 'json-section'].includes(entry.record.format)});
      const resolution = Object.hasOwn(resolutions, filePath) ? resolutions[filePath] : undefined;
      let file = merged.file, baseline = u;
      if (resolution !== undefined) {
        if (!resolution || typeof resolution !== 'object' || Object.keys(resolution).some(key => !['choice', 'text', 'mode'].includes(key))) fail('INVALID_SOURCE_RESOLUTIONS');
        if (['keep', 'defer'].includes(resolution.choice)) {file = k; baseline = b; deferred.push(filePath);}
        else if (resolution.choice === 'upstream') file = u;
        else if (resolution.choice === 'manual' && typeof resolution.text === 'string') {
          file = {path: filePath, content: Buffer.from(resolution.text), mode: resolution.mode ?? k?.mode ?? u?.mode ?? b?.mode ?? 0o644};
          if (file.content.length > 1024 * 1024) fail('IMPORT_SOURCE_LIMIT_EXCEEDED');
          assertImportContentSafe(file.content);
        }
        else fail('INVALID_SOURCE_RESOLUTIONS');
        if (resolution.choice !== 'manual' && (resolution.text !== undefined || resolution.mode !== undefined)) fail('INVALID_SOURCE_RESOLUTIONS');
      } else if (merged.conflict) {automatic = false; file = k; baseline = b; deferred.push(filePath);}
      if (file) result.push(digestFile(file));
      if (baseline) accepted.push(baseline);
      if (!sameInventory(b ? [b] : [], u ? [u] : []) || resolution || merged.conflict) details.push({path: filePath,
        base: fileView(b), kit: fileView(k), upstream: fileView(u), after: fileView(file && digestFile(file)),
        reason: merged.reason, conflict: merged.conflict, resolution: resolution?.choice || null});
    }
    // Immutable commits/integrity pins bind the reviewed bytes. Local installations remain mutable and are re-read at commit.
    const revalidate = next.binding ? () => {} : () => {
      if (upstream(input, entry).snapshot.fingerprint !== next.snapshot.fingerprint) fail('IMPORT_SOURCE_CHANGED');
    };
    if (!automatic) return remember({kind: 'refresh', ...entry, artifactRecord: entry.record, automatic: false, details, reviewHash,
      revalidate, operations: [{operation: 'CONFLICT', assetId: input.assetId, reason: 'SOURCE_MERGE_CONFLICT'}]});
    const unchanged = sameInventory(entry.record.files, sourceInventory(accepted)) && !deferred.length
      && sameInventory(entry.kit.inventory, sourceInventory(result));
    const repeatedCheck = entry.record.lastCheck?.fingerprint === next.snapshot.fingerprint
      && JSON.stringify(entry.record.lastCheck.deferred) === JSON.stringify(deferred);
    return prepare(input, entry, {kind: 'refresh', kitFiles: result, baseFiles: accepted, details, reviewHash, revalidate, binding: next.binding,
      lastCheck: unchanged || repeatedCheck ? entry.record.lastCheck : {fingerprint: next.snapshot.fingerprint, at: new Date(clock()).toISOString(), deferred}});
  }
}
