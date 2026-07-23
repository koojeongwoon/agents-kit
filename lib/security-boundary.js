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
