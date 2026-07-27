import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { domainError } from '../domain/errors.js';
import { isWithinRoot, resolveForAuthorization } from '../security-boundary.js';

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
  state
}) {
  const operations = [];
  const blocked = [...capabilityPlan.blocked];

  for (const planned of capabilityPlan.operations) {
    if (planned.strategy !== 'copy') {
      blocked.push(Object.freeze({
        ...planned,
        reason: 'STRATEGY_EXECUTOR_NOT_IMPLEMENTED'
      }));
      continue;
    }
    const source = sources.get(planned.assetId);
    if (!source) {
      blocked.push(Object.freeze({ ...planned, reason: 'ASSET_SOURCE_NOT_RESOLVED' }));
      continue;
    }
    const targetBase = resolveTarget(planned.target, { targetRoot, homeDir });
    for (const file of sourceFiles(source)) {
      const target = file.relative ? path.join(targetBase, file.relative) : targetBase;
      const expectedHash = hashBuffer(fs.readFileSync(file.source));
      const beforeHash = currentHash(target);
      const owned = state.managed[target];
      let operation = 'CREATE';
      let reason = 'TARGET_ABSENT';
      if (beforeHash === expectedHash) {
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
      const entry = Object.freeze({
        ...planned,
        operation,
        reason,
        source: file.source,
        target,
        beforeHash,
        expectedHash,
        ownership: 'file'
      });
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
