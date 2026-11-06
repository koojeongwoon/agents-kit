import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeSnapshotProfileFixture} from './helpers/snapshot-profile-fixture.js';

function fixture(t, strategy = 'snapshot-link') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-shared-link-')));
  t.after(() => {const visit = file => {if (fs.lstatSync(file).isDirectory()) {fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) visit(path.join(file, name));}}; visit(root); fs.rmSync(root, {recursive: true, force: true});});
  const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project'), definitionsDir = path.join(root, 'definitions');
  for (const directory of [homeDir, targetRoot, path.join(scopeRoot, 'review')]) fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review source\n---\n\nOriginal.\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/icon.bin'), Buffer.from([0, 255, 3]));
  const raw = {schemaVersion: 1, kit: {id: 'links'}, assets: {skills: [{id: 'review', scope: 'project', source: 'review', definition: {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy}}}]}};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  for (const clientId of ['codex', 'antigravity']) writeSnapshotProfileFixture({definitionsDir, repositoryRoot: path.resolve('.'), clientId});
  const input = {scopeRoot, targetRoot, scope: 'project'}, targets = ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}));
  const restart = (extras = {}) => createManifestDeploymentService({definitionsDir, homeDir, ...extras}); let service = restart();
  const statePath = path.join(targetRoot, '.agent-kit/state.json'), target = path.join(targetRoot, '.agents/skills/review');
  return {root, homeDir, scopeRoot, targetRoot, definitionsDir, raw, write, input, targets, service, restart, target,
    state: () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {schemaVersion: 1, managed: {}, transactions: []}, plan: () => service.plan({...input, targets}),
    migration: () => service.planMigration({...input, targets, migration: 'skill-strategy', assetIds: ['review']})};
}

test('verified shared links freeze source revisions, coordinate updates, release consumers, remove only the last link and roll back', t => {
  const f = fixture(t), plan = f.plan(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
  assert.equal(fs.existsSync(path.join(f.homeDir, '.agents-kit/snapshots')), false);
  f.service.apply({planId: plan.planId}); assert.equal(fs.lstatSync(f.target).isSymbolicLink(), true); assert.equal(f.state().schemaVersion, 6);
  const firstSnapshot = fs.readlinkSync(f.target), original = fs.readFileSync(path.join(f.target, 'SKILL.md'), 'utf8');
  assert.ok(f.plan().operations.every(item => item.operation === 'SKIP'));
  fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'New revision.\n'); assert.equal(fs.readFileSync(path.join(f.target, 'SKILL.md'), 'utf8'), original);
  const single = f.service.plan({...f.input, ...f.targets[0]}); assert.equal(single.automatic, false); assert.ok(single.blocked.some(item => item.reason === 'SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS'));
  f.service.apply({planId: f.plan().planId}); assert.notEqual(fs.readlinkSync(f.target), firstSnapshot); assert.equal(fs.existsSync(firstSnapshot), true);
  const inode = fs.lstatSync(f.target).ino;
  f.service.apply({planId: f.service.planRemoval({...f.input, ...f.targets[0], assetIds: ['review']}).planId}); assert.equal(fs.lstatSync(f.target).ino, inode);
  const removed = f.service.apply({planId: f.service.planRemoval({...f.input, ...f.targets[1], assetIds: ['review']}).planId}); assert.equal(fs.existsSync(f.target), false); assert.equal(fs.existsSync(firstSnapshot), true);
  const rollback = f.service.planRollback({...f.input, clientId: 'antigravity', transactionId: removed.transactionId}); assert.equal(rollback.automatic, true, JSON.stringify(rollback.blocked));
  f.service.rollback({planId: rollback.planId}); assert.equal(fs.lstatSync(f.target).isSymbolicLink(), true); assert.match(fs.readFileSync(path.join(f.target, 'SKILL.md'), 'utf8'), /New revision/);
});

test('copy/link migration is explicit, preserves unowned contents, and rollback restores the original directory and ownership', t => {
  const f = fixture(t, 'copy'); f.service.apply({planId: f.plan().planId}); fs.chmodSync(f.target, 0o750); fs.chmodSync(path.join(f.target, 'icon.bin'), 0o640);
  const before = fs.readFileSync(path.join(f.target, 'icon.bin')), state = f.state();
  f.raw.assets.skills[0].definition.deployment.strategy = 'snapshot-link'; f.write();
  assert.equal(f.plan().automatic, false); assert.ok(f.plan().blocked.some(item => item.reason === 'SHARED_CONNECTION_MIGRATION_REQUIRED'));
  fs.writeFileSync(path.join(f.target, 'user.txt'), 'keep user data'); const conflict = f.migration(); assert.equal(conflict.automatic, false); assert.equal(fs.readFileSync(path.join(f.target, 'user.txt'), 'utf8'), 'keep user data'); fs.unlinkSync(path.join(f.target, 'user.txt'));
  const plan = f.migration(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); assert.equal(plan.kind, 'migration');
  const applied = f.service.apply({planId: plan.planId}); assert.equal(fs.lstatSync(f.target).isSymbolicLink(), true);
  const rollback = f.service.planRollback({...f.input, clientId: 'codex', transactionId: applied.transactionId}); assert.equal(rollback.automatic, true, JSON.stringify(rollback.blocked));
  f.service.rollback({planId: rollback.planId}); assert.equal(fs.lstatSync(f.target).isDirectory(), true); assert.equal(fs.statSync(f.target).mode & 0o777, 0o750);
  assert.equal(fs.statSync(path.join(f.target, 'icon.bin')).mode & 0o777, 0o640); assert.deepEqual(fs.readFileSync(path.join(f.target, 'icon.bin')), before);
  assert.deepEqual(Object.keys(f.state().managed).sort(), Object.keys(state.managed).sort());
});

test('app validation failures and source changes preserve installation and ledger while retaining unused snapshots', t => {
  const f = fixture(t); let plan = f.plan();
  fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'changed after review\n');
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'STALE_SOURCE_REVISION'}); assert.equal(fs.existsSync(f.target), false);
  plan = f.plan(); assert.throws(() => f.service.apply({planId: plan.planId, validate: () => ({valid: false})}), {code: 'DEPLOYMENT_VALIDATION_FAILED'});
  assert.equal(fs.existsSync(f.target), false); assert.equal(f.state().transactions.length, 0);
});

test('snapshot plans persist and resume through the same application services after restart', t => {
  const f = fixture(t), saved = f.service.savePlan({planId: f.plan().planId}); assert.equal(fs.existsSync(f.target), false);
  const next = f.restart(), result = next.resumeSavedPlan({planId: saved.planId, digest: saved.digest}); assert.equal(result.transactionId, `tx-plan-${saved.planId}`);
  assert.equal(fs.lstatSync(f.target).isSymbolicLink(), true); assert.equal(next.savedPlans()[0].status, 'completed');
});

test('link-to-copy migration preserves all consumers, source bytes and original directory permissions', t => {
  const f = fixture(t, 'copy'); f.service.apply({planId: f.plan().planId}); fs.chmodSync(f.target, 0o750);
  f.raw.assets.skills[0].definition.deployment.strategy = 'snapshot-link'; f.write(); f.service.apply({planId: f.migration().planId});
  f.raw.assets.skills[0].definition.deployment.strategy = 'copy'; f.write();
  assert.equal(f.plan().automatic, false);
  const migration = f.migration(); assert.equal(migration.automatic, true, JSON.stringify(migration.blocked));
  const saved = f.service.savePlan({planId: migration.planId}); const applied = f.restart().resumeSavedPlan({planId: saved.planId, digest: saved.digest});
  assert.equal(fs.lstatSync(f.target).isDirectory(), true); assert.equal(fs.statSync(f.target).mode & 0o777, 0o750);
  for (const record of Object.values(f.state().managed)) assert.deepEqual(record.shared.consumers, ['links:antigravity:cli', 'links:codex:cli']);
  const rollback = f.service.planRollback({...f.input, clientId: 'codex', transactionId: applied.transactionId});
  const rollbackSaved = f.service.savePlan({planId: rollback.planId}); f.restart().resumeSavedPlan({planId: rollbackSaved.planId, digest: rollbackSaved.digest});
  assert.equal(fs.lstatSync(f.target).isSymbolicLink(), true);
});

test('saved snapshot updates reject changed sources and rollback rejects a corrupted retained snapshot', t => {
  const f = fixture(t); f.service.apply({planId: f.plan().planId});
  const snapshot = fs.readlinkSync(f.target);
  fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'planned revision\n');
  const saved = f.service.savePlan({planId: f.plan().planId}); fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'unreviewed\n');
  assert.throws(() => f.restart().resumeSavedPlan({planId: saved.planId, digest: saved.digest}), {code: 'STALE_SAVED_PLAN'});
  assert.equal(fs.readlinkSync(f.target), snapshot);
  const update = f.service.apply({planId: f.plan().planId});
  fs.chmodSync(path.join(snapshot, 'SKILL.md'), 0o644); fs.appendFileSync(path.join(snapshot, 'SKILL.md'), 'external tamper\n'); fs.chmodSync(path.join(snapshot, 'SKILL.md'), 0o444);
  const rollback = f.service.planRollback({...f.input, clientId: 'codex', transactionId: update.transactionId}); assert.equal(rollback.automatic, false);
  assert.ok(rollback.blocked.some(item => item.reason === 'SKILL_SNAPSHOT_DRIFT'));
});

test('Manifest or client policy edits invalidate a reviewed snapshot plan before client writes', t => {
  const f = fixture(t); let plan = f.plan();
  f.raw.assets.skills[0].definition.deployment.strategy = 'copy'; f.write();
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'STALE_DEPLOYMENT_PLAN'}); assert.equal(fs.existsSync(f.target), false);
  f.raw.assets.skills[0].definition.deployment.strategy = 'snapshot-link'; f.write(); plan = f.plan();
  fs.appendFileSync(path.join(f.definitionsDir, 'codex.yaml'), '\n# changed policy file\n');
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'STALE_DEPLOYMENT_PLAN'}); assert.equal(fs.existsSync(f.target), false);
});

test('snapshot byte limits apply to the selected strategy without restricting another client copy override', t => {
  const f = fixture(t, 'copy'); f.raw.assets.skills[0].definition.deployment.overrides = [{clientId: 'antigravity', strategy: 'snapshot-link'}]; f.write();
  fs.writeFileSync(path.join(f.scopeRoot, 'review/large.bin'), Buffer.alloc(1024 * 1024 + 1));
  const copy = f.service.plan({...f.input, ...f.targets[0]}); assert.equal(copy.automatic, true, JSON.stringify(copy.blocked));
  assert.throws(() => f.service.plan({...f.input, ...f.targets[1]}), {code: 'IMPORT_SOURCE_LIMIT_EXCEEDED'});
});

test('application recovery resumes the recorded global snapshot publication and target phases after SIGKILL', t => {
  const module = new URL('../lib/application/manifest-deployment-service.js', import.meta.url).href;
  for (const phase of ['snapshot-stage-created', 'snapshot-published', 'stage-ready', 'path-swapped', 'before-state', 'state-committed']) {
    const f = fixture(t), input = {homeDir: f.homeDir, definitionsDir: f.definitionsDir, request: {...f.input, targets: f.targets}, phase};
    const script = `import{createManifestDeploymentService}from ${JSON.stringify(module)};const i=${JSON.stringify(input)};const s=createManifestDeploymentService({homeDir:i.homeDir,definitionsDir:i.definitionsDir,onDeploymentPhase:p=>{if(p===i.phase)process.kill(process.pid,'SIGKILL')}});s.apply({planId:s.plan(i.request).planId});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'}); assert.equal(child.signal, 'SIGKILL', child.stderr);
    const service = f.restart(), recovery = service.planRecovery({...f.input, clientId: 'codex'});
    const result = service.recover({planId: recovery.planId}); assert.equal(result.outcome, phase === 'state-committed' ? 'committed' : 'restored');
    assert.equal(fs.existsSync(f.target), phase === 'state-committed');
    assert.equal(service.plan({...f.input, targets: f.targets}).automatic, true);
    assert.ok(Array.isArray(result.retainedSnapshots));
  }
});

test('rollback crash recovery restores the pre-rollback version or keeps the committed rollback', t => {
  const module = new URL('../lib/application/manifest-deployment-service.js', import.meta.url).href;
  for (const phase of ['path-swapped', 'state-committed']) {
    const f = fixture(t); f.service.apply({planId: f.plan().planId}); const original = fs.readlinkSync(f.target);
    fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'Updated\n'); const update = f.service.apply({planId: f.plan().planId}), updated = fs.readlinkSync(f.target);
    const input = {homeDir: f.homeDir, definitionsDir: f.definitionsDir, request: {...f.input, clientId: 'codex', transactionId: update.transactionId}, phase};
    const script = `import{createManifestDeploymentService}from ${JSON.stringify(module)};const i=${JSON.stringify(input)};const s=createManifestDeploymentService({homeDir:i.homeDir,definitionsDir:i.definitionsDir,onDeploymentPhase:p=>{if(p===i.phase)process.kill(process.pid,'SIGKILL')}});s.rollback({planId:s.planRollback(i.request).planId});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'}); assert.equal(child.signal, 'SIGKILL', child.stderr);
    const next = f.restart(), recovery = next.planRecovery({...f.input, clientId: 'codex'}); next.recover({planId: recovery.planId});
    assert.equal(fs.readlinkSync(f.target), phase === 'state-committed' ? original : updated);
  }
});

test('a mixed instruction merge and snapshot link use one rollback-capable transaction', t => {
  const f = fixture(t); f.raw.assets.instructions = [{id: 'rules', source: 'rules.md', scope: 'project', definition: {schemaVersion: 1, format: 'markdown'}}];
  fs.writeFileSync(path.join(f.scopeRoot, 'rules.md'), '# Kit rules\n'); f.write();
  for (const clientId of ['codex', 'antigravity']) writeSnapshotProfileFixture({definitionsDir: f.definitionsDir, repositoryRoot: path.resolve('.'), clientId, capabilityIds: ['skills-project', 'instructions-project']});
  fs.writeFileSync(path.join(f.targetRoot, 'AGENTS.md'), '# User rules\n', {mode: 0o640});
  const plan = f.plan(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); const applied = f.service.apply({planId: plan.planId});
  assert.match(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), /User rules[\s\S]*Kit rules/); assert.equal(fs.statSync(path.join(f.targetRoot, 'AGENTS.md')).mode & 0o777, 0o640);
  const rollback = f.service.planRollback({...f.input, clientId: 'codex', transactionId: applied.transactionId}); assert.equal(rollback.automatic, true, JSON.stringify(rollback.blocked)); f.service.rollback({planId: rollback.planId});
  assert.equal(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), '# User rules\n'); assert.equal(fs.existsSync(f.target), false);
});

test('a metadata symlink cannot move the deployment journal or backup writes outside the selected project', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(f.targetRoot, '.agent-kit'));
  const plan = f.plan(); assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'TREE_METADATA_SCOPE_UNSAFE'});
  assert.deepEqual(fs.readdirSync(outside), []); assert.equal(fs.existsSync(f.target), false);
});

test('editing a public connection preview cannot change the reviewed internal ownership record', t => {
  const f = fixture(t), plan = f.plan(), expected = plan.operations[0].connection.snapshot.treeDigest;
  plan.operations[0].connection.strategy = 'copy';
  plan.operations[0].connection.snapshot = {treeDigest: '0'.repeat(64)};
  f.service.apply({planId: plan.planId});
  assert.equal(f.state().managed[f.target].connection.strategy, 'snapshot-link');
  assert.equal(f.state().managed[f.target].connection.snapshot.treeDigest, expected);
  assert.equal(f.plan().automatic, true);
});

test('an unavailable atomic helper blocks the plan without copying or creating client files', t => {
  const f = fixture(t), previousPath = process.env.PATH;
  try {
    process.env.PATH = '/no-atomic-helper';
    const plan = f.plan(); assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'ATOMIC_PATH_UNAVAILABLE'));
    assert.equal(fs.existsSync(f.target), false); assert.equal(fs.existsSync(path.join(f.homeDir, '.agents-kit/snapshots')), false);
  } finally {if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;}
});
