import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {observeNativeInventory} from '../lib/infrastructure/native-inventory-observer.js';

function fixture(t, body) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-inventory-rpc-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const binaryPath=path.join(root,'client'),homeDir=path.join(root,'home');fs.mkdirSync(homeDir);
  const transcript=path.join(root,'methods.jsonl');
  fs.writeFileSync(binaryPath,`#!${process.execPath}\n${body(transcript)}\n`,{mode:0o755});
  return {root,transcript,input:{binaryPath,adapter:'codex-skills-list-v1',profile:{nativeInventory:{environment:{CODEX_HOME:'~/.codex'}}},homeDir,cwd:homeDir,timeoutMs:3000}};
}

test('inventory transport sends only the reviewed list handshake and rejects server action requests',async t=>{
  const f=fixture(t,transcript=>`
const fs=require('node:fs'),readline=require('node:readline');
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
fs.writeFileSync(${JSON.stringify(transcript)},JSON.stringify({providerSecretPresent:!!process.env.OPENAI_API_KEY,codexHome:process.env.CODEX_HOME})+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const item=JSON.parse(line);fs.appendFileSync(${JSON.stringify(transcript)},JSON.stringify(item)+'\\n');
 if(item.method==='initialize'){send({id:91,method:'item/commandExecution/requestApproval',params:{}});send({id:item.id,result:{}});}
 if(item.method==='skills/list')send({id:item.id,result:{data:[{cwd:item.params.cwds[0],skills:[],errors:[]}]}});
});`);
  const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-environment-value';
  t.after(()=>{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior;});
  const result=await observeNativeInventory(f.input);assert.equal(result.data[0].cwd,f.input.cwd);
  const records=fs.readFileSync(f.transcript,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records[0].providerSecretPresent,false);assert.equal(records[0].codexHome,path.join(f.input.homeDir,'.codex'));
  assert.deepEqual(records.filter(item=>item.method).map(item=>item.method),['initialize','initialized','skills/list']);
  assert.equal(records.find(item=>item.id===91).error.code,-32601);
  assert.deepEqual(records.find(item=>item.method==='skills/list').params,{cwds:[f.input.cwd],forceReload:true});
});

test('silent and oversized clients terminate without returning positive inventory',async t=>{
  const silent=fixture(t,()=>`setInterval(()=>{},1000);`);
  await assert.rejects(observeNativeInventory({...silent.input,timeoutMs:100}),{code:'NATIVE_INVENTORY_TIMEOUT'});
  const huge=fixture(t,()=>`process.stdout.write('x'.repeat(5*1024*1024));setInterval(()=>{},1000);`);
  await assert.rejects(observeNativeInventory(huge.input),{code:'NATIVE_INVENTORY_OUTPUT_LIMIT'});
});

test('MCP metadata uses config/read only and never starts a thread or MCP connection',async t=>{
  const f=fixture(t,transcript=>`
const fs=require('node:fs'),readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{const item=JSON.parse(line);fs.appendFileSync(${JSON.stringify(transcript)},JSON.stringify(item)+'\\n');
 if(item.method==='initialize')process.stdout.write(JSON.stringify({id:item.id,result:{}})+'\\n');
 if(item.method==='config/read')process.stdout.write(JSON.stringify({id:item.id,result:{config:{mcp_servers:{}},origins:{},layers:[]}})+'\\n');});`);
  const result=await observeNativeInventory({...f.input,adapter:'codex-mcp-config-v1'});assert.deepEqual(result.config.mcp_servers,{});
  const requests=fs.readFileSync(f.transcript,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests.map(item=>item.method),['initialize','initialized','config/read']);
  assert.deepEqual(requests.at(-1).params,{includeLayers:true,cwd:f.input.cwd});
  const result2=await observeNativeInventory({...f.input,adapter:'codex-instruction-settings-v1'});assert.deepEqual(result2.config.mcp_servers,{});
  const updated=fs.readFileSync(f.transcript,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(updated.map(item=>item.method),['initialize','initialized','config/read','initialize','initialized','config/read']);
});
