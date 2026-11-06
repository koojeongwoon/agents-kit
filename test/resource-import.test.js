import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {discoverAndLoadManifest} from '../lib/infrastructure/manifest-loader.js';
import {applyKitSourceMutation, sourceHash, planKitSourceRecovery, applyKitSourceRecovery} from '../lib/infrastructure/kit-source-transaction.js';
import {createResourceBundle} from '../lib/infrastructure/resource-bundle.js';
import {selectManifestDeployment} from '../lib/domain/manifest-targets.js';
import {planClientDeployment} from '../lib/application/plan-client-deployment.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {validateManifestDocument} from '../lib/infrastructure/manifest-loader.js';
import {dependencyIndexFixture} from './helpers/dependency-index-fixture.js';
import {dependencyPrerequisiteId} from '../lib/domain/dependency-reverse-index.js';

const definitionsDir = path.resolve('clients');
const write = (file, content, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); fs.chmodSync(file, mode);
};
const code = expected => error => error.code === expected;
function fixture(t, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-import-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'kit'), targetRoot = homeDir;
  fs.mkdirSync(homeDir);
  const manifestPath = path.join(scopeRoot, 'agent-kit.yaml');
  write(manifestPath, 'schemaVersion: 1\nkit: {id: import-test}\nassets:\n  instructions:\n    - {id: existing, scope: global, source: existing.md}\n');
  write(path.join(scopeRoot, 'existing.md'), '# Existing\n');
  const service = createManifestDeploymentService({definitionsDir, homeDir, ...options});
  const input = {scope: 'global', scopeRoot, targetRoot, clientId: 'codex', surface: 'cli'};
  function selected(kind, id, extra = {}) {
    const clientId = extra.clientId || input.clientId;
    const inventory = service.localDiscovery({scope: extra.sourceScope || input.scope, ...(extra.projectPath ? {projectPath: extra.projectPath} : {})});
    const client = inventory.find(client => client.id === clientId);
    const surface = client.surfaces?.find(surface => surface.id === (extra.surface || input.surface));
    const candidate = (surface || client).observations.find(item => item.kind === kind && item.id === id);
    assert.ok(candidate, `discovered ${kind}/${id}`);
    return {...input, ...extra, candidateId: candidate.candidateId};
  }
  return {root, homeDir, scopeRoot, manifestPath, service, input, selected};
}

test('source import plans are pure; Skill metadata, scripts, original link and mode survive import/detach/reattach', t => {
  const f = fixture(t);
  const original = path.join(f.homeDir, 'my-skills/review');
  write(path.join(original, 'SKILL.md'), '---\nname: review\n---\n# Review\n');
  write(path.join(original, 'agents/openai.yaml'), 'interface:\n  display_name: Review\n');
  write(path.join(original, 'scripts/run.sh'), '#!/bin/sh\nexit 0\n', 0o755);
  const link = path.join(f.homeDir, '.agents/skills/review');
  fs.mkdirSync(path.dirname(link), {recursive: true}); fs.symlinkSync(original, link);
  const before = fs.readFileSync(f.manifestPath, 'utf8'), linkBefore = fs.lstatSync(link);
  const input = f.selected('skills', 'review');
  const plan = f.service.planImport(input);
  assert.equal(plan.source.fileCount, 3); assert.deepEqual(plan.stateUpgrade, {from: 1, to: 2});
  assert.equal(fs.readFileSync(f.manifestPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(f.scopeRoot, '.kit-sources')), false);
  f.service.applyImport({planId: plan.planId});
  const loaded = discoverAndLoadManifest({scopeRoot: f.scopeRoot});
  const record = loaded.manifest.management.resources.review;
  assert.equal(loaded.manifest.schemaVersion, 2);
  assert.equal(fs.readlinkSync(link), original); assert.equal(fs.lstatSync(link).mtimeMs, linkBefore.mtimeMs);
  assert.equal(fs.readFileSync(path.join(f.scopeRoot, record.source, 'agents/openai.yaml'), 'utf8'), 'interface:\n  display_name: Review\n');
  assert.equal(fs.statSync(path.join(f.scopeRoot, record.source, 'scripts/run.sh')).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(f.scopeRoot, record.baseline, 'scripts/run.sh'), 'utf8'), '#!/bin/sh\nexit 0\n');
  assert.deepEqual(selectManifestDeployment(loaded.manifest, {clientId: 'codex', scope: 'global'}).rootAssetIds, ['existing']);
  const explicit = planClientDeployment({manifest: loaded.manifest, definition: loadClientDefinitions({definitionsDir}).get('codex'), surface: 'cli', selectedAssetIds: ['review']});
  assert.equal(explicit.blocked[0].reason, 'IMPORTED_RESOURCE_DEPLOYMENT_NOT_ENABLED');
  const skip = f.service.planImport(input); assert.equal(skip.operations[0].operation, 'SKIP');
  assert.equal(f.service.applyImport({planId: skip.planId}).unchanged, true);
  assert.throws(() => createResourceBundle({manifestPath: f.manifestPath, resourceId: 'test', version: 1}), code('BUNDLE_MANAGEMENT_SCHEMA_UNSUPPORTED'));
  const detach = f.service.planDetach({...f.input, assetId: 'review'});
  assert.equal(parse(fs.readFileSync(f.manifestPath, 'utf8')).management.resources.review.status, 'active');
  f.service.applyDetach({planId: detach.planId});
  assert.equal(parse(fs.readFileSync(f.manifestPath, 'utf8')).management.resources.review.status, 'detached');
  assert.ok(fs.existsSync(path.join(f.scopeRoot, record.source, 'SKILL.md'))); assert.equal(fs.readlinkSync(link), original);
  f.service.applyImport({planId: f.service.planImport(input).planId});
  assert.equal(parse(fs.readFileSync(f.manifestPath, 'utf8')).management.resources.review.status, 'active');
});

test('instructions, native Agent options and selected TOML MCP survive; unrelated secrets are never imported', t => {
  const f = fixture(t);
  write(path.join(f.homeDir, '.codex/AGENTS.md'), '# Instructions\n');
  write(path.join(f.homeDir, '.codex/agents/reviewer.toml'), 'model = "gpt-5"\nsandbox_mode = "read-only"\n');
  write(path.join(f.homeDir, '.codex/config.toml'), '[mcp_servers.docs]\ncommand = "docs"\nargs = ["--local"]\n[mcp_servers.private.env]\nAPI_TOKEN = "must-not-import"\n');
  for (const [kind, id, assetId] of [['instructions', 'AGENTS', 'instructions'], ['agents', 'reviewer', 'reviewer'], ['mcpServers', 'docs', 'docs']]) {
    const client = f.service.localDiscovery().find(client => client.id === 'codex');
    const item = client.surfaces.find(surface => surface.id === 'cli').observations.find(item => item.kind === kind);
    assert.ok(item, `${kind} observation`);
    const plan = f.service.planImport({...f.input, candidateId: item.candidateId, assetId});
    f.service.applyImport({planId: plan.planId});
  }
  const doc = parse(fs.readFileSync(f.manifestPath, 'utf8'));
  const read = id => fs.readFileSync(path.join(f.scopeRoot, doc.management.resources[id].source), 'utf8');
  assert.equal(read('instructions'), '# Instructions\n');
  assert.match(read('reviewer'), /sandbox_mode = "read-only"/);
  assert.match(read('docs'), /--local/); assert.doesNotMatch(read('docs'), /must-not-import|private/);
  const raw = f.service.resource({...f.input, assetId: 'reviewer'});
  assert.ok(raw);
});

test('JSON MCP imports retain all selected native fields and exclude other servers', t => {
  const f = fixture(t);
  write(path.join(f.homeDir, '.gemini/config/mcp_config.json'), JSON.stringify({mcpServers: {docs: {command: 'docs', custom: {enabled: true}}, private: {env: {TOKEN: 'no-copy'}}}}));
  const input = f.selected('mcpServers', 'docs', {clientId: 'antigravity', surface: 'ide'});
  f.service.applyImport({planId: f.service.planImport(input).planId});
  const doc = parse(fs.readFileSync(f.manifestPath, 'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.scopeRoot, doc.management.resources.docs.source))), {mcpServers: {docs: {command: 'docs', custom: {enabled: true}}}});
});

test('external ego link rejects import before scanning its credential-like body', t => {
  const f = fixture(t), target = path.join(f.homeDir, '.local/share/ego/ego-skills');
  write(path.join(target, 'SKILL.md'), 'API_TOKEN = "do-not-read"\n');
  const link = path.join(f.homeDir, '.agents/skills/ego-browser');
  fs.mkdirSync(path.dirname(link), {recursive: true}); fs.symlinkSync(target, link);
  assert.throws(() => f.service.planImport(f.selected('skills', 'ego-browser')), code('EXTERNAL_RESOURCE_READ_ONLY'));
  assert.equal(fs.readlinkSync(link), target); assert.equal(fs.existsSync(path.join(f.scopeRoot, '.kit-sources')), false);
});

test('a different surface cannot bypass another surface external-manager observation', t => {
  const f = fixture(t), definitions = path.join(f.root, 'definitions');
  const doc = parse(fs.readFileSync(path.join(definitionsDir, 'codex.yaml'), 'utf8'));
  doc.surfaces.find(surface => surface.id === 'desktop').overrides = [{id: 'skills-global', discovery: {reader: 'directory-entries'}}];
  write(path.join(definitions, 'codex.yaml'), stringify(doc));
  const target = path.join(f.homeDir, '.local/share/ego/ego-skills'); write(path.join(target, 'SKILL.md'), 'API_TOKEN = "do-not-read"\n');
  const link = path.join(f.homeDir, '.agents/skills/ego-browser'); fs.mkdirSync(path.dirname(link), {recursive: true}); fs.symlinkSync(target, link);
  const service = createManifestDeploymentService({homeDir: f.homeDir, definitionsDir: definitions});
  const observed = service.localDiscovery()[0].surfaces.find(surface => surface.id === 'desktop').observations[0];
  assert.equal(observed.managementMode, 'unmanaged');
  assert.throws(() => service.planImport({...f.input, surface: 'desktop', candidateId: observed.candidateId}), code('EXTERNAL_RESOURCE_READ_ONLY'));
});

test('import rejects internal/escaping links, special and oversized sources, empty dirs, metadata and literal credentials', t => {
  const f = fixture(t), original = path.join(f.homeDir, '.agents/skills/review');
  const skill = path.join(original, 'SKILL.md'); write(skill, '# Review\n');
  const input = f.selected('skills', 'review');
  const invalid = path.join(original, 'extra');
  fs.symlinkSync(skill, invalid);
  assert.throws(() => f.service.planImport(input), code('IMPORT_SOURCE_UNSAFE')); fs.unlinkSync(invalid);
  fs.mkdirSync(invalid); assert.throws(() => f.service.planImport(input), code('IMPORT_EMPTY_DIRECTORY_UNSUPPORTED')); fs.rmdirSync(invalid);
  fs.mkdirSync(path.join(original, '.git')); assert.throws(() => f.service.planImport(input), code('IMPORT_SOURCE_UNSAFE')); fs.rmdirSync(path.join(original, '.git'));
  write(skill, Buffer.alloc(1024 * 1024 + 1)); assert.throws(() => f.service.planImport(input), code('IMPORT_SOURCE_LIMIT_EXCEEDED'));
  write(skill, 'API_TOKEN = "secret-value"\n'); assert.throws(() => f.service.planImport(input), error => error.code === 'LITERAL_SECRET' && !JSON.stringify(error).includes('secret-value'));
  fs.rmSync(original, {recursive: true}); const outside = path.join(f.root, 'outside'); write(path.join(outside, 'SKILL.md'), '# Outside\n'); fs.symlinkSync(outside, original);
  assert.throws(() => f.service.planImport(input), code('IMPORT_SOURCE_UNSAFE'));
});

test('apply rejects changed upstream, changed Manifest, collisions, stale IDs and expired plans', t => {
  let now = 0;
  const f = fixture(t, {clock: () => now, planTtlMs: 1000}), skill = path.join(f.homeDir, '.agents/skills/review/SKILL.md');
  write(skill, '# Review\n'); const input = f.selected('skills', 'review');
  let plan = f.service.planImport(input); write(skill, '# Changed\n');
  assert.throws(() => f.service.applyImport({planId: plan.planId}), code('IMPORT_SOURCE_CHANGED'));
  plan = f.service.planImport(input); fs.appendFileSync(f.manifestPath, '# changed\n');
  assert.throws(() => f.service.applyImport({planId: plan.planId}), code('STALE_SOURCE_MANAGEMENT_PLAN'));
  plan = f.service.planImport(input); now = 1001;
  assert.throws(() => f.service.applyImport({planId: plan.planId}), code('DEPLOYMENT_PLAN_EXPIRED'));
  assert.throws(() => f.service.applyImport({planId: plan.planId}), code('DEPLOYMENT_PLAN_NOT_FOUND'));
  write(path.join(f.scopeRoot, 'assets/imported/review/bundle/SKILL.md'), 'user-owned');
  assert.throws(() => f.service.planImport(input), code('IMPORT_SOURCE_COLLISION'));
  assert.throws(() => f.service.planImport({...input, assetId: 'existing'}), code('DUPLICATE_ASSET_ID'));
});

test('modified retained artifacts and unknown extra files block idempotency and reattachment', t => {
  const f = fixture(t); write(path.join(f.homeDir, '.agents/skills/review/SKILL.md'), '# Review\n');
  const input = f.selected('skills', 'review'); f.service.applyImport({planId: f.service.planImport(input).planId});
  f.service.applyDetach({planId: f.service.planDetach({...f.input, assetId: 'review'}).planId});
  const extra = path.join(f.scopeRoot, 'assets/imported/review/bundle/unknown.md'); write(extra, '# Extra\n');
  assert.throws(() => f.service.planImport(input), code('IMPORT_ARTIFACT_MODIFIED'));
  fs.unlinkSync(extra);
  const plan = f.service.planImport(input); write(extra, '# Added after plan\n');
  assert.throws(() => f.service.applyImport({planId: plan.planId}), code('IMPORT_ARTIFACT_MODIFIED'));
});

test('ordinary mutation faults restore Manifest and remove only exact files created by transaction', t => {
  const f = fixture(t), before = fs.readFileSync(f.manifestPath);
  for (const phase of ['journal', 'source', 'manifest']) {
    assert.throws(() => applyKitSourceMutation({scopeRoot: f.scopeRoot, manifestPath: f.manifestPath, beforeHash: sourceHash(before), content: 'changed',
      files: [{path: 'assets/imported/test/file.md', content: Buffer.from('new'), sha256: sourceHash('new'), mode: 0o600}],
      onPhase: current => { if (current === phase) throw new Error('injected'); }}), /injected/);
    assert.deepEqual(fs.readFileSync(f.manifestPath), before);
    assert.equal(fs.existsSync(path.join(f.scopeRoot, 'assets/imported/test/file.md')), false);
    assert.equal(fs.existsSync(path.join(f.scopeRoot, '.kit-sources/lock')), false);
  }
});

test('detach blocks logical dependants and deployment owners; rechecks ownership when applying', t => {
  const f = fixture(t); write(path.join(f.homeDir, '.agents/skills/review/SKILL.md'), '# Review\n');
  f.service.applyImport({planId: f.service.planImport(f.selected('skills', 'review')).planId});
  const doc = parse(fs.readFileSync(f.manifestPath, 'utf8'));
  doc.assets.agents = [{id: 'reader', scope: 'global', source: 'existing.md', uses: {skills: ['review']}}]; write(f.manifestPath, stringify(doc));
  assert.throws(() => f.service.planDetach({...f.input, assetId: 'review'}), code('IMPORT_DEPENDENCY_CONFLICT'));
  delete doc.assets.agents; write(f.manifestPath, stringify(doc));
  const plan = f.service.planDetach({...f.input, assetId: 'review'});
  const statePath = path.join(f.homeDir, '.agents-kit/deployments/_global/state.json');
  write(statePath, JSON.stringify({schemaVersion: 4, managed: {native: {resource: {kitId: 'import-test', assetId: 'review'}}}, transactions: []}));
  assert.throws(() => f.service.applyDetach({planId: plan.planId}), code('IMPORT_RESOURCE_DEPLOYED'));
  assert.throws(() => f.service.planDetach({...f.input, assetId: 'review'}), code('IMPORT_RESOURCE_DEPLOYED'));
  write(statePath, JSON.stringify({schemaVersion: 4, managed: {}, transactions: []}));
  write(`${statePath}.journal.json`, '{}');
  assert.throws(() => f.service.planDetach({...f.input, assetId: 'review'}), code('DEPLOYMENT_RECOVERY_REQUIRED'));
});

test('native source detach cannot erase an indexed global origin even when installed ownership is unavailable',t=>{
  const f=fixture(t),primary=path.join(f.homeDir,'.agents/skills/review/SKILL.md');write(primary,'# Review\n');
  f.service.applyImport({planId:f.service.planImport(f.selected('skills','review')).planId});
  const dependent=dependencyIndexFixture(t),registration=structuredClone(dependent.registration),pin=registration.prerequisites[0];
  Object.assign(pin,{kitId:'import-test',sourceRoot:f.scopeRoot});pin.id=dependencyPrerequisiteId(pin);registration.consumers[0].prerequisiteIds=[pin.id];
  write(path.join(f.homeDir,'.agents-kit/deployments/_global/state.json'),JSON.stringify({schemaVersion:8,managed:{},transactions:[],dependencyIndex:{schemaVersion:1,generation:1,projects:[registration]}}));
  const before=fs.readFileSync(f.manifestPath),original=fs.readFileSync(primary);
  assert.throws(()=>f.service.planDetach({...f.input,assetId:'review'}),{code:'GLOBAL_SOURCE_IN_USE'});
  assert.deepEqual(fs.readFileSync(f.manifestPath),before);assert.deepEqual(fs.readFileSync(primary),original);dependent.global.preserved();dependent.project.preserved();
});

test('project import uses authorized project candidates and may select global originals without changing them', t => {
  const f = fixture(t), project = path.join(f.root, 'project'); fs.mkdirSync(project);
  write(path.join(project, '.agents/skills/review/SKILL.md'), '# Project\n');
  write(path.join(f.homeDir, '.agents/skills/global/SKILL.md'), '# Global\n');
  const projectClient = f.service.localDiscovery({scope: 'project', projectPath: project}).find(client => client.id === 'codex');
  const observation = projectClient.surfaces.find(surface => surface.id === 'cli').observations.find(item => item.id === 'review');
  const input = {...f.input, scope: 'project', targetRoot: project, candidateId: observation.candidateId};
  f.service.applyImport({planId: f.service.planImport(input).planId});
  const globalInput = {...f.selected('skills', 'global'), scope: 'project', targetRoot: project, sourceScope: 'global'};
  f.service.applyImport({planId: f.service.planImport(globalInput).planId});
  assert.equal(fs.readFileSync(path.join(project, '.agents/skills/review/SKILL.md'), 'utf8'), '# Project\n');
  assert.equal(fs.readFileSync(path.join(f.homeDir, '.agents/skills/global/SKILL.md'), 'utf8'), '# Global\n');
  assert.throws(() => f.service.planImport({...input, targetRoot: f.homeDir}), error => !!error.code);
});

test('versioned management metadata rejects unknown fields, escaped paths and inconsistent assets', t => {
  const f = fixture(t); write(path.join(f.homeDir, '.agents/skills/review/SKILL.md'), '# Review\n');
  f.service.applyImport({planId: f.service.planImport(f.selected('skills', 'review')).planId});
  const original = parse(fs.readFileSync(f.manifestPath, 'utf8'));
  for (const mutate of [doc => {doc.schemaVersion = 1;}, doc => {doc.management.resources.review.origin.path = '../escape';},
    doc => {doc.management.resources.review.extra = true;}, doc => {doc.management.resources.review.files[0].path = '/escape';},
    doc => {doc.management.resources.review.status = 'detached';}, doc => {doc.management.resources.review.source = 'existing.md';}]) {
    const doc = structuredClone(original); mutate(doc);
    assert.throws(() => validateManifestDocument(doc), code('INVALID_RESOURCE_MANAGEMENT'));
  }
  assert.throws(() => f.service.planEdit({scopeRoot: f.scopeRoot, mutations: [{type: 'delete', kind: 'skills', assetId: 'review'}]}), code('IMPORTED_RESOURCE_EDIT_UNSUPPORTED'));
});

test('Manifest edits share the source lock, preserve temporary user files and fail closed on staleness and secrets', t => {
  const f = fixture(t), mutations = [{type: 'update', kind: 'instructions', assetId: 'existing', asset: {source: 'existing.md', scope: 'global', displayName: 'Updated'}}];
  const plan = f.service.planEdit({scopeRoot: f.scopeRoot, mutations});
  write(`${f.manifestPath}.tmp`, 'user temporary data'); fs.chmodSync(f.manifestPath, 0o640);
  f.service.applyEdit({planId: plan.planId});
  assert.equal(fs.readFileSync(`${f.manifestPath}.tmp`, 'utf8'), 'user temporary data');
  assert.equal(fs.statSync(f.manifestPath).mode & 0o777, 0o640);
  const stale = f.service.planEdit({scopeRoot: f.scopeRoot, mutations}); fs.appendFileSync(f.manifestPath, '# New edit\n');
  assert.throws(() => f.service.applyEdit({planId: stale.planId}), code('STALE_EDIT_CONFLICT'));
  assert.throws(() => f.service.planEdit({scopeRoot: f.scopeRoot, mutations: [{...mutations[0], asset: {...mutations[0].asset, apiToken: 'never-persist'}}]}), code('LITERAL_SECRET'));
});

test('MCP auth headers, credential arguments and URLs block import; unsupported TOML never drops native syntax', t => {
  const f = fixture(t), source = path.join(f.homeDir, '.codex/config.toml');
  for (const fields of ['http_headers = {"Authorization":"opaque-value"}', 'args = ["--api-key", "opaque-value"]', 'url = "https://docs.test/mcp?token=opaque-value"']) {
    write(source, `[mcp_servers.docs]\n${fields}\n`);
    assert.throws(() => f.service.planImport(f.selected('mcpServers', 'docs')), error => error.code === 'LITERAL_SECRET' && !JSON.stringify(error).includes('opaque-value'));
  }
  for (const fields of ['args = [\n "one",\n "two"\n]', 'command = "docs" # inline syntax', 'command = "one"\ncommand = "two"']) {
    const original = `[mcp_servers.docs]\n${fields}\n`; write(source, original);
    assert.throws(() => f.service.planImport(f.selected('mcpServers', 'docs')), code('NATIVE_MCP_IMPORT_UNSUPPORTED'));
    assert.equal(fs.readFileSync(source, 'utf8'), original);
  }
});

test('reviewed recovery refuses modified artifacts, forged paths, live owners and changed journals', t => {
  const f = fixture(t), before = fs.readFileSync(f.manifestPath, 'utf8');
  const moduleUrl = new URL('../lib/infrastructure/kit-source-transaction.js', import.meta.url).href;
  const script = `import {applyKitSourceMutation,sourceHash} from ${JSON.stringify(moduleUrl)};\napplyKitSourceMutation({scopeRoot:${JSON.stringify(f.scopeRoot)},manifestPath:${JSON.stringify(f.manifestPath)},beforeHash:sourceHash(${JSON.stringify(before)}),content:${JSON.stringify(before + '# commit\n')},files:[{path:'assets/imported/test/file.md',content:Buffer.from('new'),sha256:sourceHash('new'),mode:384}],onPhase: phase=>{if(phase==='source')process.kill(process.pid,'SIGKILL')}});`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script]).signal, 'SIGKILL');
  const file = path.join(f.scopeRoot, 'assets/imported/test/file.md'), journalPath = path.join(f.scopeRoot, '.kit-sources/journal.json'), lockPath = path.join(f.scopeRoot, '.kit-sources/lock');
  const journalBytes = fs.readFileSync(journalPath), lockBytes = fs.readFileSync(lockPath);
  write(file, 'user edit', 0o600); assert.throws(() => planKitSourceRecovery(f.scopeRoot), code('SOURCE_MANAGEMENT_RECOVERY_CONFLICT'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'user edit'); write(file, 'new', 0o600);
  let journal = JSON.parse(journalBytes); journal.files[0].path = 'assets/imported/../../escape'; write(journalPath, JSON.stringify(journal));
  assert.throws(() => planKitSourceRecovery(f.scopeRoot), code('INVALID_SOURCE_MANAGEMENT_PATH'));
  journal = JSON.parse(journalBytes); journal.owner.pid = process.pid; write(journalPath, JSON.stringify(journal)); write(lockPath, JSON.stringify(journal.owner));
  assert.throws(() => planKitSourceRecovery(f.scopeRoot), code('SOURCE_MANAGEMENT_LOCKED'));
  write(journalPath, journalBytes); write(lockPath, lockBytes);
  const plan = planKitSourceRecovery(f.scopeRoot); fs.appendFileSync(journalPath, '\n');
  assert.throws(() => applyKitSourceRecovery({scopeRoot: f.scopeRoot, plan}), code('STALE_SOURCE_MANAGEMENT_PLAN'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('SIGKILL before/after Manifest commit blocks readers and recovers only reviewed exact artifacts', t => {
  for (const phase of ['source', 'manifest']) {
    const f = fixture(t), before = fs.readFileSync(f.manifestPath, 'utf8');
    const moduleUrl = new URL('../lib/infrastructure/kit-source-transaction.js', import.meta.url).href;
    const script = `import {applyKitSourceMutation,sourceHash} from ${JSON.stringify(moduleUrl)};\napplyKitSourceMutation({scopeRoot:${JSON.stringify(f.scopeRoot)},manifestPath:${JSON.stringify(f.manifestPath)},beforeHash:sourceHash(${JSON.stringify(before)}),content:${JSON.stringify(before + '# committed\n')},files:[{path:'assets/imported/test/file.md',content:Buffer.from('new'),sha256:sourceHash('new'),mode:384}],onPhase: phase=>{if(phase===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL')}});`;
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script]).signal, 'SIGKILL');
    assert.throws(() => discoverAndLoadManifest({scopeRoot: f.scopeRoot}), code('SOURCE_MANAGEMENT_RECOVERY_REQUIRED'));
    const plan = planKitSourceRecovery(f.scopeRoot);
    assert.equal(plan.committed, phase === 'manifest');
    applyKitSourceRecovery({scopeRoot: f.scopeRoot, plan});
    assert.equal(fs.existsSync(path.join(f.scopeRoot, 'assets/imported/test/file.md')), phase === 'manifest');
    assert.equal(fs.readFileSync(f.manifestPath, 'utf8'), phase === 'manifest' ? before + '# committed\n' : before);
    assert.ok(discoverAndLoadManifest({scopeRoot: f.scopeRoot}));
  }
});
