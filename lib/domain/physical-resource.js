import crypto from 'node:crypto';
import {domainError} from './errors.js';
import {mergeStructuredDocument} from './structured-merge.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CLIENT = /^[a-z][a-z0-9._-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const textMatch = (pattern, value) => typeof value === 'string' && pattern.test(value);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const fail = code => {throw domainError(code, 'Typed contributions must agree on physical store, resource identity, selectors and generated content');};
const keysOnly = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const dependenciesValid = value => Array.isArray(value) && value.length <= 64 && value.every(id => textMatch(ID, id)) && new Set(value).size === value.length;
export function physicalResourceTargets(targets) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 4096 || targets.some(target => !keysOnly(target, ['clientId', 'surface']) || !textMatch(CLIENT, target.clientId) || !textMatch(CLIENT, target.surface))) fail('INVALID_PHYSICAL_RESOURCE');
  const result = [...new Map(targets.map(target => [`${target.clientId}:${target.surface}`, {clientId: target.clientId, surface: target.surface}])).values()].sort((a, b) => `${a.clientId}:${a.surface}`.localeCompare(`${b.clientId}:${b.surface}`));
  if (result.length > 16) fail('INVALID_PHYSICAL_RESOURCE'); return result;
}
export function validPhysicalResource(resource) {
  if (!keysOnly(resource, ['version', 'kitId', 'assetId', 'assetKind', 'configStore', 'scope', 'format', 'dependencyIds', 'targets']) || resource.version !== 2
    || !textMatch(ID, resource.kitId) || !textMatch(ID, resource.assetId) || !textMatch(CLIENT, resource.configStore)
    || !['project', 'global'].includes(resource.scope) || !dependenciesValid(resource.dependencyIds)
    || !(resource.assetKind === 'agents' && ['toml', 'markdown'].includes(resource.format) || resource.assetKind === 'mcpServers' && ['json', 'toml-section'].includes(resource.format))) return false;
  try {return JSON.stringify(physicalResourceTargets(resource.targets)) === JSON.stringify(resource.targets);} catch {return false;}
}
export function physicalResources(record) {
  return record?.ownership === 'file' ? [record.resource] : Object.values(record?.owners || {}).map(owner => owner.resource);
}
export function validPhysicalResourceRecord(record) {
  if (!keysOnly(record, ['physicalVersion', 'strategy', 'ownership', 'hash', 'resource', 'owners', 'transactionId']) || record.physicalVersion !== 1 || !textMatch(HASH, record.hash)
    || record.transactionId !== undefined && (typeof record.transactionId !== 'string' || !/^tx-[A-Za-z0-9-]{1,180}$/.test(record.transactionId))) return false;
  if (record.ownership === 'file') return record.strategy === 'copy' && !record.owners && validPhysicalResource(record.resource) && record.resource.assetKind === 'agents';
  if (record.ownership !== 'structured-units' || record.strategy !== 'merge' || record.resource || !keysOnly(record.owners, Object.keys(record.owners || {})) || !Object.keys(record.owners).length) return false;
  const resources = physicalResources(record), first = resources[0]; if (resources.length > 256) return false;
  return Object.entries(record.owners).every(([id, owner]) => keysOnly(owner, ['units', 'resource']) && validPhysicalResource(owner.resource) && owner.resource.assetId === id && owner.resource.assetKind === 'mcpServers'
    && ['configStore', 'scope', 'format'].every(key => owner.resource[key] === first[key]) && keysOnly(owner.units, Object.keys(owner.units || {})) && Object.keys(owner.units).length > 0
    && Object.entries(owner.units).every(([selector, unit]) => selector.length <= 1024 && keysOnly(unit, ['hash']) && textMatch(HASH, unit.hash)
      && (owner.resource.format === 'json' ? selector.startsWith(`/mcpServers/${id}/`) : selector === `mcp_servers.${id}`)));
}

export function upgradePhysicalResource(resource) {
  if (resource?.version === 1 && !keysOnly(resource, ['version', 'kitId', 'assetId', 'assetKind', 'configStore', 'clientId', 'surface', 'scope', 'format', 'dependencyIds'])) fail('PHYSICAL_RESOURCE_OWNERSHIP_UNPROVEN');
  const next = resource?.version === 1 ? {version: 2, kitId: resource.kitId, assetId: resource.assetId, assetKind: resource.assetKind, configStore: resource.configStore,
    scope: resource.scope, format: resource.format, dependencyIds: resource.dependencyIds, targets: [{clientId: resource.clientId, surface: resource.surface}]} : structuredClone(resource);
  if (!validPhysicalResource(next)) fail('PHYSICAL_RESOURCE_OWNERSHIP_UNPROVEN');
  next.dependencyIds = [...next.dependencyIds].sort();
  return next;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Pure composition. Filesystem observation, capability checks and merge ownership
// preconditions remain in the application service on either side of this boundary.
export function composePhysicalResourceContributions(contributions) {
  if (!Array.isArray(contributions) || !contributions.length || contributions.length > 256) fail('INVALID_PHYSICAL_RESOURCE');
  const resources = new Map(), first = contributions[0];
  const store = upgradePhysicalResource(first.resource);
  for (const item of contributions) {
    const resource = upgradePhysicalResource(item.resource);
    if (['configStore', 'scope', 'format', 'assetKind'].some(key => resource[key] !== store[key]) || item.format !== store.format || item.strategy !== first.strategy
      || (resource.assetKind === 'agents' ? item.strategy !== 'copy' : item.strategy !== 'merge')) fail('PHYSICAL_RESOURCE_STORE_CONFLICT');
    if (typeof item.content !== 'string' || Buffer.byteLength(item.content) > 1024 * 1024) fail('INVALID_PHYSICAL_RESOURCE');
    const rawUnits = resource.assetKind === 'agents' ? {file: {hash: hash(item.content)}} : mergeStructuredDocument({format: resource.format, current: '', desired: item.content, assetId: resource.assetId, previousUnits: {}}).units;
    const units = Object.fromEntries(Object.entries(rawUnits).sort(([a], [b]) => a.localeCompare(b)));
    if (resource.assetKind === 'mcpServers' && Object.keys(units).some(selector => resource.format === 'json' ? !selector.startsWith(`/mcpServers/${resource.assetId}/`) : selector !== `mcp_servers.${resource.assetId}`)) fail('PHYSICAL_RESOURCE_SELECTOR_CONFLICT');
    const content = resource.format === 'json' ? `${JSON.stringify(canonical(JSON.parse(item.content)))}\n` : item.content;
    const previous = resources.get(resource.assetId);
    if (previous) {
      if (resource.kitId !== previous.resource.kitId || JSON.stringify([...resource.dependencyIds].sort()) !== JSON.stringify([...previous.resource.dependencyIds].sort())
        || JSON.stringify(units) !== JSON.stringify(previous.units)) fail('PHYSICAL_RESOURCE_CONTENT_CONFLICT');
      previous.resource.targets = physicalResourceTargets([...previous.resource.targets, ...resource.targets]);
    } else resources.set(resource.assetId, {resource, content, units});
  }
  const selected = [...resources.values()].sort((a, b) => a.resource.assetId.localeCompare(b.resource.assetId));
  if (store.assetKind === 'agents' && selected.length !== 1) fail('PHYSICAL_RESOURCE_CONTENT_CONFLICT');
  const selectors = new Set();
  for (const item of selected) for (const selector of Object.keys(item.units)) {if (selectors.has(selector)) fail('PHYSICAL_RESOURCE_SELECTOR_CONFLICT'); selectors.add(selector);}
  return {configStore: store.configStore, scope: store.scope, format: store.format, assetKind: store.assetKind, strategy: first.strategy, resources: selected,
    targets: physicalResourceTargets(selected.flatMap(item => item.resource.targets))};
}
