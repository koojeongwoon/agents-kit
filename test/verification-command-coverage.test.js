import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {mcpListCoverage} from '../lib/adapters/verification/command-coverage.js';
import {discoveryEvidence} from '../lib/adapters/verification/probe-evidence.js';

const evidence = JSON.parse(fs.readFileSync(new URL('../docs/reconstruction/antigravity-mcp-list-scope-control-20261106.json', import.meta.url), 'utf8'));
const build = Object.fromEntries(['clientId', 'version', 'binarySha256', 'platform', 'arch'].map(key => [key, evidence[key]]));
test('the recorded Antigravity list failure cannot disprove project loading because its controls cover only global configuration', () => {
  assert.equal(mcpListCoverage(evidence, build).coversRequestedScope, false);
  const before = discoveryEvidence({mcp: {present: false}}, {resource: 'mcp', present: true}); assert.equal(before.nativeRecognition.status, 'failed');
  const after = discoveryEvidence({mcp: {present: false, coversRequestedScope: false}}, {resource: 'mcp', present: true});
  assert.equal(after.nativeRecognition.status, 'not-observed'); assert.equal(after.confirmed, false);
  assert.equal(discoveryEvidence({mcp: {present: false, coversRequestedScope: true}}, {resource: 'mcp', present: true}).nativeRecognition.status, 'failed');
});
test('command coverage cannot be transferred to another build or an incomplete/unrestored control', () => {
  for (const patch of [{version: '9.9.9'}, {binarySha256: '0'.repeat(64)}, {clientId: 'codex'}, {arch: 'x64'}]) assert.throws(() => mcpListCoverage(evidence, {...build, ...patch}), {code: 'INVALID_LIST_SCOPE_EVIDENCE'});
  for (const patch of [{controlsRestored: false}, {modelRequests: 1}, {freshHome: false}, {observations: evidence.observations.slice(1)}]) assert.throws(() => mcpListCoverage({...evidence, ...patch}, build), {code: 'INVALID_LIST_SCOPE_EVIDENCE'});
});
