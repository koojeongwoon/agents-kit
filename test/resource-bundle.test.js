import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createResourceBundle, validateResourceBundle, decodeResourceBundle, BUNDLE_LIMITS} from '../lib/infrastructure/resource-bundle.js';
import {createResourceBundleDeploymentService} from '../lib/application/resource-bundle-deployment-service.js';
import {canonicalDigest} from '../lib/infrastructure/saved-deployment-plan-store.js';
import {normalizeMcpDefinition} from '../lib/domain/mcp-definition.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {observeClientBinary} from '../lib/infrastructure/client-binary-observer.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('published portable bundle fixture has the exact cross-service byte digest', () => {
  const base = path.join(repositoryRoot, 'docs/contracts/resource-bundle-v1');
  const digest = JSON.parse(fs.readFileSync(path.join(base, 'example.digest.json')));
  const bytes = fs.readFileSync(path.join(base, 'example.bundle.json'));
  assert.equal(bytes.length, digest.bytes);
  assert.deepEqual(decodeResourceBundle(bytes, digest.sha256).bundle.resource, digest.resource);
  assert.equal(digest.profile, 'immutable-local-input-not-a-signed-job');
});
function fixture(t, {scope = 'project', mcp = false, agent = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-bundle-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'source'), definitionsDir = path.join(root, 'definitions');
  const targetRoot = scope === 'project' ? path.join(root, 'project') : homeDir;
  for (const dir of [homeDir, scopeRoot, targetRoot, path.join(scopeRoot, 'review')]) fs.mkdirSync(dir, {recursive: true});
  const manifest = {schemaVersion: 1, kit: {id: 'bundle-kit'}, assets: {
    skills: [{id: 'review', scope, source: 'review', definition: {schemaVersion: 1, format: 'agent-skills'}}],
    ...(scope === 'project' ? {instructions: [{id: 'rules', scope, source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}]} : {})
  }};
  if (mcp) {
    manifest.defaults = {mcpBindings: {schemaVersion: 1, executables: {node: {command: 'node'}}}};
    manifest.assets.mcpServers = [{id: 'lookup', scope, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: ['never-launched.js']}}];
  }
  if (agent) {
    manifest.assets.agents = [{id: 'inspector', scope, definition: {schemaVersion: 1, description: 'Inspect changes', instructions: 'Review evidence.', permissions: 'client-default'}}];
    manifest.targets = {codex: {assetIds: Object.values(manifest.assets).flat().map(asset => asset.id)}, antigravity: {assetIds: ['rules', 'review', ...(mcp ? ['lookup'] : [])]}};
  }
  const manifestPath = path.join(scopeRoot, 'agent-kit.json');
  const write = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  write();
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Use reviewed evidence.\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review a change\n---\nRead guide.txt before reviewing.\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/guide.txt'), '한국어 안내: 사용자 파일을 보존하세요.\n');
  for (const clientId of ['codex', 'antigravity']) writeProfileFixture({definitionsDir, repositoryRoot, clientId,
    capabilityIds: [`instructions-${scope}`, `skills-${scope}`, `mcp-${scope}`, `agents-${scope}`]});
  const binding = {scope, targetRoot, targets: ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}))};
  if (mcp) binding.allowedMcpDigests = [canonicalDigest(normalizeMcpDefinition(manifest.assets.mcpServers[0], manifest.defaults.mcpBindings))];
  const options = {homeDir, definitionsDir, workRoot: path.join(root, 'executor'), bindings: {workspace: binding}};
  const create = () => createResourceBundle({manifestPath, resourceId: 'review-resources', version: 1});
  const restart = extra => createResourceBundleDeploymentService({...options, ...extra});
  const prepare = (service = restart()) => { const bundle = create(); return service.prepare({bindingId: 'workspace', bundleBytes: bundle.bytes, sha256: bundle.sha256}); };
  const applyRequest = prepared => ({receiptId: prepared.receiptId, receiptDigest: prepared.receiptDigest});
  const readReceipt = prepared => JSON.parse(fs.readFileSync(path.join(options.workRoot, 'receipts', `${prepared.receiptId}.json`)));
  const configPath = path.join(root, 'executor-config.json');
  const writeConfig = patch => fs.writeFileSync(configPath, JSON.stringify({schemaVersion: 1, userId: process.getuid(), ...options, ...patch}), {mode: 0o600});
  const helper = request => {
    const child = spawnSync(process.execPath, ['bin/resource-bundle-helper.js', configPath], {cwd: repositoryRoot, input: JSON.stringify(request), encoding: 'utf8'});
    assert.equal(child.stderr, '');
    return {status: child.status, ...JSON.parse(child.stdout)};
  };
  return {root, homeDir, scopeRoot, targetRoot, manifest, manifestPath, write, create, options, binding, restart, prepare, applyRequest, readReceipt, writeConfig, configPath, helper};
}

test('bundle freezes deterministic canonical bytes with all supporting files and no host source paths', t => {
  const f = fixture(t, {mcp: true, agent: true}), first = f.create();
  assert.equal(first.sha256, sha(first.bytes));
  assert.deepEqual(f.create().bytes, first.bytes);
  assert.doesNotMatch(first.bytes.toString(), new RegExp(f.root));
  assert.deepEqual(decodeResourceBundle(first.bytes, first.sha256).bundle, first.bundle);
  assert.equal(first.bundle.files.length, 3);
  fs.writeFileSync(path.join(f.scopeRoot, 'review/guide.txt'), 'Changed source');
  assert.notEqual(f.create().sha256, first.sha256);
  assert.match(first.bundle.files.find(file => file.path.endsWith('guide.txt')).content, /한국어/);
  const noncanonical = Buffer.from(JSON.stringify(first.bundle, null, 2));
  assert.throws(() => decodeResourceBundle(noncanonical, sha(noncanonical)), {code: 'NONCANONICAL_RESOURCE_BUNDLE'});
});

test('bundle rejects hashes, unsafe paths, duplicate/case aliases, extra files, secrets, bad encoding and unsupported/native assets', t => {
  const f = fixture(t), original = f.create();
  assert.throws(() => decodeResourceBundle(original.bytes, '0'.repeat(64)), {code: 'RESOURCE_BUNDLE_HASH_MISMATCH'});
  const mutations = [
    bundle => { bundle.files[0].content += 'tampered'; },
    bundle => { bundle.files[0].path = '../escape'; },
    bundle => { bundle.files[0].path = '/absolute'; },
    bundle => { bundle.files.push(bundle.files[0]); },
    bundle => { bundle.files.push({...bundle.files[0], path: 'sources/review/skill.md'}); bundle.files.sort((a, b) => a.path < b.path ? -1 : 1); },
    bundle => { bundle.files.push(...['sources/review/Guide/a', 'sources/review/guide/b'].map(path => ({...bundle.files[0], path}))); bundle.files.sort((a, b) => a.path < b.path ? -1 : 1); },
    bundle => { bundle.files[0].path = 'sources/orphan.md'; },
    bundle => { bundle.files = []; },
    bundle => { bundle.manifest.assets.skills[0].source = '../escape'; },
    bundle => { delete bundle.manifest.assets.skills[0].definition; },
    bundle => { bundle.clientDefinitions = {}; },
    bundle => { bundle.manifest.assets.memory = []; },
    bundle => { bundle.resource.version = 0; },
    bundle => { bundle.manifest.assets.skills[0].requires = {tools: ['missing.tool']}; },
    bundle => { bundle.files[0].content = 'Bearer example-only-credential'; bundle.files[0].sha256 = sha(bundle.files[0].content); },
    bundle => { bundle.files[0].content = '\ud800'; bundle.files[0].sha256 = sha(bundle.files[0].content); }
  ];
  for (const change of mutations) { const altered = structuredClone(original.bundle); change(altered); assert.throws(() => validateResourceBundle(altered)); }
  fs.writeFileSync(path.join(f.scopeRoot, 'review/guide.txt'), Buffer.from([0xff]));
  assert.throws(f.create, {code: 'INVALID_BUNDLE_TEXT'});
  fs.writeFileSync(path.join(f.scopeRoot, 'review/guide.txt'), 'Bearer example-only-credential');
  assert.throws(f.create, {code: 'LITERAL_SECRET'});
});

test('bundle source snapshot rejects symlinks, oversized files and native materialization before reading them', t => {
  for (const kind of ['file', 'directory', 'intermediate', 'size', 'native']) {
    const f = fixture(t);
    if (kind === 'native') { delete f.manifest.assets.skills[0].definition; f.write(); }
    else if (kind === 'size') fs.writeFileSync(path.join(f.scopeRoot, 'review/guide.txt'), Buffer.alloc(BUNDLE_LIMITS.fileBytes + 1));
    else if (kind === 'file') { fs.unlinkSync(path.join(f.scopeRoot, 'review/guide.txt')); fs.symlinkSync(f.manifestPath, path.join(f.scopeRoot, 'review/guide.txt')); }
    else {
      fs.renameSync(path.join(f.scopeRoot, 'review'), path.join(f.scopeRoot, 'original'));
      fs.symlinkSync(path.join(f.scopeRoot, 'original'), path.join(f.scopeRoot, 'review'));
      if (kind === 'intermediate') { f.manifest.assets.instructions[0].source = 'review/guide.txt'; f.write(); }
    }
    assert.throws(f.create);
  }
});

test('prepare never changes client files; apply survives restart, uses frozen sources and returns one historical transaction', t => {
  for (const scope of ['project', 'global']) {
    const f = fixture(t, {scope, mcp: scope === 'project', agent: scope === 'project'});
    if (scope === 'project') fs.writeFileSync(path.join(f.targetRoot, 'AGENTS.md'), '# User-owned\n');
    const prepared = f.prepare();
    assert.equal(prepared.phase, 'prepared', JSON.stringify(prepared.plan.blocked));
    assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), false);
    fs.rmSync(f.scopeRoot, {recursive: true}); // Replay has no dependency on authoring paths.
    const request = f.applyRequest(prepared), applied = f.restart().apply(request);
    assert.equal(applied.phase, 'files-applied'); assert.equal(applied.clientRecognition, 'unverified');
    assert.deepEqual(f.restart().apply(request), applied);
    assert.match(fs.readFileSync(path.join(f.targetRoot, '.agents/skills/review/guide.txt'), 'utf8'), /한국어/);
    if (scope === 'project') {
      assert.match(fs.readFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'utf8'), /^# User-owned/);
      assert.ok(fs.existsSync(path.join(f.targetRoot, '.codex/config.toml')));
      assert.ok(fs.existsSync(path.join(f.targetRoot, '.codex/agents/inspector.toml')));
    } else assert.ok(fs.existsSync(path.join(f.homeDir, '.gemini/config/skills/review/SKILL.md')));
    const state = JSON.parse(fs.readFileSync(scope === 'project' ? path.join(f.targetRoot, '.agent-kit/state.json') : path.join(f.homeDir, '.agents-kit/deployments/_global/state.json')));
    assert.equal(state.transactions.length, 1);
    assert.doesNotMatch(JSON.stringify(applied), /User-owned|guide.txt|Review evidence/);
  }
});

test('apply rejects changed staged bytes, cache, target, ownership, local binding and client definitions', t => {
  for (const kind of ['staged', 'extra', 'cache', 'symlink', 'target', 'state', 'binding', 'definition', 'digest']) {
    const f = fixture(t), prepared = f.prepare(), receipt = f.readReceipt(prepared);
    let options;
    if (kind === 'staged') fs.appendFileSync(path.join(receipt.body.scopeRoot, 'sources/rules.md'), 'changed');
    if (kind === 'extra') fs.writeFileSync(path.join(receipt.body.scopeRoot, 'extra'), 'unapproved');
    if (kind === 'cache') fs.appendFileSync(path.join(f.options.workRoot, `${prepared.bundleSha256}.json`), ' ');
    if (kind === 'symlink') { fs.renameSync(receipt.body.scopeRoot, `${receipt.body.scopeRoot}-moved`); fs.symlinkSync(`${receipt.body.scopeRoot}-moved`, receipt.body.scopeRoot); }
    if (kind === 'target') fs.writeFileSync(path.join(f.targetRoot, 'AGENTS.md'), 'User changed');
    if (kind === 'state') { fs.mkdirSync(path.join(f.targetRoot, '.agent-kit'), {recursive: true}); fs.writeFileSync(path.join(f.targetRoot, '.agent-kit/state.json'), '{}'); }
    if (kind === 'binding') options = {bindings: {workspace: {...f.binding, targetRoot: path.join(f.root, 'other')}}};
    if (kind === 'definition') fs.appendFileSync(path.join(f.options.definitionsDir, 'codex.yaml'), '\n# changed\n');
    if (kind === 'digest') prepared.receiptDigest = '0'.repeat(64);
    assert.throws(() => f.restart(options).apply(f.applyRequest(prepared)), undefined, kind);
    assert.equal(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/SKILL.md')), false, kind);
  }
});

test('bounded local policy disallows unknown binding, remote path/command, preview or desktop and unapproved MCP recipes', t => {
  const f = fixture(t, {mcp: true}), bundle = f.create();
  const request = {bindingId: 'workspace', bundleBytes: bundle.bytes, sha256: bundle.sha256};
  assert.throws(() => f.restart().prepare({...request, targetRoot: f.root}), {code: 'INVALID_BUNDLE_REQUEST'});
  assert.throws(() => f.restart().prepare({...request, bindingId: 'missing'}), {code: 'BUNDLE_BINDING_NOT_FOUND'});
  assert.throws(() => f.restart({bindings: {workspace: {...f.binding, allowedMcpDigests: []}}}).prepare(request), {code: 'BUNDLE_MCP_POLICY_DENIED'});
  for (const target of [{clientId: 'codex', surface: 'desktop'}, {clientId: 'codex', surface: 'cli', previewOptIn: true}]) {
    assert.throws(() => f.restart({bindings: {workspace: {...f.binding, targets: [target]}}}));
  }
  const service = f.restart({bindings: {workspace: {...f.binding, targets: [{clientId: 'codex', surface: 'cli', clientVersion: 'unknown'}]}}});
  const blocked = service.prepare(request);
  assert.equal(blocked.phase, 'blocked'); assert.equal(blocked.receiptId, undefined);
  assert.equal(fs.existsSync(path.join(f.options.workRoot, 'receipts')), false);
});

test('executor rejects redirected private stores and target bindings before staging or writes', t => {
  for (const name of ['receipts', '.deployment-plans']) {
    const f = fixture(t);
    fs.mkdirSync(f.options.workRoot, {mode: 0o700});
    fs.symlinkSync(f.targetRoot, path.join(f.options.workRoot, name));
    assert.throws(() => f.restart(), {code: 'UNSAFE_BUNDLE_PATH'});
    assert.deepEqual(fs.readdirSync(f.targetRoot), []);
  }
  const f = fixture(t), prepared = f.prepare();
  fs.renameSync(f.targetRoot, `${f.targetRoot}-moved`);
  fs.symlinkSync(`${f.targetRoot}-moved`, f.targetRoot);
  assert.throws(() => f.restart().apply(f.applyRequest(prepared)), {code: 'INVALID_BUNDLE_EXECUTOR_CONFIG'});
});

test('expired, claimed and interrupted preparations never blindly replay, but committed inner receipts reconcile', t => {
  for (const kind of ['expired', 'claimed', 'running', 'committed']) {
    const f = fixture(t), prepared = f.prepare(f.restart({clock: () => 1000, ttlMs: 10}));
    const record = f.readReceipt(prepared), file = path.join(f.options.workRoot, 'receipts', `${prepared.receiptId}.json`);
    if (kind === 'claimed') fs.writeFileSync(`${file}.claim`, 'claimed');
    if (kind === 'running') { record.status = 'running'; fs.writeFileSync(file, JSON.stringify(record)); }
    if (kind === 'committed') {
      const first = f.restart({clock: () => 1001}).apply(f.applyRequest(prepared));
      record.status = 'running'; delete record.result; fs.writeFileSync(file, JSON.stringify(record));
      const recovered = f.restart({clock: () => 2000}).apply(f.applyRequest(prepared));
      assert.equal(recovered.transactionId, first.transactionId);
    } else assert.throws(() => f.restart({clock: () => kind === 'expired' ? 1011 : 1001}).apply(f.applyRequest(prepared)));
  }
});

test('CLI export and fixed helper work across actual processes with strict input and sanitized errors', {skip: !process.getuid || process.getuid() === 0}, t => {
  const f = fixture(t, {mcp: true, agent: true}), output = path.join(f.root, 'bundle.json');
  const command = ['bin/cli.js', 'bundle', '--manifest', f.manifestPath, '--bundle-id', 'review-resources', '--bundle-version', '1', '--out', output];
  const exported = spawnSync(process.execPath, command, {cwd: repositoryRoot, encoding: 'utf8'});
  assert.equal(exported.status, 0, exported.stderr);
  const metadata = JSON.parse(exported.stdout);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.equal(spawnSync(process.execPath, command, {cwd: repositoryRoot}).status, 1); // No overwrite.
  f.writeConfig();
  const prepared = f.helper({schemaVersion: 1, operation: 'prepare', bindingId: 'workspace', sha256: metadata.sha256, bundleBase64: fs.readFileSync(output).toString('base64')});
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const applied = f.helper({schemaVersion: 1, operation: 'apply', ...f.applyRequest(prepared.result)});
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.result.phase, 'files-applied');
  assert.deepEqual(f.helper({schemaVersion: 1, operation: 'apply', ...f.applyRequest(prepared.result)}).result, applied.result);
  for (const bad of [
    {schemaVersion: 1, operation: 'exec', command: 'not-allowed'},
    {schemaVersion: 1, operation: 'prepare', url: 'https://example.invalid/bundle'},
    {schemaVersion: 1, operation: 'apply', ...f.applyRequest(prepared.result), targetRoot: f.root}
  ]) { const response = f.helper(bad); assert.equal(response.ok, false); assert.doesNotMatch(JSON.stringify(response), new RegExp(f.root)); }
  fs.chmodSync(f.configPath, 0o644);
  assert.equal(f.helper({schemaVersion: 1, operation: 'apply', ...f.applyRequest(prepared.result)}).code, 'UNSAFE_BUNDLE_EXECUTOR_CONFIG');
});

test('actual SIGKILL requires reviewed rollback for incomplete writes and reconciles committed bundle without replay', t => {
  for (const stage of ['mutation', 'finalized']) {
    const f = fixture(t), target = path.join(f.targetRoot, 'AGENTS.md');
    fs.writeFileSync(target, 'Original user text\n');
    const prepared = f.prepare(), request = f.applyRequest(prepared), config = path.join(f.root, 'crash.json');
    fs.writeFileSync(config, JSON.stringify({options: f.options, request, stage, crashTarget: target}));
    const child = spawnSync(process.execPath, ['test/helpers/crash-bundle-deployment.js', config], {cwd: repositoryRoot, encoding: 'utf8'});
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    if (stage === 'mutation') {
      assert.throws(() => f.restart().apply(request));
      const recovery = createManifestDeploymentService({...f.options, planStoreRoot: path.join(f.options.workRoot, '.deployment-plans')});
      const plan = recovery.planRecovery({scope: 'project', targetRoot: f.targetRoot});
      assert.equal(plan.outcome, 'restore-original');
      recovery.recover({planId: plan.planId});
      assert.equal(fs.readFileSync(target, 'utf8'), 'Original user text\n');
      assert.throws(() => f.restart().apply(request));
    } else {
      const recovered = f.restart().apply(request);
      assert.equal(recovered.phase, 'files-applied');
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetRoot, '.agent-kit/state.json'))).transactions.length, 1);
    }
  }
});

test('bundle runtime gate rechecks the reviewed executable at apply', t => {
  const f = fixture(t), definitionsDir = path.join(repositoryRoot, 'clients');
  const definitions = loadClientDefinitions({definitionsDir});
  if (process.platform !== 'darwin' || process.arch !== 'arm64') { t.skip('Shipped evidence is darwin arm64'); return; }
  const bindings = {workspace: {...f.binding, targets: [{clientId: 'codex', surface: 'cli'}]}};
  const record = definitions.get('codex').surfaces.find(surface => surface.id === 'cli').runtimeEvidence[0];
  let observed = {binaryPath: '/test/verified-codex', sha256: record.binarySha256};
  const options = {definitionsDir, bindings, binaryObserver: () => observed};
  const prepared = f.prepare(f.restart(options)); assert.equal(prepared.phase, 'prepared');
  observed = {...observed, sha256: '0'.repeat(64)};
  assert.throws(() => f.restart(options).apply(f.applyRequest(prepared)));
  assert.equal(fs.existsSync(path.join(f.targetRoot, 'AGENTS.md')), false);
});

test('installed reviewed binaries gate fixed-helper deployments for both CLI project profiles and global Skills', {skip: !process.getuid || process.getuid() === 0}, t => {
  const definitionsDir = path.join(repositoryRoot, 'clients');
  const definitions = loadClientDefinitions({definitionsDir});
  for (const clientId of ['codex', 'antigravity']) {
    const profile = definitions.get(clientId).surfaces.find(surface => surface.id === 'cli');
    const observed = observeClientBinary(profile);
    if (!observed || !profile.runtimeEvidence.some(record => record.binarySha256 === observed.sha256 && record.platform === process.platform && record.arch === process.arch)) {
      t.skip('Reviewed native CLI binary unavailable on this test host'); return;
    }
  }
  for (const scope of ['project', 'global']) {
    const f = fixture(t, {scope, mcp: scope === 'project', agent: scope === 'project'}), bundle = f.create();
    const bindings = {workspace: {...f.binding, targets: ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli'}))}};
    f.writeConfig({definitionsDir, bindings});
    const prepared = f.helper({schemaVersion: 1, operation: 'prepare', bindingId: 'workspace', sha256: bundle.sha256, bundleBase64: bundle.bytes.toString('base64')});
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(prepared.result.phase, 'prepared', JSON.stringify(prepared.result.plan?.blocked));
    for (const profile of prepared.result.plan.targetProfiles) assert.equal(profile.versionSource, 'binary-sha256');
    const applied = f.helper({schemaVersion: 1, operation: 'apply', ...f.applyRequest(prepared.result)});
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.result.phase, 'files-applied');
    if (scope === 'project') {
      for (const file of ['.codex/config.toml', '.agents/mcp_config.json', '.codex/agents/inspector.toml', 'AGENTS.md']) assert.ok(fs.existsSync(path.join(f.targetRoot, file)), file);
    }
    assert.ok(fs.existsSync(path.join(f.targetRoot, '.agents/skills/review/guide.txt')));
  }
});
