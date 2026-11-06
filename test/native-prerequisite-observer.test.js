import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {observeNativeInventory} from '../lib/infrastructure/native-inventory-observer.js';

function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-native-prerequisite-transport-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),binaryPath=path.join(root,'native'),transcript=path.join(root,'transcript.jsonl');fs.mkdirSync(homeDir);
  fs.writeFileSync(binaryPath,`#!${process.execPath}
const fs=require('node:fs'),readline=require('node:readline');const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);fs.appendFileSync(${JSON.stringify(transcript)},JSON.stringify(r)+'\\n');
if(r.method==='initialize'){send({id:99,method:'mcpServer/elicitation/request',params:{DO_NOT_APPROVE:true}});send({id:r.id,result:{}});}
if(r.method==='config/read')send({id:r.id,result:{config:{mcp_servers:{}},layers:[],origins:{}}});
if(r.method==='skills/list')send({id:r.id,result:{data:[{cwd:r.params.cwds[0],skills:[],errors:[]}]}});
if(r.method==='mcpServerStatus/list')send({id:r.id,result:{data:[{name:r.params.serverName,authStatus:'unsupported',resources:[],resourceTemplates:[],tools:{search:{name:'search',inputSchema:{type:'object'}}},serverCapabilities:{tools:{}}}],nextCursor:null}});
});\n`,{mode:0o755});
  return {transcript,input:{binaryPath,homeDir,cwd:homeDir,adapter:'codex-prerequisites-v1',profile:{nativeInventory:{environment:{CODEX_HOME:'~/.codex'}}},timeoutMs:3000}};
}

test('prerequisite observer connects only explicitly selected servers after metadata approval and never starts a thread or tool call',async t=>{
  const f=fixture(t);let approvals=0;
  const result=await observeNativeInventory({...f.input,includeSkills:true,serverNames:['original-server'],authorizeDiscovery:({configuration,skills})=>{approvals++;assert.deepEqual(configuration.config.mcp_servers,{});assert.equal(skills.data[0].cwd,f.input.cwd);return true;}});
  assert.equal(approvals,1);assert.equal(result.mcpServers[0].serverName,'original-server');assert.equal(result.mcpServers[0].pages[0].data[0].name,'original-server');
  const events=fs.readFileSync(f.transcript,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(event=>event.method).map(event=>event.method),['initialize','initialized','config/read','skills/list','mcpServerStatus/list']);
  assert.deepEqual(events.find(event=>event.method==='mcpServerStatus/list').params,{serverName:'original-server',detail:'toolsAndAuthOnly',limit:16});
  assert.equal(events.find(event=>event.id===99).error.code,-32601);
});

test('metadata-only prerequisite inspection never opens a provider and denied or absent approval fails before discovery',async t=>{
  const f=fixture(t),result=await observeNativeInventory({...f.input,includeSkills:true,serverNames:[]});assert.deepEqual(result.mcpServers,[]);
  for(const authorizeDiscovery of [undefined,()=>false,async()=>true])await assert.rejects(observeNativeInventory({...f.input,serverNames:['original-server'],authorizeDiscovery}),{code:'NATIVE_PREREQUISITE_DISCOVERY_DENIED'});
  assert.ok(fs.readFileSync(f.transcript,'utf8').trim().split('\n').map(JSON.parse).every(event=>event.method!=='mcpServerStatus/list'));
});

test('unknown server IDs, duplicate selections and nonboolean Skill flags are rejected before a process is started',async t=>{
  const f=fixture(t);
  for(const input of [{serverNames:['../outside']},{serverNames:['same','same']},{serverNames:'all'},{includeSkills:'true'}])await assert.rejects(observeNativeInventory({...f.input,...input}),{code:'INVALID_NATIVE_PREREQUISITE_REQUEST'});
  assert.equal(fs.existsSync(f.transcript),false);
});
