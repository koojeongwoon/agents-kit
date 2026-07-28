import fs from 'fs';
import path from 'path';

export function isWithinRoot(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveForAuthorization(candidate) {
  let cursor = path.resolve(candidate);
  const suffix = [];

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }

  const realBase = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.join(realBase, ...suffix);
}

export function assertWithinRoots(candidate, roots, operation = 'filesystem operation') {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(`${operation}: path is required`);
  }

  const authorizedPath = resolveForAuthorization(candidate);
  const allowed = roots.some(root => isWithinRoot(authorizedPath, resolveForAuthorization(root)));
  if (!allowed) throw new Error(`${operation}: path is outside the allowed roots`);
  return authorizedPath;
}

export function assertSafeProjectTarget({ targetDir, homeDir, projectRoot, kitRoot }) {
  if (typeof targetDir !== 'string' || !targetDir.trim()) {
    const error = new Error('Project path is required');
    error.code = 'PROJECT_PATH_REQUIRED';
    throw error;
  }
  const resolved = resolveForAuthorization(targetDir);
  const filesystemRoot = path.parse(resolved).root;
  const forbiddenRoots = [
    resolveForAuthorization(filesystemRoot),
    homeDir ? resolveForAuthorization(homeDir) : null,
    projectRoot ? resolveForAuthorization(projectRoot) : null,
    kitRoot ? resolveForAuthorization(kitRoot) : null
  ].filter(Boolean);

  if (forbiddenRoots.some(root => isWithinRoot(resolved, root) && isWithinRoot(root, resolved))) {
    const error = new Error('Agent Kit cannot deploy into a filesystem root, home, repository, or Kit directory');
    error.code = 'INVALID_PROJECT_TARGET';
    throw error;
  }

  const resolvedKitRoot = kitRoot ? resolveForAuthorization(kitRoot) : null;
  const resolvedProjectRoot = projectRoot ? resolveForAuthorization(projectRoot) : null;

  if ((resolvedKitRoot && isWithinRoot(resolved, resolvedKitRoot)) ||
      (resolvedProjectRoot && isWithinRoot(resolved, resolvedProjectRoot))) {
    const error = new Error('Agent Kit cannot deploy inside its own repository or Kit directory');
    error.code = 'INVALID_PROJECT_TARGET';
    throw error;
  }
}
