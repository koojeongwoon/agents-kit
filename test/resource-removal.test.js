import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {DeploymentStateStore} from '../lib/infrastructure/deployment-state-store.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
function fixture(t, clientId = 'codex', scope = 'project', dependency = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resource-removal-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const scopeRoot = path.join(root, 'kit'), homeDir = path.join(root, 'home');
  const targetRoot = scope === 'global' ? homeDir : path.join(root, 'project');
  for (const dir of [scopeRoot, homeDir, targetRoot]) fs.mkdirSync(dir, {recursive: true});
  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot, clientId, capabilityIds: [`agents-${scope}`, `mcp-${scope}`, `skills-${scope}`]});
  const raw = {schemaVersion: 1, kit: {id: 'removal'}, defaults: {mcpBindings: {schemaVersion: 1, endpoints: {docs: {url: 'https://docs.example.test/mcp'}}}}, assets: {
    agents: [{id: 'reviewer', scope, ...(dependency ? {dependsOn: {skills: ['review']}} : {}), definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Check evidence.'}}],
    mcpServers: ['docs', 'other'].map(id => ({id, scope, ...(id === 'docs' ? {provides: {tools: ['docs.search']}} : {}), definition: {schemaVersion: 1, transport: 'http', endpointId: 'docs'}}))
  }};
  if (dependency) {
    fs.mkdirSync(path.join(scopeRoot, 'review')); fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review code\n---\n\nReview evidence.\n');
    raw.assets.skills = [{id: 'review', scope, source: 'review', requires: {tools: ['docs.search']}, definition: {schemaVersion: 1, format: 'agent-skills'}}];
  }
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  const service = createManifestDeploymentService({definitionsDir, homeDir});
  const input = {scopeRoot, targetRoot, clientId, surface: 'cli', scope, clientVersion: '0.0.1-test'};
  const config = path.join(targetRoot, clientId === 'codex' ? '.codex/config.toml' : scope === 'global' ? '.gemini/config/mcp_config.json' : '.agents/mcp_config.json');
  const agent = path.join(targetRoot, clientId === 'codex' ? '.codex/agents/reviewer.toml' : scope === 'global' ? '.gemini/config/agents/reviewer.md' : '.agents/agents/reviewer.md');
  fs.mkdirSync(path.dirname(config), {recursive: true});
  fs.writeFileSync(config, clientId === 'codex' ? '# User preamble\nmodel = "user-model"\n\n[mcp_servers.user]\ncommand = "custom"\n' : JSON.stringify({theme: 'dark', mcpServers: {user: {command: 'custom'}}}));
  const plan = () => service.plan(input);
  const apply = () => {const p = plan(); assert.equal(p.automatic, true, JSON.stringify(p.blocked)); return service.apply({planId: p.planId});};
  const remove = (assetIds, extra = {}) => service.planRemoval({...input, assetIds, ...extra});
  const statePath = scope === 'global' ? path.join(homeDir, '.agents-kit/deployments/_global/state.json') : path.join(targetRoot, '.agent-kit/state.json');
  const state = () => JSON.parse(fs.readFileSync(statePath));
  return {root, scopeRoot, raw, write, input, service, config, agent, targetRoot, plan, apply, remove, state, statePath};
}

test('Agent/MCP removal preserves other settings and restores exact bytes and ownership on rollback', t => {
  for (const client of ['codex', 'antigravity']) for (const scope of ['project', 'global']) {
    const f = fixture(t, client, scope), initial = f.plan();
    assert.deepEqual(initial.stateUpgrade, {from: 1, to: 4});
    f.service.apply({planId: initial.planId});
    assert.equal(f.state().schemaVersion, 4);
    const before = fs.readFileSync(f.config), agent = fs.readFileSync(f.agent), managed = f.state().managed;
    const removal = f.remove(['reviewer', 'docs']);
    assert.equal(removal.automatic, true, JSON.stringify(removal.blocked));
    assert.deepEqual(removal.operations.map(item => item.operation).sort(), ['REMOVE', 'REMOVE_UNITS']);
    const result = f.service.apply({planId: removal.planId});
    assert.equal(fs.existsSync(f.agent), false);
    const remaining = fs.readFileSync(f.config, 'utf8');
    assert.match(remaining, /custom/); assert.match(remaining, /other/);
    assert.doesNotMatch(remaining, client === 'codex' ? /mcp_servers\.docs/ : /"docs"\s*:/);
    assert.equal(f.service.planRollback({...f.input, transactionId: result.transactionId}).automatic, true);
    f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: result.transactionId}).planId});
    assert.deepEqual(fs.readFileSync(f.config), before); assert.deepEqual(fs.readFileSync(f.agent), agent);
    assert.deepEqual(f.state().managed, managed);
  }
});

test('removal works from recorded identities after sources are removed or target disabled', t => {
  const f = fixture(t); f.apply();
  f.raw.assets = {}; f.raw.targets = {codex: {enabled: false}}; f.write();
  assert.equal(f.remove(['docs', 'reviewer']).automatic, true);
  f.service.apply({planId: f.remove(['docs', 'reviewer']).planId});
  assert.equal(fs.existsSync(f.agent), false);
});

test('persisted Agent/Skill dependencies require a complete removal set even after Manifest changes', t => {
  const f = fixture(t, 'codex', 'project', true); f.apply();
  f.raw.assets.agents[0].dependsOn = {}; delete f.raw.assets.skills[0].requires; f.write();
  assert.ok(f.remove(['docs']).blocked.some(item => item.reason === 'RESOURCE_STILL_REQUIRED'));
  assert.ok(f.remove(['docs', 'review']).blocked.some(item => item.reason === 'RESOURCE_STILL_REQUIRED'));
  const all = f.remove(['docs', 'review', 'reviewer']);
  assert.equal(all.automatic, true, JSON.stringify(all.blocked));
  f.service.apply({planId: all.planId});
  assert.equal(fs.existsSync(f.agent), false);
});

test('foreign Kit, legacy records and unsupported surfaces cannot remove typed resources', t => {
  for (const kind of ['kit', 'legacy', 'profile']) {
    const f = fixture(t, kind === 'profile' ? 'antigravity' : 'codex'); f.apply();
    if (kind === 'kit') {f.raw.kit.id = 'different'; f.write();}
    if (kind === 'legacy') {const state = f.state(); delete state.managed[f.agent].resource; fs.writeFileSync(f.statePath, JSON.stringify(state));}
    const removal = f.remove(['reviewer'], kind === 'profile' ? {surface: 'ide'} : {});
    assert.equal(removal.automatic, false);
    assert.throws(() => f.service.apply({planId: removal.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
    assert.equal(fs.existsSync(f.agent), true);
  }
});

test('modified Agent or MCP units block the whole mixed removal', t => {
  for (const client of ['codex', 'antigravity']) for (const target of ['agent', 'mcp']) {
    const f = fixture(t, client); f.apply();
    if (target === 'agent') fs.appendFileSync(f.agent, '\nUser edit\n');
    else fs.writeFileSync(f.config, fs.readFileSync(f.config, 'utf8').replace('https://docs.example.test/mcp', 'https://changed.example.test/mcp'));
    const removal = f.remove(['reviewer', 'docs']);
    assert.equal(removal.automatic, false);
    assert.throws(() => f.service.apply({planId: removal.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
    assert.equal(fs.existsSync(f.agent), true);
  }
});

test('JSON rejects duplicate keys and unowned fields while unrelated user settings survive', t => {
  const f = fixture(t, 'antigravity'); f.apply();
  const raw = JSON.parse(fs.readFileSync(f.config)); raw.userNew = {keep: true};
  fs.writeFileSync(f.config, JSON.stringify(raw));
  assert.equal(f.remove(['docs']).automatic, true);
  raw.mcpServers.docs.timeout = 123;
  fs.writeFileSync(f.config, JSON.stringify(raw));
  assert.ok(f.remove(['docs']).blocked.some(item => item.reason === 'MCP_UNOWNED_FIELDS_REMAIN'));
  delete raw.mcpServers.docs.timeout;
  fs.writeFileSync(f.config, JSON.stringify(raw).replace('"theme":"dark"', '"theme":"dark","theme":"light"'));
  assert.ok(f.remove(['docs']).blocked.some(item => item.reason === 'MCP_TARGET_PARSE_ERROR'));
});

test('TOML preserves unrelated bytes and fails closed on nested, quoted or multiline tables', t => {
  for (const extra of ['[mcp_servers.docs.env]\nKEY = "value"\n', '[mcp_servers."docs"]\nurl = "value"\n', 'value = """multi\nline"""\n']) {
    const f = fixture(t); f.apply(); fs.appendFileSync(f.config, extra);
    assert.equal(f.remove(['docs']).automatic, false);
  }
  const f = fixture(t); f.apply(); fs.appendFileSync(f.config, '\n# User tail\n[custom]\nkeep = true\n');
  f.service.apply({planId: f.remove(['docs']).planId});
  assert.ok(fs.readFileSync(f.config, 'utf8').startsWith('# User preamble\nmodel = "user-model"'));
  assert.ok(fs.readFileSync(f.config, 'utf8').endsWith('\n# User tail\n[custom]\nkeep = true\n'));
});

test('stale plans, validation/state failures and changed parent symlinks leave Agent/MCP intact', t => {
  for (const kind of ['stale', 'validation', 'state', 'symlink']) {
    const f = fixture(t); f.apply(); const before = fs.readFileSync(f.config), state = fs.readFileSync(f.statePath);
    const plan = f.remove(['reviewer', 'docs']);
    if (kind === 'stale') fs.appendFileSync(f.config, '\n# later edit\n');
    if (kind === 'state') t.mock.method(DeploymentStateStore.prototype, 'commit', () => {throw new Error('Injected state failure');});
    if (kind === 'symlink') {const moved = path.join(f.root, 'moved'); fs.renameSync(path.dirname(f.agent), moved); fs.symlinkSync(moved, path.dirname(f.agent));}
    assert.throws(() => f.service.apply({planId: plan.planId, ...(kind === 'validation' ? {validate: () => ({valid: false})} : {})}));
    t.mock.restoreAll();
    assert.equal(fs.existsSync(f.agent), true); assert.deepEqual(fs.readFileSync(f.statePath), state);
    if (kind !== 'stale') assert.deepEqual(fs.readFileSync(f.config), before);
  }
});

test('typed ownership cannot be overwritten through another Kit or native source fallback', t => {
  const f = fixture(t); f.apply();
  f.raw.kit.id = 'foreign'; f.write();
  assert.ok(f.plan().blocked.every(item => item.reason === 'RESOURCE_OWNERSHIP_CONFLICT'));
  f.raw.kit.id = 'removal'; delete f.raw.assets.agents[0].definition; f.raw.assets.agents[0].source = 'agent.toml';
  fs.copyFileSync(f.agent, path.join(f.scopeRoot, 'agent.toml')); f.write();
  assert.ok(f.plan().blocked.some(item => item.reason === 'RESOURCE_OWNERSHIP_CONFLICT'));
});

test('dependency-only updates are recorded without rewriting Agent files', t => {
  const f = fixture(t, 'codex', 'project', true); f.apply();
  const before = fs.readFileSync(f.agent); fs.chmodSync(f.agent, 0o640);
  f.raw.assets.agents[0].dependsOn = {}; f.write();
  const update = f.plan();
  assert.equal(update.operations.find(item => item.assetId === 'reviewer').operation, 'REGISTER');
  f.service.apply({planId: update.planId});
  assert.deepEqual(fs.readFileSync(f.agent), before);
  assert.equal(fs.statSync(f.agent).mode & 0o777, 0o640);
  assert.equal(f.remove(['docs', 'review']).automatic, true);
});

test('schema 4 typed ownership rejects downgraded ledgers and MCP-only removal retains the settings file', t => {
  const f = fixture(t); f.apply();
  const downgrade = f.state(); downgrade.schemaVersion = 2;
  fs.writeFileSync(f.statePath, JSON.stringify(downgrade));
  assert.throws(() => f.remove(['docs']), {code: 'INVALID_DEPLOYMENT_STATE'});
  downgrade.schemaVersion = 4; fs.writeFileSync(f.statePath, JSON.stringify(downgrade));
  f.service.apply({planId: f.remove(['docs', 'other']).planId});
  assert.ok(fs.existsSync(f.config)); assert.match(fs.readFileSync(f.config, 'utf8'), /mcp_servers.user/);
  assert.ok(fs.existsSync(f.agent));
});


test('CLI dry-run, remove and rollback share the typed resource transaction', t => {
  const f = fixture(t); f.apply();
  const kitRoot = path.join(f.root, 'cli-kit');
  fs.mkdirSync(path.join(kitRoot, 'projects'), {recursive: true});
  fs.cpSync(f.scopeRoot, path.join(kitRoot, 'projects/default'), {recursive: true});
  const common = ['--kit', kitRoot, '--project', f.targetRoot, '--client', 'codex', '--surface', 'cli'];
  const run = args => spawnSync(process.execPath, ['bin/cli.js', ...args], {cwd: repositoryRoot, encoding: 'utf8'});
  const preview = run(['remove', ...common, '--assets', 'docs,reviewer', '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).automatic, true);
  assert.ok(fs.existsSync(f.agent));
  const applied = run(['remove', ...common, '--assets', 'docs,reviewer']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.existsSync(f.agent), false);
  const transactionId = applied.stdout.match(/"transactionId": "(tx-[A-Za-z0-9-]+)"/)?.[1];
  assert.ok(transactionId);
  const rollback = run(['rollback', ...common, '--transaction', transactionId]);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.ok(fs.existsSync(f.agent));
});


test('invalid UTF-8 outside managed MCP units is rejected without rewriting user bytes', t => {
  const f = fixture(t); f.apply();
  fs.appendFileSync(f.config, Buffer.concat([Buffer.from('\n# User bytes: '), Buffer.from([0xff])]));
  const before = fs.readFileSync(f.config);
  const removal = f.remove(['docs']);
  assert.ok(removal.blocked.some(item => item.reason === 'RESOURCE_REMOVAL_INVALID_UTF8'));
  assert.deepEqual(fs.readFileSync(f.config), before);
});
