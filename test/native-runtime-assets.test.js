import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse} from 'yaml';
import {createClientDefinition,resolveClientCapability} from '../lib/domain/client-definition.js';
import {nativeRuntimeAsset} from '../lib/adapters/native-runtime-asset.js';

const record={kind:'mcpServers',nativeId:'node_repl',format:'toml-section'};
const asset={id:'node-repl',source:'native.toml',scope:{type:'global'}};
const input={surface:'cli',clientVersion:'0.0.2-test',platform:'darwin',arch:'arm64',assetKind:'mcp',scope:'global'};
function definition(){const raw=parse(fs.readFileSync(path.resolve('clients/codex.yaml'),'utf8'));raw.surfaces[0].runtimeEvidence=[{capabilityId:'mcp-global',version:input.clientVersion,platform:input.platform,arch:input.arch,verifiedAt:'2026-11-05',source:'synthetic unit fixture',resourceProfile:'mcp-native-stdio-options-v1'}];return createClientDefinition(raw);}
const body='[mcp_servers.node_repl]\ncommand = "node"\nargs = ["--before"]\nenv_vars = ["PASSTHROUGH"]\nstartup_timeout_sec = 15\n[mcp_servers.node_repl.env]\nPATH_HINT = "/tmp/path"\n';

test('a native stdio evidence profile preserves validated options and native names separately from logical asset IDs',()=>{
  const native=nativeRuntimeAsset(asset,record,body),client=definition();
  assert.equal(native.source,asset.source);assert.equal(native.definition,undefined);
  assert.equal(resolveClientCapability(client,{...input,asset:native}).eligible,true);
  assert.equal(resolveClientCapability(client,{...input,asset:JSON.parse(JSON.stringify(native))}).reason,'CLIENT_RESOURCE_PROFILE_UNVERIFIED');
  assert.equal(resolveClientCapability(client,{...input,asset:{...asset,nativeRuntimeProfile:'mcp-native-stdio-options-v1'}}).eligible,false);
});

test('native stdio classification refuses unknown fields, literal credentials, invalid environment shapes and ambiguous native units',()=>{
  const client=definition();
  for(const content of [body+'unknown = true\n',body.replace('startup_timeout_sec = 15','startup_timeout_sec = -1'),body.replace('PATH_HINT = "/tmp/path"','API_TOKEN = "literal-secret"'),body.replace('env_vars = ["PASSTHROUGH"]','env_vars = ["BAD-NAME"]'),body+'[mcp_servers.other]\ncommand = "other"\n',body+'PATH_HINT = "duplicate"\n']){
    assert.equal(resolveClientCapability(client,{...input,asset:nativeRuntimeAsset(asset,record,content)}).eligible,false);
  }
});

test('basic native MCP classification reuses the selected TOML parser for quoted names and literal strings',()=>{
  for(const header of ['[mcp_servers.review]','[mcp_servers."review"]']){
    const converted=nativeRuntimeAsset({...asset,id:'review'},{...record,nativeId:'review'},`${header}\ncommand = 'node'\nargs = ["--before"]\n`);
    assert.equal(converted.definition?.transport,'stdio');assert.deepEqual(converted.definition.args,['--before']);assert.equal(converted.source,undefined);
  }
});
