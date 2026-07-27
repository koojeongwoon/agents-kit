import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyDeployment } from '../lib/application/apply-deployment.js';
import { applyDeploymentRollback, planDeploymentRollback } from '../lib/application/rollback-deployment.js';
import { prepareManagedLinkDeployment } from '../lib/application/prepare-managed-link-deployment.js';
import { DeploymentBackupStore } from '../lib/infrastructure/deployment-backup-store.js';
import { DeploymentStateStore } from '../lib/infrastructure/deployment-state-store.js';

function fixture(strategy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-kit-${strategy}-`));
  const project = path.join(root, 'project');
  const source = path.join(root, 'source.txt');
  fs.mkdirSync(project);
  fs.writeFileSync(source, 'version one');
  const stateStore = new DeploymentStateStore({
    statePath: path.join(project, '.agent-kit/state.json')
  });
  const backupStore = new DeploymentBackupStore({
    backupsRoot: path.join(project, '.agent-kit/backups')
  });
  const capabilityPlan = {
    clientId: 'example',
    clientVersion: '',
    blocked: [],
    operations: [{
      clientId: 'example',
      assetId: 'asset',
      assetKind: 'instructions',
      target: `.client/${strategy}.txt`,
      strategy,
      format: 'markdown'
    }]
  };
  const prepare = () => prepareManagedLinkDeployment({
    capabilityPlan,
    sources: new Map([['asset', source]]),
    targetRoot: project,
    homeDir: path.join(root, 'home'),
    state: stateStore.load()
  });
  return { root, project, source, stateStore, backupStore, capabilityPlan, prepare };
}

test('managed strategy owns the complete file and updates only its owned target', () => {
  const subject = fixture('managed');
  let plan = subject.prepare();
  assert.equal(plan.operations[0].operation, 'CREATE');
  applyDeployment({
    plans: [plan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-managed-one'
  });
  fs.writeFileSync(subject.source, 'version two');
  plan = subject.prepare();
  assert.equal(plan.operations[0].operation, 'UPDATE_MANAGED');
  applyDeployment({
    plans: [plan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-managed-two'
  });
  assert.equal(fs.readFileSync(plan.operations[0].target, 'utf8'), 'version two');
  assert.equal(subject.stateStore.load().managed[plan.operations[0].target].strategy, 'managed');
});

test('managed strategy blocks unknown and externally modified files', () => {
  const subject = fixture('managed');
  const target = path.join(subject.project, '.client/managed.txt');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'user');
  let plan = subject.prepare();
  assert.equal(plan.blocked[0].reason, 'UNKNOWN_EXISTING_CONTENT');

  fs.unlinkSync(target);
  plan = subject.prepare();
  applyDeployment({
    plans: [plan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-managed-owned'
  });
  fs.writeFileSync(target, 'external');
  plan = subject.prepare();
  assert.equal(plan.blocked[0].reason, 'OWNED_CONTENT_MODIFIED_EXTERNALLY');
});

test('link strategy creates and safely replaces only an owned symlink', () => {
  const subject = fixture('link');
  let plan = subject.prepare();
  applyDeployment({
    plans: [plan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-link-one'
  });
  const target = plan.operations[0].target;
  assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(target), fs.realpathSync(subject.source));

  const nextSource = path.join(subject.root, 'next.txt');
  fs.writeFileSync(nextSource, 'next');
  const nextPlan = prepareManagedLinkDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['asset', nextSource]]),
    targetRoot: subject.project,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.equal(nextPlan.operations[0].operation, 'REPLACE_LINK');
  applyDeployment({
    plans: [nextPlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-link-two'
  });
  assert.equal(fs.realpathSync(target), fs.realpathSync(nextSource));

  const rollback = planDeploymentRollback({
    transactionId: 'tx-link-two',
    stateStore: subject.stateStore
  });
  assert.equal(rollback.operations[0].operation, 'RESTORE_LINK');
  applyDeploymentRollback({
    plan: rollback,
    stateStore: subject.stateStore,
    backupStore: subject.backupStore
  });
  assert.equal(fs.realpathSync(target), fs.realpathSync(subject.source));
  assert.equal(subject.stateStore.load().managed[target].transactionId, 'tx-link-one');
});

test('link strategy blocks unknown files, changed links, and self references', () => {
  const subject = fixture('link');
  const target = path.join(subject.project, '.client/link.txt');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'user');
  let plan = subject.prepare();
  assert.equal(plan.blocked[0].reason, 'UNKNOWN_EXISTING_CONTENT');

  fs.unlinkSync(target);
  plan = subject.prepare();
  applyDeployment({
    plans: [plan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-owned-link'
  });
  const external = path.join(subject.root, 'external.txt');
  fs.writeFileSync(external, 'external');
  fs.unlinkSync(target);
  fs.symlinkSync(external, target);
  plan = subject.prepare();
  assert.equal(plan.blocked[0].reason, 'OWNED_LINK_MODIFIED_EXTERNALLY');

  const selfSource = path.join(subject.project, 'source.txt');
  fs.writeFileSync(selfSource, 'self');
  const selfPlan = prepareManagedLinkDeployment({
    capabilityPlan: {
      ...subject.capabilityPlan,
      operations: [{ ...subject.capabilityPlan.operations[0], target: 'source.txt' }]
    },
    sources: new Map([['asset', selfSource]]),
    targetRoot: subject.project,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.equal(selfPlan.blocked[0].reason, 'SELF_REFERENCING_LINK');
});
