import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse,stringify} from 'yaml';
import {nativePrerequisiteServiceFixture} from './helpers/native-prerequisite-service-fixture.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {applyKitSourceMutation} from '../lib/infrastructure/kit-source-transaction.js';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

function fixture(t) {
  const f=nativePrerequisiteServiceFixture(t,{scoped:true}),service=createManifestDeploymentService(f.options),scopeRoot=f.project.sourceRoot,file=path.join(scopeRoot,'agent-kit.yaml');
  const read=()=>parse(fs.readFileSync(file,'utf8')),write=raw=>fs.writeFileSync(file,stringify(raw)),update=asset=>({type:'update',kind:'agents',assetId:'reviewer',asset});
  return {f,service,scopeRoot,file,read,write,update};
}

test('v3 validation resolves source-only global references without creating client or source state',t=>{
  const {f,service,scopeRoot,file}=fixture(t),before=fs.readFileSync(file),ledger=fs.readFileSync(f.f.statePath);
  const result=service.validate({scopeRoot});assert.equal(result.valid,true);assert.equal(result.readOnly,true);assert.equal(result.fulfilled,false);assert.equal(result.deploymentReady,false);assert.ok(result.dependencyGraph.globalPrerequisites.some(value=>value.assetId==='review'));
  assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.project.targetRoot,'.agent-kit')),false);assert.equal(fs.existsSync(path.join(scopeRoot,'.kit-sources')),false);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(f.f.statePath),ledger);f.f.preserved();
});

test('v3 validation reports qualified missing references and never falls back to a same-named global asset for a bare ID',t=>{
  const {service,scopeRoot,read,write}=fixture(t),raw=read();raw.assets.agents[0].dependsOn.skills=['review'];write(raw);
  const bare=service.validate({scopeRoot});assert.equal(bare.valid,false);assert.ok(bare.issues.some(issue=>issue.code==='MISSING_REFERENCE'));
  raw.assets.agents[0].dependsOn.skills=[{schemaVersion:1,kitId:'missing-kit',scope:{type:'global'},kind:'skills',assetId:'review'}];write(raw);
  const qualified=service.validate({scopeRoot});assert.equal(qualified.valid,false);assert.ok(qualified.issues.some(issue=>issue.code==='MISSING_REFERENCE'));
});

test('v3 doctor keeps native discovery and deployment readiness unverified without any write probes',t=>{
  const {f,service,scopeRoot}=fixture(t),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),ledger=fs.readFileSync(f.f.statePath);
  const result=service.doctor({scopeRoot,targetRoot:f.project.targetRoot,scope:'project',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'});
  assert.equal(result.readOnly,true);assert.equal(result.healthy,true);assert.equal(result.fulfilled,false);assert.equal(result.deploymentReady,false);assert.equal(result.nativePrerequisitesState,'unverified');assert.ok(result.checks.some(check=>check.code==='DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'&&check.status==='warning'));
  assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.project.targetRoot,'.agent-kit')),false);assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(f.f.statePath),ledger);f.f.preserved();
});

test('v3 original asset editing preserves qualified references and changes only the selected Kit manifest',t=>{
  const {f,service,scopeRoot,read,update,file}=fixture(t),raw=read(),asset={...raw.assets.agents[0],displayName:'Updated'},config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),info=fs.statSync(config),ledger=fs.readFileSync(f.f.statePath),global=fs.readFileSync(path.join(f.f.scopeRoot,'agent-kit.yaml'));
  const registry=service.registry({scopeRoot});assert.equal(registry.find(value=>value.id==='reviewer').manifestSchemaVersion,3);assert.equal(registry.find(value=>value.id==='reviewer').previewOnly,false);
  assert.deepEqual(service.resource({scopeRoot,assetId:'reviewer'}).dependsOn.skills,asset.dependsOn.skills);
  const review=service.planEdit({scopeRoot,mutations:[update(asset)]});assert.equal(read().assets.agents[0].displayName,undefined);assert.equal(review.scoped.schemaVersion,1);service.applyEdit({planId:review.planId});
  assert.equal(read().assets.agents[0].displayName,'Updated');assert.deepEqual(read().assets.agents[0].dependsOn.skills,asset.dependsOn.skills);assert.deepEqual(fs.readFileSync(config),before);assert.equal(fs.statSync(config).ino,info.ino);assert.deepEqual(fs.readFileSync(f.f.statePath),ledger);assert.deepEqual(fs.readFileSync(path.join(f.f.scopeRoot,'agent-kit.yaml')),global);assert.equal(fs.statSync(file).mode&0o777,0o644);f.f.preserved();
});

test('a source lock replaced after the Manifest write retains recovery evidence and never removes the new owner lock',t=>{
  const {scopeRoot,file}=fixture(t),before=fs.readFileSync(file),lock=path.join(scopeRoot,'.kit-sources/lock'),after=Buffer.concat([before,Buffer.from('\n# Reviewed source edit\n')]);
  assert.throws(()=>applyKitSourceMutation({scopeRoot,manifestPath:file,beforeHash:crypto.createHash('sha256').update(before).digest('hex'),content:after,onPhase:phase=>{if(phase==='manifest'){fs.renameSync(lock,lock+'.original');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token:'new-owner'}),{mode:0o600});}}}),{code:'SOURCE_MANAGEMENT_RECOVERY_REQUIRED'});
  assert.deepEqual(fs.readFileSync(file),after);assert.equal(JSON.parse(fs.readFileSync(lock)).token,'new-owner');assert.ok(fs.existsSync(path.join(scopeRoot,'.kit-sources/journal.json')));
});

test('source graph projection keeps same-named local/global nodes distinct and cannot authorize client deployment',t=>{
  const {f,service,scopeRoot,read,write,update}=fixture(t),raw=read();raw.assets.skills=[{id:'review',scope:'project',source:'local',definition:{schemaVersion:1,format:'agent-skills'}}];write(raw);
  const graph=service.dependencies({scopeRoot}),local=graph.nodes.find(node=>node.assetId==='review'&&node.local),global=graph.nodes.find(node=>node.assetId==='review'&&!node.local);assert.notEqual(local.id,global.id);assert.equal(graph.links.find(link=>link.source==='reviewer').target,global.id);
  const edit=service.planEdit({scopeRoot,mutations:[update({...raw.assets.agents[0],displayName:'Only source'})]});assert.throws(()=>service.apply({planId:edit.planId,verified:true}),{code:'DEPLOYMENT_PLAN_NOT_FOUND'});service.applyEdit({planId:edit.planId});assert.equal(read().assets.agents[0].displayName,'Only source');assert.equal(f.calls.length,0);f.f.preserved();
});

test('v3 validation reports unsafe referenced sources while an edit preserves a locked companion and current settings',t=>{
  const {f,service,scopeRoot,read,update,file}=fixture(t),review=service.planEdit({scopeRoot,mutations:[update({...read().assets.agents[0],displayName:'Reviewed'})]}),before=fs.readFileSync(file),lock=path.join(f.f.scopeRoot,'.kit-sources/lock');fs.mkdirSync(path.dirname(lock),{recursive:true});fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token:'other-edit'}),{mode:0o600});
  assert.throws(()=>service.applyEdit({planId:review.planId}),{code:'SOURCE_MANAGEMENT_LOCKED'});assert.deepEqual(fs.readFileSync(file),before);assert.equal(JSON.parse(fs.readFileSync(lock)).token,'other-edit');fs.unlinkSync(lock);
  const source=path.join(f.f.scopeRoot,'review'),outside=path.join(f.f.root,'outside-kit');fs.mkdirSync(outside);fs.renameSync(source,source+'.saved');fs.symlinkSync(outside,source);const result=service.validate({scopeRoot});assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.code==='SOURCE_OUTSIDE_SCOPE'));assert.equal(f.calls.length,0);f.f.preserved();
});

test('v3 edits reject companion source changes after review and preserve both manifests',t=>{
  const {f,service,scopeRoot,read,update,file}=fixture(t),before=fs.readFileSync(file),review=service.planEdit({scopeRoot,mutations:[update({...read().assets.agents[0],displayName:'Updated'})]}),global=path.join(f.f.scopeRoot,'agent-kit.yaml');
  fs.appendFileSync(global,'\n# Concurrent global source update\n');const manual=fs.readFileSync(global);assert.throws(()=>service.applyEdit({planId:review.planId}),{code:'STALE_EDIT_CONTEXT'});assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(global),manual);f.f.preserved();
});

for(const version of [1,3])test(`global v${version} deletion is blocked by an uninstalled v3 project declaration without a registered dependency`,t=>{
  const {f,service,scopeRoot}=fixture(t);f.f.raw.schemaVersion=version;if(version===3)f.f.raw.management={schemaVersion:1,resources:{}};f.f.write();
  assert.throws(()=>service.planEdit({scopeRoot:f.f.scopeRoot,mutations:[{type:'delete',kind:'skills',assetId:'review'}]}),error=>error.code==='DELETE_BLOCKED_BY_REFERENCES'&&error.details?.issues.some(issue=>issue.projectName==='default'));
  assert.equal(service.validate({scopeRoot}).valid,true);assert.equal(f.f.state().dependencyIndex,undefined);f.f.preserved();
});

test('ordinary doctor is read-only and never creates deployment metadata in an otherwise untouched target',t=>{
  const {f}=fixture(t),metadata=path.join(f.f.homeDir,'.agent-kit');assert.equal(fs.existsSync(metadata),false);
  const result=f.f.service.doctor(f.f.input);assert.equal(result.readOnly,true);assert.equal(result.deploymentReady,false);assert.equal(fs.existsSync(metadata),false);f.f.preserved();
});

test('source transaction preserves a replacement lock and stops before writing the Manifest',t=>{
  const {scopeRoot,file}=fixture(t),before=fs.readFileSync(file),lock=path.join(scopeRoot,'.kit-sources/lock');let replace=true;
  assert.throws(()=>applyKitSourceMutation({scopeRoot,manifestPath:file,beforeHash:crypto.createHash('sha256').update(before).digest('hex'),content:Buffer.concat([before,Buffer.from('\n# Proposed\n')]),revalidate:()=>{if(replace){replace=false;fs.renameSync(lock,lock+'.original');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token:'replacement-owner'}),{mode:0o600});}}}),{code:'SOURCE_MANAGEMENT_LOCK_CHANGED'});
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(JSON.parse(fs.readFileSync(lock)).token,'replacement-owner');
});

test('v3 edit review isolates nested mutations and returned metadata from its private source command',t=>{
  const {service,scopeRoot,read,update}=fixture(t),asset={...read().assets.agents[0],displayName:'Reviewed'},review=service.planEdit({scopeRoot,mutations:[update(asset)]});
  try{asset.dependsOn.skills[0].assetId='forged';}catch{/* Frozen caller data is also isolated. */}
  try{review.mutations[0].asset.definition.instructions='Unreviewed';}catch{}
  service.applyEdit({planId:review.planId});assert.equal(read().assets.agents[0].displayName,'Reviewed');assert.equal(read().assets.agents[0].dependsOn.skills[0].assetId,'review');assert.equal(read().assets.agents[0].definition.instructions,'Review with prerequisites.');
});

test('qualified global dependencies do not block deletion of an unrelated same-named local asset',t=>{
  const {f,service,scopeRoot,read,write}=fixture(t),raw=read();fs.mkdirSync(path.join(scopeRoot,'local-review'));fs.writeFileSync(path.join(scopeRoot,'local-review/SKILL.md'),'---\nname: local-review\ndescription: Local\n---\nLocal.\n');
  raw.assets.skills=[{id:'review',scope:'project',source:'local-review',definition:{schemaVersion:1,format:'agent-skills'}}];raw.targets.codex.assetIds.push('review');write(raw);
  const plan=service.planEdit({scopeRoot,mutations:[{type:'delete',kind:'skills',assetId:'review'}]});service.applyEdit({planId:plan.planId});assert.deepEqual(read().assets.skills,[]);assert.ok(!read().targets.codex.assetIds.includes('review'));assert.equal(service.validate({scopeRoot}).valid,true);f.f.preserved();
});

test('a project named global remains a project source and resolves its own qualified global prerequisite',t=>{
  const {f,service,scopeRoot,read}=fixture(t),raw=read(),named=path.join(path.dirname(scopeRoot),'global');
  for(const asset of Object.values(raw.assets).flat())asset.scope={type:'project',projectName:'global'};raw.targets.codex.projectName='global';fs.renameSync(scopeRoot,named);fs.writeFileSync(path.join(named,'agent-kit.yaml'),stringify(raw));
  const result=service.validate({scopeRoot:named});assert.equal(result.valid,true);assert.ok(result.dependencyGraph.nodes.some(node=>node.scope.type==='project'&&node.scope.projectName==='global'));f.f.preserved();
});

test('CLI validates, diagnoses and edits v3 sources through the shared service without touching client files',t=>{
  const {f,scopeRoot,file,read,update}=fixture(t),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),ledger=fs.readFileSync(f.f.statePath),manifest=fs.readFileSync(file),mutations=path.join(f.f.root,'mutations.json');fs.writeFileSync(mutations,JSON.stringify([update({...read().assets.agents[0],displayName:'CLI updated'}),{type:'create',kind:'agents',assetId:'extra-reviewer',asset:read().assets.agents[0]}]));
  const run=args=>spawnSync(process.execPath,[path.resolve('bin/cli.js'),...args],{encoding:'utf8',timeout:20000,env:{...process.env,HOME:f.f.homeDir,CODEX_HOME:path.join(f.f.homeDir,'.codex'),AGENTS_KIT_DIR:''}}),common=['--kit',f.f.kitRoot,'--project',f.project.targetRoot];
  let result=run(['validate',...common]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).valid,true);
  result=run(['doctor',...common]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).readOnly,true);assert.equal(fs.existsSync(path.join(f.project.targetRoot,'.agent-kit')),false);
  result=run(['manifest-edit',...common,'--mutations',mutations,'--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).scoped.deploymentChanged,false);assert.deepEqual(fs.readFileSync(file),manifest);
  result=run(['manifest-edit',...common,'--mutations',mutations]);assert.equal(result.status,0,result.stderr);assert.equal(read().assets.agents[0].displayName,'CLI updated');assert.ok(read().assets.agents.some(asset=>asset.id==='extra-reviewer'));assert.ok(!read().targets.codex.assetIds.includes('extra-reviewer'));assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(f.f.statePath),ledger);f.f.preserved();
});

test('native source detach preserves an uninstalled v3 project reference through the common source guard',t=>{
  const {f,service,read,write}=fixture(t),original=path.join(f.f.homeDir,'.agents/skills/native-review');fs.mkdirSync(original);fs.writeFileSync(path.join(original,'SKILL.md'),'---\nname: native-review\ndescription: Existing\n---\nPreserve.\n');
  const candidate=service.localDiscovery().find(client=>client.id==='codex').surfaces.find(surface=>surface.id==='cli').observations.find(item=>item.kind==='skills'&&item.id==='native-review'),input={scope:'global',scopeRoot:f.f.scopeRoot,targetRoot:f.f.homeDir,clientId:'codex',surface:'cli'};assert.ok(candidate);
  service.applyImport({planId:service.planImport({...input,candidateId:candidate.candidateId}).planId});const raw=read();raw.assets.agents[0].dependsOn.skills=[{schemaVersion:1,kitId:f.f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'native-review'}];write(raw);
  const manifest=path.join(f.f.scopeRoot,'agent-kit.yaml'),before=fs.readFileSync(manifest);assert.throws(()=>service.planDetach({...input,assetId:'native-review'}),{code:'DELETE_BLOCKED_BY_REFERENCES'});assert.deepEqual(fs.readFileSync(manifest),before);assert.ok(fs.readFileSync(path.join(original,'SKILL.md'),'utf8').includes('Preserve.'));f.f.preserved();
});

test('replacing a v3 declaration under the same stable ID preserves its existing client target selection',t=>{
  const {service,scopeRoot,read}=fixture(t),before=read(),review=service.planEdit({scopeRoot,mutations:[{type:'delete',kind:'agents',assetId:'reviewer'},{type:'create',kind:'agents',assetId:'reviewer',asset:{...before.assets.agents[0],displayName:'Replacement'}}]});
  service.applyEdit({planId:review.planId});assert.deepEqual(read().targets,before.targets);assert.equal(read().assets.agents[0].displayName,'Replacement');
});

test('v3 deletion validates the final mutation batch and removes only absent IDs from client targets',t=>{
  const {service,scopeRoot,read}=fixture(t),review=service.planEdit({scopeRoot,mutations:[{type:'delete',kind:'agents',assetId:'reviewer'},{type:'delete',kind:'mcpServers',assetId:'local-docs'}]});service.applyEdit({planId:review.planId});
  assert.deepEqual(read().targets.codex.assetIds,[]);assert.deepEqual(read().assets.agents,[]);assert.deepEqual(read().assets.mcpServers,[]);assert.equal(service.validate({scopeRoot}).valid,true);
});

test('a companion lock replaced during the Manifest write preserves its new owner and restores the selected source',t=>{
  const {f,service,scopeRoot,file,read,update}=fixture(t),before=fs.readFileSync(file),review=service.planEdit({scopeRoot,mutations:[update({...read().assets.agents[0],displayName:'Reviewed'})]}),lock=path.join(f.f.scopeRoot,'.kit-sources/lock'),rename=fs.renameSync;let replace=true;
  fs.renameSync=(source,target)=>{const result=rename(source,target);if(replace&&target===file){replace=false;rename(lock,lock+'.original');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token:'new-companion-owner'}),{mode:0o600});}return result;};
  try{assert.throws(()=>service.applyEdit({planId:review.planId}),{code:'SOURCE_MANAGEMENT_LOCK_CHANGED'});}finally{fs.renameSync=rename;}
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(JSON.parse(fs.readFileSync(lock)).token,'new-companion-owner');f.f.preserved();
});
