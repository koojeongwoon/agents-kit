import { createScope } from '../domain/scope.js';
import { domainError } from '../domain/errors.js';

export function createInstallSkill({ parseLocator, downloader, skillStore, authorizeProject, deploySkill }) {
  if (![parseLocator, authorizeProject, deploySkill].every(value => typeof value === 'function')) {
    throw new TypeError('install skill dependencies must be functions');
  }
  if (!downloader || typeof downloader.download !== 'function') throw new TypeError('install skill requires a downloader port');
  if (!skillStore || typeof skillStore.transaction !== 'function') throw new TypeError('install skill requires a transactional skill store');

  return async function installSkill(command) {
    const scope = createScope({ type: command?.scope, projectName: command?.projectName });
    let skill;
    try {
      skill = parseLocator(command?.locator);
    } catch (error) {
      throw domainError('INVALID_SKILL_LOCATOR', error?.message || 'Invalid skill locator');
    }
    const projectPath = String(command?.projectPath || '').trim();
    if (scope.type === 'project') {
      if (!projectPath) throw domainError('PROJECT_PATH_REQUIRED', 'Project path is required to apply a project skill');
      authorizeProject(projectPath);
    }

    const artifact = await downloader.download(skill);
    try {
      return await skillStore.transaction(scope, skill, artifact, installedPath => {
        const deployment = deploySkill({ scope, projectPath, installedPath });
        return Object.freeze({
          skill: Object.freeze({ ...skill }),
          installedPath,
          files: artifact.files,
          bytes: artifact.bytes,
          appliedLinksCount: deployment.totalAppliedLinks,
          deployedTargets: Object.freeze([...(deployment.deployedTargets || [])])
        });
      });
    } finally {
      await artifact.cleanup?.();
    }
  };
}
