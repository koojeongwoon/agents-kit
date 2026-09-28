import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {mergeStructuredDocument} from '../domain/structured-merge.js';
import {isWithinRoot, resolveForAuthorization} from '../security-boundary.js';

const contents = new WeakMap();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const deploymentStateHash = state => hash(JSON.stringify(state));
export const sharedConsumerId = (kitId, clientId, surface) => `${kitId}:${clientId}:${surface || 'default'}`;

export function authorizeSharedTarget(target, root) {
  const authorizedRoot = resolveForAuthorization(root);
  const authorized = resolveForAuthorization(target);
  if (authorized !== path.resolve(target) || !isWithinRoot(authorized, authorizedRoot) || authorized === authorizedRoot) {
    throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Shared target is outside its original scope');
  }
  return authorized;
}

function observe(target, root) {
  authorizeSharedTarget(target, root);
  try {
    if (!fs.lstatSync(target).isFile()) throw domainError('SHARED_TARGET_NOT_FILE', 'Shared target must be a regular file');
    const content = fs.readFileSync(target);
    return {content, hash: hash(content)};
  } catch (error) {
    if (error.code === 'ENOENT') return {content: Buffer.alloc(0), hash: null};
    throw error;
  }
}

function files(source, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(source, relative), {withFileTypes: true})) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...files(source, name));
    else if (entry.isFile()) result.push(name);
    else throw domainError('COMMON_SKILL_UNSAFE_ENTRY', 'Shared bundles cannot contain links or special files');
  }
  return result.sort();
}

function blockParts(content, assetId) {
  const start = `<!-- agents-kit:${assetId}:start -->`;
  const end = `<!-- agents-kit:${assetId}:end -->`;
  if (content.split(start).length !== 2 || content.split(end).length !== 2) {
    throw domainError('SHARED_BLOCK_MODIFIED', 'Shared instruction markers are missing or duplicated');
  }
  const from = content.indexOf(start), to = content.indexOf(end) + end.length;
  if (to <= from) throw domainError('SHARED_BLOCK_MODIFIED', 'Shared instruction markers are malformed');
  return {from, to, text: content.slice(from, to)};
}

function assertOwner(owner, context) {
  if (!owner || owner.kitId !== context.kitId || owner.assetId !== context.assetId
    || !Array.isArray(owner.consumers) || !owner.consumers.length) {
    throw domainError('SHARED_OWNERSHIP_MIGRATION_REQUIRED', 'Existing ownership requires an explicit migration');
  }
}

function preparedOperation({target, before, content, nextManaged, context, targetRoot, operation, reason}) {
  const expectedHash = content === null ? null : hash(content);
  const metadataOnly = before.hash === expectedHash;
  const entry = Object.freeze({
    clientId: context.clientId, assetId: context.assetId, assetKind: context.assetKind,
    target, strategy: 'shared', format: context.assetKind === 'instructions' ? 'markdown' : 'file',
    ownership: context.assetKind === 'instructions' ? 'structured-units' : 'file',
    operation, reason, beforeHash: before.hash, expectedHash,
    nextManaged, metadataOnly, authorizedRoot: resolveForAuthorization(targetRoot),
    consumers: nextManaged?.shared?.consumers || [...new Set(Object.values(nextManaged?.owners || {}).flatMap(owner => owner.consumers || []))].sort()
  });
  if (content !== null) contents.set(entry, content);
  return entry;
}

export function contentForSharedOperation(operation) {
  if (!contents.has(operation)) throw domainError('SHARED_CONTENT_NOT_PREPARED', 'Shared content requires its original prepared operation');
  return contents.get(operation);
}

// A single transaction coalesces common source contributions from all requested clients.
export function prepareSharedDeployment({contributions, state, targetRoot, scope, homeDir = targetRoot}) {
  const operations = [], blocked = [], groups = new Map(), desiredTargets = new Set();
  const resources = new Map();
  for (const contribution of contributions) {
    const {planned, source, kitId, consumerId} = contribution;
    const context = {...planned, kitId, consumerId};
    const base = sharedTargetBase(planned.target, {scope, targetRoot, homeDir});
    context.targetBase = base;
    const entries = planned.assetKind === 'skills' ? files(source) : [''];
    const resourceKey = `${kitId}:${planned.assetId}`;
    if (!resources.has(resourceKey)) resources.set(resourceKey, []);
    resources.get(resourceKey).push(context);
    for (const relative of entries) {
      const target = relative ? path.join(base, relative) : base;
      const content = fs.readFileSync(relative ? path.join(source, relative) : source);
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push({context, content});
      desiredTargets.add(`${resourceKey}:${target}`);
    }
  }
  for (const [target, items] of groups) {
    const context = items[0].context;
    try {
      const before = observe(target, targetRoot);
      const managed = state.managed[target];
      if (managed && managed.sharedVersion !== 1) throw domainError('SHARED_OWNERSHIP_MIGRATION_REQUIRED', 'Existing ownership requires an explicit migration');
      if (items.some(item => item.context.assetKind !== context.assetKind)) throw domainError('SHARED_RESOURCE_CONTENT_CONFLICT', 'Incompatible resources share a path');
      let content = before.content;
      let nextManaged;
      if (context.assetKind === 'skills') {
        if (items.some(item => item.context.kitId !== context.kitId || item.context.assetId !== context.assetId || !item.content.equals(items[0].content))) {
          throw domainError('SHARED_RESOURCE_CONTENT_CONFLICT', 'Shared consumers require identical resources');
        }
        if (before.hash !== null && !managed) throw domainError('UNKNOWN_EXISTING_CONTENT', 'Shared deployment cannot adopt unmanaged content');
        const owner = managed?.shared;
        if (managed) {
          assertOwner(owner, context);
          if (managed.hash !== before.hash) throw domainError('OWNED_CONTENT_MODIFIED_EXTERNALLY', 'Shared file was modified externally');
        }
        const requested = items.map(item => item.context.consumerId);
        const bundleConsumers = Object.entries(state.managed).filter(([file, record]) => isWithinRoot(file, context.targetBase) && record.sharedVersion === 1
          && record.shared?.kitId === context.kitId && record.shared?.assetId === context.assetId)
          .flatMap(([, record]) => record.shared.consumers);
        if ((before.hash !== hash(items[0].content) || JSON.stringify(owner?.dependencyIds || []) !== JSON.stringify(context.dependencyIds || [])) && bundleConsumers.some(id => !requested.includes(id))) {
          throw domainError('SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS', 'All recorded consumers must participate in a shared update');
        }
        content = items[0].content;
        nextManaged = {sharedVersion: 1, strategy: 'copy', ownership: 'file', hash: hash(content),
          shared: {kitId: context.kitId, assetId: context.assetId, assetKind: 'skills', dependencyIds: context.dependencyIds || [], consumers: [...new Set([...(owner?.consumers || []), ...requested])].sort()}};
      } else {
        if (managed && managed.ownership !== 'structured-units') throw domainError('SHARED_RESOURCE_CONTENT_CONFLICT', 'Target ownership strategy differs');
        const owners = structuredClone(managed?.owners || {});
        const byAsset = new Map();
        for (const item of items) {
          if (!byAsset.has(item.context.assetId)) byAsset.set(item.context.assetId, []);
          byAsset.get(item.context.assetId).push(item);
        }
        for (const [assetId, assetItems] of byAsset) {
          const representative = assetItems[0];
          if (assetItems.some(item => item.context.kitId !== representative.context.kitId || !item.content.equals(representative.content))) {
            throw domainError('SHARED_RESOURCE_CONTENT_CONFLICT', 'Shared instruction contributions differ');
          }
          const owner = owners[assetId];
          if (owner) {
            assertOwner(owner, representative.context);
            if (hash(blockParts(content.toString('utf8'), assetId).text) !== owner.units?.[`block:${assetId}`]?.hash) {
              throw domainError('OWNED_CONTENT_MODIFIED_EXTERNALLY', 'Shared instruction block was modified');
            }
          } else if (content.includes(`<!-- agents-kit:${assetId}:`)) throw domainError('UNKNOWN_EXISTING_CONTENT', 'Instruction block is unmanaged');
          const result = mergeStructuredDocument({format: 'markdown', current: content.toString('utf8'), desired: representative.content.toString('utf8'), assetId, previousUnits: owner?.units || {}});
          if (result.conflicts.length) throw domainError(result.conflicts[0].reason, 'Shared instruction merge conflicts');
          const requested = assetItems.map(item => item.context.consumerId);
          if (owner && (owner.units[`block:${assetId}`].hash !== result.units[`block:${assetId}`].hash || JSON.stringify(owner.dependencyIds || []) !== JSON.stringify(representative.context.dependencyIds || [])) && owner.consumers.some(id => !requested.includes(id))) {
            throw domainError('SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS', 'All recorded consumers must participate in a shared update');
          }
          owners[assetId] = {kitId: representative.context.kitId, assetId, assetKind: 'instructions', units: result.units, dependencyIds: representative.context.dependencyIds || [],
            consumers: [...new Set([...(owner?.consumers || []), ...requested])].sort()};
          content = Buffer.from(result.content);
        }
        nextManaged = {sharedVersion: 1, strategy: 'merge', ownership: 'structured-units', hash: hash(content), owners,
          createdByKit: managed?.createdByKit ?? before.hash === null};
      }
      const previous = managed && {...managed};
      if (previous) delete previous.transactionId;
      const unchanged = before.hash === hash(content);
      operations.push(preparedOperation({target, before, content, nextManaged, context, targetRoot,
        operation: unchanged ? JSON.stringify(previous) === JSON.stringify(nextManaged) ? 'SKIP' : 'REGISTER' : before.hash === null ? 'CREATE' : 'UPDATE',
        reason: unchanged ? 'SHARED_CONSUMERS_RECONCILED' : 'SHARED_CONTENT_PLANNED'}));
    } catch (error) {
      if (error.name !== 'DomainError') throw error;
      blocked.push({...context, target, reason: error.code});
    }
  }
  // Prune managed bundle files removed from the desired source, with the same consumer gate.
  for (const [target, managed] of Object.entries(state.managed)) {
    if (managed.sharedVersion !== 1 || managed.ownership !== 'file') continue;
    const owner = managed.shared;
    const key = `${owner.kitId}:${owner.assetId}`;
    const contexts = resources.get(key)?.filter(context => isWithinRoot(target, context.targetBase));
    if (!contexts?.length || desiredTargets.has(`${key}:${target}`)) continue;
    const requested = contexts.map(item => item.consumerId);
    if (owner.consumers.some(id => !requested.includes(id))) {
      blocked.push({...contexts[0], target, reason: 'SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS'});
      continue;
    }
    const removal = prepareSharedRemoval({state: {...state, managed: {[target]: managed}}, targetRoot,
      consumerIds: requested, kitId: owner.kitId, assetIds: [owner.assetId]});
    operations.push(...removal.operations); blocked.push(...removal.blocked);
  }
  return {operations, blocked, automatic: !blocked.length};
}

export function prepareSharedRemoval({state, targetRoot, consumerIds, kitId, assetIds}) {
  const operations = [], blocked = [], found = new Set();
  for (const [target, managed] of Object.entries(state.managed)) {
    if (managed.sharedVersion !== 1) continue;
    const owners = managed.ownership === 'file' ? [managed.shared] : Object.values(managed.owners || {});
    const selected = owners.filter(owner => owner.kitId === kitId && assetIds.includes(owner.assetId) && owner.consumers.some(id => consumerIds.includes(id)));
    if (!selected.length) continue;
    selected.forEach(owner => found.add(owner.assetId));
    const context = {clientId: consumerIds[0].split(':')[1], assetId: selected.map(owner => owner.assetId).join(','), assetKind: selected[0].assetKind};
    try {
      const before = observe(target, targetRoot);
      let content = before.content;
      let nextManaged = structuredClone(managed); delete nextManaged.transactionId;
      for (const owner of selected) {
        const remaining = owner.consumers.filter(id => !consumerIds.includes(id));
        if (managed.ownership === 'file') {
          if (before.hash !== managed.hash) throw domainError('OWNED_CONTENT_MODIFIED_EXTERNALLY', 'Shared file was modified externally');
          if (remaining.length) nextManaged.shared.consumers = remaining;
          else { nextManaged = null; content = null; }
        } else {
          const block = blockParts(content.toString('utf8'), owner.assetId);
          if (hash(block.text) !== owner.units?.[`block:${owner.assetId}`]?.hash) throw domainError('OWNED_CONTENT_MODIFIED_EXTERNALLY', 'Shared block was modified externally');
          if (remaining.length) nextManaged.owners[owner.assetId].consumers = remaining;
          else {
            const text = content.toString('utf8');
            content = Buffer.from(text.slice(0, block.from) + text.slice(block.to));
            delete nextManaged.owners[owner.assetId];
          }
        }
      }
      if (nextManaged?.owners && !Object.keys(nextManaged.owners).length) {
        if (nextManaged.createdByKit && !content.toString('utf8').trim()) content = null;
        nextManaged = null;
      }
      if (nextManaged) nextManaged.hash = hash(content);
      operations.push(preparedOperation({target, before, content, nextManaged, context, targetRoot,
        operation: content === null ? 'REMOVE' : hash(content) === before.hash ? 'RELEASE' : 'REMOVE_BLOCK', reason: 'SHARED_CONSUMER_REMOVAL'}));
    } catch (error) {
      if (error.name !== 'DomainError') throw error;
      blocked.push({...context, target, reason: error.code});
    }
  }
  for (const assetId of assetIds) if (!found.has(assetId)) blocked.push({assetId, reason: 'SHARED_RESOURCE_NOT_MANAGED'});
  return {operations, blocked, automatic: !blocked.length};
}


function sharedTargetBase(template, {scope, targetRoot, homeDir}) {
  const root = resolveForAuthorization(scope === 'global' ? homeDir : targetRoot);
  if (scope === 'global' && !template.startsWith('~/')) throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Global common resources require a home-relative client path');
  const target = path.resolve(root, scope === 'global' ? template.slice(2) : template);
  return authorizeSharedTarget(target, root);
}

// Explicit transfer proves the legacy bytes and mapping before changing only ownership.
export function prepareSharedOwnershipMigration({contributions, state, targetRoot, scope, homeDir = targetRoot}) {
  const groups = new Map(), operations = [], blocked = [];
  for (const {planned, source, kitId, consumerId} of contributions) {
    const context = {...planned, kitId, consumerId};
    const base = sharedTargetBase(planned.target, {scope, targetRoot, homeDir});
    for (const relative of planned.assetKind === 'skills' ? files(source) : ['']) {
      const target = relative ? path.join(base, relative) : base;
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push({context, content: fs.readFileSync(relative ? path.join(source, relative) : source)});
    }
  }
  for (const [target, items] of groups) {
    const context = items[0].context;
    try {
      const before = observe(target, targetRoot), previous = state.managed[target];
      if (!previous || previous.sharedVersion || previous.clientId !== context.clientId || before.hash !== previous.hash) {
        throw domainError('SHARED_MIGRATION_OWNERSHIP_UNPROVEN', 'Migration requires unchanged ownership for the explicitly selected client');
      }
      const transaction = state.transactions.find(item => item.id === previous.transactionId && item.type === 'apply' && item.status === 'committed');
      if (!transaction?.operations.some(item => item.target === target && item.afterHash === before.hash)) {
        throw domainError('SHARED_MIGRATION_OWNERSHIP_UNPROVEN', 'Legacy ownership has no matching committed transaction');
      }
      let nextManaged;
      if (context.assetKind === 'skills') {
        if (items.length !== 1 || previous.strategy !== 'copy' || previous.ownership !== 'file' || previous.assetId !== context.assetId || !before.content.equals(items[0].content)) {
          throw domainError('SHARED_MIGRATION_CONTENT_MISMATCH', 'Skill mapping and source must match the legacy file exactly');
        }
        nextManaged = {sharedVersion: 1, strategy: 'copy', ownership: 'file', hash: before.hash,
          shared: {kitId: context.kitId, assetId: context.assetId, assetKind: 'skills', dependencyIds: context.dependencyIds || [], consumers: [context.consumerId]}};
      } else {
        if (previous.strategy !== 'merge' || previous.ownership !== 'structured-units'
          || Object.keys(previous.owners || {}).length !== items.length
          || items.some(item => item.context.assetKind !== 'instructions' || !previous.owners[item.context.assetId])) {
          throw domainError('SHARED_MIGRATION_ALL_OWNERS_REQUIRED', 'Every legacy instruction owner in the file must be explicitly selected');
        }
        const owners = {};
        for (const item of items) {
          const {assetId, kitId, consumerId} = item.context;
          const owner = previous.owners[assetId];
          const block = blockParts(before.content.toString('utf8'), assetId);
          if (Object.keys(owner.units || {}).length !== 1 || hash(block.text) !== owner.units?.[`block:${assetId}`]?.hash) {
            throw domainError('SHARED_MIGRATION_CONTENT_MISMATCH', 'Legacy instruction block does not match its ownership record');
          }
          const merged = mergeStructuredDocument({format: 'markdown', current: before.content.toString('utf8'), desired: item.content.toString('utf8'), assetId, previousUnits: owner.units});
          if (merged.conflicts.length || merged.content !== before.content.toString('utf8')) {
            throw domainError('SHARED_MIGRATION_CONTENT_MISMATCH', 'Migration cannot change instruction content');
          }
          owners[assetId] = {kitId, assetId, assetKind: 'instructions', units: owner.units, dependencyIds: item.context.dependencyIds || [], consumers: [consumerId]};
        }
        nextManaged = {sharedVersion: 1, strategy: 'merge', ownership: 'structured-units', hash: before.hash, owners, createdByKit: false};
      }
      operations.push(preparedOperation({target, before, content: before.content, nextManaged, context, targetRoot,
        operation: 'MIGRATE_OWNERSHIP', reason: 'EXPLICIT_LEGACY_OWNERSHIP_TRANSFER'}));
    } catch (error) {
      if (error.name !== 'DomainError') throw error;
      blocked.push({...context, target, reason: error.code});
    }
  }
  // An old bundle file absent from the new source must not become orphaned silently.
  const selected = new Set(contributions.map(item => item.planned.assetId));
  const clientId = contributions[0]?.planned.clientId;
  for (const [target, record] of Object.entries(state.managed)) {
    if (!record.sharedVersion && record.clientId === clientId && !groups.has(target)
      && (selected.has(record.assetId) || Object.keys(record.owners || {}).some(id => selected.has(id)))) {
      blocked.push({target, reason: 'SHARED_MIGRATION_UNMAPPED_TARGET'});
    }
  }
  return {operations, blocked, automatic: !blocked.length};
}
