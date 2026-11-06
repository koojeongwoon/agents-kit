import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {isWithinRoot} from '../security-boundary.js';
import {createSkillSnapshotDescriptor} from '../domain/skill-snapshot.js';

const fail = code => {throw domainError(code, 'Skill strategy migration requires the exact owned tree and every recorded consumer');};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function inspectOwnedSkillCopy({state, target, image, kitId, assetId, consumers}) {
  if (image.kind !== 'directory') fail('SHARED_CONNECTION_MIGRATION_REQUIRED');
  const managedBefore = Object.fromEntries(Object.entries(state.managed).filter(([name]) => isWithinRoot(name, target)));
  const files = image.entries.filter(entry => entry.kind === 'file'), requiredDirectories = new Set(['']);
  if (!files.length) fail('SHARED_MIGRATION_OWNERSHIP_UNPROVEN');
  const seen = new Set();
  for (const file of files) {
    const location = path.join(target, file.path), record = managedBefore[location], owner = record?.shared;
    if (!record || record.sharedVersion !== 1 || record.strategy !== 'copy' || record.ownership !== 'file') fail('UNKNOWN_EXISTING_CONTENT');
    if (owner?.kitId !== kitId || owner.assetId !== assetId || owner.assetKind !== 'skills' || !Array.isArray(owner.dependencyIds)) fail('SHARED_MIGRATION_OWNERSHIP_UNPROVEN');
    if (record.hash !== hash(Buffer.from(file.content, 'base64'))) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY');
    if (owner.consumers.some(id => !consumers.includes(id))) fail('SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS');
    seen.add(location);
    const parts = file.path.split('/'); for (let index = 1; index < parts.length; index++) requiredDirectories.add(parts.slice(0, index).join('/'));
  }
  if (Object.keys(managedBefore).some(name => !seen.has(name))) fail('OWNED_CONTENT_MODIFIED_EXTERNALLY');
  if (image.entries.some(entry => entry.kind === 'directory' && !requiredDirectories.has(entry.path))) fail('UNKNOWN_EXISTING_CONTENT');
  const descriptor = createSkillSnapshotDescriptor(files.map(file => {const bytes = Buffer.from(file.content, 'base64'); return {path: file.path, mode: file.mode, bytes: bytes.length, sha256: hash(bytes)};}));
  return {managedBefore, descriptor, directoryModes: image.entries.filter(entry => entry.kind === 'directory').map(({path, mode}) => ({path, mode}))};
}
export function snapshotCopyImage(snapshot, directoryModes = []) {
  const modes = new Map(directoryModes.map(item => [item.path, item.mode])), directories = new Set(['']);
  for (const file of snapshot.files) {const parts = file.path.split('/'); for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'));}
  return {kind: 'directory', entries: [...[...directories].map(name => ({path: name, kind: 'directory', mode: modes.get(name) ?? 0o755})),
    ...snapshot.files.map(file => ({path: file.path, kind: 'file', mode: file.mode, content: file.content.toString('base64')}))]
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)};
}
export function snapshotCopyOwnership({snapshot, target, kitId, assetId, dependencyIds, consumers}) {
  return Object.fromEntries(snapshot.descriptor.files.map(file => [path.join(target, file.path), {sharedVersion: 1, strategy: 'copy', ownership: 'file', hash: file.sha256,
    shared: {kitId, assetId, assetKind: 'skills', dependencyIds, consumers: [...new Set(consumers)].sort()}}]));
}
