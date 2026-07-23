import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallSkill } from '../lib/application/install-skill.js';
import { DomainError } from '../lib/domain/errors.js';

function harness({ deploymentError = null } = {}) {
  let cleaned = false;
  let installed = false;
  let rolledBack = false;
  const execute = createInstallSkill({
    parseLocator: locator => ({ slug: locator, directoryName: locator, source: 'owner/repo', id: `owner/repo/${locator}` }),
    downloader: {
      async download() {
        return { path: '/artifact', files: 2, bytes: 128, cleanup: () => { cleaned = true; } };
      }
    },
    skillStore: {
      async transaction(scope, skill, artifact, operation) {
        installed = true;
        try { return await operation(`/kit/${scope.key}/skills/${skill.directoryName}`); }
        catch (error) { installed = false; rolledBack = true; throw error; }
      }
    },
    authorizeProject: () => {},
    deploySkill: () => {
      if (deploymentError) throw deploymentError;
      return { totalAppliedLinks: 1, deployedTargets: ['Codex'] };
    }
  });
  return { execute, cleaned: () => cleaned, installed: () => installed, rolledBack: () => rolledBack };
}

test('skill install use case downloads, commits, deploys, and cleans temporary artifact', async () => {
  const subject = harness();
  const result = await subject.execute({ locator: 'review', scope: 'global' });
  assert.equal(subject.installed(), true);
  assert.equal(subject.cleaned(), true);
  assert.equal(result.files, 2);
  assert.equal(result.appliedLinksCount, 1);
});

test('skill install use case rolls back copied skill and cleans artifact after deploy failure', async () => {
  const subject = harness({ deploymentError: new Error('deploy failed') });
  await assert.rejects(subject.execute({ locator: 'review', scope: 'global' }), /deploy failed/);
  assert.equal(subject.rolledBack(), true);
  assert.equal(subject.installed(), false);
  assert.equal(subject.cleaned(), true);
});

test('skill install project scope requires target before download', async () => {
  const subject = harness();
  await assert.rejects(
    subject.execute({ locator: 'review', scope: 'project', projectName: 'wiki' }),
    error => error instanceof DomainError && error.code === 'PROJECT_PATH_REQUIRED'
  );
  assert.equal(subject.cleaned(), false);
});

test('skill install exposes malformed locators as a stable client error', async () => {
  const install = createInstallSkill({
    parseLocator() { throw new Error('Malformed locator'); },
    downloader: { async download() { assert.fail('download must not run'); } },
    skillStore: { async transaction() { assert.fail('store must not run'); } },
    authorizeProject() {},
    deploySkill() {}
  });

  await assert.rejects(install({ scope: 'global', locator: 'bad' }), error => {
    assert.equal(error.code, 'INVALID_SKILL_LOCATOR');
    return true;
  });
});
