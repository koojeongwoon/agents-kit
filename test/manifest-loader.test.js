import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DomainError } from '../lib/domain/errors.js';
import {
  discoverAndLoadManifest,
  loadManifestFile
} from '../lib/infrastructure/manifest-loader.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-manifest-'));
  fs.mkdirSync(path.join(root, 'skills', 'review'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'review', 'SKILL.md'), '# Review\n');
  return root;
}

test('YAML Manifest loads and resolves asset sources inside its scope root', () => {
  const root = fixture();
  const manifestPath = path.join(root, 'agent-kit.yaml');
  fs.writeFileSync(manifestPath, `
schemaVersion: 1
kit:
  id: backend-kit
  name: Backend Kit
assets:
  skills:
    - id: code-review
      source: skills/review
`);

  const result = loadManifestFile({ manifestPath, scopeRoot: root });
  assert.equal(result.format, 'yaml');
  assert.equal(result.manifest.kit.id, 'backend-kit');
  assert.equal(result.sources.get('code-review'), fs.realpathSync(path.join(root, 'skills', 'review')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('JSON Manifest is supported with the same domain validation', () => {
  const root = fixture();
  const manifestPath = path.join(root, 'agent-kit.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    kit: { id: 'backend-kit' },
    assets: { skills: [{ id: 'code-review', source: 'skills/review' }] }
  }));

  const result = loadManifestFile({ manifestPath, scopeRoot: root });
  assert.equal(result.format, 'json');
  assert.equal(result.manifest.assets.skills[0].id, 'code-review');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Manifest source rejects traversal, absolute paths, missing paths, and symlink escapes', () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'outside');
  fs.symlinkSync(outside, path.join(root, 'escaped'));

  for (const [source, code] of [
    ['../outside', 'SOURCE_OUTSIDE_SCOPE'],
    [path.join(outside, 'secret.md'), 'ABSOLUTE_SOURCE_PATH'],
    ['missing/SKILL.md', 'SOURCE_NOT_FOUND'],
    ['escaped/secret.md', 'SOURCE_OUTSIDE_SCOPE']
  ]) {
    const manifestPath = path.join(root, `case-${code}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      kit: { id: 'backend-kit' },
      assets: { skills: [{ id: 'code-review', source }] }
    }));
    assert.throws(
      () => loadManifestFile({ manifestPath, scopeRoot: root }),
      error => error instanceof DomainError && error.code === code
    );
  }

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('Manifest rejects literal secrets and accepts environment references', () => {
  const root = fixture();
  const rejectedPath = path.join(root, 'literal.yaml');
  fs.writeFileSync(rejectedPath, `
schemaVersion: 1
kit:
  id: backend-kit
assets:
  mcpServers:
    - id: github-mcp
      apiToken: ghp_actual_secret_value
`);
  assert.throws(
    () => loadManifestFile({ manifestPath: rejectedPath, scopeRoot: root }),
    error => error instanceof DomainError && error.code === 'LITERAL_SECRET'
  );

  const acceptedPath = path.join(root, 'reference.yaml');
  fs.writeFileSync(acceptedPath, `
schemaVersion: 1
kit:
  id: backend-kit
assets:
  mcpServers:
    - id: github-mcp
      environment:
        GITHUB_TOKEN:
          source: environment
          name: GITHUB_TOKEN
`);
  const accepted = loadManifestFile({ manifestPath: acceptedPath, scopeRoot: root });
  assert.equal(accepted.manifest.assets.mcpServers[0].id, 'github-mcp');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Discovery requires a Manifest and prefers YAML without creating compatibility state', () => {
  const root = fixture();
  assert.throws(
    () => discoverAndLoadManifest({ scopeRoot: root }),
    error => error.code === 'MANIFEST_REQUIRED'
  );
  assert.equal(fs.existsSync(path.join(root, 'agent-kit.yaml')), false);

  fs.writeFileSync(path.join(root, 'agent-kit.json'), JSON.stringify({
    schemaVersion: 1, kit: { id: 'json-kit' }, assets: {}
  }));
  fs.writeFileSync(path.join(root, 'agent-kit.yaml'), `
schemaVersion: 1
kit:
  id: yaml-kit
assets: {}
`);
  const loaded = discoverAndLoadManifest({ scopeRoot: root });
  assert.equal(loaded.manifest.kit.id, 'yaml-kit');
  assert.equal(loaded.format, 'yaml');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Loaded Manifest enforces kind-specific materialization contracts', () => {
  const root = fixture();
  const cases = [
    {
      name: 'skill-without-source',
      asset: { skills: [{ id: 'review' }] },
      code: 'ASSET_SOURCE_REQUIRED'
    },
    {
      name: 'workflow-without-source-or-steps',
      asset: { workflows: [{ id: 'daily-review' }] },
      code: 'WORKFLOW_DEFINITION_REQUIRED'
    },
    {
      name: 'mcp-without-config-or-provider',
      asset: { mcpServers: [{ id: 'github-mcp' }] },
      code: 'MCP_DEFINITION_REQUIRED'
    },
    {
      name: 'policy-without-rules',
      asset: { policies: [{ id: 'read-only' }] },
      code: 'POLICY_RULES_REQUIRED'
    }
  ];

  for (const fixtureCase of cases) {
    const manifestPath = path.join(root, `${fixtureCase.name}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      kit: { id: 'backend-kit' },
      assets: fixtureCase.asset
    }));
    assert.throws(
      () => loadManifestFile({ manifestPath, scopeRoot: root }),
      error => error instanceof DomainError && error.code === fixtureCase.code
    );
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('Loaded Manifest rejects malformed typed references and Tool declarations', () => {
  const root = fixture();
  const manifestPath = path.join(root, 'invalid-reference.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    kit: { id: 'backend-kit' },
    assets: {
      skills: [{
        id: 'review',
        source: 'skills/review',
        requires: { tools: [{ id: '../shell', capability: 'repository read' }] }
      }]
    }
  }));
  assert.throws(
    () => loadManifestFile({ manifestPath, scopeRoot: root }),
    error => error instanceof DomainError && error.code === 'INVALID_TOOL_REQUIREMENT'
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('Loaded Manifest validates Workflow step, Memory approval, and Harness policy shapes', () => {
  const root = fixture();
  const cases = [
    {
      name: 'workflow-multiple-targets',
      assets: {
        workflows: [{
          id: 'bad-workflow',
          steps: [{ id: 'step', use: { agent: 'agent-a', skill: 'skill-a' } }]
        }]
      },
      code: 'INVALID_WORKFLOW_STEP'
    },
    {
      name: 'memory-approval',
      assets: {
        memory: [{
          id: 'memory',
          source: 'skills/review/SKILL.md',
          promotion: { requiresApproval: 'yes' }
        }]
      },
      code: 'INVALID_MEMORY_PROMOTION'
    },
    {
      name: 'harness-policy',
      assets: {
        harness: [{
          id: 'harness',
          policy: { deny: { capabilities: ['repository write'] } }
        }]
      },
      code: 'INVALID_CAPABILITY'
    }
  ];

  for (const fixtureCase of cases) {
    const manifestPath = path.join(root, `${fixtureCase.name}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      kit: { id: 'backend-kit' },
      assets: fixtureCase.assets
    }));
    assert.throws(
      () => loadManifestFile({ manifestPath, scopeRoot: root }),
      error => error instanceof DomainError && error.code === fixtureCase.code
    );
  }
  fs.rmSync(root, { recursive: true, force: true });
});
