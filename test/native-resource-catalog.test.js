import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';

const reviewedSha = '508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44';
const write = (file,text) => {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
function fixture(t, overrides={}) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-native-catalog-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'), kitRoot=path.join(root,'kit'), projectPath=path.join(root,'work');
  fs.mkdirSync(homeDir);fs.mkdirSync(projectPath);
  const globalSkill=path.join(homeDir,'.agents/skills/global-folder/SKILL.md'), projectSkill=path.join(projectPath,'.agents/skills/project-folder/SKILL.md');
  for(const file of [globalSkill,projectSkill]) write(file,'---\nname: review\ndescription: Review source\n---\nReview.\n');
  const config=path.join(homeDir,'.codex/config.toml');write(config,'# user configuration\n');
  let calls=0;
  const nativeInventoryObserver=async input=>{calls++;return {data:[{cwd:input.cwd,skills:[
    {name:'review',path:globalSkill,enabled:true,scope:'user',description:'DO_NOT_PERSIST'},
    {name:'review',path:projectSkill,enabled:false,scope:'repo',dependencies:{private:'DO_NOT_PERSIST'}}
  ],errors:[]}]};};
  const service=createManifestDeploymentService({definitionsDir:path.resolve('clients'),homeDir,
    binaryObserver:()=>({binaryPath:'/reviewed/codex',sha256:reviewedSha}),nativeInventoryObserver,...overrides});
  const input={kitRoot,projectPath,projectName:'default',clientId:'codex',surface:'cli'};
  return {root,homeDir,kitRoot,projectPath,globalSkill,projectSkill,config,service,input,calls:()=>calls};
}

test('native catalog is explicit, preserves both names and disabled state, and strips private metadata',async t=>{
  const f=fixture(t);const before=fs.readFileSync(f.config);
  f.service.catalog(f.input);assert.equal(f.calls(),0);
  const result=await f.service.observeCatalog(f.input);
  assert.equal(f.calls(),1);assert.equal(result.nativeObservation.status,'observed');
  assert.equal(result.nativeObservation.modelTurnsRequested,false);
  const effective=result.effective.find(item=>item.name==='review'&&item.surface==='cli');
  assert.equal(effective.status,'native-observed');assert.equal(effective.entries.length,2);
  assert.deepEqual(effective.entries.map(item=>item.activation).sort(),['disabled','enabled']);
  assert.ok(effective.entries.every(item=>!item.selected));
  assert.ok(!JSON.stringify(result).includes('DO_NOT_PERSIST'));
  assert.deepEqual(fs.readFileSync(f.config),before);
});

test('wrong context, duplicates and missing enabled fields cannot become active evidence',async t=>{
  const f=fixture(t,{nativeInventoryObserver:async input=>({data:[{cwd:input.cwd,skills:[
    {name:'review',path:input.cwd+'/.agents/skills/project-folder/SKILL.md',enabled:true,scope:'repo'},
    {name:'review',path:input.cwd+'/.agents/skills/project-folder/SKILL.md',enabled:false,scope:'repo'}
  ],errors:[]}]})});
  let result=await f.service.observeCatalog(f.input);
  assert.ok(result.effective.filter(item=>item.name==='review').every(item=>item.entries.every(entry=>entry.activation==='unknown')));
  const wrong=fixture(t,{nativeInventoryObserver:async()=>({data:[{cwd:'/unrelated',skills:[],errors:[]}]})});
  result=await wrong.service.observeCatalog(wrong.input);assert.equal(result.nativeObservation.status,'unverified');
  const missing=fixture(t,{nativeInventoryObserver:async input=>({data:[{cwd:input.cwd,skills:[{name:'review',path:path.join(input.cwd,'.agents/skills/project-folder/SKILL.md'),scope:'repo'}],errors:[]}]})});
  result=await missing.service.observeCatalog(missing.input);assert.equal(result.nativeObservation.status,'unverified');
});

test('unknown builds, unsupported surfaces and clients fail closed before starting a process',async t=>{
  const f=fixture(t,{binaryObserver:()=>({binaryPath:'/unknown/codex',sha256:'0'.repeat(64)})});
  let result=await f.service.observeCatalog(f.input);assert.equal(result.nativeObservation.reason,'CLIENT_BINARY_UNVERIFIED');assert.equal(f.calls(),0);
  result=await f.service.observeCatalog({...f.input,surface:'desktop'});assert.equal(result.nativeObservation.reason,'NATIVE_INVENTORY_UNSUPPORTED');assert.equal(f.calls(),0);
  result=await f.service.observeCatalog({...f.input,clientId:'antigravity'});assert.equal(result.nativeObservation.reason,'NATIVE_INVENTORY_UNSUPPORTED');
});

test('configuration or binary changes during native reading invalidate all positive evidence',async t=>{
  let config;
  const f=fixture(t,{nativeInventoryObserver:async input=>{write(config,'# changed during observation\n');return {data:[{cwd:input.cwd,skills:[],errors:[]}]};}});
  config=f.config;let result=await f.service.observeCatalog(f.input);
  assert.equal(result.nativeObservation.reason,'NATIVE_INVENTORY_CONTEXT_CHANGED');
  let count=0;
  const changed=fixture(t,{binaryObserver:()=>({binaryPath:'/reviewed/codex',sha256:count++===0?reviewedSha:'0'.repeat(64)})});
  result=await changed.service.observeCatalog(changed.input);assert.equal(result.nativeObservation.reason,'CLIENT_BINARY_CHANGED');
});

test('additional native roots are shown as read-only context and external links stay observation-only',async t=>{
  let externalFile, parentFile;
  const f=fixture(t,{nativeInventoryObserver:async input=>({data:[{cwd:input.cwd,skills:[
    {name:'parent-review',path:parentFile,enabled:true,scope:'repo'},
    {name:'ego-browser',path:externalFile,enabled:true,scope:'user'}
  ],errors:[]}]})});
  const external=path.join(f.homeDir,'.local/share/ego/ego-skills');fs.mkdirSync(external,{recursive:true});
  externalFile=path.join(external,'SKILL.md');write(externalFile,'---\nname: ego-browser\ndescription: External\n---\nExternal.\n');
  const link=path.join(f.homeDir,'.agents/skills/ego-browser');fs.symlinkSync(external,link);
  parentFile=path.join(f.root,'.agents/skills/parent/SKILL.md');
  const before=fs.lstatSync(link),result=await f.service.observeCatalog(f.input);
  const ego=result.observations.find(item=>item.id==='ego-browser'&&item.surface==='cli');
  assert.equal(ego.managementMode,'external');assert.equal(ego.contentRead,false);assert.equal(ego.activation,'unknown');
  assert.deepEqual(result.nativeObservation.additional.map(item=>item.name),['parent-review']);
  assert.equal(result.nativeObservation.additional[0].manageable,false);
  assert.equal(fs.lstatSync(link).ino,before.ino);assert.equal(fs.readlinkSync(link),external);
});

test('native reading can retain other clients and surfaces without borrowing their activation evidence',async t=>{
  const f=fixture(t),result=await f.service.observeCatalog({...f.input,includeOtherClients:true});
  assert.ok(result.clients.some(item=>item.id==='antigravity'));
  assert.ok(result.clients.find(item=>item.id==='codex').surfaces.some(item=>item.id==='desktop'));
  assert.ok(result.observations.filter(item=>item.surface!=='cli'||item.clientId!=='codex').every(item=>item.activation==='unknown'));
});

test('CLI native opt-in cannot execute a missing or unreviewed PATH binary',t=>{
  const f=fixture(t);
  for(const kind of ['skills','mcpServers','instructions']){
    const child=spawnSync(process.execPath,['bin/cli.js','catalog','--kit',f.kitRoot,'--client','codex','--surface','cli','--observe-native','--resource-kind',kind],{encoding:'utf8',env:{...process.env,HOME:f.homeDir,PATH:'',AGENTS_KIT_DIR:''}});
    assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.nativeObservation.reason,'CLIENT_BINARY_UNVERIFIED');assert.equal(result.nativeObservation.kind,kind);
  }
  assert.equal(fs.readFileSync(f.config,'utf8'),'# user configuration\n');
});
