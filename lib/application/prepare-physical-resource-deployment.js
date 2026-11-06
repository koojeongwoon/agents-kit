import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {composePhysicalResourceContributions, physicalResources, physicalResourceTargets, upgradePhysicalResource, validPhysicalResourceRecord} from '../domain/physical-resource.js';
import {mergeStructuredDocument} from '../domain/structured-merge.js';
import {hasNativeOwnership} from '../domain/native-installation.js';
import {authorizeSharedTarget} from './shared-resource-deployment.js';
import {mcpMergeBlockReason} from './mcp-merge-guard.js';
import {resolveForAuthorization, isWithinRoot} from '../security-boundary.js';

const contents = new WeakMap(), hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => {throw domainError(code, 'Physical resource deployment requires proven ownership and compatible generated contributions');};
export function physicalResourceContent(operation) {
  if (!contents.has(operation)) fail('PHYSICAL_RESOURCE_NOT_PREPARED'); return contents.get(operation);
}
function readTarget(target, root) {
  authorizeSharedTarget(target, root);
  try {
    const stat = fs.lstatSync(target); if (!stat.isFile()) fail('PHYSICAL_RESOURCE_TARGET_NOT_FILE');
    const bytes = fs.readFileSync(target), text = bytes.toString('utf8'); if (!Buffer.from(text).equals(bytes)) fail('PHYSICAL_RESOURCE_TARGET_INVALID_UTF8');
    return {content: text, hash: hash(bytes), mode: stat.mode & 0o777};
  } catch (error) {if (error.code === 'ENOENT') return {content: '', hash: null, mode: null}; throw error;}
}
function existingRecord(record, composition) {
  if (!record) return null;
  if (hasNativeOwnership(record)) fail('NATIVE_OWNERSHIP_CONFLICT');
  if (record.sharedVersion || record.physicalVersion !== undefined && record.physicalVersion !== 1) fail('RESOURCE_OWNERSHIP_CONFLICT');
  if (record.physicalVersion === 1) {if (!validPhysicalResourceRecord(record)) fail('PHYSICAL_RESOURCE_OWNERSHIP_UNPROVEN'); return structuredClone(record);}
  const next = {physicalVersion: 1, strategy: record.strategy, ownership: record.ownership, hash: record.hash};
  const upgrade = resource => {
    if (resource?.version !== 1 || resource.clientId !== record.clientId) fail('PHYSICAL_RESOURCE_OWNERSHIP_UNPROVEN');
    return upgradePhysicalResource(resource);
  };
  if (record.ownership === 'file') next.resource = upgrade(record.resource);
  else if (record.ownership === 'structured-units') next.owners = Object.fromEntries(Object.entries(record.owners || {}).map(([id, owner]) => [id, {units: owner.units, resource: upgrade(owner.resource)}]));
  if (!validPhysicalResourceRecord(next)) fail('PHYSICAL_RESOURCE_OWNERSHIP_UNPROVEN');
  // A new reader cannot infer ownership from an unrelated legacy client's record.
  if (!composition.targets.some(target => target.clientId === record.clientId)) fail('PHYSICAL_RESOURCE_OWNERSHIP_UNPROVEN');
  return next;
}
function prepareGroup(items, {state, targetRoot, sourceRoot}) {
  const first = items[0], target = first.target;
  if (['.agent-kit', '.agents-kit'].some(name => isWithinRoot(target, path.join(resolveForAuthorization(targetRoot), name)))
    || sourceRoot && isWithinRoot(target, resolveForAuthorization(sourceRoot))) fail('DEPLOYMENT_TARGET_OUTSIDE_SCOPE');
  if (items.some(item => item.planned.format !== item.planned.rendered.format)) fail('PHYSICAL_RESOURCE_STORE_CONFLICT');
  const composition = composePhysicalResourceContributions(items.map(({planned}) => ({resource: planned.resource, content: planned.rendered.content, format: planned.rendered.format, strategy: planned.strategy})));
  const before = readTarget(target, targetRoot), old = state.managed[target], previous = existingRecord(old, composition);
  if (previous && physicalResources(previous).some(resource => ['configStore', 'scope', 'format', 'assetKind'].some(key => resource[key] !== composition[key]))) fail('PHYSICAL_RESOURCE_STORE_CONFLICT');
  let content = before.content, nextManaged;
  const changes = [];
  if (composition.assetKind === 'agents') {
    const item = composition.resources[0];
    if (before.hash !== null && !previous) fail('UNKNOWN_EXISTING_CONTENT');
    if (previous && (previous.ownership !== 'file' || previous.hash !== before.hash)) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY');
    if (previous && ['kitId', 'assetId', 'assetKind'].some(key => previous.resource[key] !== item.resource[key])) fail('RESOURCE_OWNERSHIP_CONFLICT');
    const resource = {...item.resource, targets: physicalResourceTargets([...(previous?.resource.targets || []), ...item.resource.targets])};
    content = item.content; nextManaged = {physicalVersion: 1, strategy: 'copy', ownership: 'file', hash: hash(content), resource};
    changes.push({assetId: resource.assetId, selector: 'file', desiredHash: nextManaged.hash});
  } else {
    if (previous && previous.ownership !== 'structured-units') fail('RESOURCE_OWNERSHIP_CONFLICT');
    const owners = structuredClone(previous?.owners || {});
    for (const item of composition.resources) {
      const assetId = item.resource.assetId, owner = owners[assetId];
      if (owner && owner.resource.kitId !== item.resource.kitId) fail('RESOURCE_OWNERSHIP_CONFLICT');
      const guard = mcpMergeBlockReason({planned: {assetId, format: composition.format, rendered: {content: item.content}}, current: content, previousUnits: owner?.units || {}});
      if (guard) fail(guard);
      const merged = mergeStructuredDocument({format: composition.format, current: content, desired: item.content, assetId, previousUnits: owner?.units || {}});
      if (merged.conflicts.length) fail(merged.conflicts[0].reason);
      if (Object.entries(owners).some(([id, other]) => id !== assetId && Object.keys(other.units).some(selector => Object.hasOwn(merged.units, selector)))) fail('PHYSICAL_RESOURCE_SELECTOR_CONFLICT');
      owners[assetId] = {units: merged.units, resource: {...item.resource, targets: physicalResourceTargets([...(owner?.resource.targets || []), ...item.resource.targets])}};
      content = merged.content; changes.push(...Object.entries(merged.units).map(([selector, unit]) => ({assetId, selector, desiredHash: unit.hash})));
    }
    nextManaged = {physicalVersion: 1, strategy: 'merge', ownership: 'structured-units', hash: hash(content), owners};
  }
  if (!validPhysicalResourceRecord(nextManaged)) fail('INVALID_PHYSICAL_RESOURCE');
  const previousComparable = structuredClone(old); if (previousComparable) delete previousComparable.transactionId;
  const metadataOnly = before.hash === nextManaged.hash;
  const operation = Object.freeze({clientId: first.planned.clientId, assetId: composition.resources.map(item => item.resource.assetId).join(','), assetKind: composition.assetKind,
    target, strategy: 'physical-resource', ownership: nextManaged.ownership, format: composition.format, operation: metadataOnly ? JSON.stringify(previousComparable) === JSON.stringify(nextManaged) ? 'SKIP' : 'REGISTER' : before.hash === null ? 'CREATE' : 'UPDATE',
    reason: 'PHYSICAL_RESOURCE_COMPOSED', beforeHash: before.hash, expectedHash: nextManaged.hash, nextManaged,
    modeAware: true, beforeMode: before.mode, afterMode: before.mode ?? 0o644, metadataOnly, authorizedRoot: resolveForAuthorization(targetRoot),
    changes, configStore: composition.configStore, storeEffect: 'configuration', affectedTargets: physicalResourceTargets(physicalResources(nextManaged).flatMap(resource => resource.targets))});
  contents.set(operation, Buffer.from(content)); return operation;
}

// Select only multi-reader groups or records that already use physical ownership.
// Ordinary single-client typed deployment keeps its v1 ownership compatibility.
export function preparePhysicalResourceDeployment({contributions, state, targetRoot, homeDir, scope, sourceRoot}) {
  const groups = new Map(), operations = [], blocked = [], handled = new Set();
  for (const planned of contributions) {
    const root = resolveForAuthorization(scope === 'global' ? homeDir : targetRoot);
    const target = path.resolve(root, planned.target.startsWith('~/') ? planned.target.slice(2) : planned.target);
    if (!groups.has(target)) groups.set(target, []); groups.get(target).push({planned, target});
  }
  for (const [target, items] of groups) {
    if (new Set(items.map(({planned}) => `${planned.clientId}:${planned.resource.surface}`)).size < 2 && !state.managed[target]?.physicalVersion) continue;
    for (const {planned} of items) handled.add(planned);
    try {operations.push(prepareGroup(items, {state, targetRoot, sourceRoot}));}
    catch (error) {if (error.name !== 'DomainError') throw error; blocked.push({target, assetId: items.map(item => item.planned.assetId).join(','), reason: error.code});}
  }
  return {operations, blocked, handled};
}
