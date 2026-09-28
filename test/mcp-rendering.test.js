import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {stringify} from 'yaml';
import {normalizeMcpDefinition} from '../lib/domain/mcp-definition.js';
import {renderMcpDefinition} from '../lib/adapters/mcp/index.js';
import {createAgentKitManifest, validateManifestAssetContracts} from '../lib/domain/manifest.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {prepareMergeDeployment} from '../lib/application/prepare-merge-deployment.js';
import {applyDeployment} from '../lib/application/apply-deployment.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bindings = {schemaVersion: 1, executables: {docs: {command: 'docs-mcp'}}, endpoints: {docs: {url: 'https://mcp.example.test/mcp'}}};
const stdio = {id: 'docs', definition: {schemaVersion: 1, transport: 'stdio', executableId: 'docs', args: ['--read-only', 'a"b\\c', '한글']}};
const http = {id: 'remote', definition: {schemaVersion: 1, transport: 'http', endpointId: 'docs'}};
function render(asset, clientId = 'codex') { return renderMcpDefinition({asset, bindings, clientId}); }

test('one typed MCP source produces distinct Codex and Antigravity schemas without mutation', () => {
  assert.throws(() => render({...stdio, id: undefined}));
  const before = structuredClone(stdio);
  assert.equal(render(stdio).content, '[mcp_servers.docs]\ncommand = "docs-mcp"\nargs = ["--read-only", "a\\"b\\\\c", "한글"]\n');
  assert.deepEqual(JSON.parse(render(stdio, 'antigravity').content), {mcpServers: {docs: {command: 'docs-mcp', args: stdio.definition.args}}});
  assert.equal(render(http).content, '[mcp_servers.remote]\nurl = "https://mcp.example.test/mcp"\n');
  assert.deepEqual(JSON.parse(render(http, 'antigravity').content), {mcpServers: {remote: {serverUrl: 'https://mcp.example.test/mcp'}}});
  assert.deepEqual(stdio, before);
  assert.equal(render({id: 'native', source: 'mcp.json'}), null);
  assert.throws(() => render(http, 'cursor'), error => error.code === 'MCP_RENDERER_UNSUPPORTED');
});

test('authentication remains references; unverified Antigravity mapping fails closed', () => {
  const authenticated = {...http, definition: {...http.definition, authentication: {type: 'environment', source: 'environment', name: 'TEST_API_TOKEN'}}};
  const local = {...stdio, definition: {...stdio.definition, environment: [{source: 'environment', name: 'TEST_API_TOKEN'}]}};
  assert.match(render(authenticated).content, /bearer_token_env_var = "TEST_API_TOKEN"/);
  assert.match(render(local).content, /env_vars = \["TEST_API_TOKEN"\]/);
  for (const asset of [authenticated, local]) assert.throws(() => render(asset, 'antigravity'), error => error.code === 'MCP_SECRET_REFERENCE_UNSUPPORTED');
});

test('typed MCP rejects ambiguous legacy inputs, unbound IDs and silently dropped fields', () => {
  for (const patch of [
    {schemaVersion: 2}, {transport: 'sse'}, {executableId: 123}, {executableId: 'missing'}, {executableId: 'constructor'},
    {endpointId: 'docs'}, {tools: ['ignored']}, {args: 'shell string'}, {args: ['bad\nline']},
    {environment: [{source: 'environment', name: 'TOKEN', value: 'private'}]}
  ]) assert.throws(() => render({...stdio, definition: {...stdio.definition, ...patch}}));
  for (const legacy of ['source', 'command', 'connection', 'environment', 'env', 'args']) {
    assert.throws(() => render({...stdio, [legacy]: 'legacy'}), error => error.code === 'MCP_DEFINITION_AMBIGUOUS');
  }
  assert.throws(() => render({...http, definition: {...http.definition, args: []}}));
  assert.throws(() => render({...stdio, definition: {...stdio.definition, args: ['\ud800']}}));
});

test('literal credentials and credential-bearing endpoints fail without values in errors', () => {
  const cases = [
    {...stdio, definition: {...stdio.definition, args: ['--token', 'private-value']}},
    {...stdio, definition: {...stdio.definition, args: ['Authorization=private-value']}},
    {...stdio, definition: {...stdio.definition, args: ['Bearer private-value']}}
  ];
  for (const asset of cases) assert.throws(() => render(asset), error => {
    assert.equal(JSON.stringify(error).includes('private-value'), false);
    return error.code === 'LITERAL_SECRET';
  });
  for (const url of ['https://user:private-value@example.test', 'https://example.test?x=private-value', 'https://example.test#private-value', 'http://remote.example.test']) {
    assert.throws(() => normalizeMcpDefinition(http, {...bindings, endpoints: {docs: {url}}}), error => !JSON.stringify(error).includes('private-value'));
  }
  assert.equal(normalizeMcpDefinition(http, {...bindings, endpoints: {docs: {url: 'http://127.0.0.1:3000/mcp'}}}).url, 'http://127.0.0.1:3000/mcp');
});

function fixture(t, {verified = false, clientId = 'codex', assets = [http]} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-mcp-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const scopeRoot = path.join(root, 'kit');
  const targetRoot = path.join(root, 'target');
  const homeDir = path.join(root, 'home');
  for (const dir of [scopeRoot, targetRoot, homeDir]) fs.mkdirSync(dir);
  const definitionsDir = verified ? path.join(root, 'definitions') : path.join(repositoryRoot, 'clients');
  if (verified) writeProfileFixture({definitionsDir, repositoryRoot, clientId, capabilityIds: ['mcp-project']});
  const raw = {schemaVersion: 1, kit: {id: 'mcp-test'}, defaults: {mcpBindings: bindings}, assets: {mcpServers: assets.map(asset => ({...asset, scope: 'project'}))}};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw));
  write();
  const service = createManifestDeploymentService({definitionsDir, homeDir});
  const input = {scopeRoot, targetRoot, clientId, surface: 'cli', scope: 'project', clientVersion: verified ? '0.0.1-test' : '1.2.3'};
  return {root, raw, write, service, input, targetRoot};
}

test('shared service renders a reviewable preview even while CA01 denies production apply', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const subject = fixture(t, {clientId});
    const plan = subject.service.plan(subject.input);
    assert.equal(plan.automatic, false);
    assert.equal(plan.operations.length, 0);
    assert.equal(plan.blocked[0].reason, 'CLIENT_PROFILE_UNVERIFIED');
    assert.equal(plan.previews[0].previewOnly, true);
    assert.equal(plan.previews[0].operation, 'CREATE');
    assert.match(plan.previews[0].desired, /mcp.example.test/);
    assert.equal(plan.previews[0].changes.length > 0, true);
    assert.throws(() => subject.service.apply({planId: plan.planId}), error => error.code === 'DEPLOYMENT_PLAN_BLOCKED');
    assert.deepEqual(fs.readdirSync(subject.targetRoot), []);
  }
});

test('synthetic verified profiles use generated documents for apply, repeat plan and rollback', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const subject = fixture(t, {clientId, verified: true, assets: [stdio, http]});
    const plan = subject.service.plan(subject.input);
    assert.equal(plan.automatic, true);
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.previews.length, 2);
    const applied = subject.service.apply({planId: plan.planId});
    const content = fs.readFileSync(plan.operations[0].target, 'utf8');
    assert.match(content, /docs-mcp/);
    assert.match(content, /mcp.example.test/);
    assert.equal(subject.service.plan(subject.input).operations[0].operation, 'SKIP');
    const rollback = subject.service.planRollback({...subject.input, transactionId: applied.transactionId});
    subject.service.rollback({planId: rollback.planId});
    assert.equal(fs.existsSync(plan.operations[0].target), false);
  }
});

test('preview redacts current content and refuses to adopt unmanaged same-name MCP servers', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const subject = fixture(t, {clientId, verified: true});
    const empty = subject.service.plan(subject.input);
    const target = empty.operations[0].target;
    fs.mkdirSync(path.dirname(target), {recursive: true});
    const current = clientId === 'codex' ? '[mcp_servers.remote]\nurl = "https://mcp.example.test/mcp"\n' : '{"mcpServers":{"remote":{"serverUrl":"https://mcp.example.test/mcp"}},"userToken":"private-value"}';
    fs.writeFileSync(target, current);
    const plan = subject.service.plan(subject.input);
    assert.equal(plan.automatic, false);
    assert.equal(plan.previews[0].conflicts[0].reason, 'UNKNOWN_EXISTING_CONTENT');
    assert.equal(JSON.stringify(plan).includes('private-value'), false);
    assert.equal(fs.readFileSync(target, 'utf8'), current);
  }
});

test('unsafe target shapes and JSON transport removals are blocked before apply', t => {
  for (const [clientId, current] of [
    ['antigravity', '{"mcpServers":42}'],
    ['antigravity', '{"mcpServers":{"remote":false}}'],
    ['codex', '["mcp_servers"."remote"]\nurl = "https://example.test"\n'],
    ['codex', '[mcp_servers.remote.env]\nTOKEN = "private-value"\n']
  ]) {
    const subject = fixture(t, {clientId, verified: true});
    const target = subject.service.plan(subject.input).operations[0].target;
    fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, current);
    const plan = subject.service.plan(subject.input);
    assert.equal(plan.automatic, false);
    assert.equal(JSON.stringify(plan).includes('private-value'), false);
  }
  const subject = fixture(t, {clientId: 'antigravity', verified: true, assets: [stdio]});
  let plan = subject.service.plan(subject.input);
  subject.service.apply({planId: plan.planId});
  subject.raw.assets.mcpServers[0] = {...http, id: stdio.id, scope: 'project'}; subject.write();
  plan = subject.service.plan(subject.input);
  assert.equal(plan.blocked[0].reason, 'MCP_REMOVAL_PLAN_REQUIRED');
});

test('generated merge still refuses stale files and cannot apply preview-only operations', t => {
  const subject = fixture(t, {verified: true});
  const plan = subject.service.plan(subject.input);
  const target = plan.operations[0].target;
  fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, '# external\n');
  assert.throws(() => subject.service.apply({planId: plan.planId}), error => error.code === 'STALE_DEPLOYMENT_PLAN');
  const preview = prepareMergeDeployment({
    capabilityPlan: {clientId: 'codex', operations: [{assetId: 'remote', assetKind: 'mcpServers', strategy: 'merge', format: 'toml-section', target: '.codex/preview.toml', rendered: render(http)}], blocked: []},
    sources: new Map(), targetRoot: subject.targetRoot, homeDir: subject.targetRoot, state: {managed: {}}, previewOnly: true
  });
  assert.throws(() => applyDeployment({plans: [preview]}), error => error.code === 'DEPLOYMENT_PREVIEW_ONLY');
});

test('typed materialization is versioned and cannot leak into other asset kinds', () => {
  const manifest = createAgentKitManifest({schemaVersion: 1, kit: {id: 'typed'}, defaults: {mcpBindings: bindings}, assets: {mcpServers: [http]}});
  assert.doesNotThrow(() => validateManifestAssetContracts(manifest, {requireMaterialization: true}));
  const invalid = createAgentKitManifest({schemaVersion: 1, kit: {id: 'typed'}, defaults: {mcpBindings: bindings}, assets: {memory: [http]}});
  assert.throws(() => validateManifestAssetContracts(invalid), error => error.code === 'TYPED_ASSET_KIND_UNSUPPORTED');
});

test('unsupported app MCP stays manual and unsafe auth never falls back to plaintext', t => {
  const authenticated = {...http, definition: {...http.definition, authentication: {type: 'environment', source: 'environment', name: 'TEST_API_TOKEN'}}};
  const subject = fixture(t, {clientId: 'antigravity', assets: [authenticated]});
  const cliPlan = subject.service.plan(subject.input);
  assert.equal(cliPlan.blocked[0].reason, 'MCP_SECRET_REFERENCE_UNSUPPORTED');
  assert.equal(cliPlan.previews, undefined);
  const appPlan = subject.service.plan({...subject.input, surface: 'desktop'});
  assert.equal(appPlan.blocked[0].reason, 'CAPABILITY_UI_ONLY');
  assert.equal(appPlan.previews, undefined);
  assert.deepEqual(fs.readdirSync(subject.targetRoot), []);
});

test('typed MCP still requires valid dependencies before rendering or writing', t => {
  const subject = fixture(t, {assets: [{...http, requires: {tools: ['missing.read']}}]});
  assert.throws(() => subject.service.plan(subject.input), error => error.code === 'MANIFEST_DEPENDENCY_INVALID');
  assert.deepEqual(fs.readdirSync(subject.targetRoot), []);
});

test('public preview omits unrelated user secrets while preserving them through generated apply', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const subject = fixture(t, {clientId, verified: true});
    const target = subject.service.plan(subject.input).operations[0].target;
    const current = clientId === 'codex' ? 'user_token = "private-value"\n' : '{"userToken":"private-value"}';
    fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, current);
    const plan = subject.service.plan(subject.input);
    assert.equal(plan.automatic, true);
    assert.equal(JSON.stringify(plan).includes('private-value'), false);
    subject.service.apply({planId: plan.planId});
    assert.equal(fs.readFileSync(target, 'utf8').includes('private-value'), true);
  }
});
