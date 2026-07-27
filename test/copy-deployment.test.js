import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyCopyDeployment } from '../lib/application/apply-copy-deployment.js';
import { prepareCopyDeployment } from '../lib/application/prepare-copy-deployment.js';
import { DeploymentStateStore } from '../lib/infrastructure/deployment-state-store.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-copy-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'project');
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '# Review\n');
  const capabilityPlan = {
    clientId: 'codex',
    clientVersion: '',
    automatic: true,
    blocked: [],
    operations: [{
      clientId: 'codex',
      assetId: 'review',
      assetKind: 'skills',
      source: 'skills/review',
      target: '.agents/skills/review',
      strategy: 'copy',
      evidenceState: 'verified',
      reason: 'CAPABILITY_ELIGIBLE'
    }]
  };
  const stateStore = new DeploymentStateStore({
    statePath: path.join(target, '.agent-kit', 'state.json')
  });
  return { root, source, target, capabilityPlan, stateStore };
}

test('copy plan expands a directory and apply commits file ownership state', () => {
  const subject = fixture();
  const plan = prepareCopyDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['review', subject.source]]),
    targetRoot: subject.target,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.equal(plan.automatic, true);
  assert.equal(plan.operations[0].operation, 'CREATE');

  const result = applyCopyDeployment({ plan, stateStore: subject.stateStore });
  const deployed = plan.operations[0].target;
  assert.equal(fs.readFileSync(deployed, 'utf8'), '# Review\n');
  assert.equal(subject.stateStore.load().managed[deployed].assetId, 'review');
  assert.equal(result.applied.length, 1);
});

test('unknown content and externally modified owned content are conflicts', () => {
  const subject = fixture();
  const deployed = path.join(fs.realpathSync(subject.target), '.agents/skills/review/SKILL.md');
  fs.mkdirSync(path.dirname(deployed), { recursive: true });
  fs.writeFileSync(deployed, 'user content');
  let plan = prepareCopyDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['review', subject.source]]),
    targetRoot: subject.target,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.equal(plan.blocked[0].reason, 'UNKNOWN_EXISTING_CONTENT');

  const state = subject.stateStore.load();
  state.managed[deployed] = { hash: 'previous-owned-hash' };
  subject.stateStore.commit(state);
  plan = prepareCopyDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['review', subject.source]]),
    targetRoot: subject.target,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.equal(plan.blocked[0].reason, 'OWNED_CONTENT_MODIFIED_EXTERNALLY');
});

test('stale plans fail before mutation', () => {
  const subject = fixture();
  const plan = prepareCopyDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['review', subject.source]]),
    targetRoot: subject.target,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  const target = plan.operations[0].target;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'appeared after plan');
  assert.throws(
    () => applyCopyDeployment({ plan, stateStore: subject.stateStore }),
    error => error.code === 'STALE_DEPLOYMENT_PLAN'
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'appeared after plan');
});

test('validation failure rolls back every copied file and does not commit state', () => {
  const subject = fixture();
  fs.writeFileSync(path.join(subject.source, 'extra.md'), 'extra');
  const plan = prepareCopyDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['review', subject.source]]),
    targetRoot: subject.target,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.throws(() => applyCopyDeployment({
    plan,
    stateStore: subject.stateStore,
    validate: () => ({ valid: false, results: [{ code: 'INVALID_SKILL' }] })
  }), error => error.code === 'DEPLOYMENT_VALIDATION_FAILED');
  for (const operation of plan.operations) assert.equal(fs.existsSync(operation.target), false);
  assert.deepEqual(subject.stateStore.load().managed, {});
});

test('state commit failure restores deployed files', () => {
  const subject = fixture();
  const plan = prepareCopyDeployment({
    capabilityPlan: subject.capabilityPlan,
    sources: new Map([['review', subject.source]]),
    targetRoot: subject.target,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  const failingStore = {
    load: () => subject.stateStore.load(),
    commit: () => {
      const error = new Error('disk full');
      error.code = 'STATE_FAILURE';
      throw error;
    }
  };
  assert.throws(() => applyCopyDeployment({ plan, stateStore: failingStore }), /disk full/);
  assert.equal(fs.existsSync(plan.operations[0].target), false);
});

test('copy preparation ignores strategies handled by other preparation services', () => {
  const subject = fixture();
  const plan = prepareCopyDeployment({
    capabilityPlan: {
      ...subject.capabilityPlan,
      operations: [{ ...subject.capabilityPlan.operations[0], strategy: 'merge' }]
    },
    sources: new Map([['review', subject.source]]),
    targetRoot: subject.target,
    homeDir: path.join(subject.root, 'home'),
    state: subject.stateStore.load()
  });
  assert.equal(plan.automatic, true);
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.blocked.length, 0);
});
