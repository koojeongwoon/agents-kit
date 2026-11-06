import assert from 'node:assert/strict';
import test from 'node:test';
import {composePhysicalResourceContributions, validPhysicalResource, physicalResourceTargets} from '../lib/domain/physical-resource.js';

function contribution({clientId = 'codex', surface = 'cli', assetId = 'docs', args = ['lookup'], content, dependencyIds = []} = {}) {
  return {resource: {version: 1, kitId: 'kit', assetId, assetKind: 'mcpServers', configStore: 'shared-local', clientId, surface, scope: 'project', format: 'json', dependencyIds},
    strategy: 'merge', format: 'json', content: content ?? JSON.stringify({mcpServers: {[assetId]: {command: 'node', args}}})};
}
test('physical composition keeps distinct selectors and combines matching readers using stable IDs', () => {
  const composed = composePhysicalResourceContributions([contribution(), contribution({clientId: 'antigravity'}), contribution({surface: 'desktop', assetId: 'math'})]);
  assert.equal(composed.resources.length, 2); assert.deepEqual(composed.resources[0].resource.targets, [{clientId: 'antigravity', surface: 'cli'}, {clientId: 'codex', surface: 'cli'}]);
  assert.equal(composed.targets.length, 3); assert.equal(validPhysicalResource(composed.resources[0].resource), true);
  assert.deepEqual(composePhysicalResourceContributions([contribution({assetId: 'math'}), contribution()]).resources.map(item => item.resource.assetId), ['docs', 'math']);
});
test('canonical selector values compose independently of JSON field order', () => {
  const first = contribution(), second = contribution({surface: 'desktop', content: '{"mcpServers":{"docs":{"args":["lookup"],"command":"node"}}}'});
  assert.deepEqual(composePhysicalResourceContributions([first, second]), composePhysicalResourceContributions([second, first]));
});
test('different generated values, dependency identities and physical stores are explicit conflicts', () => {
  for (const mutate of [item => {item.content = contribution({args: ['other']}).content;}, item => {item.resource.dependencyIds = ['other'];}]) {
    const second = contribution({surface: 'desktop'}); mutate(second);
    assert.throws(() => composePhysicalResourceContributions([contribution(), second]), {code: 'PHYSICAL_RESOURCE_CONTENT_CONFLICT'});
  }
  for (const key of ['scope', 'configStore', 'format']) {
    const second = contribution({surface: 'desktop'}); second.resource[key] = {scope: 'global', configStore: 'another-store', format: 'toml-section'}[key];
    assert.throws(() => composePhysicalResourceContributions([contribution(), second]), {code: 'PHYSICAL_RESOURCE_STORE_CONFLICT'});
  }
});
test('generated MCP contributions cannot claim selectors belonging to a different logical asset', () => {
  const second = contribution({assetId: 'other', content: contribution().content});
  assert.throws(() => composePhysicalResourceContributions([second]), {code: 'PHYSICAL_RESOURCE_SELECTOR_CONFLICT'});
});
test('reader and resource identities reject coercible values, duplicates and ambiguous versions', () => {
  for (const targets of [[{clientId: ['codex'], surface: 'cli'}], [{clientId: 'codex', surface: 123}], [{clientId: 'codex', surface: 'cli', permissions: '*'}]]) {
    assert.throws(() => physicalResourceTargets(targets), {code: 'INVALID_PHYSICAL_RESOURCE'});
  }
  const resource = composePhysicalResourceContributions([contribution()]).resources[0].resource;
  for (const patch of [{assetId: 123}, {configStore: ['shared-local']}, {version: 3}, {dependencyIds: [123]}, {targets: [...resource.targets, ...resource.targets]}]) assert.equal(validPhysicalResource({...resource, ...patch}), false);
});
