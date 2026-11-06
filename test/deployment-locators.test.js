import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {recordedDeploymentLocators} from '../lib/application/deployment-locator-evidence.js';
import {validDeploymentLocator} from '../lib/domain/deployment-locator.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-locators-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), targetRoot = path.join(root, 'project'), scopeRoot = path.join(root, 'kit'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [homeDir, targetRoot, path.join(scopeRoot, 'skill')]) fs.mkdirSync(dir, {recursive: true});
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve('.'), capabilityIds: ['instructions-project', 'skills-project', 'agents-project', 'mcp-project']});
  const raw = {schemaVersion: 1, kit: {id: 'locators'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: 'node'}}}}, assets: {
    instructions: [{id: 'rules', scope: 'project', source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
    skills: [{id: 'review', scope: 'project', source: 'skill', definition: {schemaVersion: 1, format: 'agent-skills'}}],
    agents: [{id: 'reviewer', scope: 'project', definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Review.'}}],
    mcpServers: ['docs', 'other'].map(id => ({id, scope: 'project', definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: [id]}}))
  }};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Rules\n'); fs.writeFileSync(path.join(scopeRoot, 'skill/SKILL.md'), '---\nname: review\ndescription: Review\n---\nReview.\n');
  const service = createManifestDeploymentService({homeDir, definitionsDir}), input = {scopeRoot, targetRoot, scope: 'project', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const statePath = path.join(targetRoot, '.agent-kit/state.json'), state = () => JSON.parse(fs.readFileSync(statePath));
  return {raw, write, service, input, state, targetRoot};
}

test('committed ownership carries versioned applied locators for every common and typed resource without changing the ownership schema', t => {
  const f = fixture(t), plan = f.service.plan(f.input); assert.equal(plan.automatic, true); f.service.apply({planId: plan.planId});
  const state = f.state(); assert.equal(state.schemaVersion, 4);
  for (const [target, record] of Object.entries(state.managed)) {
    const locators = recordedDeploymentLocators(state, target); assert.ok(locators.length, target);
    assert.ok(locators.every(validDeploymentLocator)); assert.ok(locators.every(l => /^[a-f0-9]{64}$/.test(l.definitionDigest)));
    assert.ok(locators.every(l => l.scope === 'project' && l.kitId === 'locators' && l.clientId === 'codex' && l.surface === 'cli'));
    assert.ok(record.transactionId); assert.ok(state.transactions.find(tx => tx.id === record.transactionId).operations.some(op => op.locators?.length));
  }
  const tampered = structuredClone(state), target = Object.keys(tampered.managed)[0]; tampered.managed[target].hash = '0'.repeat(64);
  assert.deepEqual(recordedDeploymentLocators(tampered, target), []);
  assert.ok(f.service.plan(f.input).operations.every(op => op.operation === 'SKIP'));
});

test('updating one MCP carries forward proven locators for another installed server and rollback restores the earlier evidence', t => {
  const f = fixture(t); f.service.apply({planId: f.service.plan(f.input).planId}); const target = path.join(f.targetRoot, '.codex/config.toml');
  const original = recordedDeploymentLocators(f.state(), target); assert.deepEqual(original.map(l => l.assetId).sort(), ['docs', 'other']);
  f.raw.assets.mcpServers = [f.raw.assets.mcpServers[0]]; f.raw.assets.mcpServers[0].definition.args = ['changed']; f.write();
  const applied = f.service.apply({planId: f.service.plan(f.input).planId});
  assert.deepEqual(recordedDeploymentLocators(f.state(), target).map(l => l.assetId).sort(), ['docs', 'other']);
  f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: applied.transactionId}).planId});
  assert.deepEqual(recordedDeploymentLocators(f.state(), target), original);
});

test('locator validation rejects malformed IDs, paths, scopes, capability contracts and unknown fields', t => {
  const f = fixture(t); f.service.apply({planId: f.service.plan(f.input).planId});
  const target = Object.keys(f.state().managed)[0], locator = recordedDeploymentLocators(f.state(), target)[0];
  for (const patch of [{schemaVersion: 2}, {kitId: {}}, {definitionDigest: 'invalid'}, {targetBase: '../escape'}, {pathTemplate: '../escape'}, {scope: 'local'}, {token: 'unknown'}, {assetKind: 'settings'}, {strategy: 'manual'}]) {
    assert.equal(validDeploymentLocator({...locator, ...patch}), false);
  }
});
