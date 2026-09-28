import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import request from 'supertest';
import {createControlPlaneApp} from '../app.js';
import {createAppContext} from '../context.js';
import {writeProfileFixture} from '../../../test/helpers/client-profile-fixture.js';

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

  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..')});
  const context = createAppContext({
    homeDir,
    kitRoot,
    definitionsDir
  });
  const {app, apiToken} = createControlPlaneApp({
    context,
    apiToken: 'e'.repeat(64),
    logRequest: () => {}
  });
  const input = {
    clientId: 'codex',
    surface: 'desktop',
    clientVersion: '0.0.1-test',
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

test('HTTP control plane self-target prevention returns 400 when projectPath is forbidden', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-security-'));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  fs.mkdirSync(homeDir);
  fs.mkdirSync(kitRoot);

  const context = createAppContext({
    homeDir,
    kitRoot
  });
  const {app, apiToken} = createControlPlaneApp({
    context,
    apiToken: 'e'.repeat(64),
    logRequest: () => {}
  });

  // Try planning into kit root
  await request(app)
    .post('/api/deployment/plan')
    .set('X-Agents-Kit-Token', apiToken)
    .send({
      clientId: 'codex',
      scope: 'project',
      projectName: 'default',
      projectPath: kitRoot
    })
    .expect(400);

  // Try doctor with forbidden kit root
  await request(app)
    .post('/api/deployment/doctor')
    .set('X-Agents-Kit-Token', apiToken)
    .send({
      clientId: 'codex',
      scope: 'project',
      projectName: 'default',
      projectPath: kitRoot
    })
    .expect(400);
});

test('HTTP plans expose typed MCP previews without bypassing runtime gates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-mcp-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(directory, {recursive: true});
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  fs.copyFileSync(path.join(repositoryRoot, 'docs/examples/mcp-common.yaml'), path.join(scopeRoot, 'agent-kit.yaml'));
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot}), apiToken: 'f'.repeat(64), logRequest: () => {}});
  for (const clientId of ['codex', 'antigravity']) {
    const response = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken)
      .send({clientId, surface: 'cli', scope: 'project', projectPath: targetRoot}).expect(200);
    assert.equal(response.body.automatic, false);
    assert.equal(response.body.previews.length, 2);
    assert.match(response.body.previews[1].desired, clientId === 'codex' ? /mcp_servers.remote-docs/ : /serverUrl/);
    const applied = await request(app).post('/api/deployment/apply').set('X-Agents-Kit-Token', apiToken).send({planId: response.body.planId});
    assert.ok(applied.status >= 400);
    assert.equal(applied.body.code, 'DEPLOYMENT_PLAN_BLOCKED');
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  }
});
test('HTTP plans expose selected common Agent previews without bypassing runtime gates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-mcp-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(directory, {recursive: true});
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  fs.copyFileSync(path.join(repositoryRoot, 'docs/examples/agent-common.yaml'), path.join(scopeRoot, 'agent-kit.yaml'));
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot}), apiToken: 'f'.repeat(64), logRequest: () => {}});
  for (const clientId of ['codex', 'antigravity']) {
    const response = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken)
      .send({clientId, surface: 'cli', clientVersion: '9.9.9', scope: 'project', projectPath: targetRoot}).expect(200);
    assert.equal(response.body.automatic, false);
    assert.deepEqual(response.body.selection.rootAssetIds, ['reviewer']);
    assert.equal(response.body.previews.length, 1);
    assert.match(response.body.previews[0].desired, clientId === 'codex' ? /developer_instructions/ : /subagent: true/);
    const applied = await request(app).post('/api/deployment/apply').set('X-Agents-Kit-Token', apiToken).send({planId: response.body.planId});
    assert.ok(applied.status >= 400);
    assert.equal(applied.body.code, 'DEPLOYMENT_PLAN_BLOCKED');
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  }
});

test('HTTP shares four-resource source validation and returns actionable malformed Skill errors', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-four-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, path.dirname(scopeRoot), targetRoot]) fs.mkdirSync(directory, {recursive: true});
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  fs.cpSync(path.join(repositoryRoot, 'docs/examples/common-resources'), scopeRoot, {recursive: true});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot}), apiToken: 'f'.repeat(64), logRequest: () => {}});
  const input = {clientId: 'codex', surface: 'cli', scope: 'project', projectPath: targetRoot};
  const plan = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken).send(input).expect(200);
  assert.deepEqual(plan.body.selection.selectedAssetIds, ['docs', 'reviewer', 'shared-rules', 'source-review']);
  assert.equal(plan.body.automatic, false);
  fs.writeFileSync(path.join(scopeRoot, 'skills/source-review/SKILL.md'), '# Missing frontmatter\n');
  const invalid = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken).send(input).expect(400);
  assert.equal(invalid.body.code, 'INVALID_SKILL_FRONTMATTER');
  assert.deepEqual(fs.readdirSync(targetRoot), []);
});

test('HTTP batch ownership and two-step removal preserve the other client', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-shared-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Shared rules\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: shared}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n');
  const definitionsDir = path.join(root, 'definitions');
  for (const clientId of ['codex', 'antigravity']) writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), clientId, capabilityIds: ['instructions-project']});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'a'.repeat(64), logRequest: () => {}});
  const base = {scope: 'project', projectPath: targetRoot};
  const post = (url, input) => request(app).post(url).set('X-Agents-Kit-Token', apiToken).send(input);
  const plan = await post('/api/deployment/plan', {...base, targets: ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}))}).expect(200);
  assert.equal(plan.body.automatic, true);
  assert.equal(plan.body.operations.length, 1);
  assert.equal(plan.body.operations[0].consumers.length, 2);
  await post('/api/deployment/apply', {planId: plan.body.planId}).expect(200);
  const target = path.join(targetRoot, 'AGENTS.md');
  for (const clientId of ['codex', 'antigravity']) {
    const removal = await post('/api/deployment/removal-plan', {...base, clientId, surface: 'cli', assetIds: ['rules']}).expect(200);
    assert.equal(removal.body.kind, 'remove');
    assert.equal(fs.existsSync(target), true);
    await post('/api/deployment/apply', {planId: removal.body.planId}).expect(200);
    assert.equal(fs.existsSync(target), clientId === 'codex');
  }
  await post('/api/deployment/removal-plan', {...base, projectPath: kitRoot, clientId: 'codex', assetIds: ['rules']}).expect(400);
});

test('HTTP global ledger and ownership migration preserve files and permit later shared removal', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-migration-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'global');
  for (const directory of [homeDir, scopeRoot]) fs.mkdirSync(directory, {recursive: true});
  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['instructions-global']});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review evidence.\n');
  const manifest = 'schemaVersion: 1\nkit: {id: migration}\nassets:\n  instructions:\n    - {id: rules, scope: global, source: rules.md';
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `${manifest}}\n`);
  const context = createAppContext({homeDir, kitRoot, definitionsDir});
  const {app, apiToken} = createControlPlaneApp({context, apiToken: 'b'.repeat(64), logRequest: () => {}});
  const post = (url, input) => request(app).post(url).set('X-Agents-Kit-Token', apiToken).send(input);
  const base = {scope: 'global', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  // Seed through the native application path, then represent the pre-unification layout.
  const nativePlan = await post('/api/deployment/plan', base).expect(200);
  await post('/api/deployment/apply', {planId: nativePlan.body.planId}).expect(200);
  const unified = path.join(homeDir, '.agents-kit/deployments/_global/state.json');
  const legacy = path.join(homeDir, '.agents-kit/deployments/codex/state.json');
  fs.mkdirSync(path.dirname(legacy), {recursive: true}); fs.renameSync(unified, legacy);
  const target = path.join(homeDir, '.codex/AGENTS.md'), before = fs.readFileSync(target);
  const blocked = await post('/api/deployment/plan', base).expect(409);
  assert.equal(blocked.body.code, 'GLOBAL_LEDGER_MIGRATION_REQUIRED');
  await request(app).post('/api/deployment/migration-plan').send({...base, migration: 'global-ledger'}).expect(403);
  const ledger = await post('/api/deployment/migration-plan', {...base, migration: 'global-ledger'}).expect(200);
  assert.equal(fs.existsSync(unified), false);
  await post('/api/deployment/apply', {planId: ledger.body.planId}).expect(200);
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `${manifest}, definition: {schemaVersion: 1, format: markdown}}\n`);
  const ownership = await post('/api/deployment/migration-plan', {...base, migration: 'shared-ownership', assetIds: ['rules']}).expect(200);
  assert.equal(ownership.body.automatic, true);
  assert.equal(ownership.body.operations[0].metadataOnly, true);
  await post('/api/deployment/apply', {planId: ownership.body.planId}).expect(200);
  assert.deepEqual(fs.readFileSync(target), before);
  const removal = await post('/api/deployment/removal-plan', {...base, assetIds: ['rules']}).expect(200);
  await post('/api/deployment/apply', {planId: removal.body.planId}).expect(200);
  assert.equal(fs.readFileSync(target, 'utf8').trim(), ''); // Migrated legacy file conservatively retained.
  await post('/api/deployment/migration-plan', {...base, scope: 'project', projectPath: kitRoot, migration: 'shared-ownership', assetIds: ['rules']}).expect(400);
});

test('HTTP mixed Agent/MCP removal uses the same approval and rollback transaction', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-removal-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'target');
  for (const dir of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `schemaVersion: 1
kit: {id: removal}
defaults:
  mcpBindings: {schemaVersion: 1, endpoints: {docs: {url: https://example.test/mcp}}}
assets:
  agents:
    - id: reviewer
      scope: project
      definition: {schemaVersion: 1, permissions: client-default, description: Review, instructions: Check evidence.}
  mcpServers:
    - id: docs
      scope: project
      definition: {schemaVersion: 1, transport: http, endpointId: docs}
`);
  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['agents-project', 'mcp-project']});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'c'.repeat(64), logRequest: () => {}});
  const post = (url, input) => request(app).post(url).set('X-Agents-Kit-Token', apiToken).send(input);
  const input = {scope: 'project', projectPath: targetRoot, clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const initial = await post('/api/deployment/plan', input).expect(200);
  assert.deepEqual(initial.body.stateUpgrade, {from: 1, to: 4});
  await post('/api/deployment/apply', {planId: initial.body.planId}).expect(200);
  const config = path.join(targetRoot, '.codex/config.toml'), agent = path.join(targetRoot, '.codex/agents/reviewer.toml');
  const before = fs.readFileSync(config);
  const removal = await post('/api/deployment/removal-plan', {...input, assetIds: ['docs', 'reviewer']}).expect(200);
  assert.equal(removal.body.automatic, true);
  assert.ok(fs.existsSync(agent));
  const removed = await post('/api/deployment/apply', {planId: removal.body.planId}).expect(200);
  assert.equal(fs.existsSync(agent), false); assert.equal(fs.readFileSync(config, 'utf8').trim(), '');
  const rollback = await post('/api/deployment/rollback-plan', {...input, transactionId: removed.body.transactionId}).expect(200);
  await post('/api/deployment/rollback', {planId: rollback.body.planId}).expect(200);
  assert.ok(fs.existsSync(agent)); assert.deepEqual(fs.readFileSync(config), before);
});

test('HTTP saved plans survive app restart and require digest and CSRF before execution', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-saved-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit'), homeDir = path.join(root, 'home'), targetRoot = path.join(root, 'target');
  const scopeRoot = path.join(kitRoot, 'projects/default'), definitionsDir = path.join(root, 'definitions');
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(homeDir); fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Review\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: http-saved}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['instructions-project']});
  const options = {homeDir, kitRoot, definitionsDir}, apiToken = 'c'.repeat(64);
  const makeApp = () => createControlPlaneApp({context: createAppContext(options), apiToken, logRequest: () => {}}).app;
  let app = makeApp();
  const post = (route, body) => request(app).post(`/api/deployment/${route}`).set('X-Agents-Kit-Token', apiToken).send(body);
  const input = {scope: 'project', projectPath: targetRoot, projectName: 'default', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const plan = await post('plan', input).expect(200);
  await request(app).post('/api/deployment/save-plan').send({planId: plan.body.planId}).expect(403);
  const saved = await post('save-plan', {planId: plan.body.planId}).expect(200);
  assert.equal(fs.existsSync(path.join(targetRoot, 'AGENTS.md')), false);
  app = makeApp();
  const listed = await request(app).get('/api/deployment/saved-plans').expect(200);
  assert.equal(listed.body.plans[0].digest, saved.body.digest);
  await post('resume', {planId: saved.body.planId}).expect(400);
  await post('resume', {planId: saved.body.planId, digest: '0'.repeat(64)}).expect(409);
  await request(app).post('/api/deployment/resume').send(saved.body).expect(403);
  const resumed = await post('resume', saved.body).expect(200);
  assert.equal(resumed.body.transactionId, `tx-plan-${saved.body.planId}`);
  await post('resume', saved.body).expect(200);
  const history = await request(app).get('/api/deployment/history').query(input).expect(200);
  assert.equal(history.body.transactions.length, 1);
  await post('recovery-plan', input).expect(404);
  await post('recovery-plan', {...input, projectPath: kitRoot}).expect(400);
  await request(app).post('/api/deployment/recover').send({planId: 'none'}).expect(403);
  const target = path.join(targetRoot, 'AGENTS.md'), before = fs.readFileSync(target);
  fs.appendFileSync(path.join(scopeRoot, 'rules.md'), 'Updated rules.');
  const childConfig = path.join(root, 'crash.json');
  fs.writeFileSync(childConfig, JSON.stringify({options: {...options, planStoreRoot: path.join(kitRoot, '.deployment-plans')},
    input: {...input, scopeRoot, targetRoot, crashTarget: target}, stage: 'mutation'}));
  const killed = spawnSync(process.execPath, ['test/helpers/crash-deployment.js', childConfig], {cwd: path.resolve(import.meta.dirname, '../../..'), encoding: 'utf8'});
  assert.equal(killed.signal, 'SIGKILL', killed.stderr);
  app = makeApp();
  const recovery = await post('recovery-plan', input).expect(200);
  assert.equal(recovery.body.outcome, 'restore-original');
  assert.notDeepEqual(fs.readFileSync(target), before);
  await post('recover', {planId: recovery.body.planId}).expect(200);
  assert.deepEqual(fs.readFileSync(target), before);

});

test('HTTP ships the activated CLI profiles and uses the same observed-binary deployment gate', {skip: process.platform !== 'darwin' || process.arch !== 'arm64'}, async t => {
  const {observeClientBinary} = await import('../../../lib/infrastructure/client-binary-observer.js');
  const {loadClientDefinitions} = await import('../../../lib/infrastructure/client-definition-loader.js');
  const definitionsDir = path.resolve(import.meta.dirname, '../../../clients');
  const definitions = loadClientDefinitions({definitionsDir});
  for (const clientId of ['codex', 'antigravity']) {
    const profile = definitions.get(clientId).surfaces[0];
    if (!profile.runtimeEvidence.some(record => record.binarySha256 === observeClientBinary(profile)?.sha256)) return t.skip('Reviewed native client builds are not installed');
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-http-activation-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default');
  fs.mkdirSync(homeDir); fs.mkdirSync(scopeRoot, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review carefully.\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: http-activation}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n');
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'a'.repeat(64), logRequest: () => {}});
  const post = (route, body) => request(app).post(`/api/deployment/${route}`).set('X-Agents-Kit-Token', apiToken).send(body).expect(200);
  for (const clientId of ['codex', 'antigravity']) {
    const projectPath = path.join(root, clientId); fs.mkdirSync(projectPath);
    const input = {clientId, surface: 'cli', scope: 'project', projectName: 'default', projectPath};
    const {body: plan} = await post('plan', input);
    assert.equal(plan.automatic, true);
    assert.equal(plan.targetProfile.versionSource, 'binary-sha256');
    await post('apply', {planId: plan.planId});
    const target = path.join(projectPath, 'AGENTS.md'), content = fs.readFileSync(target, 'utf8');
    const {body: removal} = await post('removal-plan', {...input, assetIds: ['rules']});
    const {body: removed} = await post('apply', {planId: removal.planId});
    assert.notEqual(fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '', content);
    const {body: rollback} = await post('rollback-plan', {...input, transactionId: removed.transactionId});
    await post('rollback', {planId: rollback.planId});
    assert.equal(fs.readFileSync(target, 'utf8'), content);
    const {body: appPlan} = await post('plan', {...input, surface: 'desktop', clientVersion: definitions.get(clientId).surfaces[0].runtimeEvidence[0].version});
    assert.equal(appPlan.automatic, false);
  }
});
