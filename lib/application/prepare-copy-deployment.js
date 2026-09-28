import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { domainError } from '../domain/errors.js';
import { isWithinRoot, resolveForAuthorization } from '../security-boundary.js';

const generatedContent = new WeakMap();

export function contentForCopyOperation(operation) {
  if (operation.previewOnly) throw domainError('DEPLOYMENT_PREVIEW_ONLY', 'Preview operations cannot be applied');
  if (operation.rendered) {
    const content = generatedContent.get(operation);
    if (!content) throw domainError('COPY_OPERATION_NOT_PREPARED', 'Generated copy must use its original prepared operation');
    return content;
  }
  return fs.readFileSync(operation.source);
}

function hashBuffer(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function currentHash(target) {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) return `non-file:${stat.mode}`;
    return hashBuffer(fs.readFileSync(target));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sourceFiles(source) {
  const stat = fs.statSync(source);
  if (stat.isFile()) return [{ source, relative: '' }];
  if (!stat.isDirectory()) {
    throw domainError('UNSUPPORTED_COPY_SOURCE', 'Copy source must be a file or directory', { source });
  }
  const files = [];
  const visit = (directory, relativeRoot = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.join(relativeRoot, entry.name);
      if (entry.isSymbolicLink()) {
        throw domainError('COPY_SOURCE_SYMLINK_UNSUPPORTED', 'Copy source directories cannot contain symlinks', {
          source: absolute
        });
      }
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push({ source: absolute, relative });
    }
  };
  visit(source);
  return files;
}

function resolveTarget(template, { targetRoot, homeDir }) {
  const expanded = template === '~'
    ? homeDir
    : template.startsWith('~/')
      ? path.join(homeDir, template.slice(2))
      : path.resolve(targetRoot, template);
  const authorized = resolveForAuthorization(expanded);
  const root = resolveForAuthorization(template.startsWith('~') ? homeDir : targetRoot);
  if (!isWithinRoot(authorized, root)) {
    throw domainError('DEPLOYMENT_TARGET_OUTSIDE_SCOPE', 'Deployment target resolves outside its scope', {
      target: template
    });
  }
  return authorized;
}

export function prepareCopyDeployment({
  capabilityPlan,
  sources,
  targetRoot,
  homeDir,
  state,
  previewOnly = false
}) {
  const operations = [];
  const blocked = [...capabilityPlan.blocked];

  for (const planned of capabilityPlan.operations) {
    if (planned.strategy !== 'copy') continue;
    const source = sources.get(planned.assetId);
    if (!source && !planned.rendered) {
      blocked.push(Object.freeze({ ...planned, reason: 'ASSET_SOURCE_NOT_RESOLVED' }));
      continue;
    }
    const targetBase = resolveTarget(planned.target, { targetRoot, homeDir });
    const files = planned.rendered ? [{source: null, relative: ''}] : sourceFiles(source);
    for (const file of files) {
      const target = file.relative ? path.join(targetBase, file.relative) : targetBase;
      const content = planned.rendered ? Buffer.from(planned.rendered.content, 'utf8') : fs.readFileSync(file.source);
      const expectedHash = hashBuffer(content);
      const beforeHash = currentHash(target);
      const owned = state.managed[target];
      if (owned?.sharedVersion) {
        blocked.push({...planned, target, reason: 'SHARED_TARGET_REQUIRES_COMMON_SOURCE'});
        continue;
      }
      if (!planned.rendered && !planned.commonSource && owned?.clientId && owned.clientId !== capabilityPlan.clientId) {
        blocked.push({...planned, target, reason: 'TARGET_OWNED_BY_OTHER_CLIENT'});
        continue;
      }
      if (Object.values(owned?.owners || {}).some(owner => owner.resource)) {
        blocked.push({...planned, target, reason: 'RESOURCE_OWNERSHIP_CONFLICT'});
        continue;
      }
      if (owned?.resource && (!planned.resource || ['kitId', 'assetId', 'assetKind', 'configStore'].some(key => owned.resource[key] !== planned.resource[key]))) {
        blocked.push({...planned, target, reason: 'RESOURCE_OWNERSHIP_CONFLICT'});
        continue;
      }
      const strictOwnership = planned.rendered || planned.commonSource;
      let operation = 'CREATE';
      let reason = 'TARGET_ABSENT';
      if (strictOwnership && owned && (owned.clientId !== planned.clientId || owned.assetId !== planned.assetId || owned.ownership !== 'file')) {
        operation = 'CONFLICT';
        reason = 'TARGET_OWNED_BY_OTHER_ASSET';
      } else if (strictOwnership && beforeHash !== null && !owned) {
        operation = 'CONFLICT';
        reason = 'UNKNOWN_EXISTING_CONTENT';
      } else if (strictOwnership && owned && owned.hash !== beforeHash) {
        operation = 'CONFLICT';
        reason = 'OWNED_CONTENT_MODIFIED_EXTERNALLY';
      } else if (beforeHash === expectedHash) {
        operation = 'SKIP';
        reason = 'CONTENT_UNCHANGED';
      } else if (beforeHash !== null && !owned) {
        operation = 'CONFLICT';
        reason = 'UNKNOWN_EXISTING_CONTENT';
      } else if (owned && owned.hash !== beforeHash) {
        operation = 'CONFLICT';
        reason = 'OWNED_CONTENT_MODIFIED_EXTERNALLY';
      } else if (owned) {
        operation = 'COPY';
        reason = 'UPDATE_MANAGED';
      }
      if (operation === 'SKIP' && owned?.resource && JSON.stringify(owned.resource.dependencyIds) !== JSON.stringify(planned.dependencyIds)) {
        operation = 'REGISTER'; reason = 'RESOURCE_DEPENDENCIES_CHANGED';
      }
      const entry = Object.freeze({
        ...planned,
        operation,
        reason,
        source: file.source,
        target,
        beforeHash,
        expectedHash,
        ownership: 'file',
        ...(planned.resource ? {authorizedRoot: resolveForAuthorization(planned.scope === 'global' ? homeDir : targetRoot), metadataOnly: operation === 'REGISTER'} : {}),
        resource: owned ? (owned.resource ? planned.resource : undefined) : planned.resource,
        ...(previewOnly ? {previewOnly: true} : {})
      });
      if (planned.rendered && !previewOnly) generatedContent.set(entry, content);
      if (operation === 'CONFLICT') blocked.push(entry);
      else operations.push(entry);
    }
  }

  return Object.freeze({
    ...capabilityPlan,
    automatic: blocked.length === 0,
    operations: Object.freeze(operations),
    blocked: Object.freeze(blocked)
  });
}

export function hashDeploymentTarget(target) {
  return currentHash(target);
}
