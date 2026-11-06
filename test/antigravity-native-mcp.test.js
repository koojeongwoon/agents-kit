import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';

function fixture(t, {wrapped = false, occupied = false, concurrentBaselineChange = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-agy-native-mcp-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const home = path.join(root, 'home'), scopeRoot = path.join(home, '.agents-kit/kit/global'), target = path.join(home, '.gemini/config/mcp_config.json');
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: native-mcp-test}\nassets: {}\n');
  const original = JSON.stringify({theme: 'keep', mcpServers: {canva: {command: 'npx', args: ['keep']}, tools: {url: 'https://example.com/legacy'},
    ...(occupied ? {'ca04-marker': {command: 'keep-existing'}} : {})}}, null, 3) + '\n';
  fs.writeFileSync(target, original, {mode: 0o600});
  const service = createManifestDeploymentService({definitionsDir: path.resolve('clients'), homeDir: home});
  for (const assetId of ['canva', 'tools']) {
    const item = service.localDiscovery({scope: 'global'}).find(c => c.id === 'antigravity').surfaces.find(s => s.id === 'cli').observations.find(o => o.id === assetId);
    const input = {scopeRoot, targetRoot: home, scope: 'global', clientId: 'antigravity', surface: 'cli', assetId};
    service.applyImport({planId: service.planImport({...input, candidateId: item.candidateId}).planId});
    service.applyInstallation({planId: service.planInstallation({...input, mode: 'adopt'}).planId});
  }
  const links = ['.agents/skills/ego-browser', '.gemini/config/skills/ego-browser', '.gemini/antigravity-cli/skills/ego-browser'];
  const external = path.join(root, 'external-ego'); fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'SKILL.md'), '# External\n');
  const identities = links.map(relative => {const link = path.join(home, relative); fs.mkdirSync(path.dirname(link), {recursive: true}); fs.symlinkSync(external, link); return {link, stat: fs.lstatSync(link)};});
  const binary = path.join(root, 'agy'), output = path.join(root, 'report.json');
  fs.writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.argv.includes('--version')){console.log('1.5.1');process.exit(0);}
const get=key=>process.argv[process.argv.indexOf(key)+1];
const settings=JSON.parse(get('--settings')),schema=JSON.parse(get('--json-schema'));
if(JSON.stringify(settings)!==JSON.stringify({permissions:{allow:['mcp(ca04-marker/read_marker)']}})||schema.properties.mcp.enum||process.argv.includes('--dangerously-skip-permissions'))process.exit(6);
const selected=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.gemini/config/mcp_config.json'))).mcpServers['ca04-marker'];
const marker=selected?.args?.at(-1)||'ABSENT',emit=value=>console.log(JSON.stringify(value));
if(selected)emit({event:'step_update',step_update:{step_type:'tool',state:'DONE',tool_info:{name:'call_mcp_tool',parameters:{ServerName:'ca04-marker',ToolName:'read_marker',Arguments:{}},output:JSON.stringify({content:[{type:'text',text:marker}],isError:false})}}});
emit({event:'result',result:{status:'SUCCESS',response:JSON.stringify({mcp:${wrapped ? "marker==='ABSENT'?marker:JSON.stringify({content:[{text:marker}]})" : 'marker'}})}});
${concurrentBaselineChange ? "if(marker==='ABSENT'){const target=path.join(os.homedir(),'.gemini/config/mcp_config.json'),current=JSON.parse(fs.readFileSync(target));current.userChangedDuringProbe='keep';fs.writeFileSync(target,JSON.stringify(current));}" : ''}
`, {mode: 0o700});
  const run = (optIn = true) => spawnSync(process.execPath, ['scripts/verify-antigravity-mcp.mjs', '--antigravity', binary, '--output', output,
    ...(optIn ? ['--native-global', 'temporary-fixtures'] : [])], {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex')}});
  function preserved() {
    assert.equal(fs.readFileSync(target, 'utf8'), original); assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    for (const {link, stat} of identities) {assert.equal(fs.readlinkSync(link), external); assert.equal(fs.lstatSync(link).ino, stat.ino); assert.equal(fs.lstatSync(link).mtimeMs, stat.mtimeMs);}
    assert.equal(fs.readFileSync(path.join(external, 'SKILL.md'), 'utf8'), '# External\n');
    for (const assetId of ['canva', 'tools']) {
      const current = service.installation({scopeRoot, targetRoot: home, scope: 'global', assetId});
      assert.equal(current.adopted, true); assert.equal(current.installedModified, false); assert.equal(current.kitPending, false);
    }
  }
  return {run, output, target, preserved};
}

test('Antigravity native MCP verifies all five layers/stages through Kit update and stock rollback', t => {
  const f = fixture(t), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)), client = report.clients[0];
  assert.equal(report.complete, true); assert.equal(client.fullLifecycleConfirmed, true);
  assert.deepEqual(Object.keys(client.stages), ['baseline', 'applied', 'updated', 'removed', 'rollback']);
  for (const stage of Object.values(client.stages)) for (const layer of ['deployment', 'nativeRecognition', 'modelBehavior', 'execution']) assert.equal(stage.verification[layer].status, 'passed');
  assert.equal(client.cleanupVerified, true); assert.equal(report.cleanup.existingOwnersPreserved, true);
  assert.equal(report.productionEvidencePromoted, false); f.preserved();
});

test('MCP final response mismatch retains successful deployment/transport and restores every original', t => {
  const f = fixture(t, {wrapped: true}), result = f.run(); assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)), stage = report.clients[0].stages.updated.verification;
  assert.equal(stage.deployment.status, 'passed'); assert.equal(stage.nativeRecognition.status, 'passed'); assert.equal(stage.modelBehavior.status, 'failed');
  assert.equal(report.clients[0].cleanupVerified, true); assert.equal(report.complete, false); f.preserved();
});

test('occupied native fixture name and missing global opt-in cannot change existing settings', t => {
  for (const optIn of [false, true]) {
    const f = fixture(t, {occupied: true}), result = f.run(optIn); assert.notEqual(result.status, 0); f.preserved();
    if (optIn) {const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.clients[0].blocker, 'NATIVE_FIXTURE_NOT_FRESH'); assert.deepEqual(report.clients[0].stages, {});}
  }
});

test('a concurrent existing-setting edit stops verification before any fixture control overwrite', t => {
  const f = fixture(t, {concurrentBaselineChange: true}), result = f.run(); assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)), current = JSON.parse(fs.readFileSync(f.target));
  if (report.recovery?.scratchRoot) t.after(() => fs.rmSync(report.recovery.scratchRoot, {recursive: true, force: true}));
  assert.equal(current.userChangedDuringProbe, 'keep'); assert.equal(current.mcpServers['ca04-marker'], undefined);
  assert.equal(report.clients[0].blocker, 'FIXTURE_TARGET_CHANGED');
  assert.deepEqual(Object.keys(report.clients[0].stages), ['baseline']);
  assert.equal(report.recovery.scratchRetained, true);
});
