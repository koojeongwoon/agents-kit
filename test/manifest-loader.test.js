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

test('Manifest secret detection handles templates, high-entropy values, and Bearer/Basic headers', () => {
  const root = fixture();

  // 1. Accepts placeholder values on secret fields
  const placeholderPath = path.join(root, 'placeholder.yaml');
  fs.writeFileSync(placeholderPath, `
schemaVersion: 1
kit:
  id: placeholder-kit
assets:
  mcpServers:
    - id: test-mcp
      connection:
        command: "node"
      apiToken: "\${GITHUB_TOKEN}"
      password: "env:MY_PASSWORD"
`);
  const loadedPlaceholder = loadManifestFile({ manifestPath: placeholderPath, scopeRoot: root });
  assert.equal(loadedPlaceholder.manifest.assets.mcpServers[0].id, 'test-mcp');

  // 2. Rejects Bearer / Basic prefixed values on any field
  const bearerPath = path.join(root, 'bearer.yaml');
  fs.writeFileSync(bearerPath, `
schemaVersion: 1
kit:
  id: bearer-kit
assets:
  mcpServers:
    - id: test-mcp
      connection:
        command: "node"
      customField: "Bearer abcd1234efgh5678"
`);
  assert.throws(
    () => loadManifestFile({ manifestPath: bearerPath, scopeRoot: root }),
    error => error instanceof DomainError && error.code === 'LITERAL_SECRET' && error.message.includes('authorization')
  );

  // 3. Rejects high-entropy values on secret fields
  const entropyPath = path.join(root, 'entropy.yaml');
  fs.writeFileSync(entropyPath, `
schemaVersion: 1
kit:
  id: entropy-kit
assets:
  mcpServers:
    - id: test-mcp
      connection:
        command: "node"
      apiToken: "abcdef1234567890abcdef"
`);
  assert.throws(
    () => loadManifestFile({ manifestPath: entropyPath, scopeRoot: root }),
    error => error instanceof DomainError && error.code === 'LITERAL_SECRET'
  );

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
  
  // Test case 1: requires.tools contains a malformed tool ID
  const manifestPath1 = path.join(root, 'invalid-reference-requires.json');
  fs.writeFileSync(manifestPath1, JSON.stringify({
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
    () => loadManifestFile({ manifestPath: manifestPath1, scopeRoot: root }),
    error => error instanceof DomainError && error.code === 'INVALID_TOOL_REQUIREMENT'
  );

  // Test case 2: uses.tools contains a malformed tool ID even if requires.tools is empty/missing
  const manifestPath2 = path.join(root, 'invalid-reference-uses.json');
  fs.writeFileSync(manifestPath2, JSON.stringify({
    schemaVersion: 1,
    kit: { id: 'backend-kit' },
    assets: {
      skills: [{
        id: 'review-uses',
        source: 'skills/review',
        uses: { tools: [{ id: 'bad/tool-name' }] }
      }]
    }
  }));
  assert.throws(
    () => loadManifestFile({ manifestPath: manifestPath2, scopeRoot: root }),
    error => error instanceof DomainError && error.code === 'INVALID_TOOL_REQUIREMENT'
  );

  // Test case 3: Both requires.tools and uses.tools exist, and the invalid one is in uses.tools
  const manifestPath3 = path.join(root, 'invalid-reference-both.json');
  fs.writeFileSync(manifestPath3, JSON.stringify({
    schemaVersion: 1,
    kit: { id: 'backend-kit' },
    assets: {
      skills: [{
        id: 'review-both',
        source: 'skills/review',
        requires: { tools: ['valid-tool'] },
        uses: { tools: [{ id: 'bad/tool-name' }] }
      }]
    }
  }));
  assert.throws(
    () => loadManifestFile({ manifestPath: manifestPath3, scopeRoot: root }),
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
    },
    {
      name: 'package-source-missing',
      assets: {
        packages: [{
          id: 'test-package',
          version: '1.0.0',
          integrity: 'sha256-hash'
        }]
      },
      code: 'PACKAGE_SOURCE_REQUIRED'
    },
    {
      name: 'package-version-missing',
      assets: {
        packages: [{
          id: 'test-package',
          source: 'git::https://github.com/org/kit.git',
          integrity: 'sha256-hash'
        }]
      },
      code: 'PACKAGE_VERSION_REQUIRED'
    },
    {
      name: 'package-integrity-missing',
      assets: {
        packages: [{
          id: 'test-package',
          source: 'git::https://github.com/org/kit.git',
          version: '1.0.0'
        }]
      },
      code: 'PACKAGE_INTEGRITY_REQUIRED'
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
