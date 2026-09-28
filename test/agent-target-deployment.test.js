import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {parse, stringify} from 'yaml';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
import {selectManifestDeployment} from '../lib/domain/manifest-targets.js';
import {renderAgentDefinition} from '../lib/adapters/agents/index.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {prepareCopyDeployment, contentForCopyOperation} from '../lib/application/prepare-copy-deployment.js';
import {applyCopyDeployment} from '../lib/application/apply-copy-deployment.js';
import {applyDeployment} from '../lib/application/apply-deployment.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agent = {id: 'reviewer', scope: 'project', definition: {
  schemaVersion: 1, permissions: 'client-default', description: 'Review "code": 한글',
  instructions: 'Inspect changes.\nReturn evidence. 🐈\n---\nNo invented facts. \\path'
}};
const manifest = patch => createAgentKitManifest({schemaVersion: 1, kit: {id: 'test-kit'}, assets: {agents: [agent]}, ...patch});

test('target declarations reject typos, malformed lists and unknown asset IDs', () => {
  for (const targets of [null, [], {codex: false}, {codex: {enabled: 'true'}}, {codex: {assetIds: ['missing']}},
    {codex: {assetIds: ['reviewer', 'reviewer']}}, {codex: {assets: ['reviewer']}}, {codex: {projectName: '../other'}}]) {
    assert.throws(() => manifest({targets}), error => error.code.startsWith('INVALID_MANIFEST_TARGET'));
  }
  for (const targets of [{codex: {enabled: false}}, {antigravity: {enabled: true}}]) {
    assert.throws(() => selectManifestDeployment(manifest({targets}), {clientId: 'codex'}), {code: 'MANIFEST_TARGET_DISABLED'});
  }
  assert.throws(() => selectManifestDeployment(manifest({targets: {codex: {assetIds: []}}}), {clientId: 'codex'}), {code: 'NO_ASSETS_FOR_SCOPE'});
});

test('selection includes transitive Skill and MCP dependencies, and scopes stay separate', () => {
  const assets = {agents: [{...agent, dependsOn: {skills: ['review']}}], skills: [
    {id: 'review', scope: 'project', requires: {tools: ['docs.search']}},
    {id: 'provider-helper', scope: 'project'}, {id: 'unselected', scope: 'project'}
  ], mcpServers: [{id: 'docs', scope: 'project', provides: {tools: ['docs.search']}, dependsOn: {skills: ['provider-helper']}}]};
  const raw = {assets, targets: {codex: {assetIds: ['reviewer']}}};
  const selection = selectManifestDeployment(manifest(raw), {clientId: 'codex'});
  assert.deepEqual(selection.rootAssetIds, ['reviewer']);
  assert.deepEqual(selection.dependencyAssetIds, ['docs', 'provider-helper', 'review']);
  assert.equal(selection.toolBindings[0].providerId, 'docs');
  assets.skills[1].requires = {tools: ['docs.search']};
  assert.throws(() => selectManifestDeployment(manifest(raw), {clientId: 'codex'}), error => error.details.issues.some(issue => issue.code === 'CYCLIC_DEPENDENCY'));
  delete assets.skills[1].requires;
  assets.skills[0].scope = 'global';
  assets.mcpServers[0].scope = 'global';
  assets.skills[1].scope = 'global';
  assert.throws(() => selectManifestDeployment(manifest(raw), {clientId: 'codex'}), {code: 'DEPENDENCY_SCOPE_REQUIRES_SEPARATE_DEPLOYMENT'});
});

test('named projects select only that project and do not collide in a single root', () => {
  const assets = {agents: [agent, {...agent, id: 'other', scope: {type: 'project', projectName: 'other'}}]};
  assert.deepEqual(selectManifestDeployment(manifest({assets}), {clientId: 'codex'}).selectedAssetIds, ['reviewer']);
  assert.deepEqual(selectManifestDeployment(manifest({assets, targets: {codex: {projectName: 'other'}}}), {clientId: 'codex'}).selectedAssetIds, ['other']);
});

test('one Agent emits native TOML and YAML frontmatter without silently mapping permissions', () => {
  const codex = renderAgentDefinition({asset: agent, clientId: 'codex'});
  assert.match(codex.content, /developer_instructions = /);
  assert.match(codex.content, /\\nReturn evidence/);
  const antigravity = renderAgentDefinition({asset: agent, clientId: 'antigravity'});
  const [, frontmatter] = antigravity.content.split('---\n', 3);
  assert.deepEqual(parse(frontmatter), {name: 'reviewer', description: agent.definition.description, mainAgent: false, subagent: true});
  assert.ok(antigravity.content.endsWith(`${agent.definition.instructions}\n`));
  for (const definition of [{...agent.definition, tools: []}, {...agent.definition, permissions: undefined}, {...agent.definition, schemaVersion: 2}, {...agent.definition, instructions: '\ud800'}]) {
    assert.throws(() => renderAgentDefinition({asset: {...agent, definition}, clientId: 'codex'}));
  }
  for (const extra of [{source: 'native.toml'}, {policy: {}}, {uses: {skills: ['review']}}, {requires: {tools: ['docs.search']}}]) {
    assert.throws(() => renderAgentDefinition({asset: {...agent, ...extra}, clientId: 'codex'}));
  }
  assert.throws(() => renderAgentDefinition({asset: agent, clientId: 'claude-code'}), {code: 'AGENT_RENDERER_UNSUPPORTED'});
});

function fixture(t, clientId = 'codex', verified = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-target-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const scopeRoot = path.join(root, 'kit');
  const targetRoot = path.join(root, 'target');
  const homeDir = path.join(root, 'home');
  for (const dir of [scopeRoot, targetRoot, homeDir]) fs.mkdirSync(dir);
  const definitionsDir = verified ? path.join(root, 'definitions') : path.join(repositoryRoot, 'clients');
  if (verified) writeProfileFixture({definitionsDir, repositoryRoot, clientId, capabilityIds: ['agents-project', 'skills-project', 'mcp-project']});
  const raw = {schemaVersion: 1, kit: {id: 'test-kit'}, assets: {agents: [structuredClone(agent)]}, targets: {[clientId]: {assetIds: ['reviewer']}}};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw));
  write();
  return {raw, write, scopeRoot, targetRoot, homeDir, service: createManifestDeploymentService({definitionsDir, homeDir}),
    input: {scopeRoot, targetRoot, clientId, scope: 'project', surface: 'cli', clientVersion: '0.0.1-test'}};
}

test('shared service applies selected Agent and dependency files, ignores unselected missing sources, and rolls back', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const f = fixture(t, clientId);
    f.raw.assets.agents[0].dependsOn = {skills: ['review']};
    f.raw.assets.skills = [{id: 'review', scope: 'project', source: 'review', requires: {tools: ['docs.search']}}, {id: 'unused', scope: 'project', source: 'missing'}];
    f.raw.assets.mcpServers = [{id: 'docs', scope: 'project', provides: {tools: ['docs.search']}, definition: {schemaVersion: 1, transport: 'http', endpointId: 'docs'}}];
    f.raw.defaults = {mcpBindings: {schemaVersion: 1, endpoints: {docs: {url: 'https://docs.example.test/mcp'}}}};
    fs.mkdirSync(path.join(f.scopeRoot, 'review'));
    fs.writeFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), '# Review\n');
    f.write();
    const plan = f.service.plan(f.input);
    assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
    assert.deepEqual(plan.selection.dependencyAssetIds, ['docs', 'review']);
    assert.deepEqual(plan.operations.map(op => op.assetId).sort(), ['docs', 'review', 'reviewer']);
    assert.equal(f.service.doctor(f.input).healthy, true);
    const result = f.service.apply({planId: plan.planId});
    assert.equal(result.applied.length, 3);
    const repeated = f.service.plan(f.input);
    assert.ok(repeated.operations.every(op => op.operation === 'SKIP'));
    const rollback = f.service.planRollback({...f.input, transactionId: result.transactionId});
    f.service.rollback({planId: rollback.planId});
    for (const op of plan.operations) assert.equal(fs.existsSync(op.target), false);
    f.raw.targets[clientId].enabled = false;
    f.write();
    assert.throws(() => f.service.plan(f.input), {code: 'MANIFEST_TARGET_DISABLED'});
    assert.equal(f.service.doctor(f.input).checks.at(-1).code, 'MANIFEST_TARGET_DISABLED');
  }
});

test('production profiles offer Agent preview without applying; IDE Agent stays blocked', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const f = fixture(t, clientId, false);
    const plan = f.service.plan(f.input);
    assert.equal(plan.automatic, false);
    assert.equal(plan.previews[0].operation, 'CREATE');
    assert.equal(plan.previews[0].previewOnly, true);
    assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
    assert.deepEqual(fs.readdirSync(f.targetRoot), []);
    if (clientId === 'antigravity') {
      const ide = f.service.plan({...f.input, surface: 'ide'});
      assert.equal(ide.automatic, false);
      assert.equal(ide.previews, undefined);
    }
  }
});

test('generated Agent updates preserve ownership, refuse external edits, and roll back validation failure', t => {
  const f = fixture(t);
  const initial = f.service.plan(f.input);
  const target = initial.operations[0].target;
  f.service.apply({planId: initial.planId});
  const original = fs.readFileSync(target, 'utf8');
  f.raw.assets.agents[0].definition.instructions = 'New review instructions';
  f.write();
  const update = f.service.plan(f.input);
  assert.equal(update.operations[0].operation, 'COPY');
  assert.throws(() => f.service.apply({planId: update.planId, validate: () => ({valid: false})}), {code: 'DEPLOYMENT_VALIDATION_FAILED'});
  assert.equal(fs.readFileSync(target, 'utf8'), original);
  const stale = f.service.plan(f.input);
  fs.writeFileSync(target, 'User changes');
  assert.throws(() => f.service.apply({planId: stale.planId}), {code: 'STALE_DEPLOYMENT_PLAN'});
  assert.equal(f.service.plan(f.input).blocked[0].reason, 'OWNED_CONTENT_MODIFIED_EXTERNALLY');
});

test('generated copy cannot adopt identical unmanaged files or accept preview/cloned apply handles', t => {
  const f = fixture(t);
  const rendered = renderAgentDefinition({asset: agent, clientId: 'codex'});
  const planned = {clientId: 'codex', assetId: 'reviewer', strategy: 'copy', target: '.codex/agents/reviewer.toml', rendered};
  const prepare = (state = {managed: {}}, previewOnly = false) => prepareCopyDeployment({capabilityPlan: {operations: [planned], blocked: []}, sources: new Map(), ...f, state, previewOnly});
  const prepared = prepare();
  assert.equal(contentForCopyOperation(prepared.operations[0]).toString(), rendered.content);
  assert.throws(() => contentForCopyOperation({...prepared.operations[0]}), {code: 'COPY_OPERATION_NOT_PREPARED'});
  const preview = prepare({managed: {}}, true);
  assert.throws(() => applyCopyDeployment({plan: preview}), {code: 'DEPLOYMENT_PREVIEW_ONLY'});
  assert.throws(() => applyDeployment({plans: [preview]}), {code: 'DEPLOYMENT_PREVIEW_ONLY'});
  const op = prepared.operations[0];
  fs.mkdirSync(path.dirname(op.target), {recursive: true});
  fs.writeFileSync(op.target, rendered.content);
  assert.equal(prepare().blocked[0].reason, 'UNKNOWN_EXISTING_CONTENT');
  assert.equal(prepare({managed: {[op.target]: {clientId: 'other', assetId: 'reviewer', ownership: 'file', hash: op.expectedHash}}}).blocked[0].reason, 'TARGET_OWNED_BY_OTHER_ASSET');
});
