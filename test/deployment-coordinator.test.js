import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyDeployment } from '../lib/application/apply-deployment.js';
import { applyDeploymentRollback, planDeploymentRollback } from '../lib/application/rollback-deployment.js';
import { prepareCopyDeployment } from '../lib/application/prepare-copy-deployment.js';
import { prepareMergeDeployment } from '../lib/application/prepare-merge-deployment.js';
import { DeploymentBackupStore } from '../lib/infrastructure/deployment-backup-store.js';
import { DeploymentStateStore } from '../lib/infrastructure/deployment-state-store.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-coordinator-'));
  const project = path.join(root, 'project');
  const copySource = path.join(root, 'skill.md');
  const mergeSource = path.join(root, 'settings.json');
  fs.mkdirSync(project);
  fs.writeFileSync(copySource, '# Skill\n');
  fs.writeFileSync(mergeSource, '{"managed":{"enabled":true}}');
  const stateStore = new DeploymentStateStore({
    statePath: path.join(project, '.agent-kit/state.json')
  });
  const backupStore = new DeploymentBackupStore({
    backupsRoot: path.join(project, '.agent-kit/backups')
  });
  const base = {
    clientId: 'example',
    clientVersion: '',
    automatic: true,
    blocked: []
  };
  const sources = new Map([
    ['skill', copySource],
    ['settings', mergeSource]
  ]);
  const copyPlan = prepareCopyDeployment({
    capabilityPlan: {
      ...base,
      operations: [{
        clientId: 'example',
        assetId: 'skill',
        assetKind: 'skills',
        target: '.client/skill.md',
        strategy: 'copy',
        format: 'markdown'
      }]
    },
    sources,
    targetRoot: project,
    homeDir: path.join(root, 'home'),
    state: stateStore.load()
  });
  const mergePlan = prepareMergeDeployment({
    capabilityPlan: {
      ...base,
      operations: [{
        clientId: 'example',
        assetId: 'settings',
        assetKind: 'clientSettings',
        target: '.client/settings.json',
        strategy: 'merge',
        format: 'json-section'
      }]
    },
    sources,
    targetRoot: project,
    homeDir: path.join(root, 'home'),
    state: stateStore.load()
  });
  return { root, project, copySource, mergeSource, stateStore, backupStore, copyPlan, mergePlan };
}

test('coordinator applies copy and merge plans as one recorded transaction', () => {
  const subject = fixture();
  const result = applyDeployment({
    plans: [subject.copyPlan, subject.mergePlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-coordinated-apply'
  });
  assert.equal(result.applied.length, 2);
  const state = subject.stateStore.load();
  const recorded = state.transactions.find(item => item.id === 'tx-coordinated-apply');
  assert.equal(recorded.operations.length, 2);
  assert.equal(recorded.status, 'committed');
  assert.equal(fs.readFileSync(subject.copyPlan.operations[0].target, 'utf8'), '# Skill\n');
  assert.equal(JSON.parse(fs.readFileSync(subject.mergePlan.operations[0].target, 'utf8')).managed.enabled, true);
});

test('validation failure rolls back all strategies and removes new backups', () => {
  const subject = fixture();
  assert.throws(() => applyDeployment({
    plans: [subject.copyPlan, subject.mergePlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    validate: () => ({ valid: false, results: [{ code: 'CLIENT_REJECTED' }] }),
    createTransactionId: () => 'tx-validation-failure'
  }), error => error.code === 'DEPLOYMENT_VALIDATION_FAILED');
  assert.equal(fs.existsSync(subject.copyPlan.operations[0].target), false);
  assert.equal(fs.existsSync(subject.mergePlan.operations[0].target), false);
  assert.equal(
    fs.existsSync(path.join(subject.project, '.agent-kit/backups/tx-validation-failure/0000.bak')),
    false
  );
  assert.deepEqual(subject.stateStore.load().transactions, []);
});

test('rollback preview restores overwritten files and removes created files', () => {
  const subject = fixture();
  const mergeTarget = subject.mergePlan.operations[0].target;
  fs.mkdirSync(path.dirname(mergeTarget), { recursive: true });
  fs.writeFileSync(mergeTarget, '{"user":{"theme":"dark"}}\n');
  subject.mergePlan = prepareMergeDeployment({
    capabilityPlan: {
      clientId: 'example',
      clientVersion: '',
      blocked: [],
      operations: [{
        clientId: 'example',
        assetId: 'settings',
        assetKind: 'clientSettings',
        target: '.client/settings.json',
        strategy: 'merge',
        format: 'json-section'
      }]
    },
    sources: new Map([['settings', subject.mergeSource]]),
    targetRoot: subject.project,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  applyDeployment({
    plans: [subject.copyPlan, subject.mergePlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-to-rollback'
  });

  const plan = planDeploymentRollback({
    transactionId: 'tx-to-rollback',
    stateStore: subject.stateStore
  });
  assert.equal(plan.automatic, true);
  assert.deepEqual(plan.operations.map(item => item.operation).sort(), ['REMOVE', 'RESTORE']);
  applyDeploymentRollback({
    plan,
    stateStore: subject.stateStore,
    backupStore: subject.backupStore
  });
  assert.equal(fs.existsSync(subject.copyPlan.operations[0].target), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(mergeTarget, 'utf8')), { user: { theme: 'dark' } });
  const state = subject.stateStore.load();
  assert.equal(state.transactions.find(item => item.id === 'tx-to-rollback').status, 'rolled-back');
  assert.equal(state.transactions.at(-1).type, 'rollback');
});

test('rollback is blocked if a deployed target changed externally', () => {
  const subject = fixture();
  applyDeployment({
    plans: [subject.copyPlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-modified'
  });
  fs.writeFileSync(subject.copyPlan.operations[0].target, 'external');
  const plan = planDeploymentRollback({
    transactionId: 'tx-modified',
    stateStore: subject.stateStore
  });
  assert.equal(plan.automatic, false);
  assert.equal(plan.blocked[0].reason, 'ROLLBACK_TARGET_MODIFIED');
  assert.throws(() => applyDeploymentRollback({
    plan,
    stateStore: subject.stateStore,
    backupStore: subject.backupStore
  }), error => error.code === 'ROLLBACK_PLAN_BLOCKED');
});

test('coordinator rejects duplicate targets before creating backups', () => {
  const subject = fixture();
  const duplicate = {
    ...subject.copyPlan,
    operations: [{ ...subject.copyPlan.operations[0] }]
  };
  assert.throws(() => applyDeployment({
    plans: [subject.copyPlan, duplicate],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore
  }), error => error.code === 'DUPLICATE_DEPLOYMENT_TARGET');
});

test('older transaction rollback is blocked after ownership is superseded', () => {
  const subject = fixture();
  applyDeployment({
    plans: [subject.copyPlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-first'
  });
  fs.writeFileSync(subject.copySource, '# Skill version 2\n');
  const nextPlan = prepareCopyDeployment({
    capabilityPlan: {
      clientId: 'example',
      clientVersion: '',
      blocked: [],
      operations: [{
        clientId: 'example',
        assetId: 'skill',
        assetKind: 'skills',
        target: '.client/skill.md',
        strategy: 'copy',
        format: 'markdown'
      }]
    },
    sources: new Map([['skill', subject.copySource]]),
    targetRoot: subject.project,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  applyDeployment({
    plans: [nextPlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-second'
  });
  const rollback = planDeploymentRollback({
    transactionId: 'tx-first',
    stateStore: subject.stateStore
  });
  assert.equal(rollback.blocked[0].reason, 'ROLLBACK_OWNERSHIP_SUPERSEDED');
});

test('backup store rejects a reused transaction ID', () => {
  const subject = fixture();
  applyDeployment({
    plans: [subject.copyPlan],
    stateStore: subject.stateStore,
    backupStore: subject.backupStore,
    createTransactionId: () => 'tx-unique'
  });
  const fresh = fixture();
  fresh.backupStore = subject.backupStore;
  assert.throws(() => applyDeployment({
    plans: [fresh.copyPlan],
    stateStore: fresh.stateStore,
    backupStore: fresh.backupStore,
    createTransactionId: () => 'tx-unique'
  }), error => error.code === 'TRANSACTION_BACKUP_COLLISION');
});
