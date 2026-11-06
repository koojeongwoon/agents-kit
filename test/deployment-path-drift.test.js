import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {deploymentPathDriftBlocks} from '../lib/application/deployment-path-drift.js';

function fixture(t, scope = 'project') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-path-drift-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), targetRoot = scope === 'global' ? homeDir : path.join(root, 'project'), scopeRoot = path.join(root, 'kit'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [homeDir, targetRoot, path.join(scopeRoot, 'review/references')]) fs.mkdirSync(dir, {recursive: true});
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve('.'), capabilityIds: ['instructions', 'skills', 'agents', 'mcp'].map(kind => `${kind}-${scope}`)});
  const definitionPath = path.join(definitionsDir, 'codex.yaml'), originalDefinition = fs.readFileSync(definitionPath, 'utf8');
  const manifest = {schemaVersion: 1, kit: {id: 'path-drift'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: 'node'}}}}, assets: {
    instructions: [{id: 'rules', scope, source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
    skills: [{id: 'review', scope, source: 'review', definition: {schemaVersion: 1, format: 'agent-skills'}}],
    agents: [{id: 'reviewer', scope, definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Review the change.'}}],
    mcpServers: [{id: 'docs', scope, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: ['marker.js']}}]
  }};
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(manifest)); fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Rules\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review\n---\nRead references/help.md.\n'); fs.writeFileSync(path.join(scopeRoot, 'review/references/help.md'), '# Help\n');
  const input = {scopeRoot, targetRoot, scope, clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'}, service = createManifestDeploymentService({definitionsDir, homeDir});
  const plan = service.plan(input); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); service.apply({planId: plan.planId});
  const statePath = scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : path.join(targetRoot, '.agent-kit/state.json');
  const stateBefore = fs.readFileSync(statePath), bytes = new Map(plan.operations.map(op => [op.target, fs.readFileSync(op.target)]));
  function changePaths() {
    const definition = parse(originalDefinition);
    for (const capability of definition.capabilities.filter(cap => cap.scope === scope)) capability.path = scope === 'global' ? capability.path.replace('~/', '~/moved/') : `moved/${capability.path}`;
    fs.writeFileSync(definitionPath, stringify(definition));
  }
  return {input, service, definitionPath, originalDefinition, changePaths, statePath, stateBefore, bytes, targetRoot};
}

test('definition path changes require explicit migration for all four owned resources in both scopes', t => {
  for (const scope of ['project', 'global']) {
    const f = fixture(t, scope); f.changePaths(); const plan = f.service.plan(f.input);
    assert.equal(plan.automatic, false);
    assert.deepEqual(new Set(plan.blocked.filter(b => b.reason === 'RESOURCE_PATH_MIGRATION_REQUIRED').map(b => b.assetId)), new Set(['rules', 'review', 'reviewer', 'docs']));
    assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
    assert.deepEqual(fs.readFileSync(f.statePath), f.stateBefore);
    for (const [file, content] of f.bytes) assert.deepEqual(fs.readFileSync(file), content);
    assert.equal(fs.existsSync(path.join(f.targetRoot, 'moved')), false);
    fs.writeFileSync(f.definitionPath, f.originalDefinition); assert.equal(f.service.plan(f.input).automatic, true);
  }
});

test('path drift is visible after service restart and regular removal keeps its old path guard', t => {
  const f = fixture(t); f.changePaths();
  const service = createManifestDeploymentService({definitionsDir: path.dirname(f.definitionPath), homeDir: path.join(path.dirname(f.targetRoot), 'home')});
  const plan = service.plan(f.input); assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(b => b.previousTargets?.length));
  const removal = service.planRemoval({...f.input, assetIds: ['reviewer', 'docs']});
  assert.equal(removal.automatic, false); assert.ok(removal.blocked.some(b => b.reason === 'RESOURCE_REMOVAL_PROFILE_UNSUPPORTED'));
  for (const [file, content] of f.bytes) assert.deepEqual(fs.readFileSync(file), content);
});

test('reviewed common and typed plans cannot apply an old mapping after client definitions change', t => {
  const f = fixture(t), reviewed = f.service.plan(f.input), saved = f.service.savePlan({planId: f.service.plan(f.input).planId});
  f.changePaths();
  assert.throws(() => f.service.apply({planId: reviewed.planId}), {code: 'STALE_DEPLOYMENT_PLAN'});
  assert.throws(() => f.service.resumeSavedPlan({planId: saved.planId, digest: saved.digest}), {code: 'STALE_SAVED_PLAN'});
  assert.deepEqual(fs.readFileSync(f.statePath), f.stateBefore);
});

test('other shared consumers and Kits do not create false path drift, while every recorded physical reader is checked', () => {
  const root = fs.realpathSync(os.tmpdir()), base = path.join(root, 'current'), old = path.join(root, 'old');
  const planned = {clientId: 'codex', targetProfile: {surface: 'cli'}, assetId: 'review', assetKind: 'skills', commonSource: true, scope: 'project', target: base};
  const desired = [{planned, kitId: 'kit', consumerId: 'kit:codex:cli'}];
  const shared = consumers => ({sharedVersion: 1, ownership: 'file', shared: {kitId: 'kit', assetId: 'review', assetKind: 'skills', consumers}});
  const state = {managed: {[path.join(base, 'SKILL.md')]: shared(['kit:codex:cli']), [path.join(old, 'SKILL.md')]: shared(['kit:codex:desktop'])}};
  const input = {state, desired, targetRoot: root, homeDir: root, scope: 'project'};
  assert.deepEqual(deploymentPathDriftBlocks(input), []);
  state.managed[path.join(old, 'SKILL.md')].shared.consumers.push('kit:codex:cli');
  assert.equal(deploymentPathDriftBlocks(input)[0].reason, 'RESOURCE_PATH_MIGRATION_REQUIRED');
  const resource = {version: 2, kitId: 'kit', assetId: 'review', assetKind: 'agents', scope: 'project', targets: [{clientId: 'codex', surface: 'cli'}, {clientId: 'antigravity', surface: 'cli'}]};
  const physical = {managed: {[old]: {physicalVersion: 1, ownership: 'file', resource}}};
  const physicalDesired = [{...desired[0], planned: {...planned, commonSource: false, assetKind: 'agents', resource}}];
  assert.equal(deploymentPathDriftBlocks({...input, state: physical, desired: physicalDesired}).length, 1);
  assert.deepEqual(deploymentPathDriftBlocks({...input, state: physical, desired: [{...physicalDesired[0], kitId: 'other'}]}), []);
  const legacy = {managed: {[old]: {clientId: 'codex', assetId: 'review', ownership: 'file', resource: {version: 1}}}};
  assert.equal(deploymentPathDriftBlocks({...input, state: legacy, desired: physicalDesired}).length, 1);
});

test('a definition mapping change during validation rolls back newly written common content before committing ownership', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.input.scopeRoot, 'rules.md'), '# Updated rules\n');
  const plan = f.service.plan(f.input); assert.equal(plan.automatic, true);
  assert.throws(() => f.service.apply({planId: plan.planId, validate() {f.changePaths(); return {valid: true, results: []};}}), {code: 'STALE_DEPLOYMENT_PLAN'});
  assert.deepEqual(fs.readFileSync(f.statePath), f.stateBefore);
  for (const [file, content] of f.bytes) assert.deepEqual(fs.readFileSync(file), content);
  assert.equal(fs.existsSync(f.statePath + '.lock'), false); assert.equal(fs.existsSync(f.statePath + '.journal.json'), false);
});
