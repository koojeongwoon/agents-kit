import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createClientDefinition,
  resolveClientCapability
} from '../lib/domain/client-definition.js';
import { loadClientDefinitions } from '../lib/infrastructure/client-definition-loader.js';
import { planClientDeployment } from '../lib/application/plan-client-deployment.js';
import { createAgentKitManifest } from '../lib/domain/manifest.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function definitionWith(capability) {
  return createClientDefinition({
    schemaVersion: 1,
    id: 'example',
    displayName: 'Example',
    capabilities: [{
      id: 'skills-project',
      assetKind: 'skills',
      scope: 'project',
      path: '.example/skills/{assetId}',
      format: 'directory',
      strategy: 'copy',
      status: 'stable',
      evidence: {
        state: 'verified',
        source: 'https://example.com/docs/skills',
        verifiedAt: '2026-07-27'
      },
      ...capability
    }]
  });
}

test('stable verified capability is eligible for automatic deployment', () => {
  const result = resolveClientCapability(definitionWith({}), {
    assetKind: 'skills',
    scope: 'project'
  });
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'CAPABILITY_ELIGIBLE');
});

test('unverified and unsupported capabilities fail closed', () => {
  const unverified = resolveClientCapability(definitionWith({
    status: 'unverified',
    strategy: 'manual',
    path: '',
    evidence: { state: 'unverified' }
  }), { assetKind: 'skills', scope: 'project' });
  assert.equal(unverified.reason, 'CAPABILITY_UNVERIFIED');

  const unsupported = resolveClientCapability(definitionWith({
    status: 'unsupported',
    strategy: 'copy'
  }), { assetKind: 'skills', scope: 'project' });
  assert.equal(unsupported.reason, 'CAPABILITY_UNSUPPORTED');
});

test('preview capability requires explicit opt-in', () => {
  const definition = definitionWith({ status: 'preview' });
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project'
  }).reason, 'CAPABILITY_PREVIEW_OPT_IN_REQUIRED');
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project',
    previewOptIn: true
  }).eligible, true);
});

test('version-dependent capability requires a supported detected version', () => {
  const definition = definitionWith({
    status: 'version-dependent',
    version: { min: '1.2.0', max: '2.0.0' }
  });
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project'
  }).reason, 'CLIENT_VERSION_REQUIRED');
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project',
    clientVersion: 'v1.7.2'
  }).eligible, true);
  assert.equal(resolveClientCapability(definition, {
    assetKind: 'skills',
    scope: 'project',
    clientVersion: '2.1.0'
  }).reason, 'CLIENT_VERSION_UNSUPPORTED');
});

test('invalid evidence and duplicate capability IDs are rejected', () => {
  assert.throws(() => definitionWith({
    evidence: { state: 'verified', source: 'http://example.com', verifiedAt: '2026-07-27' }
  }), error => error.code === 'INVALID_CAPABILITY_EVIDENCE');
  const capability = definitionWith({}).capabilities[0];
  assert.throws(() => createClientDefinition({
    schemaVersion: 1,
    id: 'duplicate',
    displayName: 'Duplicate',
    capabilities: [capability, capability]
  }), error => error.code === 'DUPLICATE_CLIENT_CAPABILITY');
});

test('official Codex and Claude Code definitions load with corrected mappings', () => {
  const definitions = loadClientDefinitions({
    definitionsDir: path.join(repositoryRoot, 'clients')
  });
  const codex = definitions.get('codex');
  const claude = definitions.get('claude-code');
  assert.ok(codex);
  assert.ok(claude);

  const codexPaths = codex.capabilities.map(item => item.path);
  assert.ok(codexPaths.includes('.agents/skills/{assetId}'));
  assert.ok(codexPaths.includes('.codex/config.toml'));
  assert.ok(!codexPaths.some(item => item.includes('.codex/skills')));
  assert.ok(!codexPaths.some(item => item.includes('.codex/mcp.json')));
  assert.ok(!codexPaths.includes('.codex/AGENTS.md'));

  const claudeHarness = resolveClientCapability(claude, {
    assetKind: 'harness',
    scope: 'project'
  });
  assert.equal(claudeHarness.capability.path, '.claude/settings.json');
  assert.ok(!claude.capabilities.some(item => item.path.includes('.claude/hooks.json')));
  assert.equal(resolveClientCapability(claude, {
    assetKind: 'workflows',
    scope: 'global'
  }).reason, 'CAPABILITY_UNVERIFIED');
});

test('Cursor, Antigravity, and Windsurf use current documented paths', () => {
  const definitions = loadClientDefinitions({
    definitionsDir: path.join(repositoryRoot, 'clients')
  });

  const cursor = definitions.get('cursor');
  assert.equal(resolveClientCapability(cursor, {
    assetKind: 'instructions',
    scope: 'project'
  }).capability.path, '.cursor/rules/{assetId}.mdc');
  assert.equal(resolveClientCapability(cursor, {
    assetKind: 'instructions',
    scope: 'global'
  }).reason, 'CAPABILITY_UI_ONLY');
  assert.equal(resolveClientCapability(cursor, {
    assetKind: 'mcp',
    scope: 'global'
  }).capability.path, '~/.cursor/mcp.json');
  assert.ok(!cursor.capabilities.some(item => item.path === '.cursorrules'));

  const antigravity = definitions.get('antigravity');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'instructions',
    scope: 'global'
  }).capability.path, '~/.gemini/GEMINI.md');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'skills',
    scope: 'project'
  }).capability.path, '.agents/skills/{assetId}');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'mcp',
    scope: 'project'
  }).capability.path, '.agents/mcp_config.json');
  assert.equal(resolveClientCapability(antigravity, {
    assetKind: 'agents',
    scope: 'project'
  }).reason, 'CAPABILITY_UNVERIFIED');

  const windsurf = definitions.get('windsurf');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'instructions',
    scope: 'project'
  }).capability.path, 'AGENTS.md');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'mcp',
    scope: 'global'
  }).capability.path, '~/.codeium/windsurf/mcp_config.json');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'skills',
    scope: 'project'
  }).capability.path, '.windsurf/skills/{assetId}');
  assert.equal(resolveClientCapability(windsurf, {
    assetKind: 'workflows',
    scope: 'project'
  }).capability.path, '.windsurf/workflows/{assetId}.md');
  assert.ok(!windsurf.capabilities.some(item => item.path === '.windsurfrules'));
  assert.ok(!windsurf.capabilities.some(item => item.path === '.windsurf/mcp.json'));
});

test('loader rejects duplicate client definition IDs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-clients-'));
  const source = fs.readFileSync(path.join(repositoryRoot, 'clients', 'codex.yaml'), 'utf8');
  fs.writeFileSync(path.join(directory, 'one.yaml'), source);
  fs.writeFileSync(path.join(directory, 'two.yml'), source);
  assert.throws(
    () => loadClientDefinitions({ definitionsDir: directory }),
    error => error.code === 'DUPLICATE_CLIENT_DEFINITION'
  );
});

test('deployment plan exposes manual items and rejects strict automatic apply', () => {
  const definitions = loadClientDefinitions({
    definitionsDir: path.join(repositoryRoot, 'clients')
  });
  const manifest = createAgentKitManifest({
    schemaVersion: 1,
    kit: { id: 'planning-example' },
    assets: {
      skills: [{
        id: 'review',
        source: 'skills/review',
        scope: { type: 'project', root: '/tmp/example-project' }
      }],
      memory: [{
        id: 'history',
        source: 'memory/history.md',
        scope: 'global'
      }]
    }
  });
  const plan = planClientDeployment({
    manifest,
    definition: definitions.get('codex')
  });
  assert.equal(plan.automatic, false);
  assert.equal(plan.operations[0].target, '.agents/skills/review');
  assert.equal(plan.blocked[0].reason, 'CAPABILITY_UNVERIFIED');
  assert.throws(() => planClientDeployment({
    manifest,
    definition: definitions.get('codex'),
    allowManual: false
  }), error => error.code === 'CLIENT_DEPLOYMENT_BLOCKED');
});
