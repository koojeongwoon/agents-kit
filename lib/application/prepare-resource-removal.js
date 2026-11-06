import path from 'node:path';
import {resolveForAuthorization} from '../security-boundary.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {removeOwnedMcp} from '../adapters/mcp/remove.js';
import {authorizeSharedTarget} from './shared-resource-deployment.js';
import {physicalResources, physicalResourceTargets} from '../domain/physical-resource.js';
import {installationDigest} from '../domain/installation-receipt.js';

const contents = new WeakMap();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export function resourceRemovalContent(operation) {
  if (!contents.has(operation)) throw domainError('REMOVAL_CONTENT_NOT_PREPARED', 'Removal requires the original prepared operation');
  return contents.get(operation);
}

export function prepareResourceRemoval({state, targetRoot, kitId, clientId, profile, assetIds,backupStore}) {
  const {operations, blocked, found} = preparePhysicalRemoval({state, targetRoot, kitId, clientId, profile, assetIds,backupStore});
  for (const [target, record] of Object.entries(state.managed)) {
    if (record.physicalVersion || record.sharedVersion || record.clientId !== clientId) continue;
    const owned = record.ownership === 'file' ? [{assetId: record.assetId, resource: record.resource}]
      : Object.entries(record.owners || {}).map(([assetId, owner]) => ({assetId, ...owner}));
    const selected = owned.filter(owner => assetIds.includes(owner.assetId));
    if (!selected.length) continue;
    selected.forEach(owner => found.add(owner.assetId));
    try {
      authorizeSharedTarget(target, targetRoot);
      if (!fs.lstatSync(target).isFile()) throw domainError('RESOURCE_REMOVAL_TARGET_NOT_FILE', 'Managed target must be a regular file');
      let content = fs.readFileSync(target), beforeHash = hash(content);
      let nextManaged = structuredClone(record); delete nextManaged.transactionId;
      for (const owner of selected) {
        const resource = owner.resource;
        if (!resource || resource.version !== 1 || resource.kitId !== kitId || resource.clientId !== clientId
          || resource.assetId !== owner.assetId || resource.configStore !== profile.configStore
          || !['agents', 'mcpServers'].includes(resource.assetKind)) {
          throw domainError('RESOURCE_REMOVAL_OWNERSHIP_UNPROVEN', 'Typed resource identity must be recorded by this Kit before removal');
        }
        const capability = profile.capabilities.find(item => item.assetKind === (resource.assetKind === 'mcpServers' ? 'mcp' : 'agents') && item.scope === resource.scope);
        const template = capability?.path?.replaceAll('{assetId}', owner.assetId);
        const mappedTarget = template && path.resolve(resolveForAuthorization(targetRoot), template.startsWith('~/') ? template.slice(2) : template);
        if (!capability || !['stable', 'version-dependent'].includes(capability.status) || capability.evidence?.state !== 'verified'
          || capability.format !== resource.format || mappedTarget !== target) {
          throw domainError('RESOURCE_REMOVAL_PROFILE_UNSUPPORTED', 'Selected client surface cannot manage this recorded resource path');
        }
        if (resource.assetKind === 'agents') {
          if (record.strategy !== 'copy' || record.ownership !== 'file' || beforeHash !== record.hash) throw domainError('OWNED_CONTENT_MODIFIED_EXTERNALLY', 'Managed Agent file was changed');
          content = null; nextManaged = null;
        } else {
          if (record.strategy !== 'merge' || record.ownership !== 'structured-units') throw domainError('RESOURCE_REMOVAL_OWNERSHIP_UNPROVEN', 'MCP structured ownership is required');
          // Any overlapping owner makes exclusive removal unprovable.
          const selectors = Object.keys(owner.units || {});
          if (Object.entries(record.owners).some(([id, other]) => id !== owner.assetId && Object.keys(other.units || {}).some(selector => selectors.includes(selector)))) {
            throw domainError('RESOURCE_REMOVAL_OWNERSHIP_CONFLICT', 'MCP selectors overlap another owner');
          }
          const text = content.toString('utf8');
          if (!Buffer.from(text, 'utf8').equals(content)) throw domainError('RESOURCE_REMOVAL_INVALID_UTF8', 'MCP target must be valid UTF-8');
          content = Buffer.from(removeOwnedMcp({current: text, assetId: owner.assetId, format: resource.format, units: owner.units || {}}));
          delete nextManaged.owners[owner.assetId];
        }
      }
      if (nextManaged?.owners && !Object.keys(nextManaged.owners).length) nextManaged = null;
      if(!nextManaged&&content!==null)content=originalUnownedContent({state,record,target,beforeHash,content,format:selected[0].resource.format,backupStore});
      if (nextManaged) nextManaged.hash = hash(content);
      const operation = Object.freeze({clientId, assetId: selected.map(owner => owner.assetId).join(','),
        assetKind: selected.map(owner => owner.resource.assetKind).join(','), format: selected[0].resource.format, ownership: record.ownership, strategy: 'resource-removal',
        operation: content === null ? 'REMOVE' : 'REMOVE_UNITS', reason: 'OWNED_RESOURCE_REMOVAL', target,
        beforeHash, expectedHash: content === null ? null : hash(content), nextManaged, authorizedRoot: targetRoot,
        changes: selected.map(owner => ({assetId: owner.assetId, selectors: Object.keys(owner.units || {})}))});
      if (content !== null) contents.set(operation, content);
      operations.push(operation);
    } catch (error) {
      if (error.code === 'ENOENT') blocked.push({target, reason: 'RESOURCE_REMOVAL_TARGET_MISSING'});
      else if (error.name === 'DomainError') blocked.push({target, reason: error.code});
      else throw error;
    }
  }
  return {operations, blocked, found};
}

function originalUnownedContent({state,record,target,beforeHash,content,format,backupStore}) {
  if(!backupStore||record.hash!==beforeHash)return content;
  const transaction=state.transactions.find(item=>item.id===record.transactionId&&item.type==='apply'&&item.status==='committed'),original=transaction?.operations?.find(item=>item.target===target&&item.afterHash===beforeHash);
  if(original?.previousManaged!==null||original.backup?.kind!=='file')return content;
  try {
    const candidate=backupStore.read(original.backup);if(hash(candidate)!==original.beforeHash)return content;
    // Only presentation may differ. The exact current file also has to match
    // its first installation, so later user edits are never replaced by history.
    const same=content.toString('utf8').trimEnd()===candidate.toString('utf8').trimEnd()
      ||['json','json-section'].includes(format)&&installationDigest(JSON.parse(content))===installationDigest(JSON.parse(candidate));
    return same?candidate:content;
  }catch{return content;}
}

function preparePhysicalRemoval({state, targetRoot, kitId, clientId, profile, assetIds,backupStore}) {
  const operations = [], blocked = [], found = new Set();
  for (const [target, record] of Object.entries(state.managed)) {
    if (record.physicalVersion !== 1) continue;
    const selected = physicalResources(record).filter(resource => assetIds.includes(resource.assetId) && resource.targets.some(reader => reader.clientId === clientId));
    if (!selected.length) continue;
    for (const resource of selected) found.add(resource.assetId);
    try {
      authorizeSharedTarget(target, targetRoot);
      const stat = fs.lstatSync(target); if (!stat.isFile()) throw domainError('RESOURCE_REMOVAL_TARGET_NOT_FILE', 'Physical settings must remain a regular file');
      let content = fs.readFileSync(target); const beforeHash = hash(content), beforeMode = stat.mode & 0o777;
      let nextManaged = structuredClone(record); delete nextManaged.transactionId;
      for (const resource of selected) {
        if (resource.kitId !== kitId || resource.configStore !== profile.configStore) throw domainError('RESOURCE_REMOVAL_OWNERSHIP_UNPROVEN', 'The selected Kit and client store must match recorded ownership');
        const capability = profile.capabilities.find(item => item.assetKind === (resource.assetKind === 'mcpServers' ? 'mcp' : 'agents') && item.scope === resource.scope);
        const template = capability?.path?.replaceAll('{assetId}', resource.assetId), mapped = template && path.resolve(targetRoot, template.startsWith('~/') ? template.slice(2) : template);
        if (!capability || !['stable', 'version-dependent'].includes(capability.status) || capability.evidence?.state !== 'verified' || capability.format !== resource.format || mapped !== target) throw domainError('RESOURCE_REMOVAL_PROFILE_UNSUPPORTED', 'Selected surface cannot manage the recorded physical resource path');
        if (resource.assetKind === 'agents') {
          if (record.ownership !== 'file' || record.hash !== beforeHash) throw domainError('OWNED_CONTENT_MODIFIED_EXTERNALLY', 'Physical Agent file was edited');
          content = null; nextManaged = null;
        } else {
          const owner = record.owners[resource.assetId], selectors = Object.keys(owner.units);
          if (Object.entries(record.owners).some(([id, other]) => id !== resource.assetId && Object.keys(other.units).some(selector => selectors.includes(selector)))) throw domainError('RESOURCE_REMOVAL_OWNERSHIP_CONFLICT', 'Physical MCP selectors overlap');
          const text = content.toString('utf8'); if (!Buffer.from(text).equals(content)) throw domainError('RESOURCE_REMOVAL_INVALID_UTF8', 'Physical MCP settings must remain valid UTF-8');
          content = Buffer.from(removeOwnedMcp({current: text, assetId: resource.assetId, format: resource.format, units: owner.units})); delete nextManaged.owners[resource.assetId];
        }
      }
      if (nextManaged?.owners && !Object.keys(nextManaged.owners).length) nextManaged = null;
      if(!nextManaged&&content!==null)content=originalUnownedContent({state,record,target,beforeHash,content,format:selected[0].format,backupStore});
      if (nextManaged) nextManaged.hash = hash(content);
      const operation = Object.freeze({clientId, assetId: selected.map(resource => resource.assetId).join(','), assetKind: selected[0].assetKind, format: selected[0].format,
        strategy: 'resource-removal', ownership: record.ownership, operation: content === null ? 'REMOVE' : 'REMOVE_UNITS', reason: 'OWNED_PHYSICAL_RESOURCE_REMOVAL', target,
        beforeHash, expectedHash: content === null ? null : hash(content), nextManaged, authorizedRoot: targetRoot,
        modeAware: true, beforeMode, afterMode: content === null ? null : beforeMode, configStore: selected[0].configStore, storeEffect: 'configuration', affectedTargets: physicalResourceTargets(selected.flatMap(resource => resource.targets)),
        changes: selected.map(resource => ({assetId: resource.assetId, selectors: Object.keys(record.owners?.[resource.assetId]?.units || {})}))});
      if (content !== null) contents.set(operation, content); operations.push(operation);
    } catch (error) {
      if (error.code === 'ENOENT') blocked.push({target, reason: 'RESOURCE_REMOVAL_TARGET_MISSING'});
      else if (error.name === 'DomainError') blocked.push({target, reason: error.code});
      else throw error;
    }
  }
  return {operations, blocked, found};
}

// Compare the final ownership graph, including snapshots from prior manifests.
export function removalDependencyBlocks({state, operations, kitId, clientId, removedIds}) {
  const next = structuredClone(state.managed);
  for (const operation of operations) {
    if (operation.nextManaged) next[operation.target] = operation.nextManaged;
    else delete next[operation.target];
  }
  const affectedClients = new Set([clientId]);
  for (const operation of operations) {
    const previous = state.managed[operation.target];
    if (previous?.physicalVersion === 1) for (const resource of physicalResources(previous)) if (resource.kitId === kitId && removedIds.includes(resource.assetId)) {
      for (const reader of resource.targets) affectedClients.add(reader.clientId);
    }
  }
  const owners = Object.entries(next).flatMap(([target, record]) => ownershipGraph(record).map(owner => ({target, ...owner})));
  const blocked = new Map();
  for (const affectedClient of affectedClients) {
    const relevant = owners.filter(owner => (!owner.kitId || owner.kitId === kitId) && owner.clientIds.includes(affectedClient));
    const remainingIds = new Set(relevant.map(owner => owner.assetId)), deleted = removedIds.filter(id => !remainingIds.has(id));
    if (!deleted.length) continue;
    for (const owner of relevant) {
      const reason = !Array.isArray(owner.dependencyIds) ? 'REMOVAL_DEPENDENCIES_UNVERIFIED' : owner.dependencyIds.some(id => deleted.includes(id)) ? 'RESOURCE_STILL_REQUIRED' : null;
      if (reason) blocked.set(`${owner.target}:${owner.assetId}:${reason}`, {target: owner.target, assetId: owner.assetId, reason});
    }
  }
  return [...blocked.values()];
}

function ownershipGraph(record) {
  if (record.physicalVersion === 1) return physicalResources(record).map(resource => ({...resource, clientIds: resource.targets.map(target => target.clientId)}));
  if (record.sharedVersion) return (record.shared ? [record.shared] : Object.values(record.owners)).map(owner => ({...owner, clientIds: owner.consumers.map(id => id.split(':')[1])}));
  const owners = record.resource ? [record.resource] : record.nativeSource ? [record.nativeSource]
    : record.owners ? Object.entries(record.owners).map(([assetId, owner]) => owner.resource || owner.nativeSource || {assetId}) : [{assetId: record.assetId}];
  return owners.map(owner => ({...owner, clientIds: [record.clientId]}));
}
