import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import request from 'supertest';
import {createControlPlaneApp} from '../app.js';
import {createAppContext} from '../context.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

test('HTTP control plane completes plan, apply, history, and rollback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-e2e-'));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects', 'default');
  const targetRoot = path.join(root, 'target');
  fs.mkdirSync(path.join(scopeRoot, 'skills', 'review'), {recursive: true});
  fs.mkdirSync(homeDir);
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'skills', 'review', 'SKILL.md'), '# Review\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `
schemaVersion: 1
kit:
  id: http-e2e
assets:
  skills:
    - id: review
      source: skills/review
      scope: project
`);

  const context = createAppContext({
    homeDir,
    kitRoot,
    projectRoot: repositoryRoot,
    definitionsDir: path.join(repositoryRoot, 'clients')
  });
  const {app, apiToken} = createControlPlaneApp({
    context,
    apiToken: 'e'.repeat(64),
    logRequest: () => {}
  });
  const input = {
    clientId: 'codex',
    scope: 'project',
    projectName: 'default',
    projectPath: targetRoot
  };

  const session = await request(app).get('/api/session').expect(200);
  assert.equal(session.body.token, apiToken);
  await request(app).post('/api/deployment/plan').send(input).expect(403);

  const plan = await request(app)
    .post('/api/deployment/plan')
    .set('X-Agents-Kit-Token', apiToken)
    .send(input)
    .expect(200);
  assert.equal(plan.body.kind, 'apply');
  assert.equal(plan.body.automatic, true);
  assert.equal(plan.body.operations.length, 1);

  const applied = await request(app)
    .post('/api/deployment/apply')
    .set('X-Agents-Kit-Token', apiToken)
    .send({planId: plan.body.planId})
    .expect(200);
  assert.ok(applied.body.transactionId);
  assert.equal(
    fs.readFileSync(path.join(targetRoot, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8'),
    '# Review\n'
  );

  const history = await request(app)
    .get('/api/deployment/history')
    .query(input)
    .expect(200);
  assert.equal(history.body.transactions.length, 1);
  assert.equal(history.body.transactions[0].id, applied.body.transactionId);

  const rollbackPlan = await request(app)
    .post('/api/deployment/rollback-plan')
    .set('X-Agents-Kit-Token', apiToken)
    .send({...input, transactionId: applied.body.transactionId})
    .expect(200);
  assert.equal(rollbackPlan.body.kind, 'rollback');
  assert.equal(rollbackPlan.body.automatic, true);

  await request(app)
    .post('/api/deployment/rollback')
    .set('X-Agents-Kit-Token', apiToken)
    .send({planId: rollbackPlan.body.planId})
    .expect(200);
  assert.equal(
    fs.existsSync(path.join(targetRoot, '.agents', 'skills', 'review', 'SKILL.md')),
    false
  );
});
