import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {nativeInstallationFixture} from './helpers/native-installation-fixture.js';

const originals={
  skills:'---\nname: review\ndescription: Original review\n---\nOriginal instructions.\n',
  instructions:'# Original instructions\n\nKeep user settings.\n',
  agents:'name = "review"\ndescription = "Original review"\ndeveloper_instructions = "Original instructions."\n',
  mcpServers:'# User settings\nmodel = "preserve"\n\n[mcp_servers.review]\ncommand = "node"\nargs = ["--original"]\n\n[mcp_servers.other]\ncommand = "preserve-other"\n'
};

for(const scope of ['global','project'])for(const kind of Object.keys(originals))test(`core ${scope} ${kind}: import -> edit -> upstream merge -> adopt -> apply -> rollback preserves user files and links`,async t=>{
  const f=nativeInstallationFixture(t,{kind,scope,initialText:originals[kind],canonicalKitLayout:true});
  const external=path.join(f.targetRoot,'.agents/skills/ego-browser');fs.mkdirSync(path.dirname(external),{recursive:true});fs.symlinkSync('/external/ego-skills',external);const link=fs.lstatSync(external);
  assert.equal(fs.readFileSync(f.primary,'utf8'),f.original);assert.equal(fs.existsSync(f.statePath),false);
  let source=f.service.source(f.input);const primary=source.files.find(file=>kind!=='skills'||file.path==='SKILL.md'),kit=kind==='mcpServers'?primary.text.replace('--original','--kit'):kind==='instructions'?primary.text+'\nKit edit.\n':primary.text.replace('Original instructions.','Kit instructions.');
  f.edit([{path:primary.path,text:kit}]);assert.equal(fs.readFileSync(f.primary,'utf8'),f.original);
  const upstream=kind==='mcpServers'?f.original.replace('command = "node"','command = "upstream-node"'):kind==='instructions'?'# Upstream update\n'+f.original:f.original.replace('Original review','Upstream review');fs.writeFileSync(f.primary,upstream);
  assert.equal(f.service.checkUpstream(f.input).status,'changed');const refresh=f.service.planRefresh(f.input);assert.equal(refresh.automatic,true,JSON.stringify(refresh.details));f.service.applyRefresh({planId:refresh.planId});
  source=f.service.source(f.input);const merged=source.files.find(file=>file.path===primary.path).text;assert.ok(merged.includes(kind==='mcpServers'?'--kit':kind==='instructions'?'Kit edit.':'Kit instructions.'));assert.ok(merged.includes(kind==='mcpServers'?'upstream-node':kind==='instructions'?'# Upstream update':'Upstream review'));
  const before=fs.readFileSync(f.primary),mode=fs.statSync(f.primary).mode&0o777,identity=fs.statSync(f.primary),adopt=f.apply('adopt');assert.equal(adopt.metadataOnly,true);assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(fs.statSync(f.primary).ino,identity.ino);
  const applied=f.apply('apply');assert.ok(applied.transactionId);assert.equal(f.service.installation(f.input).installedModified,false);
  if(kind==='mcpServers'){const installed=fs.readFileSync(f.primary,'utf8');assert.ok(installed.includes('model = "preserve"'));assert.ok(installed.includes('[mcp_servers.other]\ncommand = "preserve-other"'));assert.ok(installed.includes('--kit'));assert.ok(installed.includes('upstream-node'));}
  else assert.equal(fs.readFileSync(f.primary,'utf8'),merged);
  const restore=f.service.planRollback({...f.input,transactionId:applied.transactionId});assert.equal(restore.automatic,true,JSON.stringify(restore.blocked));await f.service.rollback({planId:restore.planId});assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(fs.statSync(f.primary).mode&0o777,mode);
  const release=f.service.planRollback({...f.input,transactionId:adopt.transactionId});assert.equal(release.automatic,true,JSON.stringify(release.blocked));await f.service.rollback({planId:release.planId});assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(f.service.installation(f.input).adopted,false);
  assert.equal(fs.lstatSync(external).ino,link.ino);assert.equal(fs.lstatSync(external).mtimeMs,link.mtimeMs);assert.equal(fs.readlinkSync(external),'/external/ego-skills');assert.equal(fs.statSync(f.primary).mode&0o777,0o640);
});
