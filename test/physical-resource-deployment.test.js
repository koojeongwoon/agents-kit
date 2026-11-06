import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {writeSnapshotProfileFixture} from './helpers/snapshot-profile-fixture.js';

function fixture(t, scope = 'project') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-physical-'))); t.after(() => {const visit = file => {if (fs.lstatSync(file).isDirectory()) {fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) visit(path.join(file, name));}}; visit(root); fs.rmSync(root, {recursive: true, force: true});});
  const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'kit'), targetRoot = scope === 'global' ? homeDir : path.join(root, 'project'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(dir, {recursive: true});
  const raw = {schemaVersion: 1, kit: {id: 'physical'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: process.execPath}}}}, assets: {
    agents: [{id: 'reviewer', scope, definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Review source.'}}],
    mcpServers: ['docs', 'math'].map(id => ({id, scope, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: [id]}}))}};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve('.'), capabilityIds: [`agents-${scope}`, `mcp-${scope}`]});
  const request = surface => ({clientId: 'codex', surface, clientVersion: '0.0.1-test'}), input = {scopeRoot, targetRoot, scope};
  const restart = () => createManifestDeploymentService({definitionsDir, homeDir}); const service = restart();
  const statePath = scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : path.join(targetRoot, '.agent-kit/state.json');
  const mcp = path.join(targetRoot, '.codex/config.toml'), agent = path.join(targetRoot, '.codex/agents/reviewer.toml');
  return {root, homeDir, scopeRoot, targetRoot, definitionsDir, statePath, raw, write, input, request, service, restart, mcp, agent,
    state: () => JSON.parse(fs.readFileSync(statePath, 'utf8')), batch: () => service.plan({...input, targets: ['cli', 'desktop'].map(request)})};
}

test('same-store Agent and MCP targets are validated independently and written once in both scopes', t => {
  for (const scope of ['project', 'global']) {
    const f = fixture(t, scope); fs.mkdirSync(path.dirname(f.mcp), {recursive: true}); fs.writeFileSync(f.mcp, '# User setting\nmodel = "user-model"\n', {mode: 0o640});
    const plan = f.batch(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); assert.deepEqual(plan.stateUpgrade, {from: 1, to: 7});
    assert.equal(plan.operations.length, 2); assert.ok(plan.operations.every(op => op.affectedTargets.length === 2));
    const applied = f.service.apply({planId: plan.planId}); assert.equal(f.state().schemaVersion, 7);
    assert.equal(f.state().managed[f.agent].physicalVersion, 1); assert.equal(f.state().managed[f.mcp].physicalVersion, 1);
    assert.match(fs.readFileSync(f.mcp, 'utf8'), /User setting/); assert.equal(fs.statSync(f.mcp).mode & 0o777, 0o640);
    assert.match(fs.readFileSync(f.mcp, 'utf8'), /mcp_servers.docs/); assert.match(fs.readFileSync(f.mcp, 'utf8'), /mcp_servers.math/);
    assert.ok(f.batch().operations.every(op => op.operation === 'SKIP'));
    f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: applied.transactionId}).planId});
    assert.equal(fs.readFileSync(f.mcp, 'utf8'), '# User setting\nmodel = "user-model"\n'); assert.equal(fs.existsSync(f.agent), false); assert.deepEqual(f.state().managed, {});
  }
});

test('typed removal deletes the store resource for every reader rather than releasing one surface', t => {
  const f = fixture(t); f.service.apply({planId: f.batch().planId});
  const removal = f.service.planRemoval({...f.input, clientId: 'codex', surface: 'desktop', assetIds: ['docs', 'reviewer']});
  assert.equal(removal.automatic, true, JSON.stringify(removal.blocked));
  assert.ok(removal.operations.every(op => op.storeEffect === 'configuration' && op.affectedTargets.length === 2 && op.operation !== 'RELEASE'));
  const removed = f.service.apply({planId: removal.planId}); assert.equal(fs.existsSync(f.agent), false);
  assert.doesNotMatch(fs.readFileSync(f.mcp, 'utf8'), /mcp_servers.docs/); assert.match(fs.readFileSync(f.mcp, 'utf8'), /mcp_servers.math/);
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: removed.transactionId}).planId});
  assert.equal(f.state().managed[f.mcp].owners.docs.resource.targets.length, 2);
});

test('one verified surface can update a recorded store while retaining all affected readers', t => {
  const f = fixture(t); f.service.apply({planId: f.batch().planId}); const before = f.state();
  f.raw.assets.agents[0].definition.instructions = 'Updated review.'; f.raw.assets.mcpServers[0].definition.args.push('updated'); f.write();
  const plan = f.service.plan({...f.input, ...f.request('cli')}); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
  assert.ok(plan.operations.every(op => op.affectedTargets.length === 2));
  const saved = f.service.savePlan({planId: plan.planId}); const result = f.restart().resumeSavedPlan({planId: saved.planId, digest: saved.digest});
  assert.match(fs.readFileSync(f.agent, 'utf8'), /Updated review/);
  assert.equal(f.state().managed[f.agent].resource.targets.length, 2);
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}).planId});
  assert.deepEqual(f.state().managed, before.managed);
});

test('a failed capability or unverified reader cannot be hidden by another reader of the same path', t => {
  const f = fixture(t), file = path.join(f.definitionsDir, 'codex.yaml'), raw = parse(fs.readFileSync(file, 'utf8'));
  raw.surfaces.find(item => item.id === 'desktop').runtimeEvidence = []; fs.writeFileSync(file, stringify(raw));
  const plan = f.batch(); assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'CLIENT_PROFILE_UNVERIFIED'));
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'}); assert.equal(fs.existsSync(f.mcp), false);
});

test('same-store deployment does not adopt matching unmanaged settings or erase user fields', t => {
  const f = fixture(t); fs.mkdirSync(path.dirname(f.mcp), {recursive: true}); fs.writeFileSync(f.mcp, '[mcp_servers.docs]\ncommand = "node"\n');
  const bytes = fs.readFileSync(f.mcp), plan = f.batch(); assert.equal(plan.automatic, false);
  assert.ok(plan.blocked.some(item => item.reason === 'UNKNOWN_EXISTING_CONTENT'));
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'}); assert.deepEqual(fs.readFileSync(f.mcp), bytes);
});

test('a dependency of any recorded store reader blocks removal even when the current manifest no longer declares it', t => {
  const f = fixture(t); f.raw.assets.mcpServers[0].requires = {tools: ['math.lookup']}; f.raw.assets.mcpServers[1].provides = {tools: [{id: 'math.lookup', nativeName: 'lookup'}]}; f.write(); f.service.apply({planId: f.batch().planId});
  delete f.raw.assets.mcpServers[0].requires; f.write();
  const plan = f.service.planRemoval({...f.input, clientId: 'codex', surface: 'desktop', assetIds: ['math']});
  assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'RESOURCE_STILL_REQUIRED'));
  const combined = f.service.planRemoval({...f.input, clientId: 'codex', surface: 'desktop', assetIds: ['docs', 'math']}); assert.equal(combined.automatic, true, JSON.stringify(combined.blocked));
});

test('proven v1 typed ownership is upgraded without rewriting unchanged settings and rollback preserves the old record', t => {
  const f = fixture(t); f.service.apply({planId: f.service.plan({...f.input, ...f.request('cli')}).planId}); const before = f.state(), inode = fs.statSync(f.agent).ino;
  const plan = f.batch(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); assert.ok(plan.operations.every(op => op.operation === 'REGISTER'));
  const applied = f.service.apply({planId: plan.planId}); assert.equal(fs.statSync(f.agent).ino, inode);
  assert.equal(f.state().managed[f.agent].resource.targets.length, 2);
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: applied.transactionId}).planId}); assert.deepEqual(f.state().managed, before.managed);
});

test('unproven old ownership and conflicting store identifiers are not combined', t => {
  const f = fixture(t); f.service.apply({planId: f.service.plan({...f.input, ...f.request('cli')}).planId});
  const old = f.state(); delete old.managed[f.agent].resource; fs.writeFileSync(f.statePath, JSON.stringify(old));
  let plan = f.batch(); assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'PHYSICAL_RESOURCE_OWNERSHIP_UNPROVEN'));
  const other = fixture(t), file = path.join(other.definitionsDir, 'codex.yaml'), definition = parse(fs.readFileSync(file, 'utf8'));
  definition.surfaces.find(item => item.id === 'desktop').configStore = 'different-store'; fs.writeFileSync(file, stringify(definition));
  plan = other.batch(); assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'PHYSICAL_RESOURCE_STORE_CONFLICT'));
});

test('physical ownership cannot be read under an earlier ledger schema or with duplicate readers', t => {
  const f = fixture(t); f.service.apply({planId: f.batch().planId}); const state = f.state();
  state.schemaVersion = 6; fs.writeFileSync(f.statePath, JSON.stringify(state)); assert.throws(() => f.batch(), {code: 'INVALID_DEPLOYMENT_STATE'});
  state.schemaVersion = 7; state.managed[f.agent].resource.targets.push({...state.managed[f.agent].resource.targets[0]}); fs.writeFileSync(f.statePath, JSON.stringify(state));
  assert.throws(() => f.batch(), {code: 'INVALID_DEPLOYMENT_STATE'});
});

test('validation failure, policy changes and concurrent ledger edits restore bytes without overwriting external state', t => {
  for (const fault of ['validation', 'policy', 'ledger']) {
    const f = fixture(t); f.service.apply({planId: f.batch().planId}); const before = fs.readFileSync(f.agent), stateBefore = fs.readFileSync(f.statePath);
    f.raw.assets.agents[0].definition.instructions = 'Changed instructions.'; f.write(); const plan = f.batch();
    const validate = () => {
      if (fault === 'policy') fs.appendFileSync(path.join(f.definitionsDir, 'codex.yaml'), '\n# external policy revision\n');
      if (fault === 'ledger') {const state = f.state(); state.externalObservation = 'keep external state'; fs.writeFileSync(f.statePath, JSON.stringify(state));}
      return {valid: fault !== 'validation'};
    };
    assert.throws(() => f.service.apply({planId: plan.planId, validate}), {code: {validation: 'DEPLOYMENT_VALIDATION_FAILED', policy: 'STALE_DEPLOYMENT_PLAN', ledger: 'STALE_DEPLOYMENT_STATE'}[fault]});
    assert.deepEqual(fs.readFileSync(f.agent), before);
    if (fault === 'ledger') assert.equal(f.state().externalObservation, 'keep external state'); else assert.deepEqual(fs.readFileSync(f.statePath), stateBefore);
  }
});

test('physical store updates recover before or after ledger commit after a real SIGKILL', t => {
  const serviceModule = new URL('../lib/application/manifest-deployment-service.js', import.meta.url).href, stateModule = new URL('../lib/infrastructure/deployment-state-store.js', import.meta.url).href;
  for (const committed of [false, true]) {
    const f = fixture(t); f.service.apply({planId: f.batch().planId}); const original = fs.readFileSync(f.agent, 'utf8');
    f.raw.assets.agents[0].definition.instructions = 'Updated after restart.'; f.write();
    const input = {homeDir: f.homeDir, definitionsDir: f.definitionsDir, request: {...f.input, targets: ['cli', 'desktop'].map(f.request)}};
    const script = `import{createManifestDeploymentService}from ${JSON.stringify(serviceModule)};import{DeploymentStateStore}from ${JSON.stringify(stateModule)};const i=${JSON.stringify(input)};${committed ? "const commit=DeploymentStateStore.prototype.commit;DeploymentStateStore.prototype.commit=function(state){const result=commit.call(this,state);process.kill(process.pid,'SIGKILL');return result;};" : ''}const s=createManifestDeploymentService(i);s.apply({planId:s.plan(i.request).planId,validate:()=>{${committed ? '' : "process.kill(process.pid,'SIGKILL');"}return{valid:true};}});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'}); assert.equal(child.signal, 'SIGKILL', child.stderr);
    const next = f.restart(), plan = next.planRecovery({...f.input, clientId: 'codex'}), result = next.recover({planId: plan.planId});
    assert.equal(result.outcome, committed ? 'committed' : 'restored');
    if (committed) assert.match(fs.readFileSync(f.agent, 'utf8'), /Updated after restart/); else assert.equal(fs.readFileSync(f.agent, 'utf8'), original);
    assert.equal(f.state().managed[f.agent].resource.targets.length, 2); assert.equal(next.plan({...f.input, targets: ['cli', 'desktop'].map(f.request)}).automatic, true);
  }
});

test('native source mode cannot discard the readers of an existing physical store record', t => {
  const f = fixture(t); f.service.apply({planId: f.batch().planId}); const before = fs.readFileSync(f.mcp);
  f.raw.assets.agents = []; f.raw.assets.mcpServers = [{id: 'docs', scope: 'project', source: 'docs.toml'}];
  fs.writeFileSync(path.join(f.scopeRoot, 'docs.toml'), '[mcp_servers.docs]\ncommand = "node"\n'); f.write();
  const plan = f.batch(); assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'PHYSICAL_RESOURCE_REQUIRES_COMPOSED_PLAN'));
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'}); assert.deepEqual(fs.readFileSync(f.mcp), before);
});

test('physical typed stores and snapshot links share one saved and rollback-capable transaction', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.scopeRoot, 'skill')); fs.writeFileSync(path.join(f.scopeRoot, 'skill/SKILL.md'), '---\nname: skill\ndescription: Test skill\n---\nRead source.\n');
  f.raw.assets.skills = [{id: 'skill', scope: 'project', source: 'skill', definition: {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: 'snapshot-link'}}}]; f.write();
  writeSnapshotProfileFixture({definitionsDir: f.definitionsDir, repositoryRoot: path.resolve('.'), capabilityIds: ['agents-project', 'mcp-project', 'skills-project']});
  const plan = f.batch(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); assert.deepEqual(plan.stateUpgrade, {from: 1, to: 7});
  const saved = f.service.savePlan({planId: plan.planId}), record = JSON.parse(fs.readFileSync(path.join(f.homeDir, '.agents-kit/plans', `${saved.planId}.json`), 'utf8'));
  assert.equal(record.body.schemaVersion, 3); assert.equal(record.body.contract, 'physical-resource-v1');
  const installed = f.restart().resumeSavedPlan({planId: saved.planId, digest: saved.digest});
  const skill = path.join(f.targetRoot, '.agents/skills/skill'); assert.equal(fs.lstatSync(skill).isSymbolicLink(), true); assert.equal(f.state().schemaVersion, 7);
  assert.equal(f.state().transactions.at(-1).treeTransaction, true);
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: installed.transactionId}).planId});
  assert.deepEqual(f.state().managed, {}); assert.equal(fs.existsSync(skill), false); assert.equal(fs.existsSync(f.agent), false);
});

test('client mappings cannot make a physical resource overwrite deployment metadata or its Kit sources', t => {
  for (const scope of ['project', 'global']) for (const targetKind of ['metadata', 'kit']) {
    const f = fixture(t, scope), file = path.join(f.definitionsDir, 'codex.yaml'), definition = parse(fs.readFileSync(file, 'utf8'));
    const scopeRoot = targetKind === 'kit' ? path.join(f.targetRoot, 'personal-kit') : f.scopeRoot;
    if (targetKind === 'kit') fs.cpSync(f.scopeRoot, scopeRoot, {recursive: true});
    definition.capabilities.find(cap => cap.id === `agents-${scope}`).path = targetKind === 'kit' ? `${scope === 'global' ? '~/' : ''}personal-kit/agent-kit.yaml`
      : scope === 'project' ? '.agent-kit/state.json' : '~/.agents-kit/deployments/_global/state.json';
    const before = fs.readFileSync(path.join(scopeRoot, 'agent-kit.yaml'));
    fs.writeFileSync(file, stringify(definition)); const plan = f.service.plan({...f.input, scopeRoot, targets: ['cli', 'desktop'].map(f.request)}); assert.equal(plan.automatic, false);
    assert.ok(plan.blocked.some(item => item.reason === 'DEPLOYMENT_TARGET_OUTSIDE_SCOPE')); assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
    assert.equal(fs.existsSync(f.statePath), false); assert.deepEqual(fs.readFileSync(path.join(scopeRoot, 'agent-kit.yaml')), before);
  }
});
