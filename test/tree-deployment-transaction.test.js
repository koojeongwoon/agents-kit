import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {DeploymentStateStore} from '../lib/infrastructure/deployment-state-store.js';
import {DeploymentBackupStore} from '../lib/infrastructure/deployment-backup-store.js';
import {readPathImage, imageFingerprint} from '../lib/infrastructure/path-image.js';
import {executeTreeDeployment, planTreeJournalRecovery, applyTreeJournalRecovery} from '../lib/infrastructure/tree-deployment-transaction.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-tree-tx-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const target = path.join(root, 'review'); fs.mkdirSync(target, {mode: 0o750}); fs.writeFileSync(path.join(target, 'SKILL.md'), '# Original\n', {mode: 0o640});
  const stateStore = new DeploymentStateStore({statePath: path.join(root, '.agent-kit/state.json')}); stateStore.targetRoot = root;
  const backupStore = new DeploymentBackupStore({backupsRoot: path.join(root, '.agent-kit/backups')});
  const beforeImage = readPathImage(target, {authorizedRoot: root});
  const command = {target, authorizedRoot: root, beforeImage, afterImage: {kind: 'symlink', source: '/private/fixed-snapshot/tree'}};
  const buildNextState = ({beforeState, id, operations}) => ({...beforeState, schemaVersion: 6, transactions: [...beforeState.transactions, {id, type: 'apply', status: 'committed', operations}]});
  const run = extras => stateStore.withLock(() => executeTreeDeployment({stateStore, backupStore, commands: [command], buildNextState, id: 'tx-tree-test', ...extras}));
  return {root, target, stateStore, backupStore, command, beforeImage, run};
}
test('lock cleanup preserves a replacement lock or link owned by another operation', t => {
  for (const replacement of ['file', 'symlink']) {
    const f = fixture(t), lock = `${f.stateStore.statePath}.lock`, foreign = path.join(f.root, 'foreign-lock');
    const content = JSON.stringify({pid: process.pid, token: 'another-operation'}); fs.writeFileSync(foreign, content);
    f.stateStore.withLock(() => {
      fs.unlinkSync(lock);
      if (replacement === 'symlink') fs.symlinkSync(foreign, lock); else fs.copyFileSync(foreign, lock);
    });
    assert.equal(fs.lstatSync(lock).isSymbolicLink(), replacement === 'symlink');
    assert.equal(fs.readFileSync(lock, 'utf8'), content); assert.equal(fs.readFileSync(foreign, 'utf8'), content);
  }
});
test('directory-to-link transaction preserves the entire original tree and commits state after validation', t => {
  const f = fixture(t), identity = fs.statSync(f.target).ino;
  const result = f.run({validate: () => ({valid: true})});
  assert.equal(result.transactionId, 'tx-tree-test'); assert.equal(fs.readlinkSync(f.target), '/private/fixed-snapshot/tree');
  const operation = f.stateStore.load().transactions[0].operations[0];
  assert.equal(fs.statSync(operation.retainedPath).ino, identity);
  assert.equal(imageFingerprint(readPathImage(operation.retainedPath, {authorizedRoot: path.dirname(f.stateStore.statePath)})), imageFingerprint(f.beforeImage));
  assert.equal(fs.existsSync(`${f.stateStore.statePath}.journal.json`), false); assert.equal(fs.existsSync(`${f.stateStore.statePath}.lock`), false);
});
test('validation and ordinary phase failures restore original bytes, modes and identity', t => {
  for (const phase of ['stage-ready', 'path-swapped', 'before-state']) {
    const f = fixture(t), identity = fs.statSync(f.target).ino;
    assert.throws(() => f.run({onPhase: value => {if (value === phase) throw new Error('phase fault');}}), /phase fault/);
    assert.equal(fs.statSync(f.target).ino, identity); assert.equal(imageFingerprint(readPathImage(f.target, {authorizedRoot: f.root})), imageFingerprint(f.beforeImage));
    assert.equal(f.stateStore.load().transactions.length, 0); assert.equal(fs.existsSync(`${f.stateStore.statePath}.journal.json`), false);
  }
  const f = fixture(t); assert.throws(() => f.run({validate: () => ({valid: false})}), {code: 'DEPLOYMENT_VALIDATION_FAILED'});
  assert.equal(fs.readFileSync(path.join(f.target, 'SKILL.md'), 'utf8'), '# Original\n');
});
test('backup collision and a concurrent external target edit are preserved', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.backupStore.backupsRoot, 'tx-tree-test'), {recursive: true}); fs.writeFileSync(path.join(f.backupStore.backupsRoot, 'tx-tree-test/user'), 'keep');
  assert.throws(() => f.run({}), {code: 'TRANSACTION_BACKUP_COLLISION'}); assert.equal(fs.readFileSync(path.join(f.backupStore.backupsRoot, 'tx-tree-test/user'), 'utf8'), 'keep');
  const other = fixture(t);
  assert.throws(() => other.run({onPhase: phase => {if (phase === 'stage-ready') fs.writeFileSync(path.join(other.target, 'SKILL.md'), '# User edit\n');}}), {code: 'STALE_DEPLOYMENT_PLAN'});
  assert.equal(fs.readFileSync(path.join(other.target, 'SKILL.md'), 'utf8'), '# User edit\n');
});

test('SIGKILL around staging, exchange and ledger commit is recovered from the same recorded transaction', t => {
  const urls = ['deployment-state-store', 'deployment-backup-store', 'tree-deployment-transaction'].map(name => new URL(`../lib/infrastructure/${name}.js`, import.meta.url).href);
  for (const phase of ['journal', 'stage-ready', 'path-swapped', 'before-state', 'state-committed']) {
    const f = fixture(t), input = {root: f.root, target: f.target, command: f.command, phase};
    const script = `import{DeploymentStateStore}from ${JSON.stringify(urls[0])};import{DeploymentBackupStore}from ${JSON.stringify(urls[1])};import{executeTreeDeployment}from ${JSON.stringify(urls[2])};const i=${JSON.stringify(input)};const s=new DeploymentStateStore({statePath:i.root+'/.agent-kit/state.json'});s.targetRoot=i.root;const b=new DeploymentBackupStore({backupsRoot:i.root+'/.agent-kit/backups'});s.withLock(()=>executeTreeDeployment({stateStore:s,backupStore:b,commands:[i.command],id:'tx-crash',buildNextState:({beforeState,id,operations})=>({...beforeState,schemaVersion:6,transactions:[{id,type:'apply',status:'committed',operations}]}),onPhase:p=>{if(p===i.phase)process.kill(process.pid,'SIGKILL')}}));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'}); assert.equal(child.signal, 'SIGKILL', child.stderr);
    const plan = planTreeJournalRecovery({stateStore: f.stateStore, backupStore: f.backupStore}); assert.equal(plan.committed, phase === 'state-committed');
    const result = applyTreeJournalRecovery({plan, stateStore: f.stateStore, backupStore: f.backupStore});
    assert.equal(result.outcome, phase === 'state-committed' ? 'committed' : 'restored');
    if (phase === 'state-committed') assert.equal(fs.readlinkSync(f.target), '/private/fixed-snapshot/tree');
    else assert.equal(imageFingerprint(readPathImage(f.target, {authorizedRoot: f.root})), imageFingerprint(f.beforeImage));
    assert.equal(fs.existsSync(`${f.stateStore.statePath}.journal.json`), false); assert.equal(fs.existsSync(`${f.stateStore.statePath}.lock`), false);
  }
});

test('SIGKILL during recovery preserves restored paths and permits review of the remaining journal', t => {
  const f = fixture(t), urls = ['deployment-state-store', 'deployment-backup-store', 'tree-deployment-transaction'].map(name => new URL(`../lib/infrastructure/${name}.js`, import.meta.url).href);
  const setup = `import{DeploymentStateStore}from ${JSON.stringify(urls[0])};import{DeploymentBackupStore}from ${JSON.stringify(urls[1])};import{executeTreeDeployment,planTreeJournalRecovery,applyTreeJournalRecovery}from ${JSON.stringify(urls[2])};const s=new DeploymentStateStore({statePath:${JSON.stringify(f.stateStore.statePath)}});s.targetRoot=${JSON.stringify(f.root)};const b=new DeploymentBackupStore({backupsRoot:${JSON.stringify(f.backupStore.backupsRoot)}});`;
  const deployment = spawnSync(process.execPath, ['--input-type=module', '-e', `${setup}s.withLock(()=>executeTreeDeployment({stateStore:s,backupStore:b,commands:[${JSON.stringify(f.command)}],id:'tx-recovery-crash',buildNextState:({beforeState})=>beforeState,onPhase:p=>{if(p==='path-swapped')process.kill(process.pid,'SIGKILL')}}));`], {encoding: 'utf8'});
  assert.equal(deployment.signal, 'SIGKILL', deployment.stderr);
  const recovery = spawnSync(process.execPath, ['--input-type=module', '-e', `${setup}const plan=planTreeJournalRecovery({stateStore:s,backupStore:b});applyTreeJournalRecovery({plan,stateStore:s,backupStore:b,onPhase:p=>{if(p==='restored-path')process.kill(process.pid,'SIGKILL')}});`], {encoding: 'utf8'});
  assert.equal(recovery.signal, 'SIGKILL', recovery.stderr);
  assert.equal(imageFingerprint(readPathImage(f.target, {authorizedRoot: f.root})), imageFingerprint(f.beforeImage));
  const plan = planTreeJournalRecovery({stateStore: f.stateStore, backupStore: f.backupStore}); assert.equal(plan.operations[0].operation, 'KEEP_ORIGINAL');
  const result = applyTreeJournalRecovery({plan, stateStore: f.stateStore, backupStore: f.backupStore}); assert.equal(result.outcome, 'restored');
  assert.equal(fs.existsSync(`${f.stateStore.statePath}.journal.json`), false);
  assert.ok(fs.readdirSync(path.dirname(f.stateStore.statePath)).some(name => name.startsWith('state.json.recovery.lock.abandoned-')));
});

test('external changes after exchange are retained with the original directory and a blocked recovery journal', t => {
  const f = fixture(t);
  assert.throws(() => f.run({onPhase: phase => {if (phase === 'path-swapped') {fs.unlinkSync(f.target); fs.mkdirSync(f.target); fs.writeFileSync(path.join(f.target, 'SKILL.md'), '# Concurrent user\n'); throw new Error('user changed target');}}}), {code: 'DEPLOYMENT_RECOVERY_REQUIRED'});
  assert.equal(fs.readFileSync(path.join(f.target, 'SKILL.md'), 'utf8'), '# Concurrent user\n');
  assert.equal(fs.readFileSync(path.join(f.backupStore.backupsRoot, 'tx-tree-test/0000.stage/SKILL.md'), 'utf8'), '# Original\n');
  assert.equal(fs.existsSync(`${f.stateStore.statePath}.journal.json`), true);
});
