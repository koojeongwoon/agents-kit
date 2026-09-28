import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parse, stringify} from 'yaml';
import {createAgentKitManifest, validateManifestAssetContracts} from '../lib/domain/manifest.js';
import {renderAgentDefinition} from '../lib/adapters/agents/index.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const skillText = '---\nname: review\ndescription: Review source changes.\n---\n\nCheck the changed call paths.\n';
function rawManifest() {
  return {schemaVersion: 1, kit: {id: 'common'},
    defaults: {mcpBindings: {schemaVersion: 1, endpoints: {docs: {url: 'https://docs.example.test/mcp'}}}},
    assets: {
      instructions: [{id: 'rules', scope: 'project', source: 'AGENTS.md', definition: {schemaVersion: 1, format: 'markdown'}}],
      skills: [{id: 'review', scope: 'project', source: 'review', definition: {schemaVersion: 1, format: 'agent-skills'}, requires: {tools: ['docs.search']}}],
      agents: [{id: 'reviewer', scope: 'project', dependsOn: {skills: ['review']}, definition: {
        schemaVersion: 1, permissions: 'client-default', description: 'Review code', instructions: 'Inspect changes and return evidence.'
      }}],
      mcpServers: [{id: 'docs', scope: 'project', provides: {tools: [{id: 'docs.search', nativeName: 'search_docs'}]},
        definition: {schemaVersion: 1, transport: 'http', endpointId: 'docs'}}]
    }, targets: {codex: {assetIds: ['rules', 'reviewer']}, antigravity: {assetIds: ['rules', 'reviewer']}}};
}
function fixture(t, clientId = 'codex', verified = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'common-assets-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const scopeRoot = path.join(root, 'kit');
  const targetRoot = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(scopeRoot, 'review/references'), {recursive: true});
  fs.mkdirSync(targetRoot); fs.mkdirSync(homeDir);
  fs.writeFileSync(path.join(scopeRoot, 'AGENTS.md'), '# Shared rules\nCheck source evidence.\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), skillText);
  fs.writeFileSync(path.join(scopeRoot, 'review/references/checklist.md'), '# Checklist\n');
  const definitionsDir = verified ? path.join(root, 'definitions') : path.join(repositoryRoot, 'clients');
  if (verified) writeProfileFixture({definitionsDir, repositoryRoot, clientId,
    capabilityIds: ['agents-project', 'skills-project', 'mcp-project', 'instructions-project']});
  const raw = rawManifest();
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw));
  write();
  return {raw, write, scopeRoot, targetRoot, definitionsDir,
    input: {scopeRoot, targetRoot, clientId, scope: 'project', surface: 'cli', clientVersion: '0.0.1-test'},
    service: createManifestDeploymentService({homeDir, definitionsDir})};
}

function withTools(raw) {
  const agent = raw.assets.agents[0];
  agent.requires = {tools: [{id: 'docs.search', providerId: 'docs'}]};
  agent.definition.mcpToolAccess = 'required-providers';
  agent.definition.sandboxDefault = 'read-only';
}
function render(raw, clientId = 'codex') {
  const manifest = createAgentKitManifest(raw);
  validateManifestAssetContracts(manifest, {requireMaterialization: true});
  return renderAgentDefinition({manifest, asset: manifest.assets.agents[0], clientId});
}

test('logical Agent tool IDs resolve to native server allowlists, never logical strings or global allowlists', () => {
  const raw = rawManifest(); withTools(raw);
  const before = structuredClone(raw);
  const output = render(raw).content;
  assert.match(output, /sandbox_mode = "read-only"/);
  assert.match(output, /\[mcp_servers.docs\]\nurl = "https:\/\/docs.example.test\/mcp"\nenabled_tools = \["search_docs"\]/);
  assert.equal(output.includes('docs.search'), false);
  assert.deepEqual(raw, before);
  assert.throws(() => render(raw, 'antigravity'), {code: 'AGENT_NATIVE_DEFAULTS_UNSUPPORTED'});
});

test('Agent mapping rejects missing, ambiguous, optional, unsafe native names and native-source providers', () => {
  for (const mutate of [
    raw => delete raw.assets.mcpServers[0].provides.tools[0].nativeName,
    raw => { raw.assets.mcpServers[0].provides.tools[0].nativeName = '*'; },
    raw => { raw.assets.mcpServers[0].provides.tools.push({id: 'docs.other', nativeName: 'search_docs'}); },
    raw => { raw.assets.mcpServers[0].provides.tools.push('docs.search'); },
    raw => { raw.assets.agents[0].requires.tools[0].optional = true; },
    raw => { raw.assets.agents[0].requires.tools[0].providerId = 'missing'; },
    raw => { delete raw.assets.mcpServers[0].definition; raw.assets.mcpServers[0].source = 'native.toml'; },
    raw => { raw.assets.agents[0].policy = {deny: {capabilities: ['write']}}; },
    raw => { raw.assets.agents[0].definition.sandboxDefault = 'full-access'; }
  ]) {
    const raw = rawManifest(); withTools(raw); mutate(raw);
    assert.throws(() => render(raw));
  }
});

test('Agent mapping preserves environment references and deterministic multi-provider output', () => {
  const raw = rawManifest(); withTools(raw);
  raw.defaults.mcpBindings.executables = {local: {command: 'docs-server'}};
  raw.assets.mcpServers.push({id: 'local', scope: 'project', provides: {tools: [{id: 'local.read', nativeName: 'read'}]},
    definition: {schemaVersion: 1, transport: 'stdio', executableId: 'local', environment: [{source: 'environment', name: 'DOCS_TOKEN'}]}});
  raw.assets.agents[0].requires.tools.unshift('local.read');
  const content = render(raw).content;
  assert.ok(content.indexOf('[mcp_servers.docs]') < content.indexOf('[mcp_servers.local]'));
  assert.match(content, /env_vars = \["DOCS_TOKEN"\]/);
  assert.match(content, /enabled_tools = \["read"\]/);
});

test('Agent provider lists include tools required by transitive Skills without activating those Skills', () => {
  const raw = rawManifest(); withTools(raw);
  raw.assets.mcpServers[0].provides.tools.push({id: 'docs.read', nativeName: 'read_doc'});
  raw.assets.skills[0].requires.tools.push('docs.read');
  assert.match(render(raw).content, /enabled_tools = \["read_doc", "search_docs"\]/);
  assert.equal(render(raw).content.includes('skills.config'), false);
  delete raw.assets.agents[0].requires;
  assert.match(render(raw).content, /enabled_tools = \["read_doc", "search_docs"\]/);
});

test('same four-resource manifest applies to each client, preserves user rules, repeats and rolls back', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const f = fixture(t, clientId);
    const rulesTarget = path.join(f.targetRoot, 'AGENTS.md');
    fs.writeFileSync(rulesTarget, '# User rules\nKeep this.\n');
    assert.equal(f.service.validate({scopeRoot: f.scopeRoot}).valid, true);
    assert.equal(f.service.doctor(f.input).healthy, true);
    const plan = f.service.plan(f.input);
    assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
    assert.equal(plan.operations.length, 5);
    const applied = f.service.apply({planId: plan.planId});
    assert.match(fs.readFileSync(rulesTarget, 'utf8'), /# User rules[\s\S]*# Shared rules/);
    assert.equal(fs.readFileSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md'), 'utf8'), skillText);
    assert.equal(fs.readFileSync(path.join(f.targetRoot, '.agents/skills/review/references/checklist.md'), 'utf8'), '# Checklist\n');
    assert.ok(f.service.plan(f.input).operations.every(op => op.operation === 'SKIP'));
    const rollback = f.service.planRollback({...f.input, transactionId: applied.transactionId});
    f.service.rollback({planId: rollback.planId});
    assert.equal(fs.readFileSync(rulesTarget, 'utf8'), '# User rules\nKeep this.\n');
    assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), false);
  }
});

test('common sources reject incompatible frontmatter, names, encodings and ownership markers in plan/doctor/validate', t => {
  for (const content of [
    '# No metadata\n', skillText.replace('name: review', 'name: other'),
    skillText.replace('description:', 'tools: [shell]\ndescription:'),
    skillText.replace('name: review', 'name: review\nname: review'),
    skillText.replace('description: Review source changes.', 'description: true'),
    '---\nname: review\ndescription: Review\n---\n',
    skillText + '<!-- agents-kit:rules:end -->', Buffer.from([0xff, 0xfe])
  ]) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), content);
    assert.throws(() => f.service.plan(f.input));
    assert.equal(f.service.doctor(f.input).healthy, false);
    assert.equal(f.service.validate({scopeRoot: f.scopeRoot}).valid, false);
    assert.deepEqual(fs.readdirSync(f.targetRoot), []);
  }
});

test('common source validation rejects symlinks, client extensions, unsupported policies and instruction includes', t => {
  for (const mutate of [
    f => fs.symlinkSync('SKILL.md', path.join(f.scopeRoot, 'review/link')),
    f => fs.mkdirSync(path.join(f.scopeRoot, 'review/agents')),
    f => fs.writeFileSync(path.join(f.scopeRoot, 'AGENTS.md'), '@[remote](../elsewhere.md)'),
    f => fs.writeFileSync(path.join(f.scopeRoot, 'AGENTS.md'), '---\ntrigger: manual\n---\nRule'),
    f => { f.raw.assets.skills[0].policy = {}; f.write(); },
    f => { f.raw.assets.skills[0].definition.format = 'markdown'; f.write(); }
  ]) {
    const f = fixture(t); mutate(f);
    assert.throws(() => f.service.plan(f.input));
    assert.deepEqual(fs.readdirSync(f.targetRoot), []);
  }
});

test('validated common sources refuse to adopt identical unmanaged Skill files and instruction blocks', t => {
  for (const kind of ['skills', 'instructions']) {
    const f = fixture(t);
    if (kind === 'skills') {
      const destination = path.join(f.targetRoot, '.agents/skills/review');
      fs.mkdirSync(destination, {recursive: true});
      fs.writeFileSync(path.join(destination, 'SKILL.md'), skillText);
    } else {
      fs.writeFileSync(path.join(f.targetRoot, 'AGENTS.md'), '<!-- agents-kit:rules:start -->\n# Shared rules\nCheck source evidence.\n<!-- agents-kit:rules:end -->\n');
    }
    const plan = f.service.plan(f.input);
    assert.equal(plan.blocked[0].reason, 'UNKNOWN_EXISTING_CONTENT');
    assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
  }
});

test('Agent defaults flow through shared service and remain runtime-gated on production profiles', t => {
  for (const verified of [true, false]) {
    const f = fixture(t, 'codex', verified); withTools(f.raw); f.write();
    const plan = f.service.plan(f.input);
    assert.equal(plan.automatic, verified);
    assert.match(plan.previews.find(item => item.assetId === 'reviewer').desired, /enabled_tools/);
    assert.deepEqual(plan.previews.find(item => item.assetId === 'reviewer').notices,
      ['AGENT_SANDBOX_DEFAULT_OVERRIDABLE', 'AGENT_MCP_PROVIDER_SCOPE_ONLY']);
    if (verified) {
      const agentOp = plan.operations.find(item => item.assetId === 'reviewer');
      const result = f.service.apply({planId: plan.planId});
      assert.match(fs.readFileSync(agentOp.target, 'utf8'), /search_docs/);
      f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: result.transactionId}).planId});
    } else assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
  }
  const f = fixture(t, 'antigravity'); withTools(f.raw); f.write();
  const plan = f.service.plan(f.input);
  assert.equal(plan.blocked.find(item => item.assetId === 'reviewer').reason, 'AGENT_NATIVE_DEFAULTS_UNSUPPORTED');
});

test('common sources require the expected client capability format and strategy', t => {
  const f = fixture(t);
  const file = path.join(f.definitionsDir, 'codex.yaml');
  const definition = parse(fs.readFileSync(file, 'utf8'));
  definition.capabilities.find(item => item.id === 'skills-project').format = 'markdown';
  fs.writeFileSync(file, stringify(definition));
  const plan = f.service.plan(f.input);
  assert.equal(plan.blocked.find(item => item.assetId === 'review').reason, 'COMMON_SOURCE_CONTRACT_MISMATCH');
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
});
