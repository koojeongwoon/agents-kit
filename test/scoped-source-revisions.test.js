import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parse,stringify} from 'yaml';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {createResourceImportService} from '../lib/application/resource-import-service.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {selectClientSurface} from '../lib/domain/client-definition.js';

function fixture(t,{scope='project',kind='skills',onPhase}={}) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-scoped-source-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),project=path.join(root,'checkout'),kitRoot=path.join(root,'kit'),globalRoot=path.join(kitRoot,'global'),projectRoot=path.join(kitRoot,'projects/work'),scopeRoot=scope==='global'?globalRoot:projectRoot,targetRoot=scope==='global'?homeDir:project;
  for(const dir of [homeDir,project,globalRoot,projectRoot])fs.mkdirSync(dir,{recursive:true});
  const global={schemaVersion:3,kit:{id:'global-source'},management:{schemaVersion:1,resources:{}},assets:{skills:[{id:'base-review',scope:'global',source:'base',definition:{schemaVersion:1,format:'agent-skills'}}]}},reference={schemaVersion:1,kitId:'global-source',scope:{type:'global'},kind:'skills',assetId:'base-review'};
  fs.mkdirSync(path.join(globalRoot,'base'));fs.writeFileSync(path.join(globalRoot,'base/SKILL.md'),'---\nname: base-review\ndescription: Base\n---\nBase.\n');
  const local={schemaVersion:3,kit:{id:'work-source'},management:{schemaVersion:1,resources:{}},targets:{codex:{projectName:'work',assetIds:['consumer']}},assets:{agents:[{id:'consumer',scope:{type:'project',projectName:'work'},dependsOn:{skills:[reference]},definition:{schemaVersion:1,permissions:'client-default',description:'Use the global source',instructions:'Use base-review.'}}]}};
  fs.writeFileSync(path.join(globalRoot,'agent-kit.yaml'),stringify(global));fs.writeFileSync(path.join(projectRoot,'agent-kit.yaml'),stringify(local));
  const definitionsDir=path.resolve('clients'),profile=selectClientSurface(loadClientDefinitions({definitionsDir}).get('codex'),'cli'),capability=profile.capabilities.find(item=>item.assetKind===(kind==='mcpServers'?'mcp':kind)&&item.scope===scope);
  const template=capability.path.replaceAll('{assetId}','native-review'),base=template.startsWith('~/')?path.join(homeDir,template.slice(2)):path.join(targetRoot,template),original=kind==='skills'?path.join(base,'SKILL.md'):base,text={skills:'---\nname: native-review\ndescription: Existing native\n---\nOriginal instructions.\n',instructions:'# Original instructions\n',agents:'name = "Native Review"\ndescription = "Existing"\ninstructions = "Original instructions."\n',mcpServers:'model = "preserve"\n[mcp_servers.native-review]\ncommand = "node"\nargs = ["native-review.js"]\n'}[kind];
  fs.mkdirSync(path.dirname(original),{recursive:true});fs.writeFileSync(original,text,{mode:0o640});
  const ego=path.join(targetRoot,'.agents/skills/ego-browser');fs.mkdirSync(path.dirname(ego),{recursive:true});fs.symlinkSync('/external/ego-skills',ego);const identity=fs.lstatSync(ego);
  const service=createManifestDeploymentService({homeDir,definitionsDir,kitRoot}),input={scopeRoot,targetRoot,scope,clientId:'codex',surface:'cli',assetId:'native-copy'};
  const item=service.localDiscovery({scope,...(scope==='project'?{projectPath:project}:{})}).find(client=>client.id==='codex').surfaces.find(surface=>surface.id==='cli').observations.find(item=>item.kind===kind&&item.managementMode==='unmanaged'&&(item.path.startsWith('~/')?path.join(homeDir,item.path.slice(2)):path.resolve(item.path))===base);assert.ok(item,kind);
  const subject=onPhase?createResourceImportService({definitionsDir,homeDir,discover:query=>service.localDiscovery(query),authorizeProject:()=>{},onPhase}):null;
  const file=path.join(scopeRoot,'agent-kit.yaml'),read=()=>parse(fs.readFileSync(file,'utf8')),write=doc=>fs.writeFileSync(file,stringify(doc));
  const preserved=()=>{assert.equal(fs.lstatSync(ego).ino,identity.ino);assert.equal(fs.lstatSync(ego).mtimeMs,identity.mtimeMs);assert.equal(fs.readlinkSync(ego),'/external/ego-skills');assert.equal(fs.existsSync(path.join(homeDir,'.agents-kit/deployments')),false);assert.equal(fs.existsSync(path.join(project,'.agent-kit')),false);};
  return {root,homeDir,project,kitRoot,globalRoot,projectRoot,scopeRoot,targetRoot,file,read,write,service,input,item,original,text,preserved,subject};
}

for(const scope of ['global','project'])for(const kind of ['skills','instructions','agents','mcpServers'])test(`v3 ${scope} ${kind} import/edit/refresh/rollback/detach retains source identity and existing client files`,t=>{
  const f=fixture(t,{scope,kind}),before=f.read(),plan=f.service.planImport({...f.input,candidateId:f.item.candidateId});assert.equal(f.read().schemaVersion,3);f.service.applyImport({planId:plan.planId});
  assert.equal(f.read().schemaVersion,3);assert.deepEqual(f.read().targets,before.targets);if(scope==='project')assert.deepEqual(f.read().assets.agents.find(asset=>asset.id==='consumer').dependsOn,before.assets.agents[0].dependsOn);
  const asset=f.read().assets[kind].find(asset=>asset.id==='native-copy');assert.deepEqual(asset.scope,scope==='global'?'global':{type:'project',projectName:'work'});
  let source=f.service.source(f.input);const primary=source.files[0].path,initial=source.files[0].text,kit=kind==='mcpServers'?initial.replace('native-review.js','kit-review.js'):initial+'\n# Kit edit\n',upstream=kind==='mcpServers'?f.text.replace('command = "node"','command = "node-upstream"'):'# Upstream update\n'+f.text;
  f.service.applySourceEdit({planId:f.service.planSourceEdit({...f.input,revision:source.revision,changes:[{path:primary,text:kit}]}).planId});assert.equal(fs.readFileSync(f.original,'utf8'),f.text);
  fs.writeFileSync(f.original,upstream);assert.equal(f.service.checkUpstream(f.input).status,'changed');const refresh=f.service.planRefresh(f.input);assert.equal(refresh.automatic,true,JSON.stringify(refresh.details));f.service.applyRefresh({planId:refresh.planId});
  source=f.service.source(f.input);assert.ok(source.files[0].text.includes(kind==='mcpServers'?'kit-review.js':'# Kit edit'));assert.ok(source.files[0].text.includes(kind==='mcpServers'?'node-upstream':'# Upstream update'));const checkpoint=source.history.at(-1);
  f.service.applySourceRollback({planId:f.service.planSourceRollback({...f.input,revision:source.revision,checkpointId:checkpoint.id}).planId});assert.equal(f.service.source(f.input).files[0].text,kit);
  const retained=f.read().management.resources['native-copy'];f.service.applyDetach({planId:f.service.planDetach(f.input).planId});assert.equal(f.read().management.resources['native-copy'].status,'detached');assert.equal(f.read().schemaVersion,3);
  f.service.applyImport({planId:f.service.planImport({...f.input,candidateId:f.item.candidateId}).planId});assert.deepEqual(f.read().management.resources['native-copy'],retained);assert.equal(fs.readFileSync(f.original,'utf8'),upstream);assert.equal(fs.statSync(f.original).mode&0o777,0o640);f.preserved();
});

test('v3 source plans bind companion sources and reject changed global references before any source write',t=>{
  const f=fixture(t);f.service.applyImport({planId:f.service.planImport({...f.input,candidateId:f.item.candidateId}).planId});const source=f.service.source(f.input),before=fs.readFileSync(f.file),plan=f.service.planSourceEdit({...f.input,revision:source.revision,changes:[{path:'SKILL.md',text:source.files[0].text+'\nKit.\n'}]});
  const global=path.join(f.globalRoot,'agent-kit.yaml');fs.appendFileSync(global,'\n# Concurrent companion edit\n');const manual=fs.readFileSync(global);assert.throws(()=>f.service.applySourceEdit({planId:plan.planId}),{code:'STALE_EDIT_CONTEXT'});assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(global),manual);f.preserved();
});

test('v3 native source management keeps direct native deployment gated and rejects mismatched scope and external links',t=>{
  const f=fixture(t);f.service.applyImport({planId:f.service.planImport({...f.input,candidateId:f.item.candidateId}).planId});assert.throws(()=>f.service.planInstallation({...f.input,mode:'adopt'}),{code:'SCOPED_DEPLOYMENT_NOT_ENABLED'});
  assert.throws(()=>f.service.source({...f.input,scope:'global',targetRoot:f.homeDir}),{code:'SCOPED_DEPLOYMENT_TARGET_MISMATCH'});
  const ego=f.service.localDiscovery({scope:'project',projectPath:f.project}).find(client=>client.id==='codex').surfaces.find(surface=>surface.id==='cli').observations.find(item=>item.id==='ego-browser');assert.ok(ego);assert.throws(()=>f.service.planImport({...f.input,assetId:'ego-copy',candidateId:ego.candidateId}),error=>['EXTERNAL_RESOURCE_READ_ONLY','IMPORT_SOURCE_UNSAFE'].includes(error.code));f.preserved();
});

test('a companion edit during source commit restores the selected Manifest and retains the companion edit',t=>{
  let mutate=false,global;
  const f=fixture(t,{onPhase:phase=>{if(mutate&&phase==='manifest'){mutate=false;fs.appendFileSync(global,'\n# Concurrent companion write\n');}}});
  f.service.applyImport({planId:f.service.planImport({...f.input,candidateId:f.item.candidateId}).planId});global=path.join(f.globalRoot,'agent-kit.yaml');
  const source=f.service.source(f.input),before=fs.readFileSync(f.file),plan=f.subject.planSourceEdit({...f.input,revision:source.revision,changes:[{path:'SKILL.md',text:source.files[0].text+'\nReviewed edit.\n'}]});mutate=true;
  assert.throws(()=>f.subject.apply({kind:'source-edit',planId:plan.planId}),{code:'STALE_EDIT_CONTEXT'});assert.deepEqual(fs.readFileSync(f.file),before);assert.ok(fs.readFileSync(global,'utf8').endsWith('# Concurrent companion write\n'));assert.equal(fs.existsSync(path.join(f.scopeRoot,'.kit-sources/journal.json')),false);f.preserved();
});

test('detaching a global native source cannot remove an uninstalled project reference',t=>{
  const f=fixture(t,{scope:'global'});f.service.applyImport({planId:f.service.planImport({...f.input,candidateId:f.item.candidateId}).planId});
  const projectFile=path.join(f.projectRoot,'agent-kit.yaml'),project=parse(fs.readFileSync(projectFile,'utf8'));project.assets.agents[0].dependsOn.skills[0].assetId='native-copy';fs.writeFileSync(projectFile,stringify(project));
  const before=fs.readFileSync(f.file),peer=fs.readFileSync(projectFile);assert.throws(()=>f.service.planDetach(f.input),{code:'DELETE_BLOCKED_BY_REFERENCES'});assert.deepEqual(fs.readFileSync(f.file),before);assert.deepEqual(fs.readFileSync(projectFile),peer);f.preserved();
});
