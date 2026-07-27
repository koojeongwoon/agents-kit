import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../lib/domain/errors.js';
import {
  createAgentKitManifest,
  resolveManifestDependencies
} from '../lib/domain/manifest.js';

function validManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    kit: { id: 'backend-kit', name: 'Backend Kit' },
    assets: {
      skills: [],
      agents: [],
      mcpServers: [],
      policies: [],
      memory: [],
      workflows: [],
      harness: [],
      ...overrides
    }
  };
}

test('Manifest validates schema version, kit identity, and duplicate asset IDs', () => {
  assert.throws(
    () => createAgentKitManifest({ schemaVersion: 2, kit: { id: 'kit' }, assets: {} }),
    error => error instanceof DomainError && error.code === 'UNSUPPORTED_MANIFEST_VERSION'
  );
  assert.throws(
    () => createAgentKitManifest(validManifest({
      skills: [{ id: 'shared' }],
      agents: [{ id: 'shared' }]
    })),
    error => error instanceof DomainError && error.code === 'DUPLICATE_ASSET_ID'
  );
  assert.throws(
    () => createAgentKitManifest(validManifest({ skills: [{ id: '../escape' }] })),
    error => error instanceof DomainError && error.code === 'INVALID_ASSET_ID'
  );
});

test('Agent dependency closure resolves Skills and logical Tools through MCP providers', () => {
  const manifest = createAgentKitManifest(validManifest({
    skills: [{
      id: 'incident-analysis',
      scope: 'global',
      requires: {
        tools: [{ id: 'github.search-commits', capability: 'repository.read' }]
      }
    }],
    agents: [{
      id: 'incident-responder',
      scope: 'global',
      uses: { skills: ['incident-analysis'] }
    }],
    mcpServers: [{
      id: 'github-mcp',
      scope: 'global',
      provides: { tools: ['github.search-commits'] }
    }]
  }));

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['incident-responder'],
    targetScope: { type: 'global' }
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.assetIds, ['github-mcp', 'incident-analysis', 'incident-responder']);
  assert.deepEqual(result.toolBindings, [{
    consumerId: 'incident-analysis',
    toolId: 'github.search-commits',
    providerId: 'github-mcp',
    capability: 'repository.read'
  }]);
});

test('Reference validation reports missing assets and missing or ambiguous Tool providers', () => {
  const missing = createAgentKitManifest(validManifest({
    agents: [{ id: 'agent', uses: { skills: ['missing-skill'] } }],
    skills: [{
      id: 'search',
      requires: { tools: [{ id: 'search.query', capability: 'search.read' }] }
    }]
  }));
  const missingResult = resolveManifestDependencies(missing, {
    selectedAssetIds: ['agent', 'search'],
    targetScope: { type: 'global' }
  });
  assert.deepEqual(
    missingResult.issues.map(issue => issue.code).sort(),
    ['MISSING_REFERENCE', 'MISSING_TOOL_PROVIDER']
  );

  const ambiguous = createAgentKitManifest(validManifest({
    skills: [{
      id: 'search',
      requires: { tools: [{ id: 'search.query', capability: 'search.read' }] }
    }],
    mcpServers: [
      { id: 'provider-a', provides: { tools: ['search.query'] } },
      { id: 'provider-b', provides: { tools: ['search.query'] } }
    ]
  }));
  const ambiguousResult = resolveManifestDependencies(ambiguous, {
    selectedAssetIds: ['search'],
    targetScope: { type: 'global' }
  });
  assert.equal(ambiguousResult.issues[0].code, 'AMBIGUOUS_TOOL_PROVIDER');
});

test('Global assets cannot reference project assets', () => {
  const manifest = createAgentKitManifest(validManifest({
    skills: [{ id: 'project-skill', scope: { type: 'project', projectName: 'wiki' } }],
    agents: [{
      id: 'global-agent',
      scope: 'global',
      uses: { skills: ['project-skill'] }
    }]
  }));

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['global-agent'],
    targetScope: { type: 'global' }
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, 'SCOPE_VIOLATION');
});

test('Effective Policy denies a required Tool capability', () => {
  const manifest = createAgentKitManifest(validManifest({
    policies: [{
      id: 'read-only',
      deny: { capabilities: ['repository.write'] }
    }],
    skills: [{
      id: 'release',
      policies: ['read-only'],
      requires: {
        tools: [{ id: 'github.create-release', capability: 'repository.write' }]
      }
    }],
    mcpServers: [{
      id: 'github-mcp',
      provides: { tools: ['github.create-release'] }
    }]
  }));

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['release'],
    targetScope: { type: 'global' }
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, 'POLICY_DENIED');
});

test('Skill dependency cycles fail closed', () => {
  const manifest = createAgentKitManifest(validManifest({
    skills: [
      { id: 'skill-a', dependsOn: { skills: ['skill-b'] } },
      { id: 'skill-b', dependsOn: { skills: ['skill-a'] } }
    ]
  }));

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['skill-a'],
    targetScope: { type: 'global' }
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, 'CYCLIC_DEPENDENCY');
  assert.deepEqual(result.issues[0].path, ['skill-a', 'skill-b', 'skill-a']);
});

test('Workflow steps resolve Agent, Skill, and logical Tool dependencies', () => {
  const manifest = createAgentKitManifest(validManifest({
    skills: [{ id: 'verify-report' }],
    agents: [{ id: 'incident-responder' }],
    workflows: [{
      id: 'daily-review',
      steps: [
        { id: 'collect', use: { tool: 'logs.query' }, capability: 'logs.read' },
        { id: 'respond', use: { agent: 'incident-responder' } },
        { id: 'verify', use: { skill: 'verify-report' } }
      ]
    }],
    mcpServers: [{
      id: 'logs-mcp',
      provides: { tools: ['logs.query'] }
    }]
  }));

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['daily-review'],
    targetScope: { type: 'global' }
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.assetIds, [
    'daily-review', 'incident-responder', 'logs-mcp', 'verify-report'
  ]);
  assert.deepEqual(result.toolBindings, [{
    consumerId: 'daily-review',
    toolId: 'logs.query',
    providerId: 'logs-mcp',
    capability: 'logs.read'
  }]);
});

test('Memory readers and writers are typed references in the dependency graph', () => {
  const manifest = createAgentKitManifest(validManifest({
    agents: [{ id: 'incident-responder' }],
    skills: [{ id: 'incident-summary' }],
    memory: [{
      id: 'incident-history',
      access: {
        readers: { agents: ['incident-responder'] },
        writers: { skills: ['incident-summary'] }
      },
      promotion: { requiresApproval: true }
    }]
  }));

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['incident-history'],
    targetScope: { type: 'global' }
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.assetIds, [
    'incident-history', 'incident-responder', 'incident-summary'
  ]);
});

test('Selected Harness capability policy denies nested Skill Tool requirements', () => {
  const manifest = createAgentKitManifest(validManifest({
    harness: [{
      id: 'read-only-harness',
      enables: { agents: ['release-agent'] },
      policy: { deny: { capabilities: ['repository.write'] } }
    }],
    agents: [{
      id: 'release-agent',
      uses: { skills: ['publish-release'] }
    }],
    skills: [{
      id: 'publish-release',
      requires: {
        tools: [{ id: 'github.create-release', capability: 'repository.write' }]
      }
    }],
    mcpServers: [{
      id: 'github-mcp',
      provides: { tools: ['github.create-release'] }
    }]
  }));

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['read-only-harness'],
    targetScope: { type: 'global' }
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, 'POLICY_DENIED');
  assert.equal(result.issues[0].sourceAssetId, 'publish-release');
  assert.equal(result.issues[0].policyId, 'read-only-harness');
});
