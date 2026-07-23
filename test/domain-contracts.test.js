import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../lib/domain/errors.js';
import { createScope } from '../lib/domain/scope.js';
import { createMcpAlias, planMcpMerge } from '../lib/domain/mcp.js';

test('Scope normalizes global and named project identities', () => {
  assert.deepEqual(createScope(), { type: 'global', projectName: '', key: 'global' });
  assert.deepEqual(createScope({ type: 'project' }), {
    type: 'project', projectName: 'default', key: 'project:default'
  });
  assert.deepEqual(createScope({ type: 'PROJECT', projectName: 'llm_wiki' }), {
    type: 'project', projectName: 'llm_wiki', key: 'project:llm_wiki'
  });
});

test('Scope rejects invalid type and project name with stable error codes', () => {
  assert.throws(
    () => createScope({ type: 'workspace' }),
    error => error instanceof DomainError && error.code === 'INVALID_SCOPE'
  );
  assert.throws(
    () => createScope({ type: 'project', projectName: '../escape' }),
    error => error instanceof DomainError && error.code === 'INVALID_PROJECT_NAME'
  );
});

test('MCP alias is a validated domain value', () => {
  assert.equal(createMcpAlias('github-tools'), 'github-tools');
  assert.throws(
    () => createMcpAlias('../github'),
    error => error instanceof DomainError && error.code === 'INVALID_MCP_ALIAS'
  );
});

test('MCP merge plan is pure and preserves the original template', () => {
  const original = { mcpServers: { fetch: { command: 'uvx' } }, metadata: { version: 1 } };
  const plan = planMcpMerge({
    template: original,
    alias: 'github',
    server: { url: 'https://github.run.tools?token=${GITHUB_TOKEN}' },
    envContent: 'EXISTING=value\n',
    envExampleContent: '# EXISTING=\n',
    envValues: { GITHUB_TOKEN: 'secret' }
  });

  assert.deepEqual(original, { mcpServers: { fetch: { command: 'uvx' } }, metadata: { version: 1 } });
  assert.deepEqual(plan.template.mcpServers.github, { url: 'https://github.run.tools?token=${GITHUB_TOKEN}' });
  assert.match(plan.envContent, /GITHUB_TOKEN=secret/);
  assert.match(plan.envExampleContent, /# GITHUB_TOKEN=/);
  assert.deepEqual(plan.envKeys, ['GITHUB_TOKEN']);
});

test('MCP merge fails closed on alias and environment collisions', () => {
  assert.throws(
    () => planMcpMerge({
      template: { mcpServers: { github: { url: 'https://old.example' } } },
      alias: 'github',
      server: { url: 'https://new.example' }
    }),
    error => error instanceof DomainError && error.code === 'MCP_ALIAS_COLLISION'
  );
  assert.throws(
    () => planMcpMerge({
      template: { mcpServers: {} },
      alias: 'github',
      server: { url: 'https://new.example' },
      envContent: 'GITHUB_TOKEN=old\n',
      envValues: { GITHUB_TOKEN: 'new' }
    }),
    error => error instanceof DomainError && error.code === 'ENV_COLLISION'
  );
});
