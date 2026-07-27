import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { domainError } from '../domain/errors.js';
import { isWithinRoot, resolveForAuthorization } from '../security-boundary.js';

function fileHash(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function fingerprint(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return `symlink:${fs.readlinkSync(target)}`;
    if (stat.isFile()) return fileHash(target);
    return `non-file:${stat.mode}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveTarget(template, { targetRoot, homeDir }) {
  const expanded = template === '~'
    ? homeDir
    : template.startsWith('~/')
      ? path.join(homeDir, template.slice(2))
      : path.resolve(targetRoot, template);
  const target = path.join(
    resolveForAuthorization(path.dirname(expanded)),
    path.basename(expanded)
  );
  const root = resolveForAuthorization(template.startsWith('~') ? homeDir : targetRoot);
  if (!isWithinRoot(target, root)) {
    throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Deployment target resolves outside its scope', {
      target: template
    });
  }
  return target;
}

function prepareManaged(planned, source, target, owned) {
  if (!fs.statSync(source).isFile()) {
    return { blocked: { ...planned, target, reason: 'MANAGED_SOURCE_FILE_REQUIRED' } };
  }
  const beforeHash = fingerprint(target);
  const expectedHash = fileHash(source);
  if (beforeHash === expectedHash) {
    return {
      operation: {
        ...planned,
        target,
        source,
        operation: 'SKIP',
        reason: 'CONTENT_UNCHANGED',
        beforeHash,
        expectedHash,
        ownership: 'file'
      }
    };
  }
  if (beforeHash !== null && !owned) {
    return { blocked: { ...planned, target, reason: 'UNKNOWN_EXISTING_CONTENT' } };
  }
  if (owned && (owned.strategy !== 'managed' || owned.hash !== beforeHash)) {
    return { blocked: { ...planned, target, reason: 'OWNED_CONTENT_MODIFIED_EXTERNALLY' } };
  }
  return {
    operation: {
      ...planned,
      target,
      source,
      operation: beforeHash === null ? 'CREATE' : 'UPDATE_MANAGED',
      reason: beforeHash === null ? 'TARGET_ABSENT' : 'OWNED_FILE_UPDATE',
      beforeHash,
      expectedHash,
      ownership: 'file'
    }
  };
}

function prepareLink(planned, source, target, owned) {
  const resolvedSource = resolveForAuthorization(source);
  if (resolvedSource === target) {
    return { blocked: { ...planned, target, reason: 'SELF_REFERENCING_LINK' } };
  }
  const beforeHash = fingerprint(target);
  const expectedHash = `symlink:${resolvedSource}`;
  if (beforeHash === expectedHash) {
    return {
      operation: {
        ...planned,
        target,
        linkSource: resolvedSource,
        operation: 'SKIP',
        reason: 'LINK_UNCHANGED',
        beforeHash,
        expectedHash,
        ownership: 'link'
      }
    };
  }
  if (beforeHash !== null && !owned) {
    return { blocked: { ...planned, target, reason: 'UNKNOWN_EXISTING_CONTENT' } };
  }
  if (owned && (
    owned.strategy !== 'link'
    || owned.hash !== beforeHash
    || owned.linkSource !== beforeHash?.slice('symlink:'.length)
  )) {
    return { blocked: { ...planned, target, reason: 'OWNED_LINK_MODIFIED_EXTERNALLY' } };
  }
  return {
    operation: {
      ...planned,
      target,
      linkSource: resolvedSource,
      operation: beforeHash === null ? 'LINK' : 'REPLACE_LINK',
      reason: beforeHash === null ? 'TARGET_ABSENT' : 'OWNED_LINK_UPDATE',
      beforeHash,
      expectedHash,
      ownership: 'link'
    }
  };
}

export function prepareManagedLinkDeployment({
  capabilityPlan,
  sources,
  targetRoot,
  homeDir,
  state
}) {
  const operations = [];
  const blocked = [...capabilityPlan.blocked];
  for (const planned of capabilityPlan.operations) {
    if (!['managed', 'link'].includes(planned.strategy)) continue;
    const source = sources.get(planned.assetId);
    if (!source || !fs.existsSync(source)) {
      blocked.push(Object.freeze({ ...planned, reason: 'ASSET_SOURCE_NOT_RESOLVED' }));
      continue;
    }
    const target = resolveTarget(planned.target, { targetRoot, homeDir });
    const result = planned.strategy === 'managed'
      ? prepareManaged(planned, source, target, state.managed[target])
      : prepareLink(planned, source, target, state.managed[target]);
    if (result.blocked) blocked.push(Object.freeze(result.blocked));
    else operations.push(Object.freeze(result.operation));
  }
  return Object.freeze({
    clientId: capabilityPlan.clientId,
    clientVersion: capabilityPlan.clientVersion,
    automatic: blocked.length === 0,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}
