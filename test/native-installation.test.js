import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {removalDependencyBlocks} from '../lib/application/prepare-resource-removal.js';
import {nativeInstallationFixture as fixture} from './helpers/native-installation-fixture.js';
import {dependencyIndexFixture} from './helpers/dependency-index-fixture.js';

const write = (file, content, mode = 0o640) => {fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); fs.chmodSync(file, mode);};
const code = value => error => error.code === value;

test('registered global dependencies block native apply and ownership detach before changing existing files',t=>{
  const f=fixture(t,{scope:'global'});f.apply('adopt');const dependency=dependencyIndexFixture(t),state=JSON.parse(fs.readFileSync(f.statePath));state.schemaVersion=8;state.dependencyIndex=structuredClone(dependency.index);fs.writeFileSync(f.statePath,JSON.stringify(state));
  f.edit([{path:'SKILL.md',text:'# Updated desired Skill\n'}]);const before=fs.readFileSync(f.statePath),primary=fs.readFileSync(f.primary),mode=fs.statSync(f.primary).mode&0o777;
  for(const operation of ['apply','detach']){const plan=f.plan(operation);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.throws(()=>f.service.applyInstallation({planId:plan.planId}),{code:'DEPENDENCY_COORDINATOR_REQUIRED'});}
  assert.deepEqual(fs.readFileSync(f.statePath),before);assert.deepEqual(fs.readFileSync(f.primary),primary);assert.equal(fs.statSync(f.primary).mode&0o777,mode);dependency.global.preserved();dependency.project.preserved();
});


test('pinned source records remain compatible with separately planned native apply and rollback', async t => {
  const content = Buffer.from('# Git instructions\n'), sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const f = fixture(t, {kind: 'instructions', upstreamReader: async (_locator, record) => {
    const files = [{path: record.files[0].path, content, mode: 0o640, sha256}];
    return {files, inventory: files.map(({path, mode, sha256}) => ({path, mode, sha256})), fingerprint: sha256};
  }});
  f.apply('adopt');
  const newerState = JSON.parse(fs.readFileSync(f.statePath)); newerState.schemaVersion = 6; fs.writeFileSync(f.statePath, JSON.stringify(newerState));
  const upstream = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit: 'a'.repeat(40), subpath: 'AGENTS.md'};
  const refresh = await f.service.planRefresh({...f.input, upstream}); f.service.applyRefresh({planId: refresh.planId});
  assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
  const installed = f.apply('apply'); assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Git instructions\n');
  assert.equal(JSON.parse(fs.readFileSync(f.statePath)).schemaVersion, 6, 'native writes must preserve newer state semantics');
  const rollback = f.service.planRollback({...f.input, transactionId: installed.transactionId});
  f.service.rollback({planId: rollback.planId});
  assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
  assert.deepEqual(f.service.source(f.input).upstream, upstream); assert.equal(fs.statSync(f.primary).mode & 0o777, 0o640);
});

test('native adoption preserves bytes/modes; explicit apply and rollback preserve metadata, unknown files and links', t => {
  for (const scope of ['global', 'project']) for (const clientId of ['codex', 'antigravity']) {
    const f = fixture(t, {scope, clientId});
    write(path.join(f.target, 'user-notes.md'), '# Keep user data\n');
    fs.symlinkSync('user-notes.md', path.join(f.target, 'user-link'));
    const before = fs.statSync(f.primary), plan = f.plan('adopt');
    assert.equal(fs.existsSync(f.statePath), false); assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
    f.service.applyInstallation({planId: plan.planId});
    assert.equal(fs.statSync(f.primary).mtimeMs, before.mtimeMs); assert.equal(fs.statSync(f.primary).mode & 0o777, 0o640);
    assert.equal(JSON.parse(fs.readFileSync(f.statePath)).schemaVersion, 5);
    f.edit([{path: 'SKILL.md', text: '# Kit review\n'}, {path: 'scripts/run.sh', text: '#!/bin/sh\nexit 1\n', mode: 0o755}, {path: 'references/new.md', text: '# Added\n'}]);
    const applied = f.apply('apply');
    assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Kit review\n'); assert.equal(fs.statSync(path.join(f.target, 'scripts/run.sh')).mode & 0o777, 0o755);
    assert.equal(fs.readFileSync(path.join(f.target, 'user-notes.md'), 'utf8'), '# Keep user data\n'); assert.equal(fs.readlinkSync(path.join(f.target, 'user-link')), 'user-notes.md');
    const rollback = f.service.planRollback({...f.input, transactionId: applied.transactionId}); assert.equal(rollback.automatic, true, JSON.stringify(rollback.blocked));
    f.service.rollback({planId: rollback.planId});
    assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original); assert.equal(fs.statSync(path.join(f.target, 'scripts/run.sh')).mode & 0o777, 0o750);
    assert.equal(fs.existsSync(path.join(f.target, 'references/new.md')), false); assert.equal(fs.readlinkSync(path.join(f.target, 'user-link')), 'user-notes.md');
  }
});

test('instructions and Agent native copies update their owned files without introducing duplicate blocks', t => {
  for (const kind of ['instructions', 'agents']) for (const clientId of ['codex', 'antigravity']) {
    const f = fixture(t, {kind, clientId}); f.apply('adopt');
    const source = f.service.source(f.input).files[0];
    const desired = kind === 'instructions' ? '# Updated instructions\n' : source.text.replace('Original', 'Updated');
    f.edit([{path: source.path, text: desired}]); const applied = f.apply('apply');
    assert.equal(fs.readFileSync(f.primary, 'utf8'), desired); assert.doesNotMatch(fs.readFileSync(f.primary, 'utf8'), /agents-kit:.*start/);
    f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: applied.transactionId}).planId}); assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
  }
});

test('MCP reflection changes only the selected server, preserving unrelated settings, native bytes and credentials', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const f = fixture(t, {kind: 'mcpServers', clientId});
    f.apply('adopt'); const source = f.service.source(f.input).files[0];
    f.edit([{path: source.path, text: source.text.replace('--original', '--updated')}]);
    const before = fs.readFileSync(f.primary, 'utf8');
    const p = f.plan('apply'); assert.equal(p.automatic, true, JSON.stringify(p.blocked));
    assert.doesNotMatch(JSON.stringify(p), /existing-unmanaged-value/);
    const applied = f.service.applyInstallation({planId: p.planId});
    const after = fs.readFileSync(f.primary, 'utf8'); assert.match(after, /--updated/);
    if (clientId === 'codex') {assert.ok(after.startsWith('# User preamble\nmodel = "user-model"\n\n')); assert.ok(after.endsWith('[mcp_servers.other]\ncommand = "other"\n'));}
    else {assert.ok(after.startsWith('{\n  "theme": "user-theme",\n  "mcpServers": {\n    "review": ')); assert.ok(after.endsWith(',\n    "other": {"command":"other","env":{"API_TOKEN":"existing-unmanaged-value"}}\n  }\n}\n'));}
    f.service.rollback({planId: f.service.planRollback({...f.input, transactionId: applied.transactionId}).planId}); assert.equal(fs.readFileSync(f.primary, 'utf8'), before);
  }
});

test('native stdio option evidence supports logical aliases and retains env/timeouts without enabling unknown options',t=>{
  const initial='# User settings\nmodel = "keep"\n[mcp_servers.review]\ncommand = "docs"\nargs = ["--original"]\nenv_vars = ["DOCS_HOME"]\nstartup_timeout_sec = 15\n[mcp_servers.review.env]\nPATH_HINT = "/tmp/docs"\n[mcp_servers.other]\ncommand = "other"\n';
  const f=fixture(t,{kind:'mcpServers',assetId:'review-alias',initialText:initial});f.apply('adopt');
  const definitionPath=path.join(f.definitionsDir,'codex.yaml'),definition=parse(fs.readFileSync(definitionPath,'utf8'));
  definition.surfaces.find(s=>s.id==='cli').runtimeEvidence[0].resourceProfile='mcp-native-stdio-options-v1';fs.writeFileSync(definitionPath,stringify(definition));
  const source=f.service.source(f.input).files[0];f.edit([{path:source.path,text:source.text.replace('--original','--updated')}]);
  const applied=f.apply('apply');assert.match(fs.readFileSync(f.primary,'utf8'),/--updated/);assert.match(fs.readFileSync(f.primary,'utf8'),/env_vars = \["DOCS_HOME"\]/);assert.match(fs.readFileSync(f.primary,'utf8'),/startup_timeout_sec = 15/);
  f.service.rollback({planId:f.service.planRollback({...f.input,transactionId:applied.transactionId}).planId});assert.equal(fs.readFileSync(f.primary,'utf8'),initial);
  const edited=f.service.source(f.input).files[0];f.edit([{path:edited.path,text:edited.text.replace('startup_timeout_sec = 15','startup_timeout_sec = 15\ntool_timeout_sec = 20')}]);
  const blocked=f.plan('apply');assert.equal(blocked.automatic,false);assert.ok(blocked.blocked.some(item=>item.reason==='CLIENT_RESOURCE_PROFILE_UNVERIFIED'));assert.equal(fs.readFileSync(f.primary,'utf8'),initial);
});

test('basic native MCP aliases retain the original server name while the registry uses a stable logical ID',t=>{
  const f=fixture(t,{kind:'mcpServers',clientId:'antigravity',assetId:'docs-alias'});f.apply('adopt');
  const definitionPath=path.join(f.definitionsDir,'antigravity.yaml'),definition=parse(fs.readFileSync(definitionPath,'utf8'));
  definition.surfaces.find(s=>s.id==='cli').runtimeEvidence[0].resourceProfile='mcp-stdio-basic-v1';fs.writeFileSync(definitionPath,stringify(definition));
  const source=f.service.source(f.input).files[0];f.edit([{path:source.path,text:source.text.replace('--original','--updated')}]);
  const applied=f.apply('apply'),actual=JSON.parse(fs.readFileSync(f.primary,'utf8'));
  assert.deepEqual(actual.mcpServers.review.args,['--updated']);assert.equal(actual.mcpServers['docs-alias'],undefined);
  f.service.rollback({planId:f.service.planRollback({...f.input,transactionId:applied.transactionId}).planId});assert.equal(fs.readFileSync(f.primary,'utf8'),f.original);
});

test('unowned and externally modified settings are never overwritten by default; reviewed choices are state-bound', t => {
  const f = fixture(t); f.edit([{path: 'SKILL.md', text: '# Kit update\n'}]);
  assert.ok(f.plan('apply').blocked.some(item => item.reason === 'NATIVE_ADOPTION_REQUIRED')); f.apply('adopt');
  write(f.primary, '# External edit\n'); const conflict = f.plan('apply'); assert.equal(conflict.automatic, false);
  assert.ok(conflict.blocked.some(item => item.reason === 'NATIVE_INSTALLATION_MODIFIED_EXTERNALLY'));
  assert.throws(() => f.service.applyInstallation({planId: conflict.planId}), code('DEPLOYMENT_PLAN_BLOCKED'));
  const keep = f.plan('apply', {reviewHash: conflict.reviewHash, choices: {'SKILL.md': 'keep-installed'}}); f.service.applyInstallation({planId: keep.planId}); assert.equal(fs.readFileSync(f.primary, 'utf8'), '# External edit\n');
  assert.equal(f.service.installation(f.input).installedModified, true);
  const current = f.plan('apply');
  const reviewed = f.plan('apply', {reviewHash: current.reviewHash, choices: {'SKILL.md': 'use-kit'}});
  write(f.primary, '# Newer external edit\n'); assert.throws(() => f.service.applyInstallation({planId: reviewed.planId}), error => ['STALE_INSTALLATION_REVIEW', 'STALE_DEPLOYMENT_PLAN'].includes(error.code));
  assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Newer external edit\n');
});

test('links, unknown files, unsupported runtime evidence and deletion without review remain fail-closed', t => {
  const f = fixture(t, {verified: false}); f.apply('adopt');
  assert.equal(f.plan('apply').automatic, false);
  const g = fixture(t); g.apply('adopt'); g.edit([{path: 'scripts/run.sh', delete: true}]);
  assert.ok(g.plan('apply').blocked.some(item => item.reason === 'NATIVE_DELETION_REVIEW_REQUIRED'));
  g.apply('apply', {removeDeleted: true}); assert.equal(fs.existsSync(path.join(g.target, 'scripts/run.sh')), false);
  const h = fixture(t), moved = path.join(h.targetRoot, 'linked-review'); fs.renameSync(h.target, moved); fs.symlinkSync(moved, h.target);
  assert.throws(() => h.plan('adopt'), code('NATIVE_TARGET_LINK_PRESERVED')); assert.equal(fs.readlinkSync(h.target), moved);
});

test('installation ownership detach preserves content and permits Kit registration detach; failed validation restores exact originals', t => {
  const f = fixture(t); f.apply('adopt');
  assert.throws(() => f.service.planDetach(f.input), code('IMPORT_RESOURCE_DEPLOYED'));
  f.edit([{path: 'SKILL.md', text: '# Updated\n'}]); const p = f.plan('apply');
  assert.throws(() => f.service.applyInstallation({planId: p.planId, validate: () => ({valid: false})}), code('DEPLOYMENT_VALIDATION_FAILED'));
  assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
  f.apply('detach'); assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
  f.service.applyDetach({planId: f.service.planDetach(f.input).planId}); assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
});

test('installed edits merge into Kit through source revisions before a safe combined client apply', t => {
  const f = fixture(t, {initialText: 'alpha\nbase\nomega\n'}); f.apply('adopt');
  f.edit([{path: 'SKILL.md', text: 'KIT\nbase\nomega\n'}]); write(f.primary, 'alpha\nbase\nINSTALLED\n');
  assert.equal(f.plan('apply').automatic, false);
  const imported = f.plan('import-installed'); assert.equal(imported.automatic, true, JSON.stringify(imported.blocked));
  f.service.applyInstallation({planId: imported.planId});
  assert.equal(f.service.source(f.input).files.find(file => file.path === 'SKILL.md').text, 'KIT\nbase\nINSTALLED\n');
  assert.equal(fs.readFileSync(f.primary, 'utf8'), 'alpha\nbase\nINSTALLED\n');
  f.apply('apply'); assert.equal(fs.readFileSync(f.primary, 'utf8'), 'KIT\nbase\nINSTALLED\n');
  assert.equal(f.service.installation(f.input).installedModified, false);
});

test('installed/Kit overlap requires explicit merge choices and stale installed imports cannot change Kit', t => {
  const f = fixture(t); f.apply('adopt'); f.edit([{path: 'SKILL.md', text: '# Kit customization\n'}]); write(f.primary, '# Installed customization\n');
  const blocked = f.plan('import-installed'); assert.equal(blocked.automatic, false);
  const merged = f.plan('import-installed', {reviewHash: blocked.reviewHash, choices: {'SKILL.md': 'manual'}, manualTexts: {'SKILL.md': '# Kit + Installed customization\n'}});
  f.service.applyInstallation({planId: merged.planId}); assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Installed customization\n');
  const apply = f.plan('apply'); assert.equal(apply.automatic, false);
  const forced = f.plan('apply', {reviewHash: apply.reviewHash, choices: {'SKILL.md': 'use-kit'}});
  f.service.applyInstallation({planId: forced.planId}); assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Kit + Installed customization\n');
  write(f.primary, '# Another installed edit\n'); const incoming = f.plan('import-installed');
  const take = f.plan('import-installed', {reviewHash: incoming.reviewHash, choices: {'SKILL.md': 'keep-installed'}}); write(f.primary, '# Newer edit\n');
  assert.throws(() => f.service.applyInstallation({planId: take.planId}), code('STALE_INSTALLATION_REVIEW'));
  assert.equal(f.service.source(f.input).files.find(file => file.path === 'SKILL.md').text, '# Kit + Installed customization\n');
});

test('concurrent modifications during validation remain untouched and leave reviewed recovery evidence', t => {
  for (const valid of [false, true]) {
    const f = fixture(t); f.apply('adopt'); f.edit([{path: 'SKILL.md', text: '# Kit update\n'}]); const plan = f.plan('apply');
    assert.throws(() => f.service.applyInstallation({planId: plan.planId, validate: () => {write(f.primary, '# Concurrent user data\n'); return {valid};}}), code('NATIVE_DEPLOYMENT_RECOVERY_REQUIRED'));
    assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Concurrent user data\n'); assert.ok(fs.existsSync(`${f.statePath}.journal.json`)); assert.ok(fs.existsSync(`${f.statePath}.lock`));
  }
});

test('native rollback preserves concurrent user changes and retains recovery evidence instead of restoring over them', t => {
  for (const valid of [false, true]) {
    const f = fixture(t); f.apply('adopt'); f.edit([{path: 'SKILL.md', text: '# Kit update\n'}]); const applied = f.apply('apply');
    const rollback = f.service.planRollback({...f.input, transactionId: applied.transactionId}); assert.equal(rollback.automatic, true);
    assert.throws(() => f.service.rollback({planId: rollback.planId, validate: () => {write(f.primary, '# Concurrent user data\n'); return {valid};}}), code('NATIVE_DEPLOYMENT_RECOVERY_REQUIRED'));
    assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Concurrent user data\n'); assert.ok(fs.existsSync(`${f.statePath}.journal.json`)); assert.ok(fs.existsSync(`${f.statePath}.lock`));
  }
});

test('SIGKILL before/after native commit recovers bytes, executable modes and proven new files', t => {
  for (const phase of ['mutation', 'commit']) {
    const f = fixture(t); f.apply('adopt'); f.edit([{path: 'SKILL.md', text: '# Kit applied\n'}, {path: 'scripts/run.sh', text: '#!/bin/sh\nexit 1\n', mode: 0o755}, {path: 'new.md', text: 'new\n'}]);
    const serviceUrl = new URL('../lib/application/manifest-deployment-service.js', import.meta.url).href;
    const stateUrl = new URL('../lib/infrastructure/deployment-state-store.js', import.meta.url).href;
    const script = `import {createManifestDeploymentService} from ${JSON.stringify(serviceUrl)};import {DeploymentStateStore} from ${JSON.stringify(stateUrl)};const commit=DeploymentStateStore.prototype.commit;DeploymentStateStore.prototype.commit=function(state){const result=commit.call(this,state);if(${JSON.stringify(phase)}==='commit')process.kill(process.pid,'SIGKILL');return result;};const s=createManifestDeploymentService({definitionsDir:${JSON.stringify(f.definitionsDir)},homeDir:${JSON.stringify(f.homeDir)}});const p=s.planInstallation({...${JSON.stringify(f.input)},mode:'apply'});s.applyInstallation({planId:p.planId,validate:()=>{if(${JSON.stringify(phase)}==='mutation')process.kill(process.pid,'SIGKILL');return {valid:true};}});`;
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script]).signal, 'SIGKILL');
    const recovery = f.service.planRecovery(f.input); assert.equal(recovery.automatic, true);
    f.service.recover({planId: recovery.planId});
    assert.equal(fs.readFileSync(f.primary, 'utf8'), phase === 'commit' ? '# Kit applied\n' : f.original);
    assert.equal(fs.statSync(path.join(f.target, 'scripts/run.sh')).mode & 0o777, phase === 'commit' ? 0o755 : 0o750);
    assert.equal(fs.existsSync(path.join(f.target, 'new.md')), phase === 'commit');
  }
});

test('unchanged native sources do not reformat files and their state remains compatible with subsequent operations', t => {
  for (const kind of ['instructions', 'agents', 'mcpServers']) {
    const f = fixture(t, {kind, clientId: kind === 'mcpServers' ? 'antigravity' : 'codex'}); f.apply('adopt');
    const before = fs.readFileSync(f.primary), mtime = fs.statSync(f.primary).mtimeMs;
    f.apply('apply'); assert.deepEqual(fs.readFileSync(f.primary), before); assert.equal(fs.statSync(f.primary).mtimeMs, mtime);
    assert.equal(f.service.installation(f.input).adopted, true);
    const unchanged = f.apply('apply'); assert.equal(unchanged.unchanged, true);
    const state = JSON.parse(fs.readFileSync(f.statePath));
    assert.deepEqual(removalDependencyBlocks({state, operations: [], kitId: 'native-test', clientId: f.input.clientId, removedIds: ['unrelated']}), []);
  }
});

test('sensitive installed drift is redacted and cannot be overwritten through an ordinary file choice', t => {
  const f = fixture(t); f.apply('adopt'); f.edit([{path: 'SKILL.md', text: '# Kit\n'}]); write(f.primary, 'API_TOKEN = "do-not-display-or-remove"\n');
  const blocked = f.plan('apply'); assert.equal(blocked.automatic, false); assert.doesNotMatch(JSON.stringify(blocked), /do-not-display-or-remove/);
  assert.ok(blocked.blocked.some(item => item.reason === 'NATIVE_CREDENTIAL_CHANGE_REQUIRES_EXTERNAL_REVIEW'));
  const forced = f.plan('apply', {reviewHash: blocked.reviewHash, choices: {'SKILL.md': 'use-kit'}}); assert.equal(forced.automatic, false);
  assert.throws(() => f.service.applyInstallation({planId: forced.planId}), code('DEPLOYMENT_PLAN_BLOCKED'));
  assert.equal(fs.readFileSync(f.primary, 'utf8'), 'API_TOKEN = "do-not-display-or-remove"\n');
});

test('multiple native MCP owners preserve each other and unrelated edits, with metadata-only ownership release', t => {
  const f = fixture(t, {kind: 'mcpServers'}); f.apply('adopt');
  const other = f.service.localDiscovery({scope: 'project', projectPath: f.targetRoot}).find(client => client.id === 'codex').observations.find(item => item.id === 'other');
  f.service.applyImport({planId: f.service.planImport({...f.input, assetId: 'other', candidateId: other.candidateId}).planId});
  const adopt = f.service.planInstallation({...f.input, assetId: 'other', mode: 'adopt'}); assert.equal(adopt.automatic, true); f.service.applyInstallation({planId: adopt.planId});
  fs.writeFileSync(f.primary, fs.readFileSync(f.primary, 'utf8').replace('user-model', 'changed-user-model'));
  const source = f.service.source(f.input).files[0]; f.edit([{path: source.path, text: source.text.replace('--original', '--Kit')}]); f.apply('apply');
  assert.match(fs.readFileSync(f.primary, 'utf8'), /changed-user-model/); assert.match(fs.readFileSync(f.primary, 'utf8'), /mcp_servers.other/);
  f.apply('detach'); assert.equal(f.service.installation({...f.input, assetId: 'other'}).adopted, true); assert.match(fs.readFileSync(f.primary, 'utf8'), /--Kit/);
});

test('releasing one native MCP owner refreshes shared file metadata without writing unrelated external edits',t=>{
  const f=fixture(t,{kind:'mcpServers'});f.apply('adopt');
  const other=f.service.localDiscovery({scope:'project',projectPath:f.targetRoot}).find(c=>c.id==='codex').observations.find(o=>o.id==='other');
  f.service.applyImport({planId:f.service.planImport({...f.input,assetId:'other',candidateId:other.candidateId}).planId});
  f.service.applyInstallation({planId:f.service.planInstallation({...f.input,assetId:'other',mode:'adopt'}).planId});
  fs.writeFileSync(f.primary,fs.readFileSync(f.primary,'utf8').replace('user-model','external-choice'));
  const before=fs.statSync(f.primary).mtimeMs;f.apply('detach');
  const state=JSON.parse(fs.readFileSync(f.statePath,'utf8'));
  assert.equal(state.managed[f.primary].hash,crypto.createHash('sha256').update(fs.readFileSync(f.primary)).digest('hex'));
  assert.equal(fs.statSync(f.primary).mtimeMs,before);assert.equal(f.service.installation({...f.input,assetId:'other'}).adopted,true);
});

test('a removed owned MCP server can be explicitly restored without replacing other settings', t => {
  for (const clientId of ['codex', 'antigravity']) {
    const f = fixture(t, {kind: 'mcpServers', clientId}); f.apply('adopt');
    const rest = clientId === 'codex' ? '# User config\nmodel = "changed"\n[mcp_servers.other]\ncommand = "other"\n'
      : '{"theme":"changed","mcpServers":{"other":{"command":"other"}}}\n';
    fs.writeFileSync(f.primary, rest);
    const blocked = f.plan('apply'); assert.equal(blocked.automatic, false);
    const relative = f.service.source(f.input).files[0].path;
    const reviewed = f.plan('apply', {reviewHash: blocked.reviewHash, choices: {[relative]: 'use-kit'}}); assert.equal(reviewed.automatic, true, JSON.stringify(reviewed.blocked));
    f.service.applyInstallation({planId: reviewed.planId});
    const after = fs.readFileSync(f.primary, 'utf8'); assert.match(after, /--original/); assert.match(after, /other/); assert.match(after, /changed/);
  }
});

test('declared logical tool dependencies require a proven installed provider before native client writes', t => {
  const f = fixture(t), manifestPath = path.join(f.scopeRoot, 'agent-kit.yaml'), doc = parse(fs.readFileSync(manifestPath, 'utf8'));
  doc.assets.skills[0].requires = {tools: ['docs.search']};
  doc.assets.mcpServers = [{id: 'docs', scope: 'project', provides: {tools: ['docs.search']}, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'docs'}}];
  doc.defaults = {mcpBindings: {schemaVersion: 1, executables: {docs: {command: 'docs'}}}}; fs.writeFileSync(manifestPath, stringify(doc));
  f.apply('adopt'); const plan = f.plan('apply'); assert.equal(plan.automatic, false); assert.ok(plan.blocked.some(item => item.reason === 'NATIVE_DEPENDENCY_NOT_INSTALLED'));
  assert.throws(() => f.service.applyInstallation({planId: plan.planId}), code('DEPLOYMENT_PLAN_BLOCKED')); assert.equal(fs.readFileSync(f.primary, 'utf8'), f.original);
});

test('dependency proof checks the native provider unit after another MCP owner refreshes the file hash',t=>{
  const f=fixture(t,{kind:'mcpServers'});f.apply('adopt');
  const other=f.service.localDiscovery({scope:'project',projectPath:f.targetRoot}).find(c=>c.id==='codex').observations.find(o=>o.id==='other');
  f.service.applyImport({planId:f.service.planImport({...f.input,assetId:'other',candidateId:other.candidateId}).planId});
  f.service.applyInstallation({planId:f.service.planInstallation({...f.input,assetId:'other',mode:'adopt'}).planId});
  write(path.join(f.targetRoot,'.agents/skills/consumer/SKILL.md'),'# Consumer\n');
  const skill=f.service.localDiscovery({scope:'project',projectPath:f.targetRoot}).find(c=>c.id==='codex').observations.find(o=>o.id==='consumer');
  const input={...f.input,assetId:'consumer'};f.service.applyImport({planId:f.service.planImport({...input,candidateId:skill.candidateId}).planId});
  const manifestPath=path.join(f.scopeRoot,'agent-kit.yaml'),doc=parse(fs.readFileSync(manifestPath,'utf8'));
  doc.assets.mcpServers.find(a=>a.id==='review').provides={tools:['review.read']};doc.assets.skills.find(a=>a.id==='consumer').requires={tools:['review.read']};fs.writeFileSync(manifestPath,stringify(doc));
  const definitionPath=path.join(f.definitionsDir,'codex.yaml'),definition=parse(fs.readFileSync(definitionPath,'utf8')),profile=definition.surfaces.find(s=>s.id==='cli');profile.runtimeEvidence.push({...profile.runtimeEvidence[0],capabilityId:'skills-project'});fs.writeFileSync(definitionPath,stringify(definition));
  f.service.applyInstallation({planId:f.service.planInstallation({...input,mode:'adopt'}).planId});
  fs.writeFileSync(f.primary,fs.readFileSync(f.primary,'utf8').replace('command = "docs"','command = "external"'));
  f.service.applyInstallation({planId:f.service.planInstallation({...f.input,assetId:'other',mode:'detach'}).planId});
  const plan=f.service.planInstallation({...input,mode:'apply'});assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(item=>item.reason==='NATIVE_DEPENDENCY_TARGET_CHANGED'));
});

test('native resources recognize a proven physical-store provider and retain its reverse dependency protection', t => {
  const f = fixture(t), manifestPath = path.join(f.scopeRoot, 'agent-kit.yaml'), doc = parse(fs.readFileSync(manifestPath, 'utf8'));
  doc.assets.skills[0].requires = {tools: ['docs.search']};
  doc.assets.mcpServers = [{id: 'docs', scope: 'project', provides: {tools: ['docs.search']}, definition: {schemaVersion: 1, transport: 'stdio', executableId: 'docs'}}];
  doc.defaults = {mcpBindings: {schemaVersion: 1, executables: {docs: {command: 'docs'}}}};
  doc.targets = {codex: {assetIds: ['docs']}}; fs.writeFileSync(manifestPath, stringify(doc));
  writeProfileFixture({definitionsDir: f.definitionsDir, repositoryRoot: path.resolve('.'), capabilityIds: ['skills-project', 'mcp-project']});
  const input = {...f.input, clientId: undefined, targets: ['cli', 'desktop'].map(surface => ({clientId: 'codex', surface, clientVersion: '0.0.1-test'}))};
  const provider = f.service.plan(input); assert.equal(provider.automatic, true, JSON.stringify(provider.blocked)); f.service.apply({planId: provider.planId});
  f.apply('adopt'); f.edit([{path: 'SKILL.md', text: '# Updated consumer\n'}]);
  f.apply('apply'); assert.equal(fs.readFileSync(f.primary, 'utf8'), '# Updated consumer\n');
  assert.equal(JSON.parse(fs.readFileSync(f.statePath)).schemaVersion, 7);
  const removal = f.service.planRemoval({...f.input, assetIds: ['docs']}); assert.equal(removal.automatic, false); assert.ok(removal.blocked.some(item => item.reason === 'RESOURCE_STILL_REQUIRED'));
});
