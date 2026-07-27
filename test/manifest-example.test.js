import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  createAgentKitManifest,
  resolveManifestDependencies,
  validateManifestAssetContracts
} from '../lib/domain/manifest.js';

test('Documented Agent Kit example satisfies domain and dependency contracts', () => {
  const raw = parseYaml(fs.readFileSync('docs/examples/agent-kit.yaml', 'utf8'));
  const manifest = createAgentKitManifest(raw);
  validateManifestAssetContracts(manifest, { requireMaterialization: true });

  const result = resolveManifestDependencies(manifest, {
    selectedAssetIds: ['default-harness', 'incident-history'],
    targetScope: { type: 'global' }
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.assetIds, [
    'daily-incident-review',
    'default-harness',
    'github-mcp',
    'incident-analysis',
    'incident-history',
    'incident-read-only',
    'incident-responder',
    'incident-summary',
    'observability-mcp'
  ]);
  assert.deepEqual(
    result.toolBindings.map(binding => `${binding.consumerId}:${binding.toolId}`),
    [
      'daily-incident-review:logs.query',
      'incident-analysis:github.search-commits',
      'incident-analysis:logs.query'
    ]
  );
});
