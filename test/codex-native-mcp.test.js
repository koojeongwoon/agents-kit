import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';

function fixture(t, {mismatch = false, occupied = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-codex-native-mcp-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const home = path.join(root, 'home'), scopeRoot = path.join(home, '.agents-kit/kit/global'), target = path.join(home, '.codex/config.toml');
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: native-mcp-test}\nassets: {}\n');
  const original = '# Keep the user configuration\nmodel = "native-default"\n[mcp_servers.node-repl]\ncommand = "keep"\nargs = ["before"]\nstartup_timeout_sec = 15\n'
    + (occupied ? '[mcp_servers.ca04-marker]\ncommand = "existing"\n' : '');
  fs.writeFileSync(target, original, {mode: 0o640});
  const service = createManifestDeploymentService({definitionsDir: path.resolve('clients'), homeDir: home});
  const input = {scopeRoot, targetRoot: home, scope: 'global', clientId: 'codex', surface: 'cli', assetId: 'node-repl'};
  const candidate = service.localDiscovery({scope: 'global'}).find(c => c.id === 'codex').surfaces.find(s => s.id === 'cli').observations.find(o => o.id === input.assetId);
  service.applyImport({planId: service.planImport({...input, candidateId: candidate.candidateId}).planId});
  service.applyInstallation({planId: service.planInstallation({...input, mode: 'adopt'}).planId});
  const external = path.join(root, 'external'), link = path.join(home, '.agents/skills/ego-browser');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'SKILL.md'), '# Keep\n'); fs.mkdirSync(path.dirname(link), {recursive: true}); fs.symlinkSync(external, link); const identity = fs.lstatSync(link);
  const binary = path.join(root, 'codex'), output = path.join(root, 'report.json');
  fs.writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const args=process.argv.slice(2),emit=v=>console.log(JSON.stringify(v));
if(args.includes('--version')){console.log('codex-cli 0.166.0-alpha.6');process.exit(0);}
const text=fs.readFileSync(path.join(os.homedir(),'.codex/config.toml'),'utf8'),section=text.split('[mcp_servers.ca04-marker]')[1],marker=section?.match(/ca04-[a-f0-9]+-v[12]/)?.[0]||'ABSENT';
if(args[0]==='mcp'&&args[1]==='list'){emit(marker==='ABSENT'?[]:[{name:'ca04-marker'}]);process.exit(0);}
if(args.includes('--ignore-user-config')||args[args.indexOf('--sandbox')+1]!=='read-only')process.exit(8);
if(marker!=='ABSENT')emit({type:'item.completed',item:{type:'mcp_tool_call',server:'ca04-marker',tool:'read_marker',arguments:{},result:{content:[{type:'text',text:marker}],isError:false},status:'completed'}});
emit({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({mcp:${mismatch ? "marker==='ABSENT'?marker:'WRONG'" : 'marker'}})}});emit({type:'turn.completed'});
`, {mode: 0o700});
  const run = () => spawnSync(process.execPath, ['scripts/verify-global-mcp.mjs', '--client', 'codex', '--codex', binary, '--native-global', 'temporary-fixtures', '--stop-on-failure', 'true', '--output', output],
    {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex')}});
  function preserved() {
    assert.equal(fs.readFileSync(target, 'utf8'), original); assert.equal(fs.statSync(target).mode & 0o777, 0o640);
    const current = service.installation(input); assert.equal(current.adopted, true); assert.equal(current.installedModified, false); assert.equal(current.kitPending, false);
    assert.equal(fs.readlinkSync(link), external); assert.equal(fs.lstatSync(link).ino, identity.ino); assert.equal(fs.lstatSync(link).mtimeMs, identity.mtimeMs);
  }
  return {run, output, preserved};
}

test('Codex global basic MCP uses neutral rendering, native selected ownership and five-stage public tool evidence', t => {
  const f = fixture(t), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.complete, true); assert.equal(report.nativeModelProbes, 5);
  assert.equal(report.sourceRepresentation, 'client-neutral-rendered-then-native-managed'); assert.equal(report.resourceProfile, 'mcp-stdio-basic-v1');
  const client = report.clients[0]; assert.equal(client.fullLifecycleConfirmed, true); assert.equal(client.cleanupVerified, true);
  for (const stage of Object.values(client.stages)) {assert.equal(stage.confirmed, true); assert.equal(stage.nativeDiscovery.nativeRecognition.status, 'passed');}
  assert.equal(report.cleanup.existingOwnersPreserved, true); f.preserved();
});

test('Codex global MCP stops on first model mismatch and preserves an already occupied fixture', t => {
  for (const options of [{mismatch: true}, {occupied: true}]) {
    const f = fixture(t, options), result = f.run(); assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.nativeModelProbes, options.occupied ? 0 : 2);
    assert.equal(report.clients[0].cleanupVerified, true); assert.equal(report.complete, false); f.preserved();
  }
});
