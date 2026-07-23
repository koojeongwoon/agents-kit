import { domainError } from './errors.js';

export const SCOPE_TYPES = Object.freeze(['global', 'project']);

export function createScope({ type = 'global', projectName = '' } = {}) {
  const normalizedType = String(type || '').trim().toLowerCase();
  if (!SCOPE_TYPES.includes(normalizedType)) {
    throw domainError('INVALID_SCOPE', 'Scope must be global or project', { type });
  }

  if (normalizedType === 'global') {
    return Object.freeze({ type: 'global', projectName: '', key: 'global' });
  }

  const normalizedProjectName = String(projectName || 'default').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedProjectName)) {
    throw domainError(
      'INVALID_PROJECT_NAME',
      'Project name may only contain letters, numbers, hyphens, and underscores',
      { projectName }
    );
  }

  return Object.freeze({
    type: 'project',
    projectName: normalizedProjectName,
    key: `project:${normalizedProjectName}`
  });
}
