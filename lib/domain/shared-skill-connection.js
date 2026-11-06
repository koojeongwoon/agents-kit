import {domainError} from './errors.js';
import {validateSkillSnapshotDescriptor} from './skill-snapshot.js';
import {safeResourceRelativePath} from './resource-management.js';

const fail = code => {throw domainError(code, 'The shared Skill connection requires a reviewed plan preserving all consumers');};
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const consumer = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}:[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/.test(value);

export function validSharedSkillConnection(record) {
  if (!record || record.sharedVersion !== 2 || record.strategy !== 'snapshot-link' || record.ownership !== 'connection'
    || Object.keys(record).some(key => !['sharedVersion', 'strategy', 'ownership', 'hash', 'linkSource', 'connection', 'shared', 'transactionId'].includes(key))
    || typeof record.linkSource !== 'string' || !record.linkSource.startsWith('/') || record.hash !== `symlink:${record.linkSource}`
    || !record.connection || ![1, 2].includes(record.connection.schemaVersion) || record.connection.strategy !== 'snapshot-link'
    || Object.keys(record.connection).some(key => !['schemaVersion', 'strategy', 'snapshot', ...(record.connection.schemaVersion === 2 ? ['directoryModes'] : [])].includes(key))) return false;
  if (record.connection.schemaVersion === 2 && (!Array.isArray(record.connection.directoryModes) || !record.connection.directoryModes.length || record.connection.directoryModes.length > 512
    || record.connection.directoryModes.some(item => !item || Object.keys(item).some(key => !['path', 'mode'].includes(key)) || item.path !== '' && !safeResourceRelativePath(item.path)
      || !Number.isInteger(item.mode) || item.mode < 0 || item.mode > 0o777)
    || !record.connection.directoryModes.some(item => item.path === '')
    || new Set(record.connection.directoryModes.map(item => item.path)).size !== record.connection.directoryModes.length)) return false;
  const owner = record.shared;
  if (!owner || !ID.test(owner.kitId || '') || !ID.test(owner.assetId || '') || owner.assetKind !== 'skills'
    || Object.keys(owner).some(key => !['kitId', 'assetId', 'assetKind', 'dependencyIds', 'consumers'].includes(key))
    || !Array.isArray(owner.dependencyIds) || owner.dependencyIds.length > 64 || owner.dependencyIds.some(id => !ID.test(id))
    || !Array.isArray(owner.consumers) || !owner.consumers.length || owner.consumers.length > 16
    || owner.consumers.some(id => !consumer(id) || !id.startsWith(`${owner.kitId}:`)) || new Set(owner.consumers).size !== owner.consumers.length) return false;
  try {
    const snapshot = validateSkillSnapshotDescriptor(record.connection.snapshot);
    return record.linkSource.endsWith(`/.agents-kit/snapshots/v1/${snapshot.treeDigest}/tree`)
      && !/[\\\u0000-\u001f\u007f]/.test(record.linkSource)
      && record.linkSource.split('/').slice(1).every(part => part && part !== '.' && part !== '..');
  } catch {return false;}
}

export function planSharedSkillConnection({kitId, assetId, dependencyIds = [], consumers, snapshot, linkSource, previous, observed, remove = false}) {
  if (!ID.test(kitId || '') || !ID.test(assetId || '') || !Array.isArray(consumers) || !consumers.length
    || consumers.some(id => !consumer(id) || !id.startsWith(`${kitId}:`))) fail('INVALID_SHARED_SKILL_CONNECTION');
  if (previous && !validSharedSkillConnection(previous)) fail('SHARED_CONNECTION_MIGRATION_REQUIRED');
  if (previous && (previous.shared.kitId !== kitId || previous.shared.assetId !== assetId)) fail('SHARED_RESOURCE_CONTENT_CONFLICT');
  if (previous ? observed !== previous.hash : observed !== null) fail(previous ? 'OWNED_LINK_MODIFIED_EXTERNALLY' : 'UNKNOWN_EXISTING_CONTENT');
  const retainedSnapshots = previous ? [previous.connection.snapshot.treeDigest] : [];
  if (remove) {
    if (!previous || !previous.shared.consumers.some(id => consumers.includes(id))) fail('SHARED_RESOURCE_NOT_MANAGED');
    const remaining = previous.shared.consumers.filter(id => !consumers.includes(id));
    const nextManaged = remaining.length ? {...structuredClone(previous), shared: {...previous.shared, consumers: remaining}} : null;
    if (nextManaged) delete nextManaged.transactionId;
    return {operation: remaining.length ? 'RELEASE' : 'REMOVE_LINK', nextManaged, retainedSnapshots};
  }
  const descriptor = validateSkillSnapshotDescriptor(snapshot);
  if (typeof linkSource !== 'string' || !linkSource.startsWith('/') || /[\u0000-\u001f\u007f]/.test(linkSource)) fail('INVALID_SHARED_SKILL_CONNECTION');
  const changed = previous && (previous.connection.snapshot.treeDigest !== descriptor.treeDigest || previous.linkSource !== linkSource
    || JSON.stringify(previous.shared.dependencyIds) !== JSON.stringify(dependencyIds));
  if (changed && previous.shared.consumers.some(id => !consumers.includes(id))) fail('SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS');
  const nextManaged = {sharedVersion: 2, strategy: 'snapshot-link', ownership: 'connection', hash: `symlink:${linkSource}`, linkSource,
    connection: {schemaVersion: previous?.connection.schemaVersion === 2 ? 2 : 1, strategy: 'snapshot-link', snapshot: descriptor,
      ...(previous?.connection.schemaVersion === 2 ? {directoryModes: previous.connection.directoryModes} : {})},
    shared: {kitId, assetId, assetKind: 'skills', dependencyIds, consumers: [...new Set([...(previous?.shared.consumers || []), ...consumers])].sort()}};
  if (!validSharedSkillConnection(nextManaged)) fail('INVALID_SHARED_SKILL_CONNECTION');
  const sameConsumers = JSON.stringify(previous?.shared.consumers) === JSON.stringify(nextManaged.shared.consumers);
  return {operation: !previous ? 'LINK' : changed ? 'REPLACE_LINK' : sameConsumers ? 'SKIP' : 'REGISTER', nextManaged,
    retainedSnapshots: [...new Set([...retainedSnapshots, descriptor.treeDigest])]};
}
