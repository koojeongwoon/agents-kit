import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import test from 'node:test';

// A local protocol simulator reads only the disposable files the real service deploys.
// It never starts a native client, model or provider.
function fixture(t, wrapped = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-verification-cli-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const home = path.join(root, 'home'), binary = path.join(root, 'codex'), output = path.join(root, 'report.json');
  fs.mkdirSync(home);
  fs.writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.argv.includes('--version')){console.log('codex-cli 0.166.0-alpha.6');process.exit(0);}
const cwd=process.cwd(),home=os.homedir(),emit=v=>console.log(JSON.stringify(v));
const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';
const marker=p=>read(p).match(/ca04-[a-f0-9]+-v[12]/)?.[0]||'ABSENT';
if(process.argv.includes('mcp')&&process.argv.includes('list')){console.log(JSON.stringify(marker(path.join(cwd,'.codex/config.toml'))==='ABSENT'?[]:[{name:'ca04-marker'}]));process.exit(0);}
let agentFile;
for(const base of [cwd,home]){const dir=path.join(base,'.codex/agents');if(fs.existsSync(dir))for(const name of fs.readdirSync(dir))if(name.startsWith('ca04-agent-'))agentFile=path.join(dir,name);}
let skillFile;
for(const base of [cwd,home]){const dir=path.join(base,'.agents/skills');if(fs.existsSync(dir))for(const name of fs.readdirSync(dir))if(name.startsWith('ca04-')&&fs.existsSync(path.join(dir,name,'SKILL.md'))&&fs.existsSync(path.join(dir,name,'references/marker.txt')))skillFile=path.join(dir,name,'references/marker.txt');}
if(process.argv.at(-1)?.includes('custom Agent')){
 const value=agentFile?marker(agentFile):'ABSENT',name=agentFile?path.basename(agentFile,'.toml'):'';
 if(agentFile){emit({type:'item.completed',item:{type:'collab_tool_call',tool:'spawn_agent',agent_type:name,status:'completed',receiver_thread_ids:['child'],agents_states:{}}});emit({type:'item.completed',item:{type:'collab_tool_call',tool:'wait',status:'completed',receiver_thread_ids:['child'],agents_states:{child:{status:'completed',message:value}}}});}
 emit({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({agent:value})}});
}else{
 const skill=skillFile?read(skillFile):'ABSENT',mcp=marker(path.join(cwd,'.codex/config.toml'));
 if(skillFile)emit({type:'item.completed',item:{type:'command_execution',command:'cat '+skillFile,aggregated_output:skill,exit_code:0,status:'completed'}});
 if(mcp!=='ABSENT')emit({type:'item.completed',item:{type:'mcp_tool_call',server:'ca04-marker',tool:'read_marker',arguments:{},result:{content:[{type:'text',text:mcp}],isError:false},status:'completed'}});
 emit({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({instructions:marker(path.join(cwd,'AGENTS.md'))==='ABSENT'?marker(path.join(home,'.codex/AGENTS.md')):marker(path.join(cwd,'AGENTS.md')),skill,mcp:${wrapped ? "mcp==='ABSENT'?mcp:JSON.stringify({content:[{type:'text',text:mcp}]})" : 'mcp'}})}});
}
emit({type:'turn.completed'});
`, {mode: 0o700});
  const run = (script, args = []) => spawnSync(process.execPath, [script, '--client', 'codex', '--codex', binary, '--output', output, ...args],
    {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex')}});
  return {root, home, binary, output, run};
}

test('Agent verifier computes a successful five-stage report and restores disposable project ownership', t => {
  const f = fixture(t), result = f.run('scripts/verify-client-agents.mjs', ['--scope', 'project']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.complete, true);
  assert.equal(report.clients[0].verification.fullLifecycleConfirmed, true);
  assert.equal(report.clients[0].cleanupVerified, true);
  assert.equal(report.productionEvidencePromoted, false);
});

test('Agent preflight makes no parent or child requests and stage failure stops at the first unconfirmed child result', t => {
  const f = fixture(t); let result = f.run('scripts/verify-client-agents.mjs', ['--check-only', 'true']);
  assert.equal(result.status, 0, result.stderr); let report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.parentRequests, 0); assert.equal(report.completionScope, 'preflight-only'); assert.deepEqual(report.clients[0].stages, {});
  const binary = fs.readFileSync(f.binary, 'utf8').replace('message:value', "message:'unexpected'"); fs.writeFileSync(f.binary, binary, {mode: 0o700});
  result = f.run('scripts/verify-client-agents.mjs', ['--stop-on-failure', 'true']); assert.equal(result.status, 2, result.stderr);
  report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.parentRequests, 2); assert.deepEqual(Object.keys(report.clients[0].stages), ['baseline', 'applied']); assert.equal(report.clients[0].cleanupVerified, true);
});

test('Antigravity Agent lifecycle joins exact child status and ACP reply in an isolated HOME without touching source state', t => {
  const f = fixture(t), binary = path.join(f.root, 'agy'), auth = path.join(f.home, '.gemini/antigravity-cli/antigravity-oauth-token');
  fs.mkdirSync(path.dirname(auth), {recursive: true});
  const credentials = JSON.stringify({token: {access_token: 'fixture-access', refresh_token: 'source-refresh', expiry: new Date(Date.now() + 3600000).toISOString()}});
  fs.writeFileSync(auth, credentials, {mode: 0o600});
  const ledger = path.join(f.home, '.agents-kit/state.json'); fs.mkdirSync(path.dirname(ledger)); fs.writeFileSync(ledger, 'preserve-original-ledger');
  fs.writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),emit=v=>console.log(JSON.stringify(v));
if(process.env.AGY_CLI_DISABLE_AUTO_UPDATE!=='true')process.exit(7);
if(process.argv.includes('--version')){console.log('1.5.1');process.exit(0);}
const auth=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.gemini/antigravity-cli/antigravity-oauth-token')));
if(auth.token.refresh_token||os.homedir()===${JSON.stringify(f.home)})process.exit(8);
let file;for(const dir of [path.join(process.cwd(),'.agents/agents'),path.join(os.homedir(),'.gemini/config/agents')])if(fs.existsSync(dir))for(const n of fs.readdirSync(dir))if(n.startsWith('ca04-agent-'))file=path.join(dir,n);
const marker=file?fs.readFileSync(file,'utf8').match(/ca04-[a-f0-9]+-v[12]/)[0]:'ABSENT',role=file?path.basename(file,'.md'):'';
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);
if(process.argv.includes('acp')){
 if(r.method==='initialize')emit({jsonrpc:'2.0',id:r.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{close:{}}}}});
 else if(r.method==='session/load'){if(r.params.sessionId!=='fixture-child')process.exit(9);emit({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-child',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:marker}}}});emit({jsonrpc:'2.0',id:r.id,result:{}});}
 else if(r.method==='session/close')emit({jsonrpc:'2.0',id:r.id,result:{}});else process.exit(10);return;
}
if(file){emit({event:'step_update',step_update:{step_type:'subagent',state:'DONE',tool_name:'invoke_subagent',subagent_info:{subagents:[{type_name:role,conversation_id:'fixture-child'}]}}});emit({event:'step_update',step_update:{step_type:'tool',state:'DONE',tool_info:{name:'manage_subagents',parameters:{Action:'list'},output:'You have 1 active subagent(s):\\n'+JSON.stringify([{conversationId:'fixture-child',state:'idle'}])}}});}
emit({event:'result',result:{status:'SUCCESS',response:JSON.stringify({agent:marker})}});});
`, {mode: 0o700});
  for (const scope of ['project', 'global']) {
    const result = spawnSync(process.execPath, ['scripts/verify-client-agents.mjs', '--client', 'antigravity', '--antigravity', scope === 'global' ? 'agy' : binary,
      '--isolated-antigravity-home', 'true', '--scope', scope, '--native-global', 'temporary-fixtures', '--stop-on-failure', 'true', '--output', f.output],
    {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: f.home, PATH: f.root + path.delimiter + process.env.PATH}});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.complete, true);
    assert.equal(report.isolation.freshHome, true); assert.equal(report.isolation.refreshTokenCopied, false);
    assert.equal(report.sourceAuthenticationPreserved, true); assert.equal(report.clients[0].cleanupVerified, true);
    for (const stage of ['applied', 'updated', 'rollback']) {
      const proof = report.clients[0].stages[stage];
      assert.equal(proof.completedChildMarker, true); assert.equal(proof.childAcpInspection.modelTurnsRequested, 0);
      assert.equal(proof.verification.nativeRecognition.status, 'passed');
    }
    assert.equal(fs.readFileSync(auth, 'utf8'), credentials); assert.equal(fs.readFileSync(ledger, 'utf8'), 'preserve-original-ledger');
  }
  const expired = JSON.stringify({token: {access_token: 'expired-access', refresh_token: 'preserve-refresh', expiry: '2000-01-01T00:00:00Z'}});
  fs.writeFileSync(auth, expired, {mode: 0o600});
  const rejected = spawnSync(process.execPath, ['scripts/verify-client-agents.mjs', '--client', 'antigravity', '--antigravity', binary,
    '--isolated-antigravity-home', 'true', '--output', f.output], {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: f.home}});
  assert.equal(rejected.status, 2, rejected.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.parentRequests, 0);
  assert.equal(report.clients[0].blocker, 'AUTH_ACCESS_TOKEN_UNAVAILABLE');
  assert.equal(fs.readFileSync(auth, 'utf8'), expired); assert.equal(fs.readFileSync(ledger, 'utf8'), 'preserve-original-ledger');
});

test('model-use CLI preserves deployment and native proof when a wrapped final response fails', t => {
  const f = fixture(t, true), result = f.run('scripts/verify-client-use.mjs', ['--stages', 'applied']);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)), stage = report.clients[0].stages.applied.verification;
  assert.equal(stage.deployment.status, 'passed'); assert.equal(stage.nativeRecognition.status, 'passed');
  assert.equal(stage.modelBehavior.status, 'failed'); assert.equal(report.complete, false);
  assert.equal(report.clients[0].cleanupVerified, true);
});

test('resource-specific verification deploys only the selected MCP and records per-resource evidence', t => {
  const f = fixture(t), result = f.run('scripts/verify-client-use.mjs', ['--stages', 'applied', '--resources', 'mcp', '--stop-on-failure', 'true']);
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(fs.readFileSync(f.output));
  assert.deepEqual(report.resources, ['mcp']); assert.equal(report.modelRequests, 1);
  assert.ok(report.clients[0].preflight.operations.every(op => op.assetKind === 'mcpServers'));
  assert.equal(report.clients[0].stages.applied.verificationByResource.mcp.confirmed, true);
  assert.equal(report.clients[0].stages.applied.completedTools, 1); assert.equal(report.clients[0].cleanupVerified, true);
});

test('basic verification preflight prepares no installation or model calls', t => {
  const f = fixture(t), result = f.run('scripts/verify-client-use.mjs', ['--check-only', 'true']);
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.checkOnly, true); assert.equal(report.modelRequests, 0); assert.equal(report.completionScope, 'preflight-only');
  assert.deepEqual(report.clients[0].stages, {}); assert.equal(report.clients[0].fullLifecycleConfirmed, false); assert.equal(report.clients[0].cleanupVerified, true);
  assert.deepEqual(fs.readdirSync(f.home), []);
});

test('a global MCP with the fixture name stops project verification before any model or server call', t => {
  const f = fixture(t), config = path.join(f.home, '.codex/config.toml'); fs.mkdirSync(path.dirname(config)); const original = '[mcp_servers.ca04-marker]\ncommand = "existing-user-server"\n'; fs.writeFileSync(config, original);
  const result = f.run('scripts/verify-client-use.mjs', ['--resources', 'mcp', '--check-only', 'true']); assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.modelRequests, 0); assert.equal(report.clients[0].blocker, 'FIXTURE_MCP_NAME_OCCUPIED');
  assert.equal(fs.readFileSync(config, 'utf8'), original);
});

test('global instruction verification requires an explicit fixture flag and restores existing content and mode', t => {
  const f = fixture(t), target = path.join(f.home, '.codex/AGENTS.md');
  fs.mkdirSync(path.dirname(target)); const original = '# Existing rules\nPreserve my instructions.\n';
  fs.writeFileSync(target, original, {mode: 0o640}); const before = fs.statSync(target);
  const args = ['--scope', 'global', '--resources', 'instructions', '--stop-on-failure', 'true'];
  const denied = f.run('scripts/verify-client-use.mjs', args);
  assert.notEqual(denied.status, 0); assert.equal(fs.existsSync(f.output), false);
  const preflight = f.run('scripts/verify-client-use.mjs', [...args, '--native-global', 'temporary-fixtures', '--check-only', 'true']);
  assert.equal(preflight.status, 0, preflight.stderr); let report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.modelRequests, 0); assert.equal(fs.statSync(target).ino, before.ino); assert.equal(fs.statSync(target).mtimeMs, before.mtimeMs);
  const result = f.run('scripts/verify-client-use.mjs', [...args, '--native-global', 'temporary-fixtures']);
  assert.equal(result.status, 0, result.stderr); report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.scope, 'global'); assert.equal(report.complete, true); assert.equal(report.modelRequests, 5);
  assert.equal(report.clients[0].cleanupVerified, true); assert.equal(report.clients[0].userInstructionsPreserved, true);
  assert.ok(report.clients[0].preflight.operations.every(op => op.target === target));
  assert.equal(fs.readFileSync(target, 'utf8'), original); assert.equal(fs.statSync(target).mode & 0o777, 0o640);
});

test('basic MCP verification separately records native list recognition throughout the lifecycle', t => {
  const f = fixture(t), result = f.run('scripts/verify-client-use.mjs', ['--resources', 'mcp', '--native-discovery', 'true', '--stop-on-failure', 'true']);
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.modelRequests, 5); assert.equal(report.complete, true);
  for (const stage of ['baseline', 'applied', 'updated', 'removed', 'rollback']) {
    assert.equal(report.clients[0].nativeDiscovery[stage].mcp.nativeRecognition.status, 'passed');
    assert.equal(report.clients[0].stages[stage].verificationByResource.mcp.confirmed, true);
  }
});

test('stop-on-failure records the first mismatch and restores without repeating later model stages', t => {
  const f = fixture(t, true), result = f.run('scripts/verify-client-use.mjs', ['--stop-on-failure', 'true']);
  assert.equal(result.status, 2, result.stderr); const report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.modelRequests, 2); assert.deepEqual(Object.keys(report.clients[0].stages), ['baseline', 'applied']);
  assert.equal(report.clients[0].stages.applied.verification.modelBehavior.status, 'failed'); assert.equal(report.clients[0].cleanupVerified, true);
});

test('Antigravity basic verification uses only per-process MCP permissions and preserves user settings', t => {
  const f = fixture(t), binary = path.join(f.root, 'agy'), settings = path.join(f.home, '.gemini/antigravity-cli/settings.json');
  fs.mkdirSync(path.dirname(settings), {recursive: true}); const original = '{"model":"keep-model","permissions":{"allow":["read_file(/existing)"]}}'; fs.writeFileSync(settings, original, {mode: 0o640}); const before = fs.statSync(settings);
  fs.writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),cwd=process.cwd(),emit=v=>console.log(JSON.stringify(v));
if(args.includes('--version')){console.log('1.5.1');process.exit(0);}
const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';const marker=p=>read(p).match(/ca04-[a-f0-9]+-v[12]/)?.[0]||'ABSENT';
const mcp=marker(path.join(cwd,'.agents/mcp_config.json')),file=path.join(cwd,'.agents/skills/ca04-skill/references/marker.txt'),skill=read(file)||'ABSENT';
if(args[0]==='mcp'&&args[1]==='list'){console.log(process.env.FAKE_GLOBAL_MCP_LIST==='1'?'scope-control-global':mcp==='ABSENT'?'No project MCP':'ca04-marker');process.exit(0);}
const settings=JSON.parse(args[args.indexOf('--settings')+1]);if(JSON.stringify(settings)!==JSON.stringify({permissions:{allow:['mcp(ca04-marker/read_marker)']}}))process.exit(23);
if(skill!=='ABSENT')emit({event:'step_update',step_update:{step_type:'tool',state:'DONE',tool_info:{name:'read_file',parameters:{Path:file},output:skill}}});
if(mcp!=='ABSENT')emit({event:'step_update',step_update:{step_type:'tool',state:'DONE',tool_info:{name:'call_mcp_tool',parameters:{ServerName:'ca04-marker',ToolName:'read_marker'},output:JSON.stringify({content:[{type:'text',text:mcp}]})}}});
emit({event:'result',result:{status:'SUCCESS',response:JSON.stringify({instructions:marker(path.join(cwd,'AGENTS.md')),skill,mcp})}});
`, {mode: 0o700});
  const evidencePath = path.join(f.root, 'coverage.json'), evidence = JSON.parse(fs.readFileSync('docs/reconstruction/antigravity-mcp-list-scope-control-20261106.json', 'utf8'));
  Object.assign(evidence, {binarySha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), platform: process.platform, arch: process.arch}); fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  const result = spawnSync(process.execPath, ['scripts/verify-client-use.mjs', '--client', 'antigravity', '--antigravity', binary, '--session-permission', 'fixture-mcp', '--native-discovery', 'true', '--mcp-list-evidence', evidencePath, '--stop-on-failure', 'true', '--output', f.output],
    {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: f.home, CODEX_HOME: path.join(f.home, '.codex'), FAKE_GLOBAL_MCP_LIST: '1'}});
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.complete, true); assert.equal(report.modelRequests, 5);
  assert.equal(report.sessionPermission.userSettingsWritten, false); assert.equal(report.clients[0].cleanupVerified, true);
  assert.ok(Object.values(report.clients[0].nativeDiscovery).every(stage => stage.mcp.nativeRecognition.status === 'not-observed'));
  assert.ok(Object.values(report.clients[0].stages).every(stage => stage.verification.nativeRecognition.status === 'passed'));
  assert.equal(fs.readFileSync(settings, 'utf8'), original); assert.equal(fs.statSync(settings).mode & 0o777, 0o640); assert.equal(fs.statSync(settings).ino, before.ino); assert.equal(fs.statSync(settings).mtimeMs, before.mtimeMs);
});

test('global Skill verifier restores the fake home while preserving external link identity', t => {
  const f = fixture(t), external = path.join(f.root, 'external-ego'), links = path.join(f.home, '.agents/skills');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'SKILL.md'), '# Ego\n'); fs.mkdirSync(links, {recursive: true});
  const link = path.join(links, 'ego-browser'); fs.symlinkSync(external, link); const before = fs.lstatSync(link);
  const result = f.run('scripts/verify-global-skills.mjs', ['--native-global', 'temporary-fixtures']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.complete, true);
  assert.equal(report.clients[0].cleanupVerified, true);
  assert.equal(fs.readlinkSync(link), external); assert.equal(fs.lstatSync(link).ino, before.ino);
  assert.equal(fs.lstatSync(link).mtimeMs, before.mtimeMs); assert.equal(fs.readFileSync(path.join(external, 'SKILL.md'), 'utf8'), '# Ego\n');
});

test('discovery verifier records deployment separately for every disposable client/scope without model claims', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['scripts/verify-client-resources.mjs', '--codex', f.binary, '--antigravity', f.binary, '--output', f.output],
    {encoding: 'utf8', timeout: 20000, env: {...process.env, HOME: f.home, CODEX_HOME: path.join(f.home, '.codex')}});
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(fs.readFileSync(f.output)); assert.equal(report.clients.length, 4);
  for (const client of report.clients) {
    assert.equal(client.cleanupVerified, true, JSON.stringify(client));
    assert.equal(client.stages.applied.verification.deployment.status, 'passed');
    assert.equal(client.stages.applied.verification.modelBehavior.status, 'not-tested');
    assert.equal(client.stages.applied.verificationByResource.agents.modelBehavior.status, 'not-tested');
  }
  assert.equal(report.complete, false); assert.equal(report.productionEvidencePromoted, false);
});
