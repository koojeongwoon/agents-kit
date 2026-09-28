import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {DeploymentStateStore} from '../lib/infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../lib/infrastructure/global-deployment-state-store.js';
import {FileTransaction} from '../lib/infrastructure/file-transaction.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
function fixture(t, scope = 'global') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'global-ledger-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'kit'), definitionsDir = path.join(root, 'definitions');
  fs.mkdirSync(homeDir); fs.mkdirSync(path.join(scopeRoot, 'review'), {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review changes.\n');
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review changes\n---\n\nReview evidence.\n');
  const raw = {schemaVersion: 1, kit: {id: 'migration'}, assets: {
    instructions: [{id: 'rules', scope, source: 'rules.md', definition: {schemaVersion: 1, format: 'markdown'}}],
    skills: [{id: 'review', scope, source: 'review', definition: {schemaVersion: 1, format: 'agent-skills'}}]
  }};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), stringify(raw)); write();
  for (const clientId of ['codex', 'antigravity']) writeProfileFixture({definitionsDir, repositoryRoot, clientId, capabilityIds: [`instructions-${scope}`, `skills-${scope}`]});
  const service = createManifestDeploymentService({definitionsDir, homeDir});
  const input = {scopeRoot, targetRoot: homeDir, scope, clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const globalStore = new GlobalDeploymentStateStore({homeDir});
  const store = scope === 'global' ? globalStore : new DeploymentStateStore({statePath: path.join(homeDir, '.agent-kit/state.json')});
  const plan = extra => service.plan({...input, ...extra});
  const apply = extra => service.apply({planId: plan(extra).planId});
  const migrate = (migration, extra) => service.planMigration({...input, migration, ...extra});
  return {root, homeDir, scopeRoot, definitionsDir, raw, write, service, input, globalStore, store, plan, apply, migrate};
}

function legacyLedger(f, clientId = 'codex', text = 'old bytes', previousText = 'user bytes') {
  const statePath = path.join(f.homeDir, '.agents-kit/deployments', clientId, 'state.json');
  const target = path.join(f.homeDir, `.${clientId}/owned.txt`), transactionId = `tx-old-${clientId}`;
  const backup = path.join(path.dirname(statePath), 'backups', transactionId, '0000.bak');
  fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, text);
  fs.mkdirSync(path.dirname(backup), {recursive: true}); fs.writeFileSync(backup, previousText);
  const record = {clientId, assetId: 'old', strategy: 'copy', ownership: 'file', hash: hash(text), transactionId};
  const state = {schemaVersion: 1, managed: {[target]: record}, transactions: [{id: transactionId, type: 'apply', status: 'committed', createdAt: '2026-09-26T00:00:00Z', clientIds: [clientId], operations: [{target, beforeHash: hash(previousText), afterHash: hash(text), previousManaged: null, backup: {kind: 'file', path: backup}}]}]};
  fs.writeFileSync(statePath, JSON.stringify(state));
  return {statePath, target, transactionId, backup, state};
}

function native(f) {
  for (const asset of Object.values(f.raw.assets).flat()) delete asset.definition;
  f.write(); const applied = f.apply();
  f.raw.assets.instructions[0].definition = {schemaVersion: 1, format: 'markdown'};
  f.raw.assets.skills[0].definition = {schemaVersion: 1, format: 'agent-skills'}; f.write();
  return applied;
}

test('fresh global multi-client deployment keeps client stores independent and preserves legacy user files', t => {
  const f = fixture(t);
  const legacySkill = path.join(f.homeDir, '.gemini/antigravity-cli/skills/review/SKILL.md');
  fs.mkdirSync(path.dirname(legacySkill), {recursive: true}); fs.writeFileSync(legacySkill, 'user-owned legacy skill');
  const batch = f.plan({clientId: undefined, targets: ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}))});
  assert.equal(batch.automatic, true, JSON.stringify(batch.blocked));
  assert.equal(batch.operations.length, 4);
  f.service.apply({planId: batch.planId});
  assert.equal(f.store.load().schemaVersion, 2);
  assert.ok(fs.existsSync(path.join(f.homeDir, '.agents/skills/review/SKILL.md')));
  assert.ok(fs.existsSync(path.join(f.homeDir, '.gemini/config/skills/review/SKILL.md')));
  fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'Changed.\n');
  const codex = f.plan();
  assert.equal(codex.automatic, true, JSON.stringify(codex.blocked));
  assert.equal(codex.operations.some(item => item.target.includes('.gemini')), false);
  f.service.apply({planId: codex.planId});
  assert.doesNotMatch(fs.readFileSync(path.join(f.homeDir, '.gemini/config/skills/review/SKILL.md'), 'utf8'), /Changed/);
  const remove = f.service.planRemoval({...f.input, assetIds: ['review']});
  f.service.apply({planId: remove.planId});
  assert.equal(fs.existsSync(path.join(f.homeDir, '.agents/skills/review/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(f.homeDir, '.gemini/config/skills/review/SKILL.md')), true);
  assert.equal(fs.readFileSync(legacySkill, 'utf8'), 'user-owned legacy skill');
});

test('Codex CLI and desktop register separate consumers on shared global paths and update together', t => {
  const f = fixture(t); f.apply(); f.apply({surface: 'desktop'});
  fs.appendFileSync(path.join(f.scopeRoot, 'rules.md'), 'New rule.\n');
  assert.equal(f.plan().automatic, false);
  const plan = f.plan({clientId: undefined, targets: ['cli', 'desktop'].map(surface => ({clientId: 'codex', surface, clientVersion: '0.0.1-test'}))});
  assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
  f.service.apply({planId: plan.planId});
  assert.throws(() => f.plan({clientId: undefined, targets: [{clientId: 'codex'}, {clientId: 'codex', surface: 'cli'}]}), {code: 'INVALID_DEPLOYMENT_TARGETS'});
});

test('explicit global migration retires old ledgers, copies backups and preserves historical rollback', t => {
  const f = fixture(t), old = legacyLedger(f), other = legacyLedger(f, 'antigravity');
  assert.throws(() => f.plan(), {code: 'GLOBAL_LEDGER_MIGRATION_REQUIRED'});
  const migration = f.migrate('global-ledger');
  assert.equal(migration.kind, 'migration'); assert.equal(migration.operations.length, 7);
  assert.equal(fs.existsSync(f.store.statePath), false);
  f.service.apply({planId: migration.planId});
  assert.equal(fs.readFileSync(old.target, 'utf8'), 'old bytes');
  assert.equal(fs.readFileSync(other.target, 'utf8'), 'old bytes');
  assert.throws(() => new DeploymentStateStore({statePath: old.statePath}).load(), {code: 'INVALID_DEPLOYMENT_STATE'});
  const imported = f.store.load().transactions.find(item => item.id === old.transactionId);
  assert.ok(imported.operations[0].backup.path.startsWith(f.store.backupsRoot));
  const rollback = f.service.planRollback({...f.input, transactionId: old.transactionId});
  assert.equal(rollback.automatic, true);
  f.service.rollback({planId: rollback.planId});
  assert.equal(fs.readFileSync(old.target, 'utf8'), 'user bytes');
  assert.equal(f.plan().automatic, true);
  assert.throws(() => f.migrate('global-ledger'), {code: 'GLOBAL_LEDGER_ALREADY_INITIALIZED'});
});

test('migration fails closed on conflicting ownership, altered backups and unsafe paths', t => {
  for (const kind of ['conflict', 'backup', 'outside', 'symlink']) {
    const f = fixture(t), old = legacyLedger(f);
    if (kind === 'conflict') { const other = legacyLedger(f, 'antigravity'); other.state.managed[old.target] = old.state.managed[old.target]; fs.writeFileSync(other.statePath, JSON.stringify(other.state)); }
    if (kind === 'backup') fs.writeFileSync(old.backup, 'corrupt');
    if (kind === 'outside') { old.state.managed[path.join(f.root, 'outside')] = Object.values(old.state.managed)[0]; fs.writeFileSync(old.statePath, JSON.stringify(old.state)); }
    if (kind === 'symlink') { const moved = `${old.backup}.moved`; fs.renameSync(old.backup, moved); fs.symlinkSync(moved, old.backup); }
    assert.throws(() => f.migrate('global-ledger'));
    assert.equal(fs.existsSync(f.store.statePath), false);
    assert.equal(fs.readFileSync(old.target, 'utf8'), 'old bytes');
  }
});

test('stale migration, held legacy lock and interrupted migration are rejected without mutations', t => {
  for (const kind of ['state', 'file', 'backup', 'new-ledger', 'lock', 'pending']) {
    const f = fixture(t), old = legacyLedger(f), migration = f.migrate('global-ledger');
    if (kind === 'state') fs.appendFileSync(old.statePath, '\n');
    if (kind === 'file') fs.appendFileSync(old.target, 'edit');
    if (kind === 'backup') fs.appendFileSync(old.backup, 'edit');
    if (kind === 'new-ledger') legacyLedger(f, 'antigravity');
    if (kind === 'lock') fs.writeFileSync(`${old.statePath}.lock`, 'busy');
    if (kind === 'pending') { fs.mkdirSync(path.dirname(f.globalStore.pendingPath), {recursive: true}); fs.writeFileSync(f.globalStore.pendingPath, 'pending'); }
    assert.throws(() => f.service.apply({planId: migration.planId}));
    assert.equal(fs.existsSync(f.store.statePath), false);
    assert.equal(JSON.parse(fs.readFileSync(old.statePath)).schemaVersion, 1);
    if (kind === 'pending') assert.throws(() => f.plan(), {code: 'GLOBAL_LEDGER_RECOVERY_REQUIRED'});
  }
});

test('migration validation and final state write failure restore legacy ledgers and archive writes', t => {
  for (const kind of ['validation', 'write']) {
    const f = fixture(t), old = legacyLedger(f), before = fs.readFileSync(old.statePath);
    const migration = f.migrate('global-ledger');
    const originalWrite = FileTransaction.prototype.write;
    if (kind === 'write') t.mock.method(FileTransaction.prototype, 'write', function(target, ...args) {
      if (target === f.store.statePath) throw new Error('injected write failure');
      return originalWrite.call(this, target, ...args);
    });
    assert.throws(() => f.service.apply({planId: migration.planId, ...(kind === 'validation' ? {validate: () => ({valid: false})} : {})}));
    t.mock.restoreAll();
    assert.deepEqual(fs.readFileSync(old.statePath), before);
    assert.equal(fs.existsSync(f.globalStore.pendingPath), false);
    assert.equal(fs.existsSync(f.store.statePath), false);
    assert.equal(fs.existsSync(`${old.statePath}.lock`), false);
    // Empty directories can remain; archived files must be restored/removed.
    assert.equal(fs.existsSync(path.join(f.store.backupsRoot, old.transactionId, '0000.bak')), false);
  }
});

test('legacy writers reappearing after migration block unified operations', t => {
  const f = fixture(t); legacyLedger(f);
  f.service.apply({planId: f.migrate('global-ledger').planId});
  const pending = f.plan(); legacyLedger(f, 'antigravity');
  assert.throws(() => f.service.apply({planId: pending.planId}), {code: 'GLOBAL_LEDGER_MIGRATION_REQUIRED'});
});

test('explicit native ownership conversion is metadata-only and rollback restores native ownership', t => {
  for (const scope of ['project', 'global']) {
    const f = fixture(t, scope); native(f);
    assert.equal(f.plan().automatic, false);
    const before = f.store.load();
    const migration = f.migrate('shared-ownership', {assetIds: ['rules', 'review']});
    assert.equal(migration.automatic, true, JSON.stringify(migration.blocked));
    assert.ok(migration.operations.every(item => item.operation === 'MIGRATE_OWNERSHIP' && item.metadataOnly));
    const result = f.service.apply({planId: migration.planId});
    assert.equal(f.plan().automatic, true);
    f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: result.transactionId}).planId});
    assert.deepEqual(f.store.load().managed, before.managed);
    assert.equal(f.plan().automatic, false);
  }
});

test('ownership migration refuses changed sources, changed files, incomplete bundles and unknown client ownership', t => {
  for (const kind of ['source', 'target', 'missing', 'client', 'history', 'partial-blocks']) {
    const f = fixture(t, 'project'); native(f);
    if (kind === 'source') fs.appendFileSync(path.join(f.scopeRoot, 'review/SKILL.md'), 'changed');
    if (kind === 'target') fs.appendFileSync(path.join(f.homeDir, '.agents/skills/review/SKILL.md'), 'changed');
    const state = f.store.load();
    if (kind === 'missing') { state.managed[path.join(f.homeDir, '.agents/skills/review/old.txt')] = {...Object.values(state.managed).find(item => item.assetId === 'review')}; }
    if (kind === 'client') for (const record of Object.values(state.managed)) record.clientId = 'other';
    if (kind === 'history') state.transactions = [];
    if (kind === 'partial-blocks') Object.values(state.managed).find(item => item.owners).owners.other = {units: {}};
    f.store.commit(state);
    const plan = f.migrate('shared-ownership', {assetIds: ['rules', 'review']});
    assert.equal(plan.automatic, false, kind);
    assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
  }
});

test('migration plans detect ledger or target changes and preserve native rollback after a failed conversion', t => {
  for (const kind of ['state', 'file', 'validation']) {
    const f = fixture(t, 'project'); native(f);
    const before = fs.readFileSync(f.store.statePath);
    const migration = f.migrate('shared-ownership', {assetIds: ['rules', 'review']});
    if (kind === 'state') { const state = f.store.load(); state.extra = true; f.store.commit(state); }
    if (kind === 'file') fs.appendFileSync(path.join(f.homeDir, 'AGENTS.md'), 'changed');
    assert.throws(() => f.service.apply({planId: migration.planId, ...(kind === 'validation' ? {validate: () => ({valid: false})} : {})}));
    assert.ok(Object.values(f.store.load().managed).every(record => !record.sharedVersion));
    if (kind === 'validation') assert.deepEqual(fs.readFileSync(f.store.statePath), before);
  }
});

test('unified native ownership cannot be silently taken over by another client', t => {
  const f = fixture(t, 'project'); native(f);
  for (const asset of Object.values(f.raw.assets).flat()) delete asset.definition;
  f.write();
  const plan = f.plan({clientId: 'antigravity'});
  assert.equal(plan.automatic, false);
  assert.ok(plan.blocked.every(item => item.reason === 'TARGET_OWNED_BY_OTHER_CLIENT'));
});

test('migration rechecks symlink authorization before writing any metadata', t => {
  const f = fixture(t), old = legacyLedger(f), migration = f.migrate('global-ledger');
  const original = path.dirname(old.target), moved = path.join(f.root, 'moved');
  fs.renameSync(original, moved); fs.symlinkSync(moved, original);
  assert.throws(() => f.service.apply({planId: migration.planId}), {code: 'DEPLOYMENT_TARGET_OUTSIDE_SCOPE'});
  assert.equal(JSON.parse(fs.readFileSync(old.statePath)).schemaVersion, 1);
  assert.equal(fs.existsSync(f.store.statePath), false);
});

test('public ownership migration consumers cannot mutate the prepared transfer', t => {
  const f = fixture(t, 'project'); native(f);
  const migration = f.migrate('shared-ownership', {assetIds: ['rules', 'review']});
  assert.throws(() => migration.operations[0].consumers.push('other:antigravity:cli'), TypeError);
  f.service.apply({planId: migration.planId});
  assert.ok(Object.values(f.store.load().managed).every(record => (record.shared?.consumers || record.owners.rules.consumers).length === 1));
});
