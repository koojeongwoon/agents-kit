import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareCodexNativePrerequisites,finishCodexNativePrerequisites,parseNativeProviderDiscovery} from '../lib/adapters/native-prerequisite-inventory.js';

const cwd='/workspace/project',source='/home/test/.codex/config.toml';
function fixture() {
  const origin={kitId:'test',sourceRoot:'/kit/global',clientId:'codex',surface:'cli',configStore:'codex-local'};
  const declaration={schemaVersion:2,dependencies:[],requirements:[],references:[],providedTools:[],providedToolNames:[],toolBindings:[],deniedCapabilities:[]};
  const mcp={...origin,assetId:'docs',assetKind:'mcpServers',locator:{targetBase:source,nativeId:'original_server'},proofs:[],declaration:{...declaration,providedToolNames:[{id:'docs-search',nativeName:'search_repository'}]}};
  const skill={...origin,assetId:'review',assetKind:'skills',locator:{targetBase:'/home/test/.agents/skills/review'},proofs:[],declaration:{...declaration,dependencies:[{assetId:'docs',assetKind:'mcpServers'}],toolBindings:[{toolId:'docs-search',providerId:'docs'}]}};
  const input={pairs:[{pin:{id:'skill-pin'},receipt:skill},{pin:{id:'mcp-pin'},receipt:mcp}],cwd,
    configuration:{config:{mcp_servers:{original_server:{command:'SECRET_COMMAND',enabled:true}}},layers:[],origins:{'mcp_servers.original_server.command':{name:{type:'user',file:source},version:'sha256:'+'a'.repeat(64)}}},
    skills:{data:[{cwd,skills:[{path:'/home/test/.agents/skills/review/SKILL.md',name:'review',scope:'user',enabled:true}],errors:[]}]}};
  const frame={serverName:'original_server',pages:[{data:[{name:'original_server',authStatus:'unsupported',runtimeStatus:null,serverCapabilities:{tools:{}},toolsError:null,
    tools:{search_repository:{name:'search_repository',description:'SECRET_DESCRIPTION',inputSchema:{secret:'SECRET_SCHEMA'}},unrequested:{name:'unrequested'}},resources:[{uri:'SECRET_URI'}]}],nextCursor:null}]};
  return {input,frame};
}

test('native prerequisites bind original server IDs and frozen logical tool aliases without projecting provider payloads',()=>{
  const {input,frame}=fixture(),prepared=prepareCodexNativePrerequisites(input),result=finishCodexNativePrerequisites(prepared,[frame]);
  assert.equal(prepared.discoveryAllowed,true);assert.deepEqual(prepared.servers,[{prerequisiteId:'mcp-pin',nativeId:'original_server',tools:[{toolId:'docs-search',nativeName:'search_repository'}]}]);
  assert.deepEqual(result.map(check=>check.status),['observed','observed']);assert.equal(result[1].toolUseState,'unverified');assert.equal(result[1].activeThreadState,'unverified');
  assert.ok(!JSON.stringify({prepared,result}).includes('SECRET'));assert.ok(!JSON.stringify(result).includes('unrequested'));
});

test('unrelated malformed external Skill does not invalidate an exactly listed owned Skill; own and unscoped errors do',()=>{
  const {input}=fixture();input.skills.data[0].errors=[{path:'/external/ego-skills/SKILL.md',message:'SECRET_ERROR'}];
  assert.equal(prepareCodexNativePrerequisites(input).checks[0].status,'observed');
  for(const error of [{path:'/home/test/.agents/skills/review/SKILL.md'},{path:'/home/test/.agents/skills'},{path:'relative'},{message:'SECRET_ERROR'}]) {
    input.skills.data[0].errors=[error];assert.equal(prepareCodexNativePrerequisites(input).checks[0].status,'unverified');
  }
});

test('Skill discovery requires exact enabled user scope and complete prerequisite closure, including snapshot paths',()=>{
  const {input}=fixture();input.pairs[0].receipt.proofs=[{linkSource:'/store/snapshot/review'}];input.skills.data[0].skills[0].path='/store/snapshot/review/SKILL.md';
  assert.equal(prepareCodexNativePrerequisites(input).checks[0].status,'observed');
  for(const change of [entry=>{entry.enabled=false;},entry=>{entry.scope='repo';},entry=>{entry.path='/elsewhere/SKILL.md';}]) {
    const changed=structuredClone(input);change(changed.skills.data[0].skills[0]);assert.equal(prepareCodexNativePrerequisites(changed).discoveryAllowed,false);
  }
  input.pairs.pop();assert.equal(prepareCodexNativePrerequisites(input).checks[0].reason,'NATIVE_PREREQUISITE_CLOSURE_INCOMPLETE');
});

test('native provider discovery is denied before connection on disabled, composed, shadowed or policy-denied config and unknown aliases',()=>{
  const mutations=[input=>{input.configuration.config.mcp_servers.original_server.enabled=false;},
    input=>{input.configuration.origins['mcp_servers.original_server.command'].name={type:'project',dotCodexFolder:'/workspace/project/.codex'};},
    input=>{input.configuration.origins['mcp_servers.original_server.enabled']={name:{type:'system',file:'/etc/codex/config.toml'},version:'sha256:'+'b'.repeat(64)};},
    input=>{input.configuration.config.mcp_servers.original_server.disabled_tools=['search_repository'];},
    input=>{input.configuration.config.mcp_servers.original_server.enabled_tools=['other'];},
    input=>{delete input.pairs[1].receipt.declaration.providedToolNames[0].nativeName;}];
  for(const mutate of mutations){const {input}=fixture();mutate(input);const result=prepareCodexNativePrerequisites(input);assert.equal(result.discoveryAllowed,false);assert.deepEqual(result.servers,[]);}
});

test('a single recorded field does not prove the origin of missing executable, arguments or Tool filter fields',()=>{
  for(const mutate of [input=>{delete input.configuration.origins['mcp_servers.original_server.command'];input.configuration.origins['mcp_servers.original_server.enabled']={name:{type:'user',file:source},version:'sha256:'+'a'.repeat(64)};},
    input=>{input.configuration.config.mcp_servers.original_server.args=['shadow.js'];},
    input=>{input.configuration.config.mcp_servers.original_server.enabled_tools=['search_repository'];}]) {
    const {input}=fixture();mutate(input);const result=prepareCodexNativePrerequisites(input);assert.equal(result.discoveryAllowed,false);assert.deepEqual(result.servers,[]);
  }
});

test('tool listing alone proves no tool execution and requires a completed initialized provider with the required alias',()=>{
  const {input,frame}=fixture(),prepared=prepareCodexNativePrerequisites(input);
  for(const mutate of [record=>{record.serverCapabilities=null;},record=>{record.runtimeStatus='notStarted';},record=>{record.authStatus='notLoggedIn';},record=>{record.toolsError='SECRET';},record=>{delete record.tools.search_repository;}]) {
    const changed=structuredClone(frame);mutate(changed.pages[0].data[0]);assert.equal(finishCodexNativePrerequisites(prepared,[changed])[1].status,'unverified');
  }
  assert.equal(finishCodexNativePrerequisites(prepared,[])[1].status,'unverified');
});

test('mismatched servers, tool names, auth status and duplicate pagination are rejected or kept unverified',()=>{
  const {frame}=fixture();
  for(const mutate of [f=>{f.pages[0].data[0].name='other';},f=>{f.pages[0].data[0].tools.search_repository.name='other';},f=>{f.pages[0].data[0].authStatus='loggedIn';}]) {
    const changed=structuredClone(frame);mutate(changed);assert.throws(()=>parseNativeProviderDiscovery(changed),{code:'NATIVE_PREREQUISITE_RESPONSE_INVALID'});
  }
  const duplicate=structuredClone(frame);duplicate.pages.push(duplicate.pages[0]);assert.equal(parseNativeProviderDiscovery(duplicate).status,'unverified');
});
