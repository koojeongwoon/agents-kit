import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {createResourceImportService} from '../lib/application/resource-import-service.js';
import {mergeSourceFile} from '../lib/domain/source-merge.js';
import {planKitSourceRecovery, applyKitSourceRecovery} from '../lib/infrastructure/kit-source-transaction.js';
import {discoverAndLoadManifest} from '../lib/infrastructure/manifest-loader.js';
import {sourceHash} from '../lib/infrastructure/kit-source-transaction.js';
import {sourceInventory} from '../lib/infrastructure/kit-source-snapshot.js';

const definitionsDir = path.resolve('clients');
const write = (file, bytes, mode = 0o644) => {fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes); fs.chmodSync(file, mode);};
const code = value => error => error.code === value;
function fixture(t, {kind = 'skills', clientId = 'codex', text = 'alpha\nbase\nomega\n', onPhase, upstreamReader, extras = {}} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-revisions-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), scopeRoot = path.join(root, 'kit');
  const original = path.join(homeDir, kind === 'skills' ? '.agents/skills/review/SKILL.md' : kind === 'instructions' ? '.codex/AGENTS.md'
    : kind === 'agents' ? '.codex/agents/review.toml' : clientId === 'codex' ? '.codex/config.toml' : '.gemini/config/mcp_config.json');
  write(original, text);
  for (const [name, value] of Object.entries(extras)) write(path.join(path.dirname(original), name), value);
  const manifestPath = path.join(scopeRoot, 'agent-kit.yaml');
  write(manifestPath, 'schemaVersion: 1\nkit: {id: revisions}\nassets: {}\n');
  const service = createManifestDeploymentService({definitionsDir, homeDir, upstreamReader});
  const input = {scopeRoot, targetRoot: homeDir, scope: 'global', clientId, surface: clientId === 'codex' ? 'cli' : 'ide', assetId: 'review'};
  const item = service.localDiscovery().find(client => client.id === clientId).surfaces.find(surface => surface.id === input.surface).observations.find(item => item.kind === kind);
  service.applyImport({planId: service.planImport({...input, candidateId: item.candidateId}).planId});
  const subject = onPhase ? createResourceImportService({definitionsDir, homeDir, discover: query => service.localDiscovery(query), authorizeProject: () => {}, onPhase, upstreamReader}) : null;
  const planEdit = changes => (subject || service).planSourceEdit({...input, revision: service.source(input).revision, changes});
  const applyEdit = changes => {const plan = planEdit(changes); return subject ? subject.apply({kind: 'source-edit', planId: plan.planId}) : service.applySourceEdit({planId: plan.planId});};
  const doc = () => parse(fs.readFileSync(manifestPath, 'utf8'));
  return {root, homeDir, scopeRoot, original, manifestPath, service, input, subject, planEdit, applyEdit, doc,
    read: filePath => service.source(input).files.find(file => file.path === filePath)?.text};
}
const file = (text, mode = 0o644) => ({path: 'file', content: Buffer.from(text), mode});

test('pinned upstream connection, updates, deferred merges and rollback retain the original local installation binding', async t => {
  let incoming = 'alpha\nbase\nREMOTE\n', downloads = 0;
  const upstreamReader = async () => {
    downloads++;
    const files = [{path: 'SKILL.md', content: Buffer.from(incoming), mode: 0o644, sha256: sourceHash(incoming)}];
    const inventory = sourceInventory(files);
    return {files, inventory, fingerprint: sourceHash(JSON.stringify(inventory))};
  };
  const f = fixture(t, {upstreamReader}), originalRecord = f.doc().management.resources.review;
  const pinned = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit: 'a'.repeat(40), subpath: 'skills/review'};
  f.applyEdit([{path: 'SKILL.md', text: 'KIT\nbase\nomega\n'}]);
  const before = fs.readFileSync(f.manifestPath);
  assert.equal((await f.service.checkUpstream({...f.input, upstream: pinned})).status, 'changed');
  const plan = await f.service.planRefresh({...f.input, upstream: pinned});
  assert.deepEqual(fs.readFileSync(f.manifestPath), before);
  const fetched = downloads;
  f.service.applyRefresh({planId: plan.planId});
  assert.equal(downloads, fetched, 'apply uses the reviewed immutable bytes without a second fetch');
  assert.equal(f.read('SKILL.md'), 'KIT\nbase\nREMOTE\n');
  assert.equal(f.doc().management.resources.review.schemaVersion, 3);
  assert.deepEqual(f.doc().management.resources.review.origin, originalRecord.origin);
  assert.deepEqual(f.service.source(f.input).upstream, pinned);
  const checkpoint = f.service.source(f.input).history.at(-1);
  assert.equal((await f.service.checkUpstream(f.input)).status, 'unchanged');
  const nextPin = {...pinned, commit: 'b'.repeat(40)};
  incoming = 'CONFLICT\nbase\nREMOTE\n';
  const conflict = await f.service.planRefresh({...f.input, upstream: nextPin});
  assert.equal(conflict.automatic, false);
  const partial = await f.service.planRefresh({...f.input, upstream: nextPin, reviewHash: conflict.reviewHash, resolutions: {'SKILL.md': {choice: 'defer'}}});
  f.service.applyRefresh({planId: partial.planId});
  assert.equal(f.read('SKILL.md'), 'KIT\nbase\nREMOTE\n');
  assert.deepEqual(f.service.source(f.input).upstream, nextPin);
  assert.equal((await f.service.checkUpstream(f.input)).status, 'changed');
  const state = f.service.source(f.input);
  f.service.applySourceRollback({planId: f.service.planSourceRollback({...f.input, revision: state.revision, checkpointId: checkpoint.id}).planId});
  assert.equal(f.read('SKILL.md'), 'KIT\nbase\nomega\n');
  assert.equal(f.service.source(f.input).upstream, null);
  assert.deepEqual(f.doc().management.resources.review.origin, originalRecord.origin);
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'alpha\nbase\nomega\n');
});

test('pin identity participates in conflict review; async failures and stale applies leave all local files intact', async t => {
  let offline = false;
  const f = fixture(t, {upstreamReader: async () => {
    if (offline) throw Object.assign(new Error('offline'), {code: 'UPSTREAM_UNAVAILABLE'});
    const content = Buffer.from('UPSTREAM\n'), files = [{path: 'SKILL.md', content, mode: 0o644, sha256: sourceHash(content)}];
    return {files, inventory: sourceInventory(files), fingerprint: sourceHash(content)};
  }});
  const pinned = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit: 'a'.repeat(40), subpath: 'skills/review'};
  f.applyEdit([{path: 'SKILL.md', text: 'KIT\n'}]);
  const conflict = await f.service.planRefresh({...f.input, upstream: pinned});
  await assert.rejects(f.service.planRefresh({...f.input, upstream: {...pinned, commit: 'b'.repeat(40)}, reviewHash: conflict.reviewHash,
    resolutions: {'SKILL.md': {choice: 'upstream'}}}), code('STALE_SOURCE_REVIEW'));
  const plan = await f.service.planRefresh({...f.input, upstream: pinned, reviewHash: conflict.reviewHash, resolutions: {'SKILL.md': {choice: 'upstream'}}});
  f.applyEdit([{path: 'SKILL.md', text: 'NEWER\n'}]);
  assert.throws(() => f.service.applyRefresh({planId: plan.planId}), code('STALE_SOURCE_MANAGEMENT_PLAN'));
  const before = fs.readFileSync(f.manifestPath); offline = true;
  assert.equal((await f.service.checkUpstream({...f.input, upstream: pinned})).status, 'unavailable');
  await assert.rejects(f.service.planRefresh({...f.input, upstream: pinned}), code('UPSTREAM_UNAVAILABLE'));
  assert.deepEqual(fs.readFileSync(f.manifestPath), before); assert.equal(f.read('SKILL.md'), 'NEWER\n');
});

test('same-byte pins are reviewed metadata changes, connection rollback restores the previous pin, and returning local is explicit', async t => {
  const f = fixture(t, {upstreamReader: async () => {
    const content = Buffer.from('alpha\nbase\nomega\n'), files = [{path: 'SKILL.md', content, mode: 0o644, sha256: sourceHash(content)}];
    return {files, inventory: sourceInventory(files), fingerprint: sourceHash(content)};
  }});
  const pinned = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit: 'a'.repeat(40), subpath: 'skills/review'};
  let plan = await f.service.planRefresh({...f.input, upstream: pinned});
  assert.equal(plan.source.upstream.commit, pinned.commit); f.service.applyRefresh({planId: plan.planId});
  plan = await f.service.planRefresh({...f.input, upstream: {...pinned, commit: 'b'.repeat(40)}});
  assert.notEqual(plan.operations[0].operation, 'SKIP'); f.service.applyRefresh({planId: plan.planId});
  let state = f.service.source(f.input);
  f.service.applySourceRollback({planId: f.service.planSourceRollback({...f.input, revision: state.revision, checkpointId: state.history.at(-1).id}).planId});
  assert.deepEqual(f.service.source(f.input).upstream, pinned);
  f.applyEdit([{path: 'SKILL.md', text: 'KIT\nbase\nomega\n'}]);
  assert.deepEqual(f.service.source(f.input).upstream, pinned, 'editing retains the pin and schema v3');
  plan = f.service.planRefresh({...f.input, upstream: null});
  f.service.applyRefresh({planId: plan.planId});
  state = f.service.source(f.input); assert.equal(state.upstream, null);
  assert.equal(f.read('SKILL.md'), 'KIT\nbase\nomega\n');
  const invalid = f.doc(); invalid.management.resources.review.upstream = pinned; invalid.management.resources.review.schemaVersion = 2;
  fs.writeFileSync(f.manifestPath, JSON.stringify(invalid));
  assert.throws(() => f.service.source(f.input), code('INVALID_RESOURCE_MANAGEMENT'));
});

test('a failed pinned refresh rolls back its files and connection in the existing source transaction', async t => {
  const f = fixture(t, {onPhase: phase => {if (phase === 'manifest') throw new Error('commit fault');}, upstreamReader: async () => {
    const content = Buffer.from('REMOTE\n'), files = [{path: 'SKILL.md', content, mode: 0o644, sha256: sourceHash(content)}];
    return {files, inventory: sourceInventory(files), fingerprint: sourceHash(content)};
  }});
  const pinned = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit: 'a'.repeat(40), subpath: 'skills/review'};
  const before = fs.readFileSync(f.manifestPath), plan = await f.subject.planRefresh({...f.input, upstream: pinned});
  assert.throws(() => f.subject.apply({kind: 'refresh', planId: plan.planId}), /commit fault/);
  assert.deepEqual(fs.readFileSync(f.manifestPath), before); assert.equal(f.service.source(f.input).upstream, null);
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'alpha\nbase\nomega\n');
});

test('three-way merge preserves both disjoint text/mode changes and rejects overlaps, deletions and binary ambiguity', () => {
  assert.equal(mergeSourceFile(file('a\nb\nc\n'), file('A\nb\nc\n', 0o755), file('a\nb\nC\n')).file.content.toString(), 'A\nb\nC\n');
  assert.equal(mergeSourceFile(file('a\n'), file('A\n'), file('other\n')).conflict, 'OVERLAPPING_CHANGES');
  assert.equal(mergeSourceFile(file('a\n'), undefined, file('A\n')).conflict, 'DELETE_MODIFY_OR_ADD_ADD');
  assert.equal(mergeSourceFile(file('a\n'), file('A\n'), file('a\n')).file.content.toString(), 'A\n');
  assert.equal(mergeSourceFile(file('a\n'), file('same\n'), file('same\n')).file.content.toString(), 'same\n');
  assert.equal(mergeSourceFile(file('\0base'), file('\0kit'), file('\0upstream')).conflict, 'BINARY_CONFLICT');
  assert.equal(mergeSourceFile(undefined, file('kit'), file('upstream')).conflict, 'DELETE_MODIFY_OR_ADD_ADD');
  for (let left = 0; left < 20; left++) for (let right = left + 1; right < 20; right++) {
    const b = Array.from({length: 20}, (_, index) => `${index}\n`), k = [...b], u = [...b], expected = [...b];
    k[left] = `kit-${left}\n`; u[right] = `upstream-${right}\n`; expected[left] = k[left]; expected[right] = u[right];
    assert.equal(mergeSourceFile(file(b.join('')), file(k.join('')), file(u.join(''))).file.content.toString(), expected.join(''));
  }
});

test('Kit editing is pure until apply, retains metadata/binary/modes and baseline, and restores a prior revision', t => {
  const f = fixture(t, {extras: {'icon.bin': Buffer.from([0, 1, 2, 255]), 'references/guide.md': '# Guide\n'}}), record = f.doc().management.resources.review;
  const baseline = fs.readFileSync(path.join(f.scopeRoot, record.baseline, 'SKILL.md'));
  const before = fs.readFileSync(f.manifestPath);
  const plan = f.planEdit([{path: 'SKILL.md', text: 'Kit customization\n'}, {path: 'agents/openai.yaml', text: 'interface:\n  display_name: Review\n'}, {path: 'scripts/run.sh', text: '#!/bin/sh\nexit 0\n', mode: 0o755}]);
  assert.deepEqual(plan.managementUpgrade, {from: 1, to: 2});
  assert.deepEqual(fs.readFileSync(f.manifestPath), before); assert.equal(fs.existsSync(path.join(f.scopeRoot, 'assets/revisions')), false);
  f.service.applySourceEdit({planId: plan.planId});
  assert.equal(f.doc().management.resources.review.schemaVersion, 2);
  assert.equal(f.read('SKILL.md'), 'Kit customization\n'); assert.equal(fs.readFileSync(f.original, 'utf8'), 'alpha\nbase\nomega\n');
  assert.deepEqual(fs.readFileSync(path.join(f.scopeRoot, record.baseline, 'SKILL.md')), baseline);
  assert.equal(f.service.source(f.input).files.find(file => file.path === 'scripts/run.sh').mode, 0o755);
  assert.deepEqual(fs.readFileSync(path.join(f.scopeRoot, f.doc().management.resources.review.source, 'icon.bin')), Buffer.from([0, 1, 2, 255]));
  const state = f.service.source(f.input), restored = f.service.planSourceRollback({...f.input, revision: state.revision, checkpointId: state.history[0].id});
  f.service.applySourceRollback({planId: restored.planId});
  assert.equal(f.read('SKILL.md'), 'alpha\nbase\nomega\n'); assert.equal(f.service.source(f.input).files.length, 3);
  assert.ok(fs.existsSync(path.join(f.scopeRoot, plan.operations.find(operation => operation.path?.endsWith('scripts/run.sh')).path)));
  assert.equal(f.service.source(f.input).history.length, 2);
});

test('refresh auto-merges disjoint edits, advances only the accepted baseline and can roll back both Kit/baseline', t => {
  const f = fixture(t);
  f.applyEdit([{path: 'SKILL.md', text: 'KIT\nbase\nomega\n'}]);
  const checkpointBeforeRefresh = f.service.source(f.input);
  write(f.original, 'alpha\nbase\nUPSTREAM\n');
  assert.equal(f.service.checkUpstream(f.input).status, 'changed');
  const before = fs.readFileSync(f.manifestPath);
  const plan = f.service.planRefresh(f.input); assert.equal(plan.automatic, true); assert.equal(plan.details[0].reason, 'MERGED');
  assert.deepEqual(fs.readFileSync(f.manifestPath), before);
  f.service.applyRefresh({planId: plan.planId});
  assert.equal(f.read('SKILL.md'), 'KIT\nbase\nUPSTREAM\n');
  const record = f.doc().management.resources.review;
  assert.equal(fs.readFileSync(path.join(f.scopeRoot, record.baseline, 'SKILL.md'), 'utf8'), 'alpha\nbase\nUPSTREAM\n');
  assert.equal(f.service.checkUpstream(f.input).status, 'unchanged');
  const state = f.service.source(f.input);
  const target = state.history.at(-1);
  f.service.applySourceRollback({planId: f.service.planSourceRollback({...f.input, revision: state.revision, checkpointId: target.id}).planId});
  assert.equal(f.read('SKILL.md'), 'KIT\nbase\nomega\n');
  assert.equal(f.doc().management.resources.review.baseline, checkpointBeforeRefresh.baseline);
  assert.equal(f.service.checkUpstream(f.input).status, 'changed');
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'alpha\nbase\nUPSTREAM\n');
  assert.equal(f.service.source(f.input).lastCheck, null);
});

test('conflicts block apply, partial acceptance preserves deferred B, and fresh review binds every resolution', t => {
  const f = fixture(t);
  f.applyEdit([{path: 'SKILL.md', text: 'KIT\nbase\nomega\n'}, {path: 'notes.md', text: 'local notes\n'}]);
  write(f.original, 'UPSTREAM\nbase\nomega\n'); write(path.join(path.dirname(f.original), 'new.md'), 'new upstream file\n');
  const conflict = f.service.planRefresh(f.input);
  assert.equal(conflict.automatic, false); assert.equal(conflict.details.find(item => item.path === 'SKILL.md').conflict, 'OVERLAPPING_CHANGES');
  assert.throws(() => f.service.applyRefresh({planId: conflict.planId}), code('SOURCE_MANAGEMENT_PLAN_BLOCKED'));
  const partial = f.service.planRefresh({...f.input, reviewHash: conflict.reviewHash, resolutions: {'SKILL.md': {choice: 'defer'}}});
  f.service.applyRefresh({planId: partial.planId});
  assert.equal(f.read('SKILL.md'), 'KIT\nbase\nomega\n'); assert.equal(f.read('new.md'), 'new upstream file\n'); assert.equal(f.read('notes.md'), 'local notes\n');
  const record = f.doc().management.resources.review;
  assert.equal(fs.readFileSync(path.join(f.scopeRoot, record.baseline, 'SKILL.md'), 'utf8'), 'alpha\nbase\nomega\n');
  assert.deepEqual(record.lastCheck.deferred, ['SKILL.md']); assert.equal(f.service.checkUpstream(f.input).status, 'changed');
  const review = f.service.planRefresh(f.input);
  write(f.original, 'NEWER\nbase\nomega\n');
  assert.throws(() => f.service.planRefresh({...f.input, reviewHash: review.reviewHash, resolutions: {'SKILL.md': {choice: 'upstream'}}}), code('STALE_SOURCE_REVIEW'));
  const fresh = f.service.planRefresh(f.input);
  const resolved = f.service.planRefresh({...f.input, reviewHash: fresh.reviewHash, resolutions: {'SKILL.md': {choice: 'manual', text: 'KIT and NEWER\nbase\nomega\n'}}});
  f.service.applyRefresh({planId: resolved.planId});
  assert.equal(f.read('SKILL.md'), 'KIT and NEWER\nbase\nomega\n'); assert.equal(f.service.checkUpstream(f.input).status, 'unchanged');
});

test('source and upstream changes after planning, unsafe edits and literal credentials never overwrite data', t => {
  const f = fixture(t), initial = f.service.source(f.input);
  const plan = f.planEdit([{path: 'SKILL.md', text: 'safe\n'}]);
  f.applyEdit([{path: 'SKILL.md', text: 'newer local\n'}]);
  assert.throws(() => f.service.applySourceEdit({planId: plan.planId}), code('STALE_SOURCE_MANAGEMENT_PLAN'));
  assert.throws(() => f.service.planSourceEdit({...f.input, revision: initial.revision, changes: [{path: 'SKILL.md', text: 'lost edit'}]}), code('STALE_SOURCE_REVISION'));
  for (const changes of [[{path: '../escape', text: 'x'}], [{path: 'SKILL.md', delete: true}], [{path: 'SKILL.md', text: 'API_TOKEN = "literal"'}], [{path: 'x', text: 'x'}, {path: 'x/file', text: 'nested'}]]) {
    assert.throws(() => f.planEdit(changes), error => ['INVALID_SOURCE_CHANGES', 'SOURCE_PRIMARY_FILE_REQUIRED', 'LITERAL_SECRET', 'INVALID_SOURCE_EDIT_PATH'].includes(error.code));
  }
  write(f.original, 'changed upstream\n'); const refresh = f.service.planRefresh(f.input);
  const resolved = f.service.planRefresh({...f.input, reviewHash: refresh.reviewHash, resolutions: {'SKILL.md': {choice: 'upstream'}}});
  write(f.original, 'even newer upstream\n');
  assert.throws(() => f.service.applyRefresh({planId: resolved.planId}), code('IMPORT_SOURCE_CHANGED'));
  assert.equal(f.read('SKILL.md'), 'newer local\n');
});

test('missing or newly external upstream leaves the editable Kit copy and baseline intact', t => {
  const f = fixture(t); fs.unlinkSync(f.original);
  assert.equal(f.service.checkUpstream(f.input).status, 'unavailable');
  assert.throws(() => f.service.planRefresh(f.input), code('IMPORT_SOURCE_UNSAFE'));
  f.applyEdit([{path: 'SKILL.md', text: 'still editable\n'}]); assert.equal(f.read('SKILL.md'), 'still editable\n');
});

test('all four native kinds edit without dropping options; JSON MCP merges separate fields and rejects sibling servers/secrets', t => {
  for (const [kind, text, replacement] of [['instructions', '# Original\n', '# Kit\n'], ['agents', 'model = "base"\ncustom = true\n', 'model = "kit"\ncustom = true\n'], ['mcpServers', '[mcp_servers.docs]\ncommand = "docs"\nargs = ["--base"]\n', '[mcp_servers.docs]\ncommand = "docs"\nargs = ["--kit"]\n']]) {
    const f = fixture(t, {kind, text}); const name = f.service.source(f.input).files[0].path;
    f.applyEdit([{path: name, text: replacement}]); assert.equal(f.read(name), replacement); assert.equal(fs.readFileSync(f.original, 'utf8'), text);
  }
  const original = JSON.stringify({mcpServers: {docs: {command: 'docs', custom: {kit: 0, upstream: 0}}}});
  const f = fixture(t, {kind: 'mcpServers', clientId: 'antigravity', text: original});
  const name = f.service.source(f.input).files[0].path;
  f.applyEdit([{path: name, text: JSON.stringify({mcpServers: {docs: {command: 'docs', custom: {kit: 1, upstream: 0}}}})}]);
  write(f.original, JSON.stringify({mcpServers: {docs: {command: 'docs', custom: {kit: 0, upstream: 2}}, unrelated: {env: {API_TOKEN: 'never-copy'}}}}));
  const refresh = f.service.planRefresh(f.input); assert.equal(refresh.automatic, true); f.service.applyRefresh({planId: refresh.planId});
  assert.deepEqual(JSON.parse(f.read(name)), {mcpServers: {docs: {command: 'docs', custom: {kit: 1, upstream: 2}}}});
  for (const selected of [{mcpServers: {docs: {headers: {Authorization: 'opaque'}}}}, {mcpServers: {docs: {command: 'docs'}, sibling: {command: 'other'}}}]) assert.throws(() => f.planEdit([{path: name, text: JSON.stringify(selected)}]), error => ['LITERAL_SECRET', 'NATIVE_MCP_IMPORT_UNSUPPORTED'].includes(error.code));
});

test('ordinary edit/refresh faults restore exact Manifest and preserve previous artifacts', t => {
  for (const phase of ['source', 'manifest']) {
    const f = fixture(t, {onPhase: value => {if (value === phase) throw new Error('fault');}});
    const before = fs.readFileSync(f.manifestPath);
    assert.throws(() => f.applyEdit([{path: 'SKILL.md', text: 'new content\n'}]), /fault/);
    assert.deepEqual(fs.readFileSync(f.manifestPath), before); assert.equal(f.read('SKILL.md'), 'alpha\nbase\nomega\n');
  }
});

test('an upstream change during refresh rolls back the new Kit tree, accepted baseline and checkpoint together', t => {
  let fixtureValue;
  const f = fixture(t, {onPhase: (phase, index) => {if (phase === 'source' && index === 0) write(fixtureValue.original, 'changed during apply\n');}});
  fixtureValue = f;
  write(f.original, 'first upstream update\n');
  const before = fs.readFileSync(f.manifestPath), plan = f.subject.planRefresh(f.input);
  assert.throws(() => f.subject.apply({kind: 'refresh', planId: plan.planId}), code('IMPORT_SOURCE_CHANGED'));
  assert.deepEqual(fs.readFileSync(f.manifestPath), before); assert.equal(f.read('SKILL.md'), 'alpha\nbase\nomega\n');
  for (const operation of plan.operations.filter(item => item.operation === 'CREATE_SOURCE')) assert.equal(fs.existsSync(path.join(f.scopeRoot, operation.path)), false);
  assert.equal(fs.readFileSync(f.original, 'utf8'), 'changed during apply\n');
});

test('a same-byte file created concurrently is never removed by transaction error cleanup', t => {
  let collision, fixtureValue;
  const f = fixture(t, {onPhase: phase => {if (phase === 'journal') write(path.join(fixtureValue.scopeRoot, collision), 'new Kit text\n');}});
  fixtureValue = f;
  const plan = f.planEdit([{path: 'SKILL.md', text: 'new Kit text\n'}]);
  collision = plan.operations.find(operation => operation.path?.startsWith('assets/revisions/')).path;
  const before = fs.readFileSync(f.manifestPath);
  assert.throws(() => f.subject.apply({kind: 'source-edit', planId: plan.planId}), error => error.code === 'EEXIST');
  assert.equal(fs.readFileSync(path.join(f.scopeRoot, collision), 'utf8'), 'new Kit text\n');
  assert.deepEqual(fs.readFileSync(f.manifestPath), before);
  assert.equal(fs.existsSync(path.join(f.scopeRoot, '.kit-sources/journal.json')), false);
});

test('upstream additions/deletions and binary conflicts are reviewed; identical repeated deferral is a no-op', t => {
  const f = fixture(t, {extras: {'remove.md': 'base\n', 'icon.bin': Buffer.from([0, 1])}});
  f.applyEdit([{path: 'remove.md', text: 'Kit change\n'}, {path: 'icon.bin', mode: 0o755}]);
  fs.unlinkSync(path.join(path.dirname(f.original), 'remove.md')); write(path.join(path.dirname(f.original), 'icon.bin'), Buffer.from([0, 2]));
  const first = f.service.planRefresh(f.input); assert.equal(first.automatic, false);
  const accepted = f.service.planRefresh({...f.input, reviewHash: first.reviewHash, resolutions: {'remove.md': {choice: 'defer'}}});
  f.service.applyRefresh({planId: accepted.planId});
  assert.equal(f.read('remove.md'), 'Kit change\n');
  assert.deepEqual(fs.readFileSync(path.join(f.scopeRoot, f.doc().management.resources.review.source, 'icon.bin')), Buffer.from([0, 2]));
  assert.equal(f.service.source(f.input).files.find(file => file.path === 'icon.bin').mode, 0o755);
  const again = f.service.planRefresh(f.input);
  const deferred = f.service.planRefresh({...f.input, reviewHash: again.reviewHash, resolutions: {'remove.md': {choice: 'defer'}}});
  assert.equal(deferred.operations[0].operation, 'SKIP');
  const deleted = f.service.planRefresh({...f.input, reviewHash: again.reviewHash, resolutions: {'remove.md': {choice: 'upstream'}}});
  f.service.applyRefresh({planId: deleted.planId}); assert.equal(f.read('remove.md'), undefined);
});

test('retained revisions reattach after an upstream change; unknown paths, changed baselines and checkpoints block overwrites', t => {
  const f = fixture(t); f.applyEdit([{path: 'SKILL.md', text: 'Kit customization\n'}]);
  const record = f.doc().management.resources.review;
  f.service.applyDetach({planId: f.service.planDetach(f.input).planId}); write(f.original, 'upstream changed\n');
  const observed = f.service.localDiscovery().find(client => client.id === 'codex').observations.find(item => item.id === 'review');
  const reattach = f.service.planImport({...f.input, candidateId: observed.candidateId}); assert.equal(reattach.operations[0].operation, 'REATTACH_RETAINED_SOURCE');
  f.service.applyImport({planId: reattach.planId}); assert.equal(f.read('SKILL.md'), 'Kit customization\n'); assert.equal(f.service.checkUpstream(f.input).status, 'changed');
  const pending = f.planEdit([{path: 'SKILL.md', text: 'next edit\n'}]);
  const target = pending.operations.find(operation => operation.path?.startsWith('assets/revisions/')).path; write(path.join(f.scopeRoot, target), 'user file');
  assert.throws(() => f.service.applySourceEdit({planId: pending.planId}), code('IMPORT_SOURCE_COLLISION'));
  const source = f.service.source(f.input), checkpoint = source.history[0];
  fs.appendFileSync(path.join(f.scopeRoot, checkpoint.path), 'tamper');
  assert.throws(() => f.service.planSourceRollback({...f.input, revision: source.revision, checkpointId: checkpoint.id}), code('IMPORT_ARTIFACT_MODIFIED'));
  fs.appendFileSync(path.join(f.scopeRoot, record.baseline, 'SKILL.md'), 'tamper');
  assert.throws(() => f.service.source(f.input), code('IMPORT_ARTIFACT_MODIFIED'));
});

test('changed link bindings, Kit deployment targets and newly external managers cannot become upstream updates', t => {
  const f = fixture(t), originalDirectory = path.dirname(f.original), relocated = path.join(f.homeDir, 'source-review');
  fs.renameSync(originalDirectory, relocated); fs.symlinkSync(relocated, originalDirectory);
  assert.throws(() => f.service.checkUpstream(f.input), code('SOURCE_BINDING_CHANGED'));
  fs.unlinkSync(originalDirectory); fs.renameSync(relocated, originalDirectory);
  const statePath = path.join(f.homeDir, '.agents-kit/deployments/_global/state.json');
  write(statePath, JSON.stringify({schemaVersion: 4, managed: {[originalDirectory]: {resource: {kitId: 'revisions', assetId: 'review'}}}, transactions: []}));
  assert.throws(() => f.service.checkUpstream(f.input), code('SOURCE_UPSTREAM_KIT_MANAGED'));
  fs.unlinkSync(statePath);
  fs.renameSync(originalDirectory, relocated);
  const ego = path.join(f.homeDir, '.local/share/ego/ego-skills'); write(path.join(ego, 'SKILL.md'), 'API_TOKEN = "no-read"\n'); fs.symlinkSync(ego, originalDirectory);
  assert.throws(() => f.service.planRefresh(f.input), code('EXTERNAL_RESOURCE_READ_ONLY'));
  f.applyEdit([{path: 'SKILL.md', text: 'Kit copy remains editable\n'}]);
});

test('portable filenames and UTF-8 BOM/CRLF survive refresh without prototype or newline corruption', t => {
  const f = fixture(t, {text: '\uFEFFalpha\r\nbase\r\nomega\r\n', extras: {'constructor': 'old\n', ['__proto__']: 'old\n'}});
  assert.equal(f.read('SKILL.md'), '\uFEFFalpha\r\nbase\r\nomega\r\n');
  f.applyEdit([{path: 'SKILL.md', text: '\uFEFFKIT\r\nbase\r\nomega\r\n'}]);
  write(f.original, '\uFEFFalpha\r\nbase\r\nUPSTREAM\r\n');
  write(path.join(path.dirname(f.original), 'constructor'), 'new\n');
  const plan = f.service.planRefresh(f.input); assert.equal(plan.automatic, true); f.service.applyRefresh({planId: plan.planId});
  assert.equal(f.read('SKILL.md'), '\uFEFFKIT\r\nbase\r\nUPSTREAM\r\n'); assert.equal(f.read('constructor'), 'new\n');
});

test('record/journal v2 survive SIGKILL and reviewed recovery before and after revision commit', t => {
  for (const phase of ['source', 'manifest']) {
    const f = fixture(t), before = fs.readFileSync(f.manifestPath);
    const serviceUrl = new URL('../lib/application/resource-import-service.js', import.meta.url).href;
    const input = JSON.stringify(f.input);
    const script = `import {createResourceImportService} from ${JSON.stringify(serviceUrl)};const s=createResourceImportService({definitionsDir:${JSON.stringify(definitionsDir)},homeDir:${JSON.stringify(f.homeDir)},discover:()=>[],authorizeProject:()=>{},onPhase:p=>{if(p===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL')}});const i=${input};const p=s.planSourceEdit({...i,revision:s.source(i).revision,changes:[{path:'SKILL.md',text:'committed revision\\n'}]});s.apply({kind:'source-edit',planId:p.planId});`;
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script]).signal, 'SIGKILL');
    assert.throws(() => discoverAndLoadManifest({scopeRoot: f.scopeRoot}), code('SOURCE_MANAGEMENT_RECOVERY_REQUIRED'));
    const plan = planKitSourceRecovery(f.scopeRoot); assert.equal(plan.journal.schemaVersion, 2);
    applyKitSourceRecovery({scopeRoot: f.scopeRoot, plan});
    if (phase === 'source') assert.deepEqual(fs.readFileSync(f.manifestPath), before);
    else assert.equal(f.read('SKILL.md'), 'committed revision\n');
    assert.equal(fs.readFileSync(f.original, 'utf8'), 'alpha\nbase\nomega\n');
  }
});

test('recovery refuses a same-byte concurrent creation without its descriptor receipt', t => {
  const f = fixture(t), serviceUrl = new URL('../lib/application/resource-import-service.js', import.meta.url).href;
  const script = `import fs from 'node:fs';import path from 'node:path';import {createResourceImportService} from ${JSON.stringify(serviceUrl)};const i=${JSON.stringify(f.input)};const s=createResourceImportService({definitionsDir:${JSON.stringify(definitionsDir)},homeDir:${JSON.stringify(f.homeDir)},discover:()=>[],authorizeProject:()=>{},onPhase:phase=>{if(phase==='journal'){const journal=JSON.parse(fs.readFileSync(path.join(i.scopeRoot,'.kit-sources/journal.json')));const file=path.join(i.scopeRoot,journal.files[0].path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'new Kit text\\n');process.kill(process.pid,'SIGKILL');}}});const plan=s.planSourceEdit({...i,revision:s.source(i).revision,changes:[{path:'SKILL.md',text:'new Kit text\\n'}]});s.apply({kind:'source-edit',planId:plan.planId});`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script]).signal, 'SIGKILL');
  const journal = JSON.parse(fs.readFileSync(path.join(f.scopeRoot, '.kit-sources/journal.json')));
  assert.throws(() => planKitSourceRecovery(f.scopeRoot), code('SOURCE_MANAGEMENT_RECOVERY_CONFLICT'));
  assert.equal(fs.readFileSync(path.join(f.scopeRoot, journal.files[0].path), 'utf8'), 'new Kit text\n');
});
