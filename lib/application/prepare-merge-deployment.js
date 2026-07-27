import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mergeStructuredDocument } from '../domain/structured-merge.js';
import { domainError } from '../domain/errors.js';
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
  state
}) {
  const blocked = [...capabilityPlan.blocked];
  const groups = new Map();
  for (const planned of capabilityPlan.operations) {
    if (planned.strategy !== 'merge') continue;
    const source = sources.get(planned.assetId);
    if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
      blocked.push(Object.freeze({ ...planned, reason: 'MERGE_SOURCE_FILE_REQUIRED' }));
      continue;
    }
    const target = resolveTarget(planned.target, { targetRoot, homeDir });
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push({ planned, source });
  }

  const operations = [];
  for (const [target, contributions] of groups) {
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
    for (const { planned, source } of contributions) {
      const result = mergeStructuredDocument({
        format: planned.format,
        current: content,
        desired: fs.readFileSync(source, 'utf8'),
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
      content = result.content;
      owners[planned.assetId] = { units: result.units };
    }
    if (groupConflicts.length > 0) {
      blocked.push(...groupConflicts);
      continue;
    }
    const expectedHash = hash(content);
    const operation = Object.freeze({
      clientId: capabilityPlan.clientId,
      assetId: contributions.map(item => item.planned.assetId).join(','),
      assetKind: contributions.map(item => item.planned.assetKind).join(','),
      operation: before.hash === expectedHash ? 'SKIP' : before.hash === null ? 'CREATE' : 'MERGE',
      reason: before.hash === expectedHash ? 'CONTENT_UNCHANGED' : before.hash === null ? 'TARGET_ABSENT' : 'OWNED_UNITS_UPDATE',
      strategy: 'merge',
      target,
      beforeHash: before.hash,
      expectedHash,
      ownership: 'structured-units',
      owners: Object.freeze(owners)
    });
    preparedContent.set(operation, content);
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
