import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeployRouter } from '../routes/deploy.js';

function routerWith(service) {
  return createDeployRouter({
    homeDir: '/home/test',
    kitRoot: '/kit',
    assertSafeProjectTarget: () => {},
    resolveKitScopeDir: () => '/kit/projects/default',
    manifestDeploymentService: service,
    sendApiError: (req, res, error) => res.status(error.code === 'DEPLOYMENT_PLAN_NOT_FOUND' ? 404 : 400).json({
      code: error.code,
      requestId: req.requestId
    })
  });
}

test('deployment router exposes only the Manifest control-plane surface', () => {
  const service = {};
  const routes = routerWith(service).stack
    .filter(layer => layer.route)
    .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`)
    .sort();

  assert.deepEqual(routes, [
    'GET /api/deployment/history',
    'GET /api/manifest/registry',
    'POST /api/deployment/apply',
    'POST /api/deployment/doctor',
    'POST /api/deployment/plan',
    'POST /api/deployment/rollback',
    'POST /api/deployment/rollback-plan',
    'POST /api/deployment/validate',
    'POST /api/manifest/edit/apply',
    'POST /api/manifest/edit/plan'
  ]);
});

function dispatch(router, method, routePath, { body = {}, query = {} } = {}) {
  const layer = router.stack.find(item => (
    item.route?.path === routePath
    && item.route.methods[method.toLowerCase()]
  ));
  assert.ok(layer, `route ${method} ${routePath} exists`);
  const response = { statusCode: 200, body: undefined };
  const res = {
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(value) {
      response.body = value;
      return this;
    }
  };
  layer.route.stack[0].handle({ body, query, requestId: 'request-test' }, res);
  return response;
}

test('manifest deployment API keeps plan and apply as separate requests', async () => {
  let appliedPlanId = '';
  const service = {
    plan: input => ({
      planId: 'plan-1',
      kind: 'apply',
      automatic: true,
      operations: [{ target: '/project/.agents/skills/review' }],
      blocked: [],
      received: input
    }),
    apply: ({ planId }) => {
      appliedPlanId = planId;
      return { transactionId: 'tx-1', applied: ['/project/.agents/skills/review'] };
    }
  };
  const router = routerWith(service);
  const planned = dispatch(router, 'POST', '/api/deployment/plan', {
    body: { clientId: 'codex', scope: 'project', projectPath: '/project' }
  });
  assert.equal(planned.statusCode, 200);
  assert.equal(planned.body.planId, 'plan-1');
  assert.equal(appliedPlanId, '');

  const applied = dispatch(router, 'POST', '/api/deployment/apply', {
    body: { planId: planned.body.planId }
  });
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.body.transactionId, 'tx-1');
  assert.equal(appliedPlanId, 'plan-1');
});

test('manifest deployment API exposes history and two-step rollback', async () => {
  const service = {
    history: () => [{ id: 'tx-1', type: 'apply' }],
    planRollback: () => ({
      planId: 'rollback-1',
      kind: 'rollback',
      automatic: true,
      operations: [{ operation: 'REMOVE', target: '/project/file' }],
      blocked: []
    }),
    rollback: ({ planId }) => ({ transactionId: 'tx-rollback', planId })
  };
  const router = routerWith(service);
  const history = dispatch(router, 'GET', '/api/deployment/history', {
    query: { clientId: 'codex', scope: 'project', projectPath: '/project' }
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.body.transactions[0].id, 'tx-1');

  const planned = dispatch(router, 'POST', '/api/deployment/rollback-plan', {
    body: {
      transactionId: 'tx-1',
      clientId: 'codex',
      scope: 'project',
      projectPath: '/project'
    }
  });
  assert.equal(planned.statusCode, 200);
  const rolledBack = dispatch(router, 'POST', '/api/deployment/rollback', {
    body: { planId: planned.body.planId }
  });
  assert.equal(rolledBack.statusCode, 200);
  assert.equal(rolledBack.body.transactionId, 'tx-rollback');
});

test('manifest deployment API returns stable plan lookup errors', async () => {
  const service = {
    apply: () => {
      const error = new Error('missing');
      error.code = 'DEPLOYMENT_PLAN_NOT_FOUND';
      throw error;
    }
  };
  const response = dispatch(routerWith(service), 'POST', '/api/deployment/apply', {
    body: { planId: 'missing' }
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    code: 'DEPLOYMENT_PLAN_NOT_FOUND',
    requestId: 'request-test'
  });
});

test('deployment router supports validate and doctor endpoints', () => {
  const service = {
    validate: ({ scopeRoot }) => ({ valid: true, issues: [] }),
    doctor: ({ scopeRoot, targetRoot, clientId, scope, clientVersion }) => ({ healthy: true, checks: [] })
  };
  const router = routerWith(service);

  const validateRes = dispatch(router, 'POST', '/api/deployment/validate', {
    body: { scope: 'project', projectPath: '/project' }
  });
  assert.equal(validateRes.statusCode, 200);
  assert.equal(validateRes.body.valid, true);

  const doctorRes = dispatch(router, 'POST', '/api/deployment/doctor', {
    body: { clientId: 'codex', scope: 'project', projectPath: '/project' }
  });
  assert.equal(doctorRes.statusCode, 200);
  assert.equal(doctorRes.body.healthy, true);
});

test('deployment router supports manifest registry and edit endpoints', () => {
  const service = {
    registry: ({ scopeRoot }) => [{ id: 'review', kind: 'skills' }],
    planEdit: ({ scopeRoot, mutations }) => ({ planId: 'edit-plan-1', mutations }),
    applyEdit: ({ planId }) => ({ success: true })
  };
  const router = routerWith(service);

  const registryRes = dispatch(router, 'GET', '/api/manifest/registry', {
    query: { scope: 'project', projectPath: '/project' }
  });
  assert.equal(registryRes.statusCode, 200);
  assert.equal(registryRes.body.registry[0].id, 'review');

  const planEditRes = dispatch(router, 'POST', '/api/manifest/edit/plan', {
    body: { scope: 'project', projectPath: '/project', mutations: [] }
  });
  assert.equal(planEditRes.statusCode, 200);
  assert.equal(planEditRes.body.planId, 'edit-plan-1');

  const applyEditRes = dispatch(router, 'POST', '/api/manifest/edit/apply', {
    body: { planId: 'edit-plan-1' }
  });
  assert.equal(applyEditRes.statusCode, 200);
  assert.equal(applyEditRes.body.success, true);
});
