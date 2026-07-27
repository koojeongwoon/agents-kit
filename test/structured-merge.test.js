import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeStructuredDocument } from '../lib/domain/structured-merge.js';

test('JSON merge owns desired leaves and preserves user-owned fields', () => {
  const result = mergeStructuredDocument({
    format: 'json-section',
    current: JSON.stringify({ theme: 'dark', mcpServers: { local: { command: 'node' } } }),
    desired: JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['server'] } } }),
    assetId: 'github'
  });
  assert.deepEqual(JSON.parse(result.content), {
    theme: 'dark',
    mcpServers: {
      local: { command: 'node' },
      github: { command: 'npx', args: ['server'] }
    }
  });
  assert.deepEqual(Object.keys(result.units).sort(), [
    '/mcpServers/github/args',
    '/mcpServers/github/command'
  ]);
});

test('JSON merge rejects unknown collisions and externally modified owned leaves', () => {
  let result = mergeStructuredDocument({
    format: 'json',
    current: '{"setting":"user"}',
    desired: '{"setting":"kit"}',
    assetId: 'settings'
  });
  assert.equal(result.conflicts[0].reason, 'UNKNOWN_EXISTING_CONTENT');

  result = mergeStructuredDocument({
    format: 'json',
    current: '{"setting":"external"}',
    desired: '{"setting":"next"}',
    assetId: 'settings',
    previousUnits: { '/setting': { hash: 'stale-owned-hash' } }
  });
  assert.equal(result.conflicts[0].reason, 'OWNED_CONTENT_MODIFIED_EXTERNALLY');
});

test('TOML merge replaces only explicitly owned tables', () => {
  const result = mergeStructuredDocument({
    format: 'toml-section',
    current: 'model = "gpt"\n\n[user]\ntheme = "dark"\n',
    desired: '[mcp_servers.github]\ncommand = "npx"\nargs = ["server"]\n',
    assetId: 'github'
  });
  assert.match(result.content, /model = "gpt"/);
  assert.match(result.content, /\[user]/);
  assert.match(result.content, /\[mcp_servers\.github]/);
  assert.ok(result.units['mcp_servers.github']);
});

test('TOML merge refuses unscoped root values and table collisions', () => {
  assert.throws(() => mergeStructuredDocument({
    format: 'toml',
    current: '',
    desired: 'model = "gpt-5"\n',
    assetId: 'settings'
  }), error => error.code === 'TOML_OWNERSHIP_SELECTOR_REQUIRED');
  const result = mergeStructuredDocument({
    format: 'toml',
    current: '[agents.review]\ndescription = "user"\n',
    desired: '[agents.review]\ndescription = "kit"\n',
    assetId: 'review'
  });
  assert.equal(result.conflicts[0].reason, 'UNKNOWN_EXISTING_CONTENT');
});

test('Markdown merge uses one asset-owned block and preserves surrounding text', () => {
  const first = mergeStructuredDocument({
    format: 'markdown',
    current: '# User instructions\n\nKeep this.',
    desired: '## Kit rules\n\nRun tests.',
    assetId: 'project-rules'
  });
  assert.match(first.content, /# User instructions/);
  assert.match(first.content, /agents-kit:project-rules:start/);
  const second = mergeStructuredDocument({
    format: 'markdown',
    current: first.content,
    desired: '## Kit rules\n\nRun all tests.',
    assetId: 'project-rules',
    previousUnits: first.units
  });
  assert.match(second.content, /Run all tests/);
  assert.doesNotMatch(second.content, /Run tests\\./);
  assert.match(second.content, /Keep this/);
});

test('Markdown merge detects edits inside an owned block', () => {
  const initial = mergeStructuredDocument({
    format: 'markdown',
    current: '',
    desired: 'Managed',
    assetId: 'rules'
  });
  const changed = initial.content.replace('Managed', 'Changed externally');
  const result = mergeStructuredDocument({
    format: 'markdown',
    current: changed,
    desired: 'Next',
    assetId: 'rules',
    previousUnits: initial.units
  });
  assert.equal(result.conflicts[0].reason, 'OWNED_CONTENT_MODIFIED_EXTERNALLY');
  assert.equal(result.content, changed);
});
