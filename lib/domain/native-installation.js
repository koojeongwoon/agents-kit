import path from 'node:path';
import {safeResourceRelativePath} from './resource-management.js';

const HASH = /^[a-f0-9]{64}$/;
export const hasNativeOwnership = record => !!record?.nativeSource || Object.values(record?.owners || {}).some(owner => owner?.nativeSource);
export function validNativeOwner(owner) {
  return owner?.schemaVersion === 1 && Object.keys(owner).every(key => ['schemaVersion', 'kitId', 'assetId', 'kind', 'clientId', 'configStore', 'surface', 'nativeId', 'scope', 'format', 'sourceRoot', 'targetBase', 'relative', 'revisionId', 'dependencyIds', 'lastApplied'].includes(key))
    && /^[a-z0-9][a-z0-9-]{0,63}$/.test(owner.kitId || '')
    && /^[a-z0-9][a-z0-9-]{0,63}$/.test(owner.assetId || '')
    && ['instructions', 'skills', 'agents', 'mcpServers'].includes(owner.kind)
    && typeof owner.clientId === 'string' && typeof owner.configStore === 'string'
    && typeof owner.nativeId === 'string' && !/[\\/\u0000-\u001f]/.test(owner.nativeId) && !['.', '..'].includes(owner.nativeId)
    && ['global', 'project'].includes(owner.scope) && path.isAbsolute(owner.sourceRoot || '') && path.isAbsolute(owner.targetBase || '')
    && safeResourceRelativePath(owner.relative) && typeof owner.revisionId === 'string'
    && safeResourceRelativePath(owner.lastApplied?.directory)
    && (owner.lastApplied.directory === `assets/imported/${owner.assetId}` || [`.kit-sources/baselines/${owner.assetId}/`, `assets/imported/${owner.assetId}/`, `assets/revisions/${owner.assetId}/`].some(prefix => owner.lastApplied.directory.startsWith(prefix)))
    && safeResourceRelativePath(owner.lastApplied.file?.path) && HASH.test(owner.lastApplied.file.sha256 || '')
    && owner.lastApplied.file.path === owner.relative
    && Number.isInteger(owner.lastApplied.file.mode) && owner.lastApplied.file.mode >= 0 && owner.lastApplied.file.mode <= 0o777
    && Array.isArray(owner.dependencyIds) && owner.dependencyIds.every(id => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id));
}
