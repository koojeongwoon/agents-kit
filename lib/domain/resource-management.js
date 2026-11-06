import {domainError} from './errors.js';
import {normalizeUpstreamSource, safeResourceRelativePath} from './upstream-source.js';
export {safeResourceRelativePath} from './upstream-source.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const CLIENT_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const KINDS = new Set(['instructions', 'skills', 'agents', 'mcpServers']);
const FORMATS = new Set(['directory', 'markdown', 'toml', 'toml-section', 'json', 'json-section']);
const unexpected = (value, fields) => !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key));
const REVISION = /^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));

function inventory(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 256
    && value.every(file => !unexpected(file, ['path', 'sha256', 'mode']) && safeResourceRelativePath(file.path) && HASH.test(file.sha256 || '')
      && Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777)
    && new Set(value.map(file => file.path)).size === value.length;
}

export function validSourceState(state, id) {
  if (state?.upstream !== undefined) {
    try { normalizeUpstreamSource(state.upstream); } catch { return false; }
  }
  return state && safeResourceRelativePath(state.source)
    && (state.source.startsWith(`assets/imported/${id}/`) || state.source.startsWith(`assets/revisions/${id}/`))
    && HASH.test(state.fingerprint || '') && state.baseline === `.kit-sources/baselines/${id}/${state.fingerprint}`
    && inventory(state.files) && inventory(state.kitFiles || state.files)
    && (state.revisionId === undefined || REVISION.test(state.revisionId))
    && (state.lastCheck === undefined || (!unexpected(state.lastCheck, ['fingerprint', 'at', 'deferred'])
      && HASH.test(state.lastCheck.fingerprint || '') && timestamp(state.lastCheck.at)
      && Array.isArray(state.lastCheck.deferred) && state.lastCheck.deferred.length <= 512
      && state.lastCheck.deferred.every(safeResourceRelativePath)));
}

export function normalizeResourceManagement(raw, assets, schemaVersion) {
  if (schemaVersion === 1) {
    if (raw !== undefined) throw domainError('INVALID_RESOURCE_MANAGEMENT', 'Management metadata requires Manifest schema 2');
    return undefined;
  }
  if (!raw || raw.schemaVersion !== 1 || !raw.resources || typeof raw.resources !== 'object'
    || Array.isArray(raw.resources) || Object.keys(raw).some(key => !['schemaVersion', 'resources'].includes(key))
    || Object.keys(raw.resources).length > 64) {
    throw domainError('INVALID_RESOURCE_MANAGEMENT', 'Manifest schema 2 requires versioned resource management');
  }
  const byId = new Map(Object.values(assets).flat().map(asset => [asset.id, asset]));
  const resources = {};
  for (const [id, record] of Object.entries(raw.resources)) {
    const asset = byId.get(id);
    const fields = ['schemaVersion', 'status', 'kind', 'format', 'source', 'baseline', 'fingerprint', 'origin', 'nativeId', 'files'];
    if (record?.schemaVersion >= 2) fields.push('kitFiles', 'revisionId', 'history', 'lastCheck');
    if (record?.schemaVersion === 3) fields.push('upstream');
    if (!ID.test(id) || unexpected(record, fields) || ![1, 2, 3].includes(record.schemaVersion) || !KINDS.has(record.kind)
      || !['active', 'detached'].includes(record.status) || !FORMATS.has(record.format)
      || !validSourceState(record, id) || (record.schemaVersion === 1 && !record.source.startsWith(`assets/imported/${id}/`))
      || !safeResourceRelativePath(record.baseline) || !HASH.test(record.fingerprint || '')
      || record.baseline !== `.kit-sources/baselines/${id}/${record.fingerprint}`
      || unexpected(record.origin, ['type', 'clientId', 'surface', 'scope', 'root', 'path', 'candidateId', 'linkHash']) || record.origin.type !== 'local' || !CLIENT_ID.test(record.origin.clientId || '')
      || !CLIENT_ID.test(record.origin.surface || '')
      || !['global', 'project'].includes(record.origin.scope) || !HASH.test(record.origin.candidateId || '')
      || !safeResourceRelativePath(record.origin.path) || typeof record.origin.root !== 'string'
      || (record.origin.scope === 'global' ? record.origin.root !== '~' : !record.origin.root.startsWith('/'))
      || (record.origin.linkHash !== undefined && !HASH.test(record.origin.linkHash))
      || typeof record.nativeId !== 'string' || !record.nativeId || ['.', '..'].includes(record.nativeId) || /[\\/\u0000-\u001f\u007f]/.test(record.nativeId)
      || (record.schemaVersion >= 2 && (!inventory(record.kitFiles) || !REVISION.test(record.revisionId || '')
        || !Array.isArray(record.history) || record.history.length > 1024
        || record.history.some(item => unexpected(item, ['id', 'path', 'sha256', 'at', 'action']) || !REVISION.test(item.id || '')
          || item.path !== `.kit-sources/revisions/${id}/${item.id}.json` || !HASH.test(item.sha256 || '')
          || !timestamp(item.at) || !['import', 'edit', 'refresh', 'rollback'].includes(item.action))
        || new Set(record.history.map(item => item.id)).size !== record.history.length))
      || (record.status === 'active' ? !asset || asset.kind !== record.kind || asset.source !== record.source : !!asset)) {
      throw domainError('INVALID_RESOURCE_MANAGEMENT', 'Imported resource metadata is malformed', {assetId: id});
    }
    resources[id] = Object.freeze(structuredClone(record));
  }
  return Object.freeze({schemaVersion: 1, resources: Object.freeze(resources)});
}
