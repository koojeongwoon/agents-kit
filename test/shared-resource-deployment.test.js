import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {DeploymentStateStore} from '../lib/infrastructure/deployment-state-store.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-resources-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const scopeRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project'), homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(scopeRoot, 'review'), {recursive: true}); fs.mkdirSync(targetRoot); fs.mkdirSync(homeDir);
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Shared rules\nCheck evidence.\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review changes\n---\n\nCheck evidence.\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/helper.txt'), 'Helper\n');
  const raw = {schemaVersion: 1, kit: {id: 'shared'}, assets: {
    instructions: [{id: 'rules', scope: 'project', source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
    skills: [{id: 'review', scope: 'project', source: 'review', definition: {schemaVersion: 1, format: 'agent-skills'}}]
  }};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  const definitionsDir = path.join(root, 'definitions');
  for (const clientId of ['codex', 'antigravity']) writeProfileFixture({definitionsDir, repositoryRoot, clientId, capabilityIds: ['instructions-project', 'skills-project']});
  const service = createManifestDeploymentService({definitionsDir, homeDir});
  const input = {scopeRoot, targetRoot, scope: 'project'};
  const target = clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'});
  const plan = (clientId = 'codex') => service.plan({...input, ...target(clientId)});
  const apply = (clientId = 'codex') => service.apply({planId: plan(clientId).planId});
  const batch = () => service.plan({...input, targets: ['codex', 'antigravity'].map(target)});
  const removal = (clientId, assetIds = ['rules', 'review']) => service.planRemoval({...input, clientId, surface: 'cli', assetIds});
  const statePath = path.join(targetRoot, '.agent-kit/state.json');
  const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return {root, raw, write, scopeRoot, targetRoot, input, target, service, plan, apply, batch, removal, statePath, state};
}

test('second consumer registers without writes; releases preserve peers and last removal is reversible', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.targetRoot, 'AGENTS.md'), '# User instructions\n');
  const first = f.apply();
  assert.equal(f.state().schemaVersion, 2);
  const before = fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'));
  const secondPlan = f.plan('antigravity');
  assert.ok(secondPlan.operations.every(item => item.operation === 'REGISTER' && item.metadataOnly));
  f.service.apply({planId: secondPlan.planId});
  assert.deepEqual(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md')), before);
  assert.ok(f.plan().operations.every(item => item.operation === 'SKIP'));
  const staleOriginal = f.service.planRollback({...f.input, clientId: 'codex', transactionId: first.transactionId});
  assert.equal(staleOriginal.automatic, false);
  const release = f.removal('codex');
  assert.ok(release.operations.every(item => item.operation === 'RELEASE'));
  f.service.apply({planId: release.planId});
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), true);
  assert.deepEqual(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md')), before);
  const last = f.removal('antigravity');
  assert.ok(last.operations.some(item => item.operation === 'REMOVE_BLOCK'));
  const removed = f.service.apply({planId: last.planId});
  assert.match(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), /# User instructions/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), /agents-kit/);
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), false);
  const rollback = f.service.planRollback({...f.input, clientId: 'antigravity', transactionId: removed.transactionId});
  assert.equal(rollback.automatic, true, JSON.stringify(rollback.blocked));
  f.service.rollback({planId: rollback.planId});
  assert.deepEqual(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md')), before);
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), true);
});

test('batch plans write shared paths once; coordinated updates and bundle pruning protect all consumers', t => {
  const f = fixture(t);
  const initial = f.batch();
  assert.equal(initial.automatic, true, JSON.stringify(initial.blocked));
  assert.deepEqual(initial.stateUpgrade, {from: 1, to: 2});
  assert.equal(initial.operations.length, 3);
  assert.ok(initial.operations.every(item => item.consumers.length === 2));
  f.service.apply({planId: initial.planId});
  fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'New instructions.\n');
  fs.appendFileSync(path.join(f.scopeRoot, 'rules.md'), 'New rule.\n');
  fs.unlinkSync(path.join(f.scopeRoot, 'review/helper.txt'));
  fs.writeFileSync(path.join(f.scopeRoot, 'review/new.txt'), 'New helper\n');
  const single = f.plan();
  assert.ok(single.blocked.every(item => item.reason === 'SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS'));
  assert.throws(() => f.service.apply({planId: single.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
  const batch = f.batch();
  assert.equal(batch.automatic, true, JSON.stringify(batch.blocked));
  const updated = f.service.apply({planId: batch.planId});
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/helper.txt')), false);
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/new.txt')), true);
  assert.match(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), /New rule/);
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: updated.transactionId}).planId});
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/helper.txt')), true);
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/new.txt')), false);
});

test('ownership-only changes invalidate apply and rollback plans even when bytes are unchanged', t => {
  const f = fixture(t); const applied = f.apply();
  const pending = f.plan();
  const pendingRollback = f.service.planRollback({...f.input, clientId: 'codex', transactionId: applied.transactionId});
  f.apply('antigravity');
  assert.throws(() => f.service.apply({planId: pending.planId}), {code: 'STALE_DEPLOYMENT_STATE'});
  assert.throws(() => f.service.rollback({planId: pendingRollback.planId}), {code: 'STALE_ROLLBACK_PLAN'});
});

test('removal allows source deletion and disabled targets but requires explicit managed asset IDs', t => {
  const f = fixture(t); f.apply();
  fs.rmSync(path.join(f.scopeRoot, 'review'), {recursive: true});
  f.raw.targets = {codex: {enabled: false}}; f.write();
  const plan = f.removal('codex');
  assert.equal(plan.automatic, true);
  assert.throws(() => f.removal('codex', []), {code: 'INVALID_REMOVAL_ASSETS'});
  assert.equal(f.removal('codex', ['unknown']).blocked[0].reason, 'SHARED_RESOURCE_NOT_MANAGED');
  f.service.apply({planId: plan.planId});
  assert.equal(fs.existsSync(path.join(f.targetRoot, 'AGENTS.md')), false);
});

test('external edits, duplicate markers and another Kit identity cannot be overwritten or removed', t => {
  for (const kind of ['skill', 'block', 'duplicate', 'kit']) {
    const f = fixture(t); f.apply();
    if (kind === 'skill') fs.appendFileSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md'), 'User change');
    if (kind === 'block') fs.writeFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'User replacement');
    if (kind === 'duplicate') fs.appendFileSync(path.join(f.targetRoot, 'AGENTS.md'), '<!-- agents-kit:rules:start -->');
    if (kind === 'kit') { f.raw.kit.id = 'other'; f.write(); }
    assert.equal(f.plan().automatic, false);
    assert.equal(f.removal('codex').automatic, false);
  }
});

test('failed validation restores shared files and ownership; the state lock is released', t => {
  const f = fixture(t); f.apply();
  const stateBefore = fs.readFileSync(f.statePath, 'utf8');
  const removal = f.removal('codex');
  assert.throws(() => f.service.apply({planId: removal.planId, validate: () => ({valid: false})}), {code: 'DEPLOYMENT_VALIDATION_FAILED'});
  assert.equal(fs.readFileSync(f.statePath, 'utf8'), stateBefore);
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), true);
  assert.equal(fs.existsSync(`${f.statePath}.lock`), false);
  const blocked = f.plan('antigravity');
  fs.writeFileSync(`${f.statePath}.lock`, 'existing owner');
  assert.throws(() => f.service.apply({planId: blocked.planId}), {code: 'DEPLOYMENT_STATE_LOCKED'});
  assert.equal(fs.readFileSync(`${f.statePath}.lock`, 'utf8'), 'existing owner');
});

test('native source mode cannot bypass the shared ownership ledger and legacy records require migration', t => {
  const f = fixture(t); f.apply();
  delete f.raw.assets.instructions[0].definition; delete f.raw.assets.skills[0].definition; f.write();
  assert.ok(f.plan().blocked.every(item => item.reason === 'SHARED_TARGET_REQUIRES_COMMON_SOURCE'));
  const state = f.state();
  for (const record of Object.values(state.managed)) delete record.sharedVersion;
  fs.writeFileSync(f.statePath, JSON.stringify(state));
  f.raw.assets.skills[0].definition = {schemaVersion: 1, format: 'agent-skills'};
  f.raw.assets.instructions[0].definition = {schemaVersion: 1, format: 'markdown'}; f.write();
  assert.ok(f.plan().blocked.every(item => item.reason === 'SHARED_OWNERSHIP_MIGRATION_REQUIRED'));
});

test('shared removal rechecks path authorization after parent symlink changes', t => {
  const f = fixture(t); f.apply();
  const removal = f.removal('codex', ['review']);
  const skills = path.join(f.targetRoot, '.agents/skills');
  const saved = path.join(f.root, 'saved-skills');
  fs.renameSync(skills, saved); fs.symlinkSync(saved, skills);
  assert.throws(() => f.service.apply({planId: removal.planId}), {code: 'DEPLOYMENT_TARGET_OUTSIDE_SCOPE'});
  assert.equal(fs.existsSync(path.join(saved, 'review/SKILL.md')), true);
});

test('state commit failure restores deleted files and does not lose ownership', t => {
  const f = fixture(t); f.apply();
  const before = fs.readFileSync(f.statePath, 'utf8');
  const removal = f.removal('codex');
  t.mock.method(DeploymentStateStore.prototype, 'commit', () => { throw new Error('Injected state failure'); });
  assert.throws(() => f.service.apply({planId: removal.planId}), /Injected state failure/);
  assert.equal(fs.readFileSync(f.statePath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), true);
  assert.match(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), /agents-kit:rules:start/);
  assert.equal(fs.existsSync(`${f.statePath}.lock`), false);
});

test('removal preserves user additions outside owned blocks and rejects stale deletion plans', t => {
  const f = fixture(t); f.apply();
  fs.appendFileSync(path.join(f.targetRoot, 'AGENTS.md'), '\n# User additions\n');
  const removal = f.removal('codex', ['rules']);
  assert.equal(removal.automatic, true);
  f.service.apply({planId: removal.planId});
  assert.match(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), /User additions/);
  const skillRemoval = f.removal('codex', ['review']);
  fs.appendFileSync(path.join(f.targetRoot, '.agents/skills/review/helper.txt'), 'Changed');
  assert.throws(() => f.service.apply({planId: skillRemoval.planId}), {code: 'STALE_DEPLOYMENT_PLAN'});
  assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), true);
});

test('global batch retains runtime evidence gates and native batch target collisions block planning', t => {
  const f = fixture(t);
  for (const asset of Object.values(f.raw.assets).flat()) asset.scope = 'global';
  f.write();
  const globalInput = {...f.input, scope: 'global', targetRoot: path.join(f.root, 'home')};
  const globalPlan = f.service.plan({...globalInput, ...f.target('codex')});
  // Synthetic evidence covers project scope only; global deployment remains unverified.
  assert.equal(globalPlan.automatic, false);
  assert.equal(f.service.plan({...globalInput, targets: [f.target('codex'), f.target('antigravity')]}).automatic, false);
  for (const asset of Object.values(f.raw.assets).flat()) { asset.scope = 'project'; delete asset.definition; }
  f.write();
  const collision = f.batch();
  assert.equal(collision.automatic, false);
  assert.ok(collision.blocked.some(item => item.reason === 'DUPLICATE_DEPLOYMENT_TARGET'));
});
