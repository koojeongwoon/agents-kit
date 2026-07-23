import fs from 'fs';
import path from 'path';
import { kitPaths } from '../kit-paths.js';
import { assertWithinRoots } from '../security-boundary.js';
import { domainError } from '../domain/errors.js';

export function createFsSkillStore({ kitRoot }) {
  return Object.freeze({
    async transaction(scope, skill, artifact, operation) {
      const scopedKit = kitPaths(kitRoot, scope.type, scope.projectName);
      const installedPath = path.join(scopedKit.skillsDir, skill.directoryName);
      assertWithinRoots(installedPath, [scopedKit.skillsDir], 'skills.sh install destination');
      if (fs.existsSync(installedPath)) {
        throw domainError('SKILL_ALREADY_INSTALLED', `Skill '${skill.slug}' already exists. Remove it before reinstalling.`, {
          slug: skill.slug
        });
      }

      fs.mkdirSync(scopedKit.skillsDir, { recursive: true });
      fs.cpSync(artifact.path, installedPath, { recursive: true, errorOnExist: true, force: false });
      try {
        return await operation(installedPath);
      } catch (error) {
        if (fs.existsSync(installedPath)) fs.rmSync(installedPath, { recursive: true, force: true });
        throw error;
      }
    }
  });
}
