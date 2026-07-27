import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeployRouter } from '../routes/deploy.js';

function routerWith(service) {
  return createDeployRouter({
    homeDir: '/home/test',
    kitRoot: '/kit',
    permissionsFilePath: '/kit/permissions.json',
    approvedProjectRoots: new Set(),
    globalClientRoots: () => [],
    isKnownLinkPair: () => false,
    resolveMcpConfigForDeploy: () => ({}),
    assertSafeProjectTarget: () => {},
    existsBrokenSymlink: () => false,
    checkSymlink: () => false,
    resolveKitScopeDir: () => '/kit/projects/default',
    manifestDeploymentService: service,
    sendApiError: (req, res, error) => res.status(error.code === 'DEPLOYMENT_PLAN_NOT_FOUND' ? 404 : 400).json({
      code: error.code,
      requestId: req.requestId
    })
  });
}

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
