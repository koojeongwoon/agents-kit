import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyMergeDeployment } from '../lib/application/apply-merge-deployment.js';
import { prepareMergeDeployment } from '../lib/application/prepare-merge-deployment.js';
import { DeploymentStateStore } from '../lib/infrastructure/deployment-state-store.js';

function fixture({ format = 'json-section', target = '.client/settings.json', desired } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-merge-'));
  const project = path.join(root, 'project');
  const source = path.join(root, 'desired.txt');
  fs.mkdirSync(project);
  fs.writeFileSync(source, desired || '{"managed":{"enabled":true}}');
  return {
    root,
    project,
    source,
    stateStore: new DeploymentStateStore({ statePath: path.join(project, '.agent-kit/state.json') }),
    capabilityPlan: {
      clientId: 'example',
      clientVersion: '',
      blocked: [],
      operations: [{
        clientId: 'example',
        assetId: 'settings',
        assetKind: 'clientSettings',
        target,
        strategy: 'merge',
        format,
        evidenceState: 'verified',
        reason: 'CAPABILITY_ELIGIBLE'
      }]
    }
  };
}

function prepare(subject) {
  return prepareMergeDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['settings', subject.source]]),
    targetRoot: subject.project,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
}

test('merge deployment preserves user JSON and commits structured ownership', () => {
  const subject = fixture();
  const target = path.join(subject.project, '.client/settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{"user":{"theme":"dark"}}\n');
  const plan = prepare(subject);
  assert.equal(plan.operations[0].operation, 'MERGE');
  applyMergeDeployment({ plan, stateStore: subject.stateStore });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), {
    user: { theme: 'dark' },
    managed: { enabled: true }
  });
  const state = subject.stateStore.load();
  assert.ok(state.managed[fs.realpathSync(target)].owners.settings.units['/managed/enabled']);
});

test('multiple assets targeting one file compose into one atomic operation', () => {
  const subject = fixture();
  const second = path.join(subject.root, 'second.json');
  fs.writeFileSync(second, '{"other":{"value":2}}');
  subject.capabilityPlan.operations.push({
    ...subject.capabilityPlan.operations[0],
    assetId: 'other'
  });
  const plan = prepareMergeDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['settings', subject.source], ['other', second]]),
    targetRoot: subject.project,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.equal(plan.operations.length, 1);
  applyMergeDeployment({ plan, stateStore: subject.stateStore });
  const output = JSON.parse(fs.readFileSync(plan.operations[0].target, 'utf8'));
  assert.equal(output.managed.enabled, true);
  assert.equal(output.other.value, 2);
});

test('owned-unit external edits block a later merge', () => {
  const subject = fixture();
  let plan = prepare(subject);
  applyMergeDeployment({ plan, stateStore: subject.stateStore });
  fs.writeFileSync(plan.operations[0].target, '{"managed":{"enabled":"external"}}\n');
  fs.writeFileSync(subject.source, '{"managed":{"enabled":false}}');
  plan = prepare(subject);
  assert.equal(plan.automatic, false);
  assert.equal(plan.blocked[0].reason, 'OWNED_CONTENT_MODIFIED_EXTERNALLY');
});

test('stale merge plan and validation failure preserve the target and state', () => {
  const subject = fixture();
  let plan = prepare(subject);
  fs.mkdirSync(path.dirname(plan.operations[0].target), { recursive: true });
  fs.writeFileSync(plan.operations[0].target, '{"appeared":true}');
  assert.throws(
    () => applyMergeDeployment({ plan, stateStore: subject.stateStore }),
    error => error.code === 'STALE_DEPLOYMENT_PLAN'
  );
  assert.equal(fs.readFileSync(plan.operations[0].target, 'utf8'), '{"appeared":true}');

  fs.unlinkSync(plan.operations[0].target);
  plan = prepare(subject);
  assert.throws(() => applyMergeDeployment({
    plan,
    stateStore: subject.stateStore,
    validate: () => ({ valid: false, results: [{ code: 'INVALID_JSON' }] })
  }), error => error.code === 'DEPLOYMENT_VALIDATION_FAILED');
  assert.equal(fs.existsSync(plan.operations[0].target), false);
  assert.deepEqual(subject.stateStore.load().managed, {});
});
