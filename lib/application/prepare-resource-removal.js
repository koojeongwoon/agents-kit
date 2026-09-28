import path from 'node:path';
import {resolveForAuthorization} from '../security-boundary.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {removeOwnedMcp} from '../adapters/mcp/remove.js';
import {authorizeSharedTarget} from './shared-resource-deployment.js';

const contents = new WeakMap();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export function resourceRemovalContent(operation) {
  if (!contents.has(operation)) throw domainError('REMOVAL_CONTENT_NOT_PREPARED', 'Removal requires the original prepared operation');
  return contents.get(operation);
}

export function prepareResourceRemoval({state, targetRoot, kitId, clientId, profile, assetIds}) {
  const operations = [], blocked = [], found = new Set();
  for (const [target, record] of Object.entries(state.managed)) {
    if (record.sharedVersion || record.clientId !== clientId) continue;
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

// Compare the final ownership graph, including snapshots from prior manifests.
export function removalDependencyBlocks({state, operations, kitId, clientId, removedIds}) {
  const next = structuredClone(state.managed);
  for (const operation of operations) {
    if (operation.nextManaged) next[operation.target] = operation.nextManaged;
    else delete next[operation.target];
  }
  const blocked = [];
  const remainingIds = new Set();
  for (const record of Object.values(next)) {
    if (record.sharedVersion) {
      for (const owner of record.shared ? [record.shared] : Object.values(record.owners)) if (owner.kitId === kitId && owner.consumers.some(id => id.startsWith(`${kitId}:${clientId}:`))) remainingIds.add(owner.assetId);
    } else if (record.clientId === clientId) {
      if (record.assetId) remainingIds.add(record.assetId);
      for (const id of Object.keys(record.owners || {})) remainingIds.add(id);
    }
  }
  const deleted = removedIds.filter(id => !remainingIds.has(id));
  if (!deleted.length) return blocked;
  for (const [target, record] of Object.entries(next)) {
    const owners = record.sharedVersion ? (record.shared ? [record.shared] : Object.values(record.owners))
      : record.resource ? [record.resource] : Object.entries(record.owners || {}).map(([assetId, owner]) => owner.resource || {assetId});
    if (!record.sharedVersion && !record.resource && !record.owners && record.clientId === clientId) owners.push({assetId: record.assetId});
    for (const owner of owners) {
      const relevant = record.sharedVersion ? owner.kitId === kitId && owner.consumers.some(id => id.startsWith(`${kitId}:${clientId}:`))
        : record.clientId === clientId && (!owner.kitId || owner.kitId === kitId);
      if (!relevant) continue;
      if (!Array.isArray(owner.dependencyIds)) {
        blocked.push({target, assetId: owner.assetId, reason: 'REMOVAL_DEPENDENCIES_UNVERIFIED'});
      } else if (owner.dependencyIds.some(id => deleted.includes(id))) {
        blocked.push({target, assetId: owner.assetId, reason: 'RESOURCE_STILL_REQUIRED'});
      }
    }
  }
  return blocked;
}
