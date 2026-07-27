import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadKitDesiredState,
  projectLegacyKit
} from '../lib/infrastructure/legacy-manifest-projector.js';

function legacyKit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-legacy-'));
  const files = {
    'harness/AGENTS.md': '# Rules\n',
    'harness/allowed-commands.json': '{"commands":["npm test"]}',
    'harness/hooks.json': '{"hooks":{}}',
    'skills/code-review/SKILL.md': '# Review\n',
    'agents/security-auditor.md': '# Security\n',
    'loops/daily-docs/LOOP.md': '# Daily\n',
    'memory/global_memory.md': '# Memory\n',
    'mcp/mcp-servers.json': JSON.stringify({
      mcpServers: {
        github: { command: 'github-mcp' },
        fetch: { command: 'uvx', args: ['mcp-server-fetch'] }
      }
    })
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

test('Legacy projector creates a client-neutral Manifest view without modifying files', () => {
  const root = legacyKit();
  const before = fs.readdirSync(root).sort();
  const result = projectLegacyKit({ scopeRoot: root, scope: { type: 'global' } });

  assert.equal(result.mode, 'legacy-projection');
  assert.equal(result.manifest.schemaVersion, 1);
  assert.deepEqual(result.manifest.assets.skills.map(asset => asset.id), ['code-review']);
  assert.deepEqual(result.manifest.assets.agents.map(asset => asset.id), ['security-auditor']);
  assert.deepEqual(result.manifest.assets.workflows.map(asset => asset.id), ['daily-docs']);
  assert.deepEqual(result.manifest.assets.mcpServers.map(asset => asset.id), ['fetch', 'github']);
  assert.equal(result.manifest.assets.instructions[0].source, 'harness/AGENTS.md');
  assert.equal(result.manifest.assets.hooks[0].source, 'harness/hooks.json');
  assert.equal(result.manifest.assets.memory[0].source, 'memory/global_memory.md');
  assert.deepEqual(fs.readdirSync(root).sort(), before);
  assert.equal(fs.existsSync(path.join(root, 'agent-kit.yaml')), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Legacy projection records every projected source as an authorized real path', () => {
  const root = legacyKit();
  const result = projectLegacyKit({ scopeRoot: root, scope: { type: 'global' } });
  for (const asset of Object.values(result.manifest.assets).flat()) {
    if (!asset.source) continue;
    assert.equal(result.sources.get(asset.id), fs.realpathSync(path.join(root, asset.source)));
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('Desired-state loader prefers an explicit Manifest and otherwise returns projection', () => {
  const root = legacyKit();
  const projected = loadKitDesiredState({ scopeRoot: root, scope: { type: 'global' } });
  assert.equal(projected.mode, 'legacy-projection');

  fs.writeFileSync(path.join(root, 'agent-kit.yaml'), `
schemaVersion: 1
kit:
  id: explicit-kit
assets: {}
`);
  const explicit = loadKitDesiredState({ scopeRoot: root, scope: { type: 'global' } });
  assert.equal(explicit.mode, 'manifest');
  assert.equal(explicit.manifest.kit.id, 'explicit-kit');
  fs.rmSync(root, { recursive: true, force: true });
});
