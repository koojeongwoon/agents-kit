import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {canonicalDigest} from '../lib/infrastructure/saved-deployment-plan-store.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
function fixture(t, scope = 'project') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'persistent-deployment-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'kit'), definitionsDir = path.join(root, 'definitions');
  const targetRoot = scope === 'global' ? homeDir : path.join(root, 'project');
  for (const directory of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review evidence.\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `schemaVersion: 1\nkit: {id: persistent}\nassets:\n  instructions:\n    - {id: rules, scope: ${scope}, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n`);
  writeProfileFixture({definitionsDir, repositoryRoot, capabilityIds: [`instructions-${scope}`]});
  const options = {definitionsDir, homeDir, planStoreRoot: path.join(root, 'saved-plans')};
  const service = createManifestDeploymentService(options);
  const target = path.join(targetRoot, scope === 'global' ? '.codex/AGENTS.md' : 'AGENTS.md');
  fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, '# User instructions\n');
  const input = {scopeRoot, targetRoot, scope, clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test', crashTarget: target};
  const statePath = scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : path.join(targetRoot, '.agent-kit/state.json');
  const restart = extra => createManifestDeploymentService({...options, ...extra});
  const save = () => service.savePlan({planId: service.plan(input).planId});
  const crash = ({stage = 'mutation', ...extra} = {}) => {
    const config = path.join(root, 'child.json'); fs.writeFileSync(config, JSON.stringify({options, input, stage, ...extra}));
    const result = spawnSync(process.execPath, ['test/helpers/crash-deployment.js', config], {cwd: repositoryRoot, encoding: 'utf8'});
    assert.equal(result.signal, 'SIGKILL', result.stderr); return result;
  };
  return {root, options, input, service, target, scopeRoot, statePath, restart, save, crash};
}

test('saved deployment survives service and process restart, requires digest and executes once', t => {
  const f = fixture(t), saved = f.save();
  assert.equal(fs.readFileSync(f.target, 'utf8'), '# User instructions\n');
  assert.equal(fs.statSync(path.join(f.options.planStoreRoot, `${saved.planId}.json`)).mode & 0o777, 0o600);
  assert.throws(() => f.restart().resumeSavedPlan({planId: saved.planId}), {code: 'SAVED_PLAN_DIGEST_REQUIRED'});
  assert.throws(() => f.restart().resumeSavedPlan({...saved, digest: '0'.repeat(64)}), {code: 'SAVED_PLAN_DIGEST_MISMATCH'});
  const runner = 'import {createManifestDeploymentService} from "./lib/application/manifest-deployment-service.js"; const [options,saved]=JSON.parse(process.argv[1]); console.log(JSON.stringify(createManifestDeploymentService(options).resumeSavedPlan(saved)));';
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', runner, JSON.stringify([f.options, saved])], {cwd: repositoryRoot, encoding: 'utf8'});
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.transactionId, `tx-plan-${saved.planId}`);
  assert.deepEqual(f.restart().resumeSavedPlan(saved), result);
  assert.equal(f.restart().savedPlans()[0].status, 'completed');
  assert.equal(JSON.parse(fs.readFileSync(f.statePath)).transactions.length, 1);
});

test('saved source, target, ownership, definition and payload changes fail closed', t => {
  for (const kind of ['source', 'target', 'state', 'definition', 'payload']) {
    const f = fixture(t), saved = f.save();
    if (kind === 'source') fs.appendFileSync(path.join(f.scopeRoot, 'rules.md'), 'Changed');
    if (kind === 'target') fs.appendFileSync(f.target, 'User changed');
    if (kind === 'state') { const other = f.restart(); other.apply({planId: other.plan(f.input).planId}); }
    if (kind === 'definition') fs.appendFileSync(path.join(f.options.definitionsDir, 'codex.yaml'), '\n# Changed support definition\n');
    if (kind === 'payload') {
      const file = path.join(f.options.planStoreRoot, `${saved.planId}.json`), record = JSON.parse(fs.readFileSync(file));
      record.body.replay.input.targetRoot = f.root; record.digest = canonicalDigest(record.body); fs.writeFileSync(file, JSON.stringify(record));
    }
    assert.throws(() => f.restart().resumeSavedPlan(saved));
  }
});

test('saved removal and rollback reconstruct original prepared operations without stored file contents', t => {
  const f = fixture(t); const initial = f.service.apply({planId: f.service.plan(f.input).planId});
  const removal = f.service.savePlan({planId: f.service.planRemoval({...f.input, assetIds: ['rules']}).planId});
  const removed = f.restart().resumeSavedPlan(removal);
  assert.doesNotMatch(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
  const restarted = f.restart();
  const rollback = restarted.savePlan({planId: restarted.planRollback({...f.input, transactionId: removed.transactionId}).planId});
  f.restart().resumeSavedPlan(rollback);
  assert.match(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
  assert.ok(initial.transactionId);
  const onDisk = fs.readFileSync(path.join(f.options.planStoreRoot, `${removal.planId}.json`), 'utf8');
  assert.doesNotMatch(onDisk, /Review evidence|User instructions/);
});

test('saved plans expire and a claimed execution is not replayed', t => {
  const f = fixture(t), service = f.restart({clock: () => 1000, savedPlanTtlMs: 10});
  const saved = service.savePlan({planId: service.plan(f.input).planId});
  assert.throws(() => f.restart({clock: () => 1011}).resumeSavedPlan(saved), {code: 'DEPLOYMENT_PLAN_EXPIRED'});
  fs.writeFileSync(path.join(f.options.planStoreRoot, `${saved.planId}.json.claim`), 'claimed');
  assert.throws(() => f.restart({clock: () => 1001}).resumeSavedPlan(saved), {code: 'SAVED_PLAN_NOT_READY'});
});

test('SIGKILL during file mutation restores original files in project and global scopes', t => {
  for (const scope of ['project', 'global']) {
    const f = fixture(t, scope), original = fs.readFileSync(f.target); fs.chmodSync(f.target, 0o640); f.crash();
    assert.match(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
    assert.ok(fs.existsSync(`${f.statePath}.journal.json`));
    const restarted = f.restart(), plan = restarted.planRecovery(f.input);
    assert.equal(plan.outcome, 'restore-original');
    assert.match(fs.readFileSync(f.target, 'utf8'), /agents-kit/); // Planning never restores.
    const result = restarted.recover({planId: plan.planId});
    assert.equal(result.outcome, 'restored'); assert.deepEqual(fs.readFileSync(f.target), original);
    assert.equal(fs.statSync(f.target).mode & 0o777, 0o640);
    assert.equal(fs.existsSync(`${f.statePath}.journal.json`), false); assert.equal(fs.existsSync(`${f.statePath}.lock`), false);
    restarted.apply({planId: restarted.plan(f.input).planId});
  }
});

test('SIGKILL after state commit keeps committed files and reconciles saved execution without replay', t => {
  const f = fixture(t), saved = f.save(); f.crash({stage: 'committed', saved});
  assert.throws(() => f.restart().resumeSavedPlan(saved), {code: 'SAVED_PLAN_NOT_READY'});
  const restarted = f.restart(), plan = restarted.planRecovery(f.input);
  assert.equal(plan.outcome, 'keep-committed');
  const result = restarted.recover({planId: plan.planId});
  assert.equal(result.outcome, 'committed'); assert.match(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
  assert.equal(f.restart().resumeSavedPlan(saved).transactionId, `tx-plan-${saved.planId}`);
  assert.equal(JSON.parse(fs.readFileSync(f.statePath)).transactions.length, 1);
});

test('interrupted rollback is undone back to the pre-rollback deployment', t => {
  const f = fixture(t), applied = f.service.apply({planId: f.service.plan(f.input).planId});
  const before = fs.readFileSync(f.target); f.crash({transactionId: applied.transactionId});
  assert.doesNotMatch(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
  const restarted = f.restart(); restarted.recover({planId: restarted.planRecovery(f.input).planId});
  assert.deepEqual(fs.readFileSync(f.target), before);
  assert.equal(JSON.parse(fs.readFileSync(f.statePath)).transactions[0].status, 'committed');
});

test('recovery rejects live owners, outside-scope journals, external edits, altered backups and stale review', t => {
  for (const kind of ['live', 'scope', 'file', 'backup', 'stale']) {
    const f = fixture(t); f.crash();
    const journalFile = `${f.statePath}.journal.json`, journal = JSON.parse(fs.readFileSync(journalFile));
    if (kind === 'live') {
      journal.lockOwner.pid = process.pid; fs.writeFileSync(`${f.statePath}.lock`, JSON.stringify(journal.lockOwner)); fs.writeFileSync(journalFile, JSON.stringify(journal));
    }
    if (kind === 'scope') {journal.operations[0].authorizedRoot = f.root; fs.writeFileSync(journalFile, JSON.stringify(journal));}
    if (kind === 'file') fs.appendFileSync(f.target, 'external edit');
    if (kind === 'backup') fs.appendFileSync(journal.operations[0].backup.path, 'corrupt');
    const restarted = f.restart();
    if (kind === 'stale') {
      const plan = restarted.planRecovery(f.input); fs.appendFileSync(f.target, 'later edit');
      assert.throws(() => restarted.recover({planId: plan.planId}));
    } else assert.throws(() => restarted.planRecovery(f.input));
    assert.ok(fs.existsSync(`${f.statePath}.lock`)); assert.match(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
  }
});

test('interrupted removal restores owned contents and a restored saved attempt cannot replay', t => {
  const f = fixture(t);
  f.service.apply({planId: f.service.plan(f.input).planId});
  const original = fs.readFileSync(f.target);
  const saved = f.service.savePlan({planId: f.service.planRemoval({...f.input, assetIds: ['rules']}).planId});
  f.crash({saved});
  assert.doesNotMatch(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
  const restarted = f.restart();
  restarted.recover({planId: restarted.planRecovery(f.input).planId});
  assert.deepEqual(fs.readFileSync(f.target), original);
  assert.equal(restarted.savedPlans()[0].status, 'recovered');
  assert.throws(() => restarted.resumeSavedPlan(saved), {code: 'SAVED_PLAN_NOT_READY'});
});

test('global saved execution and missing source preserve runtime verification and file preconditions', t => {
  const f = fixture(t, 'global'), saved = f.save();
  f.restart().resumeSavedPlan(saved);
  assert.match(fs.readFileSync(f.target, 'utf8'), /agents-kit/);
  const missing = fixture(t), missingSaved = missing.save();
  fs.unlinkSync(path.join(missing.scopeRoot, 'rules.md'));
  assert.throws(() => missing.restart().resumeSavedPlan(missingSaved));
  assert.equal(fs.readFileSync(missing.target, 'utf8'), '# User instructions\n');
  const unverified = fixture(t);
  const blocked = unverified.service.plan({...unverified.input, clientVersion: 'unknown'});
  assert.equal(blocked.automatic, false);
  assert.throws(() => unverified.service.savePlan({planId: blocked.planId}), {code: 'SAVED_PLAN_UNSUPPORTED'});
});

test('saved execution reconciles the commit-to-receipt crash window without replay', t => {
  const f = fixture(t), saved = f.save(); f.crash({stage: 'finalized', saved});
  assert.equal(fs.existsSync(`${f.statePath}.journal.json`), false);
  assert.equal(fs.existsSync(`${f.statePath}.lock`), false);
  const result = f.restart().resumeSavedPlan(saved);
  assert.equal(result.reconciled, true);
  assert.equal(result.transactionId, `tx-plan-${saved.planId}`);
  assert.equal(f.restart().savedPlans()[0].status, 'completed');
  assert.equal(JSON.parse(fs.readFileSync(f.statePath)).transactions.length, 1);
});

test('recovery checks every target before restoring any file in a multi-target transaction', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.scopeRoot, 'skills/review'), {recursive: true});
  fs.writeFileSync(path.join(f.scopeRoot, 'skills/review/SKILL.md'), '---\nname: review\ndescription: Review code\n---\nReview evidence.\n');
  fs.appendFileSync(path.join(f.scopeRoot, 'agent-kit.yaml'), '  skills:\n    - {id: review, scope: project, source: skills/review, definition: {schemaVersion: 1, format: agent-skills}}\n');
  writeProfileFixture({definitionsDir: f.options.definitionsDir, repositoryRoot, capabilityIds: ['instructions-project', 'skills-project']});
  f.crash();
  const journal = JSON.parse(fs.readFileSync(`${f.statePath}.journal.json`));
  assert.equal(journal.operations.length, 2);
  const other = journal.operations.find(item => item.target !== f.target).target;
  fs.mkdirSync(path.dirname(other), {recursive: true}); fs.writeFileSync(other, 'external change');
  const changed = fs.readFileSync(f.target);
  assert.throws(() => f.restart().planRecovery(f.input), {code: 'RECOVERY_TARGET_CONFLICT'});
  assert.deepEqual(fs.readFileSync(f.target), changed);
  assert.equal(fs.readFileSync(other, 'utf8'), 'external change');
});
