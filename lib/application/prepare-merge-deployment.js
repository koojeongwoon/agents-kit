import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mergeStructuredDocument } from '../domain/structured-merge.js';
import { domainError } from '../domain/errors.js';
import { mcpMergeBlockReason } from './mcp-merge-guard.js';
import { isWithinRoot, resolveForAuthorization } from '../security-boundary.js';

const preparedContent = new WeakMap();

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function observe(target) {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) return { hash: `non-file:${stat.mode}`, content: null };
    const content = fs.readFileSync(target, 'utf8');
    return { hash: hash(content), content };
  } catch (error) {
    if (error.code === 'ENOENT') return { hash: null, content: '' };
    throw error;
  }
}

function resolveTarget(template, { targetRoot, homeDir }) {
  const expanded = template === '~'
    ? homeDir
    : template.startsWith('~/')
      ? path.join(homeDir, template.slice(2))
      : path.resolve(targetRoot, template);
  const target = resolveForAuthorization(expanded);
  const root = resolveForAuthorization(template.startsWith('~') ? homeDir : targetRoot);
  if (!isWithinRoot(target, root)) {
    throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Deployment target resolves outside its scope', {
      target: template
    });
  }
  return target;
}

export function prepareMergeDeployment({
  capabilityPlan,
  sources,
  targetRoot,
  homeDir,
  state,
  previewOnly = false
}) {
  const blocked = [...capabilityPlan.blocked];
  const groups = new Map();
  for (const planned of capabilityPlan.operations) {
    if (planned.strategy !== 'merge') continue;
    const source = sources.get(planned.assetId);
    if (!planned.rendered && (!source || !fs.existsSync(source) || !fs.statSync(source).isFile())) {
      blocked.push(Object.freeze({ ...planned, reason: 'MERGE_SOURCE_FILE_REQUIRED' }));
      continue;
    }
    const target = resolveTarget(planned.target, { targetRoot, homeDir });
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push({ planned, source });
  }

  const operations = [];
  for (const [target, contributions] of groups) {
    if (state.managed[target]?.sharedVersion) {
      blocked.push({...contributions[0].planned, target, reason: 'SHARED_TARGET_REQUIRES_COMMON_SOURCE'});
      continue;
    }
    if (state.managed[target]?.clientId && state.managed[target].clientId !== capabilityPlan.clientId) {
      blocked.push({...contributions[0].planned, target, reason: 'TARGET_OWNED_BY_OTHER_CLIENT'});
      continue;
    }
    if (state.managed[target]?.resource) {
      blocked.push({...contributions[0].planned, target, reason: 'RESOURCE_OWNERSHIP_CONFLICT'});
      continue;
    }
    const before = observe(target);
    if (before.content === null) {
      blocked.push(Object.freeze({
        ...contributions[0].planned,
        target,
        reason: 'MERGE_TARGET_NOT_FILE'
      }));
      continue;
    }
    let content = before.content;
    const owners = structuredClone(state.managed[target]?.owners || {});
    const groupConflicts = [];
    const changes = [];
    for (const { planned, source } of contributions) {
      if (planned.commonSource && planned.format === 'markdown'
        && !owners[planned.assetId]?.units?.[`block:${planned.assetId}`]
        && (content.includes(`<!-- agents-kit:${planned.assetId}:start -->`)
          || content.includes(`<!-- agents-kit:${planned.assetId}:end -->`))) {
        groupConflicts.push(Object.freeze({...planned, target, reason: 'UNKNOWN_EXISTING_CONTENT'}));
        continue;
      }
      const previousOwner = owners[planned.assetId];
      if (previousOwner?.resource && (!planned.resource || ['kitId', 'assetId', 'assetKind', 'configStore'].some(key => previousOwner.resource[key] !== planned.resource[key]))) {
        groupConflicts.push({...planned, target, reason: 'RESOURCE_OWNERSHIP_CONFLICT'});
        continue;
      }
      const guardReason = mcpMergeBlockReason({planned, current: content, previousUnits: owners[planned.assetId]?.units || {}});
      if (guardReason) {
        groupConflicts.push(Object.freeze({...planned, target, reason: guardReason}));
        continue;
      }
      const result = mergeStructuredDocument({
        format: planned.format,
        current: content,
        desired: planned.rendered?.content ?? fs.readFileSync(source, 'utf8'),
        assetId: planned.assetId,
        previousUnits: owners[planned.assetId]?.units || {}
      });
      if (result.conflicts.length > 0) {
        for (const conflict of result.conflicts) {
          groupConflicts.push(Object.freeze({
            ...planned,
            target,
            selector: conflict.selector,
            reason: conflict.reason
          }));
        }
        continue;
      }
      if (Object.entries(owners).some(([id, owner]) => id !== planned.assetId && owner.resource
        && Object.keys(owner.units).some(selector => Object.hasOwn(result.units, selector)))) {
        groupConflicts.push({...planned, target, reason: 'RESOURCE_OWNERSHIP_CONFLICT'});
        continue;
      }
      if (planned.rendered) {
        for (const [selector, unit] of Object.entries(result.units)) {
          changes.push(Object.freeze({assetId: planned.assetId, selector, desiredHash: unit.hash}));
        }
      }
      content = result.content;
      owners[planned.assetId] = {units: result.units,
        ...((!previousOwner || previousOwner.resource) && planned.resource ? {resource: planned.resource} : {})};
    }
    if (groupConflicts.length > 0) {
      blocked.push(...groupConflicts);
      continue;
    }
    const expectedHash = hash(content);
    const metadataChanged = Object.values(owners).some(owner => owner.resource) && JSON.stringify(owners) !== JSON.stringify(state.managed[target]?.owners || {});
    const operation = Object.freeze({
      ...(previewOnly ? {previewOnly: true} : {}),
      ...(changes.length ? {changes: Object.freeze(changes)} : {}),
      ...(contributions.some(item => item.planned.resource) ? {authorizedRoot: resolveForAuthorization(contributions[0].planned.scope === 'global' ? homeDir : targetRoot), metadataOnly: before.hash === expectedHash} : {}),
      clientId: capabilityPlan.clientId,
      assetId: contributions.map(item => item.planned.assetId).join(','),
      assetKind: contributions.map(item => item.planned.assetKind).join(','),
      operation: before.hash === expectedHash ? (metadataChanged ? 'REGISTER' : 'SKIP') : before.hash === null ? 'CREATE' : 'MERGE',
      reason: before.hash === expectedHash ? 'CONTENT_UNCHANGED' : before.hash === null ? 'TARGET_ABSENT' : 'OWNED_UNITS_UPDATE',
      strategy: 'merge',
      format: contributions[0].planned.format,
      target,
      beforeHash: before.hash,
      expectedHash,
      ownership: 'structured-units',
      owners: Object.freeze(owners)
    });
    if (!previewOnly) preparedContent.set(operation, content);
    operations.push(operation);
  }
  return Object.freeze({
    clientId: capabilityPlan.clientId,
    clientVersion: capabilityPlan.clientVersion,
    automatic: blocked.length === 0,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}

export function contentForMergeOperation(operation) {
  const content = preparedContent.get(operation);
  if (content === undefined) {
    throw domainError('MERGE_CONTENT_NOT_PREPARED', 'Merge operation content is unavailable');
  }
  return content;
}

export function hashMergeTarget(target) {
  return observe(target).hash;
}
