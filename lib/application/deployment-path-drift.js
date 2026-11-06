import path from 'node:path';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';
import {hasNativeOwnership} from '../domain/native-installation.js';
import {physicalResources} from '../domain/physical-resource.js';

function belongsTo(record, {planned, kitId, consumerId}) {
  if (hasNativeOwnership(record)) return false;
  if (record.sharedVersion) {
    const owners = record.ownership === 'structured-units' ? Object.values(record.owners || {}) : [record.shared];
    return owners.some(owner => owner?.kitId === kitId && owner.assetId === planned.assetId && owner.assetKind === planned.assetKind && owner.consumers?.includes(consumerId));
  }
  if (record.physicalVersion) return physicalResources(record).some(resource => resource.kitId === kitId && resource.assetId === planned.assetId
    && resource.assetKind === planned.assetKind && resource.scope === planned.scope
    && resource.targets.some(reader => reader.clientId === planned.clientId && reader.surface === planned.targetProfile.surface));
  if (record.clientId !== planned.clientId) return false;
  const owners = record.ownership === 'file' ? [{assetId: record.assetId, resource: record.resource}] : Object.entries(record.owners || {}).map(([assetId, owner]) => ({assetId, ...owner}));
  return owners.some(owner => owner.assetId === planned.assetId && (!owner.resource || [
    ['kitId', kitId], ['assetKind', planned.assetKind], ['scope', planned.scope], ['surface', planned.targetProfile.surface]
  ].every(([key, expected]) => owner.resource[key] === undefined || owner.resource[key] === expected)));
}

// Historical ownership is observation, never permission to write/delete an old path.
// Native installation management and explicit future path migration retain separate plans.
export function deploymentPathDriftBlocks({state, desired, targetRoot, homeDir, scope}) {
  const root = resolveForAuthorization(scope === 'global' ? homeDir : targetRoot), blocks = [];
  for (const item of desired) {
    const {planned} = item;
    if ((!planned.commonSource && !planned.resource) || !planned.target) continue;
    const target = path.resolve(root, planned.target.startsWith('~/') ? planned.target.slice(2) : planned.target);
    const previousTargets = Object.entries(state.managed).filter(([file, record]) => belongsTo(record, item)
      && (planned.assetKind === 'skills' && record.sharedVersion === 1 ? !isWithinRoot(file, target) : file !== target)).map(([file]) => file).sort();
    if (previousTargets.length) blocks.push({clientId: planned.clientId, assetId: planned.assetId, assetKind: planned.assetKind,
      surface: planned.targetProfile.surface, target, previousTargets, reason: 'RESOURCE_PATH_MIGRATION_REQUIRED'});
  }
  return blocks;
}
