import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeployRouter } from '../routes/deploy.js';
import fs from 'node:fs';
import path from 'node:path';
import {resourcePathFixture} from '../../../test/helpers/resource-path-fixture.js';
import {declareDistribution} from '../../../test/helpers/skill-distribution-fixture.js';

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
    'GET /api/clients',
    'GET /api/deployment/history',
    'GET /api/deployment/saved-plans',
    'GET /api/local-discovery',
    'GET /api/manifest/dependencies',
    'GET /api/manifest/installation',
    'GET /api/manifest/registry',
    'GET /api/manifest/resources/:assetId',
    'GET /api/manifest/source',
    'GET /api/manifest/upstream/check',
    'POST /api/deployment/apply',
    'POST /api/deployment/doctor',
    'POST /api/deployment/migration-plan',
    'POST /api/deployment/plan',
    'POST /api/deployment/prerequisites/observe',
    'POST /api/deployment/recover',
    'POST /api/deployment/recovery-plan',
    'POST /api/deployment/removal-plan',
    'POST /api/deployment/resume',
    'POST /api/deployment/rollback',
    'POST /api/deployment/rollback-plan',
    'POST /api/deployment/save-plan',
    'POST /api/deployment/validate',
    'POST /api/manifest/detach/apply',
    'POST /api/manifest/detach/plan',
    'POST /api/manifest/edit/apply',
    'POST /api/manifest/edit/plan',
    'POST /api/manifest/import/apply',
    'POST /api/manifest/import/plan',
    'POST /api/manifest/installation/apply',
    'POST /api/manifest/installation/plan',
    'POST /api/manifest/inventory/observe',
    'POST /api/manifest/refresh/apply',
    'POST /api/manifest/refresh/plan',
    'POST /api/manifest/source-edit/apply',
    'POST /api/manifest/source-edit/plan',
    'POST /api/manifest/source-recovery/apply',
    'POST /api/manifest/source-recovery/plan',
    'POST /api/manifest/source-rollback/apply',
    'POST /api/manifest/source-rollback/plan',
    'POST /api/manifest/upstream/check',
    'POST /api/manifest/variant-register/apply','POST /api/manifest/variant-register/plan'
  ]);
});

function dispatch(router, method, routePath, { body = {}, query = {}, params = {} } = {}) {
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
  const pending = layer.route.stack[0].handle({ body, query, params, requestId: 'request-test' }, res);
  if (pending?.then) Object.defineProperty(response, 'done', {value: pending});
  return response;
}

test('HTTP exposes a selected Skill review and applies/restores through the same service with existing settings and links preserved',async t=>{
  const f=resourcePathFixture(t),file=path.join(f.targetRoot,'.agents/skills/review/SKILL.md'),before=fs.readFileSync(file),config=fs.readFileSync(f.mcp);
  fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'\nHTTP selected variant\n');declareDistribution(f);f.raw.targets={codex:{assetIds:['review']}};f.write();
  const router=createDeployRouter({homeDir:f.homeDir,kitRoot:f.kitRoot,assertSafeProjectTarget:()=>{},resolveKitScopeDir:()=>f.scopeRoot,manifestDeploymentService:f.service,
    sendApiError:(_req,res,error)=>res.status(400).json({code:error.code})});
  const body={scope:'project',projectName:'default',projectPath:f.targetRoot,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};
  const plan=dispatch(router,'POST','/api/deployment/plan',{body});await plan.done;assert.equal(plan.statusCode,200);assert.equal(plan.body.automatic,true,JSON.stringify(plan.body));assert.equal(plan.body.skillDistributions[0].selection.variantId,'common');assert.deepEqual(fs.readFileSync(file),before);
  const applied=dispatch(router,'POST','/api/deployment/apply',{body:{planId:plan.body.planId}});await applied.done;assert.equal(applied.statusCode,200);assert.match(fs.readFileSync(file,'utf8'),/HTTP selected variant/);
  const rollback=dispatch(router,'POST','/api/deployment/rollback-plan',{body:{...body,transactionId:applied.body.transactionId}});await rollback.done;assert.equal(rollback.body.automatic,true,JSON.stringify(rollback.body));
  const restored=dispatch(router,'POST','/api/deployment/rollback',{body:{planId:rollback.body.planId}});await restored.done;assert.equal(restored.statusCode,200);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(f.mcp),config);f.preserved();
});

test('HTTP variant registration and source edits keep origin and installed files unchanged',async t=>{
  const f=resourcePathFixture(t);f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};declareDistribution(f);const before=fs.readFileSync(f.statePath);
  const router=createDeployRouter({homeDir:f.homeDir,kitRoot:f.kitRoot,assertSafeProjectTarget:()=>{},resolveKitScopeDir:()=>f.scopeRoot,manifestDeploymentService:f.service,sendApiError:(_req,res,error)=>res.status(400).json({code:error.code})});
  const context={scope:'project',projectPath:f.targetRoot,projectName:'default',assetId:'review',variantId:'common'};
  const registration=dispatch(router,'POST','/api/manifest/variant-register/plan',{body:context});await registration.done;assert.equal(registration.body.automatic,true,JSON.stringify(registration.body));
  const accepted=dispatch(router,'POST','/api/manifest/variant-register/apply',{body:{planId:registration.body.planId}});await accepted.done;assert.equal(accepted.statusCode,200);
  const source=dispatch(router,'GET','/api/manifest/source',{query:context});await source.done;assert.equal(source.body.variantId,'common');
  const edit=dispatch(router,'POST','/api/manifest/source-edit/plan',{body:{...context,revision:source.body.revision,changes:[{path:'notes.md',text:'HTTP variant notes\n'}]}});await edit.done;assert.equal(edit.body.automatic,true,JSON.stringify(edit.body));
  const applied=dispatch(router,'POST','/api/manifest/source-edit/apply',{body:{planId:edit.body.planId}});await applied.done;assert.equal(applied.statusCode,200);
  const updated=dispatch(router,'GET','/api/manifest/source',{query:context});await updated.done;assert.ok(updated.body.files.some(file=>file.path==='notes.md'));assert.equal(fs.existsSync(path.join(f.scopeRoot,'review/notes.md')),false);assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
});

test('rollback HTTP response awaits coordinated execution and maps asynchronous errors',async()=>{
  const router=routerWith({rollback:async({planId})=>{if(planId==='failed')throw Object.assign(new Error('Changed native context'),{code:'DEPENDENCY_NATIVE_PREREQUISITES_CHANGED'});return {transactionId:'tx-rollback',outcome:'committed',fulfilled:false};}});
  const completed=dispatch(router,'POST','/api/deployment/rollback',{body:{planId:'ready'}});await completed.done;assert.equal(completed.body.transactionId,'tx-rollback');assert.equal(completed.body.fulfilled,false);
  const failed=dispatch(router,'POST','/api/deployment/rollback',{body:{planId:'failed'}});await failed.done;assert.equal(failed.statusCode,400);assert.equal(failed.body.code,'DEPENDENCY_NATIVE_PREREQUISITES_CHANGED');
});

test('registry catalog view shares the application service and preserves the default single-scope contract', () => {
  let input;
  const router = routerWith({catalog: value => {input = value; return {schemaVersion: 1, registry: [], scopes: []};},
    registry: value => {input = value; return [{id: 'legacy'}];}});
  let response = dispatch(router, 'GET', '/api/manifest/registry', {query: {view: 'catalog', clientId: 'codex', surface: 'cli'}});
  assert.equal(response.body.schemaVersion, 1); assert.equal(input.kitRoot, '/kit');
  assert.equal(input.clientId, 'codex'); assert.equal(input.projectPath, undefined);
  response = dispatch(router, 'GET', '/api/manifest/registry', {query: {scope: 'global'}});
  assert.deepEqual(response.body.registry, [{id: 'legacy'}]);
  assert.deepEqual(input, {scopeRoot: '/kit/projects/default'});
});

test('native inventory route awaits the same service and ignores caller-supplied binaries or evidence',async()=>{
  let input;
  const router=routerWith({observeCatalog:async value=>{input=value;return {schemaVersion:1,nativeObservation:{status:'observed'}};}});
  const result=dispatch(router,'POST','/api/manifest/inventory/observe',{body:{clientId:'codex',surface:'cli',projectPath:'/work',projectName:'one',includeOtherClients:true,binaryPath:'/unsafe',nativeEvidence:{enabled:true}}});
  await result.done;assert.equal(result.body.nativeObservation.status,'observed');
  assert.deepEqual(input,{kitRoot:'/kit',clientId:'codex',surface:'cli',projectPath:'/work',projectName:'one',includeDependencies:true,includeOtherClients:true});
});

test('MCP inventory route passes the resource kind without allowing a protocol or executable override',async()=>{
  let input;const router=routerWith({observeCatalog:async value=>{input=value;return {nativeObservation:{kind:value.kind,status:'observed'}};}});
  const response=dispatch(router,'POST','/api/manifest/inventory/observe',{body:{kind:'mcpServers',clientId:'codex',surface:'cli',adapter:'mcpServer/tool/call'}});await response.done;
  assert.equal(response.body.nativeObservation.kind,'mcpServers');assert.equal(input.kind,'mcpServers');assert.equal(input.adapter,undefined);
});

test('pinned source APIs await acquisition, pass only the locator, and report asynchronous failures', async () => {
  const upstream = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit: 'a'.repeat(40), subpath: 'skills/review'};
  let selected;
  const router = routerWith({planRefresh: async input => {selected = input; return {planId: 'remote-plan', automatic: true};},
    checkUpstream: async input => {selected = input; throw Object.assign(new Error('offline'), {code: 'UPSTREAM_UNAVAILABLE'});}});
  const planned = dispatch(router, 'POST', '/api/manifest/refresh/plan', {body: {scope: 'global', assetId: 'review', upstream, targetRoot: '/untrusted'}});
  await planned.done;
  assert.equal(planned.body.planId, 'remote-plan'); assert.deepEqual(selected.upstream, upstream); assert.equal(selected.targetRoot, '/home/test');
  const unavailable = dispatch(router, 'POST', '/api/manifest/upstream/check', {body: {scope: 'global', assetId: 'review', upstream}});
  await unavailable.done;
  assert.equal(unavailable.statusCode, 400); assert.equal(unavailable.body.code, 'UPSTREAM_UNAVAILABLE');
  const legacy = dispatch(router, 'GET', '/api/manifest/upstream/check', {query: {scope: 'global', assetId: 'review'}});
  await legacy.done; assert.equal(legacy.body.code, 'UPSTREAM_UNAVAILABLE');
});

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

test('client catalog API exposes read-only client summaries', () => {
  const service = {
    clients: () => [{
      id: 'codex',
      displayName: 'Codex',
      detection: { commands: ['codex'], userRoot: '~/.codex' },
      capabilities: [{ assetKind: 'mcp', scope: 'global', status: 'stable' }]
    }]
  };

  const response = dispatch(routerWith(service), 'GET', '/api/clients');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    success: true,
    clients: [{
      id: 'codex',
      displayName: 'Codex',
      detection: { commands: ['codex'], userRoot: '~/.codex' },
      capabilities: [{ assetKind: 'mcp', scope: 'global', status: 'stable' }]
    }]
  });
});

test('local discovery API exposes only sanitized read-only projections', () => {
  const service = {
    localDiscovery: () => [{
      id: 'codex',
      displayName: 'Codex',
      supported: true,
      installed: true,
      configured: true,
      signals: {commands: ['codex'], userRootExists: true},
      assets: [{
        id: 'context7',
        kind: 'mcpServers',
        clientId: 'codex',
        sourcePath: '~/.codex/config.toml'
      }],
      issues: []
    }]
  };

  const response = dispatch(routerWith(service), 'GET', '/api/local-discovery');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    success: true,
    clients: service.localDiscovery()
  });
});

test('local discovery forwards authorized project scope and rejects invalid scopes before invoking the service', () => {
  let input;
  const router = routerWith({localDiscovery: value => { input = value; return []; }});
  const response = dispatch(router, 'GET', '/api/local-discovery', {query: {scope: 'project', projectPath: '/project'}});
  assert.equal(response.statusCode, 200);
  assert.deepEqual(input, {scope: 'project', projectPath: '/project'});
  input = undefined;
  const invalid = dispatch(router, 'GET', '/api/local-discovery', {query: {scope: 'invalid'}});
  assert.equal(invalid.statusCode, 400);
  assert.equal(input, undefined);
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

test('deployment router rejects missing or forbidden project path in doctor and validate', () => {
  const service = {
    validate: () => ({ valid: true }),
    doctor: () => ({ healthy: true })
  };

  // 1. Missing projectPath for validate
  const router = routerWith(service);
  const validateResMissing = dispatch(router, 'POST', '/api/deployment/validate', {
    body: { scope: 'project', projectPath: '' }
  });
  assert.equal(validateResMissing.statusCode, 400);
  assert.equal(validateResMissing.body.code, 'PROJECT_PATH_REQUIRED');

  // 2. Missing projectPath for doctor
  const doctorResMissing = dispatch(router, 'POST', '/api/deployment/doctor', {
    body: { clientId: 'codex', scope: 'project', projectPath: '' }
  });
  assert.equal(doctorResMissing.statusCode, 400);
  assert.equal(doctorResMissing.body.code, 'PROJECT_PATH_REQUIRED');

  // 3. Forbidden projectPath for doctor (mock assertSafeProjectTarget to throw)
  const routerForbidden = createDeployRouter({
    homeDir: '/home/test',
    kitRoot: '/kit',
    assertSafeProjectTarget: (dir) => {
      if (dir === '/forbidden') {
        const err = new Error('forbidden');
        err.code = 'FORBIDDEN_PATH';
        throw err;
      }
    },
    resolveKitScopeDir: () => '/kit/projects/default',
    manifestDeploymentService: service,
    sendApiError: (req, res, error) => res.status(400).json({
      code: error.code || 'ERROR',
      message: error.message
    })
  });

  const doctorResForbidden = dispatch(routerForbidden, 'POST', '/api/deployment/doctor', {
    body: { clientId: 'codex', scope: 'project', projectPath: '/forbidden' }
  });
  assert.equal(doctorResForbidden.statusCode, 400);
  assert.equal(doctorResForbidden.body.message, 'forbidden');
});


test('deployment router supports manifest registry and edit endpoints', () => {
  const service = {
    registry: ({ scopeRoot }) => [{ id: 'review', kind: 'skills' }],
    resource: ({ scopeRoot, assetId }) => ({
      id: assetId,
      kind: 'skills',
      source: 'skills/review',
      scope: { type: 'project', projectName: 'default', key: 'project:default' }
    }),
    dependencies: ({ scopeRoot }) => ({ nodes: [{ id: 'review', kind: 'skills' }], links: [] }),
    planEdit: ({ scopeRoot, mutations }) => ({ planId: 'edit-plan-1', mutations }),
    applyEdit: ({ planId }) => ({ success: true })
  };
  const router = routerWith(service);

  const registryRes = dispatch(router, 'GET', '/api/manifest/registry', {
    query: { scope: 'project', projectPath: '/project' }
  });
  assert.equal(registryRes.statusCode, 200);
  assert.equal(registryRes.body.registry[0].id, 'review');

  const resourceRes = dispatch(router, 'GET', '/api/manifest/resources/:assetId', {
    query: { scope: 'project', projectPath: '/project' },
    params: { assetId: 'review' }
  });
  assert.equal(resourceRes.statusCode, 200);
  assert.deepEqual(resourceRes.body.resource, {
    id: 'review',
    kind: 'skills',
    source: 'skills/review',
    scope: { type: 'project', projectName: 'default', key: 'project:default' }
  });

  const dependenciesRes = dispatch(router, 'GET', '/api/manifest/dependencies', {
    query: { scope: 'project', projectPath: '/project' }
  });
  assert.equal(dependenciesRes.statusCode, 200);
  assert.equal(dependenciesRes.body.nodes[0].id, 'review');

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

test('plan and doctor forward surface/version but never request-supplied runtime evidence or OS', () => {
  const received = [];
  const router = routerWith({plan: input => { received.push(input); return {}; }, doctor: input => { received.push(input); return {}; }});
  for (const route of ['plan', 'doctor']) {
    dispatch(router, 'POST', `/api/deployment/${route}`, {body: {
      clientId: 'antigravity', surface: 'desktop', clientVersion: '1.2.3', scope: 'global',
      platform: 'fake', runtimeEvidence: [{verified: true}]
    }});
  }
  for (const input of received) {
    assert.equal(input.surface, 'desktop');
    assert.equal(input.clientVersion, '1.2.3');
    assert.equal(input.runtimeEvidence, undefined);
    assert.equal(input.platform, undefined);
  }
});

test('migration route forwards only explicit mapping and scope to the shared application service', () => {
  let received;
  const router = routerWith({planMigration: input => { received = input; return {planId: 'migration-1', kind: 'migration'}; }});
  const response = dispatch(router, 'POST', '/api/deployment/migration-plan', {body: {
    scope: 'global', clientId: 'codex', surface: 'desktop', migration: 'shared-ownership', assetIds: ['rules'],
    statePath: '/untrusted/state.json', runtimeEvidence: ['fake'], homeDir: '/untrusted'
  }});
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {scope: 'global', scopeRoot: '/kit/projects/default', targetRoot: '/home/test', clientId: 'codex', surface: 'desktop', migration: 'shared-ownership', assetIds: ['rules']});
});
