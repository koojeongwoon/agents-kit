import test from 'node:test';
import assert from 'node:assert/strict';
import { createMergeSmitheryMcp } from '../lib/application/merge-smithery-mcp.js';
import { DomainError } from '../lib/domain/errors.js';

function createHarness({ deploymentError = null, template = { mcpServers: {} } } = {}) {
  let state = {
    template: structuredClone(template),
    envContent: '',
    envExampleContent: ''
  };
  let authorizedPath = '';
  let resolvedScope = null;
  let deployed = null;
  let rolledBack = false;

  const kitStore = {
    async transaction(scope, operation) {
      const before = structuredClone(state);
      try {
        return await operation({
          read: () => structuredClone(state),
          write: plan => {
            state = {
              template: structuredClone(plan.template),
              envContent: plan.envContent,
              envExampleContent: plan.envExampleContent
            };
          }
        });
      } catch (error) {
        state = before;
        rolledBack = true;
        throw error;
      }
    }
  };

  const execute = createMergeSmitheryMcp({
    fetchServer: async qualifiedName => ({ qualifiedName }),
    buildEntry: ({ detail, alias, configValues }) => ({
      alias,
      qualifiedName: detail.qualifiedName,
      server: { url: 'https://example.run.tools?token=${EXAMPLE_TOKEN}' },
      env: { EXAMPLE_TOKEN: configValues.token }
    }),
    kitStore,
    authorizeProject: path => { authorizedPath = path; },
    resolveMcp: scope => { resolvedScope = scope; },
    deployMcp: input => {
      deployed = input;
      if (deploymentError) throw deploymentError;
      return { totalAppliedLinks: 2, deployedTargets: ['Cursor', 'Codex'] };
    }
  });

  return {
    execute,
    state: () => state,
    authorizedPath: () => authorizedPath,
    resolvedScope: () => resolvedScope,
    deployed: () => deployed,
    rolledBack: () => rolledBack
  };
}

test('Smithery MCP use case orchestrates project authorization, merge, resolve, and deploy', async () => {
  const harness = createHarness();
  const result = await harness.execute({
    qualifiedName: 'example/server',
    alias: 'example',
    configValues: { token: 'secret' },
    scope: 'project',
    projectName: 'wiki',
    projectPath: '/projects/wiki'
  });

  assert.equal(harness.authorizedPath(), '/projects/wiki');
  assert.equal(harness.resolvedScope().key, 'project:wiki');
  assert.equal(harness.deployed().scope.key, 'project:wiki');
  assert.deepEqual(harness.state().template.mcpServers.example, {
    url: 'https://example.run.tools?token=${EXAMPLE_TOKEN}'
  });
  assert.match(harness.state().envContent, /EXAMPLE_TOKEN=secret/);
  assert.deepEqual(result, {
    alias: 'example',
    qualifiedName: 'example/server',
    envKeys: ['EXAMPLE_TOKEN'],
    appliedLinksCount: 2,
    deployedTargets: ['Cursor', 'Codex']
  });
});

test('Smithery MCP use case rejects project apply without a path before external IO', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.execute({ qualifiedName: 'example/server', alias: 'example', scope: 'project' }),
    error => error instanceof DomainError && error.code === 'PROJECT_PATH_REQUIRED'
  );
});

test('Smithery MCP use case rolls persisted state back when deployment fails', async () => {
  const harness = createHarness({ deploymentError: new Error('client failed') });
  await assert.rejects(
    harness.execute({
      qualifiedName: 'example/server',
      alias: 'example',
      configValues: { token: 'secret' },
      scope: 'global'
    }),
    /client failed/
  );
  assert.deepEqual(harness.state(), { template: { mcpServers: {} }, envContent: '', envExampleContent: '' });
  assert.equal(harness.rolledBack(), true);
});

test('Smithery MCP use case preserves stable collision error codes', async () => {
  const harness = createHarness({ template: { mcpServers: { example: { url: 'https://old.example' } } } });
  await assert.rejects(
    harness.execute({ qualifiedName: 'example/server', alias: 'example', configValues: { token: 'secret' } }),
    error => error instanceof DomainError && error.code === 'MCP_ALIAS_COLLISION'
  );
});
