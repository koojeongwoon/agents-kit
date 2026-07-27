import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createManifestDeploymentService } from '../lib/application/manifest-deployment-service.js';

function fixture({ clock = () => Date.now() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-service-'));
  const scopeRoot = path.join(root, 'kit');
  const targetRoot = path.join(root, 'project');
  const definitionsDir = path.join(root, 'clients');
  fs.mkdirSync(path.join(scopeRoot, 'skills/review'), { recursive: true });
  fs.mkdirSync(targetRoot);
  fs.mkdirSync(definitionsDir);
  fs.writeFileSync(path.join(scopeRoot, 'skills/review/SKILL.md'), '# Review\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `
schemaVersion: 1
kit:
  id: service-test
assets:
  skills:
    - id: review
      source: skills/review
      scope: project
`);
  fs.writeFileSync(path.join(definitionsDir, 'example.yaml'), `
schemaVersion: 1
id: example
displayName: Example
capabilities:
  - id: skills-project
    assetKind: skills
    scope: project
    path: .agents/skills/{assetId}
    format: directory
    strategy: copy
    status: stable
    evidence:
      state: verified
      source: https://example.com/docs/skills
      verifiedAt: 2026-07-27
`);
  const service = createManifestDeploymentService({
    definitionsDir,
    homeDir: path.join(root, 'home'),
    planTtlMs: 1000,
    clock
  });
  return { root, scopeRoot, targetRoot, definitionsDir, service };
}

test('application service plans, applies, lists history, and rolls back one manifest flow', () => {
  const subject = fixture();
  const plan = subject.service.plan({
    scopeRoot: subject.scopeRoot,
    targetRoot: subject.targetRoot,
    clientId: 'example',
    scope: 'project'
  });
  assert.equal(plan.kind, 'apply');
  assert.equal(plan.automatic, true);
  assert.equal(plan.operations[0].target.endsWith('.agents/skills/review/SKILL.md'), true);
  assert.equal('content' in plan.operations[0], false);

  const applied = subject.service.apply({ planId: plan.planId });
  assert.equal(applied.applied.length, 1);
  assert.throws(
    () => subject.service.apply({ planId: plan.planId }),
    error => error.code === 'DEPLOYMENT_PLAN_NOT_FOUND'
  );
  const history = subject.service.history({
    scope: 'project',
    targetRoot: subject.targetRoot,
    clientId: 'example'
  });
  assert.equal(history[0].id, applied.transactionId);

  const rollbackPlan = subject.service.planRollback({
    transactionId: applied.transactionId,
    scope: 'project',
    targetRoot: subject.targetRoot,
    clientId: 'example'
  });
  assert.equal(rollbackPlan.kind, 'rollback');
  assert.equal(rollbackPlan.automatic, true);
  subject.service.rollback({ planId: rollbackPlan.planId });
  assert.equal(fs.existsSync(plan.operations[0].target), false);
});

test('application service fails closed for expired plans and unknown clients', () => {
  let time = 1000;
  const subject = fixture({ clock: () => time });
  assert.throws(() => subject.service.plan({
    scopeRoot: subject.scopeRoot,
    targetRoot: subject.targetRoot,
    clientId: 'missing',
    scope: 'project'
  }), error => error.code === 'CLIENT_DEFINITION_NOT_FOUND');
  const plan = subject.service.plan({
    scopeRoot: subject.scopeRoot,
    targetRoot: subject.targetRoot,
    clientId: 'example',
    scope: 'project'
  });
  time = 3000;
  assert.throws(
    () => subject.service.apply({ planId: plan.planId }),
    error => error.code === 'DEPLOYMENT_PLAN_EXPIRED'
  );
  assert.equal(fs.existsSync(plan.operations[0].target), false);
});

test('application service requires an explicit manifest and matching scope assets', () => {
  const subject = fixture();
  fs.unlinkSync(path.join(subject.scopeRoot, 'agent-kit.yaml'));
  assert.throws(() => subject.service.plan({
    scopeRoot: subject.scopeRoot,
    targetRoot: subject.targetRoot,
    clientId: 'example',
    scope: 'project'
  }), error => error.code === 'MANIFEST_REQUIRED');
});
