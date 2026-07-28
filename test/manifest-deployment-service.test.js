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
detection:
  commands: [example]
  userRoot: ~/.example
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

test('application service projects client definitions without exposing target paths or formats', () => {
  const subject = fixture();

  assert.deepEqual(subject.service.clients(), [
    {
      id: 'example',
      displayName: 'Example',
      detection: {
        commands: ['example'],
        userRoot: '~/.example'
      },
      capabilities: [
        {
          assetKind: 'skills',
          scope: 'project',
          status: 'stable'
        }
      ]
    }
  ]);
});

test('application service exposes adapter-driven local discovery without running clients', () => {
  const subject = fixture();
  const binDir = path.join(subject.root, 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, 'example'), '#!/bin/sh\n');
  fs.chmodSync(path.join(binDir, 'example'), 0o755);

  const discovery = subject.service.localDiscovery({pathValue: binDir});
  const client = discovery.find(item => item.id === 'example');

  assert.equal(client.installed, true);
  assert.deepEqual(client.signals.commands, ['example']);
  assert.deepEqual(client.assets, []);
});

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

test('application service validates manifest successfully and reports invalid state', () => {
  const subject = fixture();

  const validRes = subject.service.validate({ scopeRoot: subject.scopeRoot });
  assert.equal(validRes.valid, true);
  assert.equal(validRes.issues.length, 0);

  fs.unlinkSync(path.join(subject.scopeRoot, 'agent-kit.yaml'));
  const invalidRes = subject.service.validate({ scopeRoot: subject.scopeRoot });
  assert.equal(invalidRes.valid, false);
  assert.equal(invalidRes.issues[0].code, 'MANIFEST_REQUIRED');
});

test('application service runs doctor diagnostics', () => {
  const subject = fixture();

  const healthyRes = subject.service.doctor({
    scopeRoot: subject.scopeRoot,
    targetRoot: subject.targetRoot,
    clientId: 'example',
    scope: 'project'
  });
  assert.equal(healthyRes.healthy, true);
  assert.equal(healthyRes.checks.some(c => c.id === 'manifest-load' && c.status === 'healthy'), true);

  const badTargetRes = subject.service.doctor({
    scopeRoot: subject.scopeRoot,
    targetRoot: path.join(subject.root, 'non-existent-directory'),
    clientId: 'example',
    scope: 'project'
  });
  assert.equal(badTargetRes.healthy, false);
  assert.equal(badTargetRes.checks.some(c => c.id === 'target-path' && c.status === 'error'), true);
});

test('application service retrieves resource registry and handles mutations', () => {
  const subject = fixture();

  const registry = subject.service.registry({ scopeRoot: subject.scopeRoot });
  assert.equal(registry.length, 1);
  assert.equal(registry[0].id, 'review');
  assert.equal(registry[0].kind, 'skills');

  assert.deepEqual(subject.service.resource({
    scopeRoot: subject.scopeRoot,
    assetId: 'review'
  }), {
    id: 'review',
    kind: 'skills',
    source: 'skills/review',
    scope: {
      type: 'project',
      projectName: 'default',
      key: 'project:default'
    }
  });
  assert.throws(() => subject.service.resource({
    scopeRoot: subject.scopeRoot,
    assetId: 'missing'
  }), error => error.code === 'ASSET_NOT_FOUND' && error.details.assetId === 'missing');

  fs.mkdirSync(path.join(subject.scopeRoot, 'skills/new'), { recursive: true });

  const plan1 = subject.service.planEdit({
    scopeRoot: subject.scopeRoot,
    mutations: [{
      type: 'create',
      kind: 'skills',
      assetId: 'new-skill',
      asset: { source: 'skills/new', scope: 'project' }
    }]
  });
  assert.equal(plan1.mutations.length, 1);
  assert.ok(plan1.planId);

  const apply1 = subject.service.applyEdit({ planId: plan1.planId });
  assert.equal(apply1.success, true);

  const reg2 = subject.service.registry({ scopeRoot: subject.scopeRoot });
  assert.equal(reg2.length, 2);
  assert.ok(reg2.some(a => a.id === 'new-skill'));

  assert.throws(() => subject.service.planEdit({
    scopeRoot: subject.scopeRoot,
    mutations: [{
      type: 'create',
      kind: 'skills',
      assetId: 'new-skill',
      asset: { source: 'skills/new', scope: 'project' }
    }]
  }), error => error.code === 'DUPLICATE_ASSET_ID');

  fs.mkdirSync(path.join(subject.scopeRoot, 'agents/reviewer'), { recursive: true });
  const planAgent = subject.service.planEdit({
    scopeRoot: subject.scopeRoot,
    mutations: [
      {
        type: 'create',
        kind: 'agents',
        assetId: 'reviewer-agent',
        asset: { source: 'agents/reviewer', scope: 'project', uses: { skills: ['new-skill'] } }
      }
    ]
  });
  subject.service.applyEdit({ planId: planAgent.planId });

  assert.throws(() => subject.service.planEdit({
    scopeRoot: subject.scopeRoot,
    mutations: [{
      type: 'delete',
      kind: 'skills',
      assetId: 'new-skill'
    }]
  }), error => error.code === 'DELETE_BLOCKED_BY_REFERENCES');

  const deps = subject.service.dependencies({ scopeRoot: subject.scopeRoot });
  assert.ok(deps.nodes.some(n => n.id === 'reviewer-agent'));
  assert.ok(deps.links.some(l => l.source === 'reviewer-agent' && l.target === 'new-skill'));

  // Attempting force delete should now be blocked as we removed force support.
  assert.throws(() => subject.service.planEdit({
    scopeRoot: subject.scopeRoot,
    mutations: [{
      type: 'delete',
      kind: 'skills',
      assetId: 'new-skill',
      force: true
    }]
  }), error => error.code === 'DELETE_BLOCKED_BY_REFERENCES');

  // Verify that an atomic edit plan which updates the referencing asset (removing the reference)
  // and deletes the target skill successfully plans.
  const atomicPlan = subject.service.planEdit({
    scopeRoot: subject.scopeRoot,
    mutations: [
      {
        type: 'update',
        kind: 'agents',
        assetId: 'reviewer-agent',
        asset: {
          id: 'reviewer-agent',
          source: 'agents/reviewer/AGENT.md',
          dependsOn: { skills: [] } // Remove reference to 'new-skill'
        }
      },
      {
        type: 'delete',
        kind: 'skills',
        assetId: 'new-skill'
      }
    ]
  });
  assert.ok(atomicPlan.planId);
});

test('doctor diagnostics reports resolvable and unresolvable environment secret references', () => {
  const subject = fixture();

  process.env.TEST_RESOLVABLE_SECRET = 'active';

  const editPlan = subject.service.planEdit({
    scopeRoot: subject.scopeRoot,
    mutations: [{
      type: 'create',
      kind: 'mcpServers',
      assetId: 'postgres-mcp',
      asset: {
        command: 'npx',
        environment: {
          DATABASE_URL: { source: 'environment', name: 'TEST_RESOLVABLE_SECRET' },
          API_KEY: { source: 'environment', name: 'TEST_UNRESOLVABLE_SECRET' }
        }
      }
    }]
  });
  subject.service.applyEdit({ planId: editPlan.planId });

  const doc = subject.service.doctor({
    scopeRoot: subject.scopeRoot,
    clientId: 'codex',
    scope: 'project',
    targetRoot: subject.targetRoot
  });

  const resolvable = doc.checks.find(c => c.id === 'env-postgres-mcp-DATABASE_URL');
  const unresolvable = doc.checks.find(c => c.id === 'env-postgres-mcp-API_KEY');

  assert.ok(resolvable);
  assert.equal(resolvable.status, 'healthy');
  assert.equal(resolvable.code, 'SECRET_RESOLVABLE');

  assert.ok(unresolvable);
  assert.equal(unresolvable.status, 'warning');
  assert.equal(unresolvable.code, 'SECRET_NOT_RESOLVABLE');

  delete process.env.TEST_RESOLVABLE_SECRET;
});
