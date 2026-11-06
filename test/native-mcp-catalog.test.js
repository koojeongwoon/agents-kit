import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';

function fixture(t, responseFor) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-native-mcp-catalog-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),projectPath=path.join(root,'work'),kitRoot=path.join(root,'kit');
  const globalFile=path.join(homeDir,'.codex/config.toml'),projectFile=path.join(projectPath,'.codex/config.toml');
  for(const file of [globalFile,projectFile]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'# user setting\n[mcp_servers.shared]\ncommand = "fixture-command"\n');}
  const source=(scope)=>scope==='global'?{type:'user',file:globalFile,profile:null}:{type:'project',dotCodexFolder:path.dirname(projectFile)};
  const origin=(scope)=>({name:source(scope),version:`sha256:${(scope==='global'?'a':'b').repeat(64)}`});
  const defaults=()=>({config:{mcp_servers:{shared:{command:'DO_NOT_PERSIST',args:['DO_NOT_PERSIST'],enabled:false,env:{API_TOKEN:'DO_NOT_PERSIST'}}}},
    origins:{'mcp_servers.shared.command':origin('project'),'mcp_servers.shared.args':origin('project'),'mcp_servers.shared.enabled':origin('project')},
    layers:[{name:source('global'),config:{private:'DO_NOT_PERSIST'}},{name:source('project'),config:{private:'DO_NOT_PERSIST'}}]});
  let calls=0;
  const service=createManifestDeploymentService({homeDir,definitionsDir:path.resolve('clients'),binaryObserver:()=>({binaryPath:'/reviewed/codex',sha256:'508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44'}),
    nativeInventoryObserver:async input=>{calls++;assert.equal(input.adapter,'codex-mcp-config-v1');return responseFor?responseFor({defaults,source,origin,input}):defaults();}});
  return {service,input:{kitRoot,projectPath,clientId:'codex',surface:'cli',kind:'mcpServers'},globalFile,projectFile,calls:()=>calls};
}

test('MCP effective origins distinguish a shadowed global source and disabled project without exposing credentials',async t=>{
  const f=fixture(t);const before=[f.globalFile,f.projectFile].map(file=>fs.readFileSync(file));
  const result=await f.service.observeCatalog(f.input);
  assert.equal(result.nativeObservation.kind,'mcpServers');assert.equal(result.nativeObservation.status,'observed');
  const entries=result.observations.filter(item=>item.clientId==='codex'&&item.surface==='cli'&&item.kind==='mcpServers');assert.equal(entries.length,2);
  assert.equal(entries.find(item=>item.scope==='global').nativeEvidence.state,'shadowed');
  assert.equal(entries.find(item=>item.scope==='project').activation,'disabled');
  const effective=result.effective.find(item=>item.kind==='mcpServers');
  assert.equal(effective.nativeConfiguration.enabled,false);assert.equal(effective.nativeConfiguration.composition,'single-source');
  assert.equal(effective.nativeConfiguration.connectionState,'unverified');assert.equal(effective.nativeConfiguration.toolUseState,'unverified');
  assert.equal(JSON.stringify(result).includes('DO_NOT_PERSIST'),false);assert.ok(effective.entries.every(item=>!item.selected));
  [f.globalFile,f.projectFile].forEach((file,index)=>assert.deepEqual(fs.readFileSync(file),before[index]));
});

test('field-level origins preserve composed MCP configuration rather than inventing a winning whole asset',async t=>{
  const f=fixture(t,({defaults,origin})=>{const result=defaults();result.config.mcp_servers.shared.enabled=true;result.origins['mcp_servers.shared.command']=origin('global');return result;});
  const result=await f.service.observeCatalog(f.input),effective=result.effective.find(item=>item.kind==='mcpServers');
  assert.equal(effective.nativeConfiguration.composition,'composed');assert.equal(effective.nativeConfiguration.enabled,true);
  assert.ok(effective.entries.every(item=>item.nativeState==='contributing'&&item.activation==='unknown'));
});

test('native-disabled layers are explained, while unknown origins never assign activation to a local source',async t=>{
  const ignored=fixture(t,({defaults,origin})=>{const result=defaults();for(const key of Object.keys(result.origins))result.origins[key]=origin('global');result.layers[1].disabledReason='DO_NOT_PERSIST';return result;});
  let result=await ignored.service.observeCatalog(ignored.input);
  assert.equal(result.observations.find(item=>item.scope==='project'&&item.surface==='cli').nativeEvidence.state,'ignored');
  const unknown=fixture(t,({defaults})=>({...defaults(),origins:{}}));result=await unknown.service.observeCatalog(unknown.input);
  assert.ok(result.observations.filter(item=>item.kind==='mcpServers').every(item=>item.activation==='unknown'));
  assert.equal(result.effective.find(item=>item.kind==='mcpServers').nativeConfiguration.composition,'unverified');
});

test('additional MCP sources have no management authority and other native resource kinds remain unverified',async t=>{
  const f=fixture(t,({defaults,origin,input})=>{const result=defaults();result.config.mcp_servers.additional={command:'DO_NOT_PERSIST',enabled:true};result.origins['mcp_servers.additional.command']={...origin('project'),name:{type:'project',dotCodexFolder:path.join(path.dirname(input.cwd),'.codex')}};return result;});
  const result=await f.service.observeCatalog({...f.input,includeOtherClients:true});
  assert.ok(result.nativeObservation.registrations.some(item=>item.name==='additional'&&item.manageable===false&&item.sourceCandidates.length===0));
  assert.ok(result.observations.filter(item=>item.kind!=='mcpServers'||item.clientId!=='codex'||item.surface!=='cli').every(item=>!item.nativeEvidence));
});

test('malformed native config and ambiguous dotted origin keys never assign local activation',async t=>{
  const invalid=fixture(t,({defaults})=>{const value=defaults();value.config.mcp_servers.shared.enabled='false';return value;});
  let result=await invalid.service.observeCatalog(invalid.input);assert.equal(result.nativeObservation.reason,'NATIVE_INVENTORY_RESPONSE_INVALID');
  const ambiguous=fixture(t,({defaults,origin})=>{const value=defaults();value.config.mcp_servers.shared={enabled:true,child:{command:'DO_NOT_PERSIST'}};value.config.mcp_servers['shared.child']={command:'DO_NOT_PERSIST',enabled:true};value.origins={'mcp_servers.shared.child.command':origin('project')};return value;});
  result=await ambiguous.service.observeCatalog(ambiguous.input);assert.ok(result.observations.filter(item=>item.kind==='mcpServers').every(item=>item.activation==='unknown'));
  assert.ok(result.nativeObservation.registrations.every(item=>item.composition==='unverified'));
});
