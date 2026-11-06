import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {createResourceBundle, validateResourceBundle} from '../lib/infrastructure/resource-bundle.js';
import {SkillSnapshotStore, prepareSkillSnapshot} from '../lib/infrastructure/skill-snapshot-store.js';
import {planSharedSkillConnection} from '../lib/domain/shared-skill-connection.js';
import {planClientDeployment} from '../lib/application/plan-client-deployment.js';
import {applyDeployment} from '../lib/application/apply-deployment.js';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';

const repositoryRoot = path.resolve('.');
function fixture(t, strategy = 'snapshot-link') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-connection-plan-')));
  t.after(() => {
    const visit = file => {const stat = fs.lstatSync(file); if (stat.isDirectory()) {fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) visit(path.join(file, name));}};
    visit(root); fs.rmSync(root, {recursive: true, force: true});
  });
  const scopeRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project'), homeDir = path.join(root, 'home'), definitionsDir = path.join(root, 'definitions');
  fs.mkdirSync(path.join(scopeRoot, 'review'), {recursive: true}); fs.mkdirSync(targetRoot); fs.mkdirSync(homeDir);
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review source\n---\n\nReview it.\n');
  const raw = {schemaVersion: 1, kit: {id: 'shared'}, assets: {skills: [{id: 'review', source: 'review', scope: 'project',
    definition: {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy}}}]}};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  for (const clientId of ['codex', 'antigravity']) writeProfileFixture({definitionsDir, repositoryRoot, clientId});
  const service = createManifestDeploymentService({definitionsDir, homeDir});
  const input = {scopeRoot, targetRoot, scope: 'project', targets: ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}))};
  const allowPreview = () => {
    for (const clientId of ['codex', 'antigravity']) {
      const file = path.join(definitionsDir, `${clientId}.yaml`), definition = parse(fs.readFileSync(file, 'utf8'));
      for (const capability of [...definition.capabilities, ...definition.surfaces.flatMap(surface => surface.capabilities || [])].filter(cap => cap.assetKind === 'skills')) capability.connectionStrategies = {schemaVersion: 1, strategies: ['snapshot-link']};
      fs.writeFileSync(file, stringify(definition));
    }
  };
  return {raw, write, scopeRoot, targetRoot, homeDir, definitionsDir, service, input, allowPreview};
}

test('snapshot-link planning coalesces consumers, exposes a descriptor/diff and creates no snapshot, client files or state', t => {
  const f = fixture(t); f.allowPreview();
  const plan = f.service.plan(f.input);
  assert.equal(plan.automatic, false);
  assert.ok(plan.blocked.some(item => item.reason === 'SNAPSHOT_LINK_EXECUTION_NOT_ENABLED'));
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].strategy, 'shared-snapshot');
  assert.equal(plan.operations[0].connection.strategy, 'snapshot-link');
  assert.equal(plan.operations[0].connection.snapshot.files[0].path, 'SKILL.md');
  assert.deepEqual(plan.operations[0].consumers, ['shared:antigravity:cli', 'shared:codex:cli']);
  assert.equal(fs.existsSync(path.join(f.homeDir, '.agents-kit/snapshots')), false);
  assert.deepEqual(fs.readdirSync(f.targetRoot), []);
  assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PREVIEW_ONLY'});
  assert.deepEqual(fs.readdirSync(f.targetRoot), []);
});

test('unsupported link strategies are never silently copied, while v2 copy keeps the existing shared deployment', t => {
  const f = fixture(t);
  const blocked = f.service.plan(f.input);
  assert.equal(blocked.automatic, false); assert.ok(blocked.blocked.some(item => item.reason === 'CLIENT_CONNECTION_STRATEGY_UNVERIFIED'));
  assert.equal(blocked.operations.some(item => item.strategy === 'shared'), false);
  f.raw.assets.skills[0].definition.deployment.strategy = 'copy'; f.write();
  const copy = f.service.plan(f.input); assert.equal(copy.automatic, true, JSON.stringify(copy.blocked));
  f.service.apply({planId: copy.planId});
  assert.equal(fs.lstatSync(path.join(f.targetRoot, '.agents/skills/review')).isDirectory(), true);
  assert.ok(f.service.plan(f.input).operations.every(item => item.operation === 'SKIP'));
});

test('same target with different explicit strategies conflicts; bundle v1 refuses the newer connection contract', t => {
  const f = fixture(t); f.allowPreview();
  f.raw.assets.skills[0].definition.deployment.overrides = [{clientId: 'antigravity', surface: 'cli', strategy: 'copy'}]; f.write();
  const plan = f.service.plan(f.input);
  assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'SHARED_CONNECTION_STRATEGY_CONFLICT'));
  assert.throws(() => createResourceBundle({manifestPath: path.join(f.scopeRoot, 'agent-kit.yaml'), resourceId: 'preview', version: 1}), {code: 'BUNDLE_COMMON_SOURCE_VERSION_UNSUPPORTED'});
  const newer = f.raw.assets.skills[0].definition;
  f.raw.assets.skills[0].definition = {schemaVersion: 1, format: 'agent-skills'}; f.write();
  const portable = createResourceBundle({manifestPath: path.join(f.scopeRoot, 'agent-kit.yaml'), resourceId: 'portable', version: 1});
  portable.bundle.manifest.assets.skills[0].definition = newer;
  assert.throws(() => validateResourceBundle(portable.bundle), {code: 'BUNDLE_COMMON_SOURCE_VERSION_UNSUPPORTED'});
});

test('CLI exposes the same snapshot descriptor as a blocked plan without making client or snapshot files', t => {
  const f = fixture(t), scoped = path.join(f.scopeRoot, 'projects/default'); fs.mkdirSync(scoped, {recursive: true});
  fs.renameSync(path.join(f.scopeRoot, 'agent-kit.yaml'), path.join(scoped, 'agent-kit.yaml'));
  fs.renameSync(path.join(f.scopeRoot, 'review'), path.join(scoped, 'review'));
  const args = ['bin/cli.js', 'apply', '--kit', f.scopeRoot, '--project', f.targetRoot, '--client', 'codex', '--surface', 'cli', '--client-version', '0.0.1-test'];
  const run = extra => spawnSync(process.execPath, [...args, ...extra], {cwd: repositoryRoot, encoding: 'utf8', env: {...process.env, HOME: f.homeDir}});
  const result = run(['--dry-run']); assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout); assert.equal(plan.automatic, false);
  assert.equal(plan.operations[0].connection.snapshot.kind, 'skill-tree');
  const blocked = run([]); assert.equal(blocked.status, 1); assert.match(blocked.stderr, /Preview operations cannot be applied/);
  assert.equal(fs.existsSync(path.join(f.homeDir, '.agents-kit/snapshots')), false); assert.deepEqual(fs.readdirSync(f.targetRoot), []);
});

test('existing versioned connections plan SKIP, coordinated updates and consumer release without modifying the link', t => {
  const f = fixture(t); f.allowPreview();
  const store = new SkillSnapshotStore({homeDir: f.homeDir}), prepared = prepareSkillSnapshot({source: path.join(f.scopeRoot, 'review'), authorizedRoot: f.scopeRoot, store});
  const published = store.publish(prepared), target = path.join(f.targetRoot, '.agents/skills/review'); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.symlinkSync(published.tree, target);
  const consumers = ['shared:antigravity:cli', 'shared:codex:cli'];
  const record = planSharedSkillConnection({kitId: 'shared', assetId: 'review', consumers, snapshot: prepared.descriptor, linkSource: published.tree, observed: null}).nextManaged;
  fs.mkdirSync(path.join(f.targetRoot, '.agent-kit')); const statePath = path.join(f.targetRoot, '.agent-kit/state.json');
  const state = {schemaVersion: 6, managed: {[target]: record}, transactions: []}; fs.writeFileSync(statePath, JSON.stringify(state));
  assert.equal(f.service.plan(f.input).operations[0].operation, 'SKIP');
  const release = f.service.planRemoval({...f.input, ...f.input.targets[0], assetIds: ['review']});
  assert.equal(release.operations[0].operation, 'RELEASE'); assert.deepEqual(release.operations[0].consumers, ['shared:antigravity:cli']);
  assert.equal(release.automatic, true, 'removing recorded ownership does not require promoting a new loading profile');
  fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'New reviewed revision\n');
  const single = f.service.plan({...f.input, targets: undefined, ...f.input.targets[0]});
  assert.ok(single.blocked.some(item => item.reason === 'SHARED_RESOURCE_UPDATE_REQUIRES_ALL_CONSUMERS'));
  assert.equal(f.service.plan(f.input).operations[0].operation, 'REPLACE_LINK');
  state.managed[target].shared.consumers = ['shared:antigravity:cli']; fs.writeFileSync(statePath, JSON.stringify(state));
  const last = f.service.planRemoval({...f.input, ...f.input.targets[1], assetIds: ['review']});
  assert.equal(last.operations[0].operation, 'REMOVE_LINK'); assert.deepEqual(last.operations[0].retainedSnapshots, [prepared.descriptor.treeDigest]);
  assert.equal(fs.readlinkSync(target), published.tree); assert.equal(store.inspect(prepared.descriptor).status, 'present');
  fs.unlinkSync(target); fs.symlinkSync('/external/ego-skills', target);
  assert.ok(f.service.plan(f.input).blocked.some(item => item.reason === 'OWNED_LINK_MODIFIED_EXTERNALLY'));
  assert.equal(fs.readlinkSync(target), '/external/ego-skills');
});

test('new source strategies use strict versioned declarations and reject ambiguous overrides', t => {
  const f = fixture(t);
  for (const deployment of [{schemaVersion: 2, strategy: 'snapshot-link'}, {schemaVersion: 1, strategy: 'link'},
    {schemaVersion: 1, strategy: 'snapshot-link', arbitraryPath: '/outside'},
    {schemaVersion: 1, strategy: 'copy', overrides: [{clientId: 'codex', strategy: 'copy'}, {clientId: 'codex', strategy: 'snapshot-link'}]}]) {
    f.raw.assets.skills[0].definition.deployment = deployment; f.write();
    assert.throws(() => f.service.plan(f.input), {code: 'INVALID_COMMON_SOURCE_DEFINITION'});
  }
});

test('a regular file or symlink in the target parents blocks the connection without touching that path', t => {
  const f = fixture(t); f.allowPreview(); const parent = path.join(f.targetRoot, '.agents'); fs.writeFileSync(parent, 'preserve this');
  let plan = f.service.plan(f.input); assert.equal(plan.automatic, false);
  assert.ok(plan.blocked.some(item => item.reason === 'DEPLOYMENT_TARGET_OUTSIDE_SCOPE')); assert.equal(fs.readFileSync(parent, 'utf8'), 'preserve this');
  fs.unlinkSync(parent); fs.symlinkSync(f.homeDir, parent);
  plan = f.service.plan(f.input); assert.ok(plan.blocked.some(item => item.reason === 'DEPLOYMENT_TARGET_OUTSIDE_SCOPE')); assert.equal(fs.readlinkSync(parent), f.homeDir);
});

test('a new common strategy cannot mask the existing imported-native deployment guard', t => {
  const f = fixture(t); f.allowPreview();
  const manifest = {...createAgentKitManifest(f.raw), management: {resources: {review: {status: 'active'}}}};
  const plan = planClientDeployment({manifest, definition: loadClientDefinitions({definitionsDir: f.definitionsDir}).get('codex'),
    surface: 'cli', clientVersion: '0.0.1-test', platform: process.platform, arch: process.arch, allowManual: true});
  assert.equal(plan.blocked[0].reason, 'IMPORTED_RESOURCE_DEPLOYMENT_NOT_ENABLED');
});

test('removing a preview flag cannot execute the unfinished connection strategy or open a state lock', () => {
  assert.throws(() => applyDeployment({plans: [{operations: [{strategy: 'shared-snapshot', previewOnly: false}], blocked: []}],
    stateStore: {withLock: () => assert.fail('must not open a lock')}, backupStore: {create: () => assert.fail('must not create a backup')}}), {code: 'SNAPSHOT_LINK_EXECUTION_NOT_ENABLED'});
});
