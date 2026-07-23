import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFsMcpKitStore } from '../lib/infrastructure/fs-mcp-kit-store.js';
import { bootstrapDefaultUserKit } from '../lib/defaults/templates.js';
import { kitPaths } from '../lib/kit-paths.js';
import { createScope } from '../lib/domain/scope.js';
import { planMcpMerge } from '../lib/domain/mcp.js';

function withTemporaryKit(operation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-mcp-store-'));
  bootstrapDefaultUserKit(root);
  return Promise.resolve(operation(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

test('filesystem MCP kit store commits a complete merge with private env permissions', () => withTemporaryKit(async kitRoot => {
  const store = createFsMcpKitStore({ kitRoot });
  await store.transaction(createScope(), async transaction => {
    const current = transaction.read();
    transaction.write(planMcpMerge({
      ...current,
      envExampleContent: current.envExampleContent,
      alias: 'github',
      server: { url: 'https://github.run.tools' },
      envValues: { GITHUB_TOKEN: 'secret' }
    }));
  });

  const paths = kitPaths(kitRoot, 'global');
  const template = JSON.parse(fs.readFileSync(paths.mcpTemplate, 'utf8'));
  assert.deepEqual(template.mcpServers.github, { url: 'https://github.run.tools' });
  assert.match(fs.readFileSync(paths.envFile, 'utf8'), /GITHUB_TOKEN=secret/);
  assert.equal(fs.statSync(paths.envFile).mode & 0o777, 0o600);
}));

test('filesystem MCP kit store restores every touched file after a downstream failure', () => withTemporaryKit(async kitRoot => {
  const store = createFsMcpKitStore({ kitRoot });
  const paths = kitPaths(kitRoot, 'global');
  const beforeTemplate = fs.readFileSync(paths.mcpTemplate);
  const beforeExample = fs.readFileSync(paths.envExample);

  await assert.rejects(
    store.transaction(createScope(), async transaction => {
      const current = transaction.read();
      transaction.write(planMcpMerge({
        ...current,
        envExampleContent: current.envExampleContent,
        alias: 'github',
        server: { url: 'https://github.run.tools' },
        envValues: { GITHUB_TOKEN: 'secret' }
      }));
      fs.writeFileSync(paths.mcpResolved, '{"partial":true}');
      throw new Error('deploy failed');
    }),
    /deploy failed/
  );

  assert.deepEqual(fs.readFileSync(paths.mcpTemplate), beforeTemplate);
  assert.deepEqual(fs.readFileSync(paths.envExample), beforeExample);
  assert.equal(fs.existsSync(paths.envFile), false);
  assert.equal(fs.existsSync(paths.mcpResolved), false);
}));
