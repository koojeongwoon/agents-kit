import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {recordedDeploymentLocators} from '../lib/application/deployment-locator-evidence.js';

test('explicit path migration moves four resources for both client adapters and scopes and restores both locations', t => {
  for (const clientId of ['codex', 'antigravity']) for (const scope of ['project', 'global']) {
    const f = resourcePathFixture(t, {clientId, scope}); f.changePaths();
    assert.equal(f.service.plan(f.input).automatic, false); const plan = f.migrate();
    assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); assert.equal(plan.migration, 'resource-path'); assert.equal(plan.pathMigrations.length, 4);
    assert.deepEqual(plan.stateUpgrade, {from: 4, to: 6});
    for (const file of Object.keys(f.managed)) assert.deepEqual(fs.readFileSync(file), f.bytes[file]);
    assert.equal(fs.existsSync(path.join(f.targetRoot, 'moved')), false);
    const result = f.service.apply({planId: plan.planId}), state = f.state(); assert.equal(state.transactions.at(-1).treeTransaction, true);
    const newTargets = Object.keys(state.managed); assert.ok(newTargets.every(file => file.startsWith(path.join(f.targetRoot, 'moved/'))));
    assert.ok(newTargets.every(file => recordedDeploymentLocators(state, file).length > 0));
    assert.match(fs.readFileSync(f.rules, 'utf8'), /User rules/); assert.doesNotMatch(fs.readFileSync(f.rules, 'utf8'), /Kit rules/);
    assert.doesNotMatch(fs.readFileSync(f.mcp, 'utf8'), /docs\.js/); assert.equal(fs.statSync(f.rules).mode & 0o777, 0o640);
    assert.ok(f.service.plan(f.input).operations.every(op => op.operation === 'SKIP'));
    f.service.rollback({planId: f.service.planRollback({...f.input, clientId, transactionId: result.transactionId}).planId});
    assert.deepEqual(f.state().managed, f.managed); for (const file of Object.keys(f.managed)) assert.deepEqual(fs.readFileSync(file), f.bytes[file]);
    assert.ok(newTargets.every(file => !fs.existsSync(file))); f.preserved();
  }
});

test('missing locator proof, modified owned content and unmanaged destinations block without changing either location', t => {
  for (const condition of ['missing-proof', 'owned-edit', 'unmanaged-target', 'unmanaged-target-link']) {
    const f = resourcePathFixture(t);
    if (condition === 'missing-proof') {const state = f.state(); for (const tx of state.transactions) for (const op of tx.operations) delete op.locators; fs.writeFileSync(f.statePath, JSON.stringify(state));}
    if (condition === 'owned-edit') fs.appendFileSync(Object.keys(f.managed).find(file => file.endsWith('reviewer.toml')), '# external edit\n');
    if (condition === 'unmanaged-target') {const file = path.join(f.targetRoot, 'moved/.codex/agents/reviewer.toml'); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, '# user owns this\n');}
    if (condition === 'unmanaged-target-link') {const destination = path.join(f.targetRoot, 'moved/.codex/agents/reviewer.toml'), keep = path.join(f.targetRoot, 'keep.toml'); fs.mkdirSync(path.dirname(destination), {recursive: true}); fs.writeFileSync(keep, '# keep user file\n'); fs.symlinkSync(keep, destination);}
    f.changePaths(); const stateBefore = fs.readFileSync(f.statePath), before = Object.fromEntries(Object.keys(f.managed).map(file => [file, fs.readFileSync(file)]));
    const plan = f.migrate(); assert.equal(plan.automatic, false); assert.throws(() => f.service.apply({planId: plan.planId}), {code: 'DEPLOYMENT_PLAN_BLOCKED'});
    assert.deepEqual(fs.readFileSync(f.statePath), stateBefore); for (const [file, content] of Object.entries(before)) assert.deepEqual(fs.readFileSync(file), content);
    if (condition === 'unmanaged-target-link') {assert.equal(fs.lstatSync(path.join(f.targetRoot, 'moved/.codex/agents/reviewer.toml')).isSymbolicLink(), true); assert.equal(fs.readFileSync(path.join(f.targetRoot, 'keep.toml'), 'utf8'), '# keep user file\n');}
    f.preserved();
  }
});

test('a stale source, definition or ownership snapshot stops path migration before either location changes', t => {
  for (const condition of ['source', 'definition', 'state']) {
    const f = resourcePathFixture(t); f.changePaths(); const plan = f.migrate(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
    if (condition === 'source') fs.appendFileSync(path.join(f.scopeRoot, 'rules.md'), '# changed after review\n');
    if (condition === 'definition') fs.appendFileSync(f.definitionPath, '# changed after review\n');
    if (condition === 'state') {const state = f.state(); state.transactions.push({id: 'tx-concurrent', type: 'observation', status: 'committed', operations: []}); fs.writeFileSync(f.statePath, JSON.stringify(state));}
    const stateBefore = fs.readFileSync(f.statePath);
    assert.throws(() => f.service.apply({planId: plan.planId}), {code: {source: 'STALE_SOURCE_REVISION', definition: 'STALE_DEPLOYMENT_PLAN', state: 'STALE_DEPLOYMENT_STATE'}[condition]});
    assert.deepEqual(fs.readFileSync(f.statePath), stateBefore); assert.equal(fs.existsSync(path.join(f.targetRoot, 'moved')), false);
    for (const file of Object.keys(f.managed)) assert.deepEqual(fs.readFileSync(file), f.bytes[file]); f.preserved();
  }
});

test('a shared Skill can move one consumer while the other retains its previous location and evidence', t => {
  const f = resourcePathFixture(t, {surfaces: ['cli', 'desktop']});
  f.changePaths({selectedSurfaces: ['cli'], kinds: ['skills-project']}); const plan = f.migrate(['review']);
  assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); const result = f.service.apply({planId: plan.planId});
  const old = path.join(f.targetRoot, '.agents/skills/review/SKILL.md'), next = path.join(f.targetRoot, 'moved/.agents/skills/review/SKILL.md');
  assert.deepEqual(f.state().managed[old].shared.consumers, ['path-migration:codex:desktop']);
  assert.deepEqual(f.state().managed[next].shared.consumers, ['path-migration:codex:cli']);
  assert.deepEqual(recordedDeploymentLocators(f.state(), old).map(l => l.surface), ['desktop']);
  assert.ok(f.service.plan(f.input).operations.every(op => op.operation === 'SKIP'));
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}).planId});
  assert.deepEqual(f.state().managed, f.managed); f.preserved();
});

test('joining an already managed Skill location preserves an unowned empty directory by blocking replacement', t => {
  const f = resourcePathFixture(t, {surfaces: ['cli', 'desktop']}); f.changePaths({selectedSurfaces: ['cli'], kinds: ['skills-project']});
  f.service.apply({planId: f.migrate(['review']).planId}); const personal = path.join(f.targetRoot, 'moved/.agents/skills/review/personal-empty'); fs.mkdirSync(personal);
  f.changePaths({kinds: ['skills-project']}); const plan = f.migrate(['review']); assert.equal(plan.automatic, false);
  assert.ok(plan.blocked.some(block => block.reason === 'UNKNOWN_EXISTING_CONTENT'), JSON.stringify(plan.blocked)); assert.equal(fs.statSync(personal).isDirectory(), true); f.preserved();
});

test('a remaining shared consumer can join an already migrated consumer without losing either locator', t => {
  const f = resourcePathFixture(t, {surfaces: ['cli', 'desktop']}); f.changePaths({selectedSurfaces: ['cli'], kinds: ['skills-project']});
  const first = f.service.apply({planId: f.migrate(['review']).planId});
  f.changePaths({kinds: ['skills-project']}); const plan = f.migrate(['review']); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
  assert.equal(plan.pathMigrations.length, 1); assert.equal(plan.pathMigrations[0].surface, 'desktop'); const second = f.service.apply({planId: plan.planId});
  const file = path.join(f.targetRoot, 'moved/.agents/skills/review/SKILL.md');
  assert.deepEqual(recordedDeploymentLocators(f.state(), file).map(l => l.surface), ['cli', 'desktop']); assert.ok(f.service.plan(f.input).operations.every(op => op.operation === 'SKIP'));
  for (const result of [second, first]) f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}).planId});
  assert.deepEqual(f.state().managed, f.managed); f.preserved();
});

test('physical Agent and MCP migration requires all recorded readers and preserves the store-wide ownership', t => {
  const f = resourcePathFixture(t, {surfaces: ['cli', 'desktop']}); f.changePaths({selectedSurfaces: ['cli'], kinds: ['agents-project', 'mcp-project']});
  const single = f.service.planMigration({scopeRoot: f.scopeRoot, targetRoot: f.targetRoot, scope: 'project', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test', migration: 'resource-path', assetIds: ['reviewer', 'docs']});
  assert.equal(single.automatic, false); assert.ok(single.blocked.some(b => b.reason === 'RESOURCE_PATH_ALL_READERS_REQUIRED'));
  f.changePaths({kinds: ['agents-project', 'mcp-project']}); const plan = f.migrate(['reviewer', 'docs']); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
  const result = f.service.apply({planId: plan.planId}), state = f.state(); assert.equal(state.schemaVersion, 7);
  const records = Object.entries(state.managed).filter(([file]) => file.includes('/moved/')).map(([, r]) => r);
  assert.equal(records.length, 2); assert.ok(records.every(r => r.physicalVersion === 1));
  assert.deepEqual(records.find(r => r.resource).resource.targets.map(r => r.surface).sort(), ['cli', 'desktop']);
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}).planId}); assert.deepEqual(f.state().managed, f.managed); f.preserved();
});

test('MCP selectors migrate separately while unselected servers and user settings remain in their original file', t => {
  const f = resourcePathFixture(t);
  f.raw.assets.mcpServers.push({...structuredClone(f.raw.assets.mcpServers[0]), id: 'other'}); f.write(); f.service.apply({planId: f.service.plan(f.input).planId}); const original = structuredClone(f.state().managed);
  f.changePaths({kinds: ['mcp-project']}); const first = f.service.apply({planId: f.migrate(['docs']).planId});
  const next = path.join(f.targetRoot, 'moved/.codex/config.toml');
  assert.match(fs.readFileSync(f.mcp, 'utf8'), /mcp_servers.other/); assert.doesNotMatch(fs.readFileSync(f.mcp, 'utf8'), /mcp_servers.docs/);
  assert.match(fs.readFileSync(f.mcp, 'utf8'), /User settings/); assert.deepEqual(recordedDeploymentLocators(f.state(), f.mcp).map(l => l.assetId), ['other']);
  assert.deepEqual(recordedDeploymentLocators(f.state(), next).map(l => l.assetId), ['docs']);
  const plan = f.migrate(['other']); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); const second = f.service.apply({planId: plan.planId});
  assert.deepEqual(recordedDeploymentLocators(f.state(), next).map(l => l.assetId), ['docs', 'other']); assert.ok(f.service.plan(f.input).operations.every(op => op.operation === 'SKIP'));
  for (const result of [second, first]) f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}).planId});
  assert.deepEqual(f.state().managed, original); f.preserved();
});

test('Skill directory and file modes survive relocation and failed validation restores every old resource', t => {
  const f = resourcePathFixture(t), oldRoot = path.join(f.targetRoot, '.agents/skills/review');
  const notes = path.join(oldRoot, 'user-notes.txt'); fs.writeFileSync(notes, '# Unowned notes\n'); const notesIdentity = fs.statSync(notes).ino;
  fs.chmodSync(oldRoot, 0o700); fs.chmodSync(path.join(oldRoot, 'references'), 0o750); fs.chmodSync(path.join(oldRoot, 'SKILL.md'), 0o600);
  f.changePaths(); const plan = f.migrate(); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
  assert.throws(() => f.service.apply({planId: plan.planId, validate: () => ({valid: false})}), {code: 'DEPLOYMENT_VALIDATION_FAILED'});
  assert.deepEqual(f.state().managed, f.managed); for (const file of Object.keys(f.managed)) assert.deepEqual(fs.readFileSync(file), f.bytes[file]);
  const result = f.service.apply({planId: f.migrate().planId}), nextRoot = path.join(f.targetRoot, 'moved/.agents/skills/review');
  assert.equal(fs.statSync(nextRoot).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(nextRoot, 'references')).mode & 0o777, 0o750); assert.equal(fs.statSync(path.join(nextRoot, 'SKILL.md')).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(notes, 'utf8'), '# Unowned notes\n'); assert.equal(fs.statSync(notes).ino, notesIdentity); assert.equal(fs.existsSync(path.join(nextRoot, 'user-notes.txt')), false);
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}).planId}); assert.equal(fs.statSync(path.join(oldRoot, 'SKILL.md')).mode & 0o777, 0o600); f.preserved();
});

test('an old Agent registration section requires separate review and cannot be orphaned by file relocation', t => {
  const f = resourcePathFixture(t); fs.appendFileSync(f.mcp, '\n[agents.reviewer]\nconfig_file = ".codex/agents/reviewer.toml"\n');
  const before = fs.readFileSync(f.mcp); f.changePaths({kinds: ['agents-project']}); const plan = f.migrate(['reviewer']);
  assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(b => b.reason === 'RESOURCE_PATH_LEGACY_AGENT_REGISTRATION'));
  assert.deepEqual(fs.readFileSync(f.mcp), before); f.preserved();
});

test('snapshot path migration keeps immutable targets and restores the original links without touching external links', t => {
  const f = resourcePathFixture(t, {skillStrategy: 'snapshot-link'}), old = path.join(f.targetRoot, '.agents/skills/review'), before = fs.readlinkSync(old);
  f.changePaths({kinds: ['skills-project']}); const plan = f.migrate(['review']); assert.equal(plan.automatic, true, JSON.stringify(plan.blocked));
  const result = f.service.apply({planId: plan.planId}), next = path.join(f.targetRoot, 'moved/.agents/skills/review');
  assert.equal(fs.existsSync(old), false); assert.equal(fs.readlinkSync(next), before); assert.equal(fs.existsSync(before), true);
  assert.equal(recordedDeploymentLocators(f.state(), next)[0].strategy, 'snapshot-link');
  f.service.rollback({planId: f.service.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}).planId});
  assert.equal(fs.readlinkSync(old), before); assert.equal(fs.existsSync(next), false); assert.deepEqual(f.state().managed, f.managed); f.preserved();
});

test('saved migration survives process restart and its rollback does not depend on current client path definitions', t => {
  const f = resourcePathFixture(t); f.changePaths(); const plan = f.migrate(), saved = f.service.savePlan({planId: plan.planId});
  assert.deepEqual(saved.pathMigrations, plan.pathMigrations);
  const restart = createManifestDeploymentService({homeDir: f.homeDir, definitionsDir: f.definitionsDir});
  const result = restart.resumeSavedPlan({planId: saved.planId, digest: saved.digest});
  assert.deepEqual(restart.resumeSavedPlan({planId: saved.planId, digest: saved.digest}), result);
  fs.appendFileSync(f.definitionPath, '# newer definitions during rollback\n');
  const rollback = restart.planRollback({...f.input, clientId: 'codex', transactionId: result.transactionId}); assert.equal(rollback.automatic, true, JSON.stringify(rollback.blocked));
  restart.rollback({planId: rollback.planId}); assert.deepEqual(f.state().managed, f.managed); f.preserved();
});

test('regular removal and its rollback manage the new locations, then migration rollback restores the original locations', t => {
  for (const options of [{clientId: 'codex', scope: 'project'}, {clientId: 'antigravity', scope: 'global'}]) {
    const f = resourcePathFixture(t, options); f.changePaths(); const migrated = f.service.apply({planId: f.migrate().planId}), afterMigration = structuredClone(f.state().managed);
    const removal = f.service.planRemoval({...f.input, assetIds: ['rules', 'review', 'reviewer', 'docs']}); assert.equal(removal.automatic, true, JSON.stringify(removal.blocked));
    assert.ok(removal.operations.every(op => op.target.includes('/moved/'))); const removed = f.service.apply({planId: removal.planId});
    f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: removed.transactionId}).planId}); assert.deepEqual(f.state().managed, afterMigration);
    f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: migrated.transactionId}).planId}); assert.deepEqual(f.state().managed, f.managed); f.preserved();
  }
});

test('interrupted migration rollback restores the applied result or keeps the fully restored original', t => {
  for (const phase of ['path-swapped', 'state-committed']) {
    const f = resourcePathFixture(t); f.changePaths(); const migrated = f.service.apply({planId: f.migrate().planId}), afterMigration = structuredClone(f.state().managed);
    const input = {homeDir: f.homeDir, definitionsDir: f.definitionsDir, request: {...f.input, transactionId: migrated.transactionId}, phase};
    const module = new URL('../lib/application/manifest-deployment-service.js', import.meta.url).href;
    const script = `import{createManifestDeploymentService}from ${JSON.stringify(module)};const i=${JSON.stringify(input)};const s=createManifestDeploymentService({homeDir:i.homeDir,definitionsDir:i.definitionsDir,onDeploymentPhase:p=>{if(p===i.phase)process.kill(process.pid,'SIGKILL')}});s.rollback({planId:s.planRollback(i.request).planId});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'}); assert.equal(child.signal, 'SIGKILL', child.stderr);
    const recovery = f.service.planRecovery(f.input); f.service.recover({planId: recovery.planId});
    assert.deepEqual(f.state().managed, phase === 'state-committed' ? f.managed : afterMigration);
    assert.equal(fs.existsSync(f.statePath + '.lock'), false); assert.equal(fs.existsSync(f.statePath + '.journal.json'), false); f.preserved();
  }
});

test('interrupted path migration restores both locations or keeps the fully committed result using stock recovery', t => {
  for (const phase of ['stage-ready', 'path-swapped', 'before-state', 'state-committed']) {
    const f = resourcePathFixture(t); f.changePaths();
    const input = {homeDir: f.homeDir, definitionsDir: f.definitionsDir, request: {...f.input, migration: 'resource-path', assetIds: ['rules', 'review', 'reviewer', 'docs']}, phase};
    const module = new URL('../lib/application/manifest-deployment-service.js', import.meta.url).href;
    const script = `import{createManifestDeploymentService}from ${JSON.stringify(module)};const i=${JSON.stringify(input)};const s=createManifestDeploymentService({homeDir:i.homeDir,definitionsDir:i.definitionsDir,onDeploymentPhase:p=>{if(p===i.phase)process.kill(process.pid,'SIGKILL')}});s.apply({planId:s.planMigration(i.request).planId});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'}); assert.equal(child.signal, 'SIGKILL', child.stderr);
    const recovery = f.service.planRecovery({...f.input, clientId: 'codex'}); assert.equal(recovery.automatic, true, JSON.stringify(recovery.blocked)); f.service.recover({planId: recovery.planId});
    if (phase === 'state-committed') assert.ok(Object.keys(f.state().managed).every(file => file.includes('/moved/')));
    else {assert.deepEqual(f.state().managed, f.managed); for (const [file, content] of Object.entries(f.bytes)) assert.deepEqual(fs.readFileSync(file), content);}
    assert.equal(fs.existsSync(f.statePath + '.lock'), false); assert.equal(fs.existsSync(f.statePath + '.journal.json'), false); f.preserved();
  }
});
