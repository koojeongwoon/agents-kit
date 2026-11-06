import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse} from 'yaml';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {declareDistribution} from './helpers/skill-distribution-fixture.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {sourceHash} from '../lib/infrastructure/kit-source-transaction.js';
import {sourceInventory} from '../lib/infrastructure/kit-source-snapshot.js';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
import {inspectSkillDistributionSources} from '../lib/infrastructure/skill-distribution-source.js';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {nativePrerequisiteServiceFixture} from './helpers/native-prerequisite-service-fixture.js';

function fixture(t) {
  const f=resourcePathFixture(t),source=path.join(f.scopeRoot,'review');fs.renameSync(source,source+'-old');fs.mkdirSync(source);fs.renameSync(source+'-old',path.join(source,'a'));fs.cpSync(path.join(source,'a'),path.join(source,'b'),{recursive:true});
  fs.writeFileSync(path.join(source,'a/references/help.md'),'alpha\nbase\nomega\n');
  declareDistribution(f,{variants:[{id:'a',source:'a',targets:[{clientId:'codex',surface:'cli'}]},{id:'b',source:'b',targets:[]}]});
  return {...f,source,input:{...f.input,assetId:'review',variantId:'a'},doc:()=>parse(fs.readFileSync(path.join(f.scopeRoot,'agent-kit.yaml'),'utf8'))};
}

test('registering a variant creates independent source/baseline records without moving the original, other variants or installed files',t=>{
  const f=fixture(t),other=fs.readFileSync(path.join(f.source,'b/SKILL.md')),original=fs.lstatSync(path.join(f.source,'a/SKILL.md')),state=fs.readFileSync(f.statePath),before=fs.readFileSync(path.join(f.scopeRoot,'agent-kit.yaml'));
  const plan=f.service.planVariantRegistration(f.input);assert.equal(plan.automatic,true);assert.deepEqual(fs.readFileSync(path.join(f.scopeRoot,'agent-kit.yaml')),before);f.service.applyVariantRegistration({planId:plan.planId});
  const distribution=f.doc().assets.skills[0].definition.distribution;assert.equal(distribution.schemaVersion,2);assert.equal(distribution.variants[0].source.type,'managed');assert.equal(distribution.variants[1].source,'b');
  const read=f.service.source(f.input);assert.equal(read.variantId,'a');assert.equal(read.origin.type,'kit');assert.equal(read.files.find(file=>file.path==='references/help.md').text,'alpha\nbase\nomega\n');
  assert.deepEqual(fs.readFileSync(path.join(f.source,'b/SKILL.md')),other);assert.equal(fs.lstatSync(path.join(f.source,'a/SKILL.md')).ino,original.ino);assert.deepEqual(fs.readFileSync(f.statePath),state);f.preserved();
});

test('variant edit, local reimport, nonoverlapping merge and rollback preserve independent baselines and the existing installation',t=>{
  const f=fixture(t);f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});
  const first=f.service.source(f.input),state=fs.readFileSync(f.statePath),other=JSON.stringify(f.doc().assets.skills[0].definition.distribution.variants[1]);
  f.service.applySourceEdit({planId:f.service.planSourceEdit({...f.input,revision:first.revision,changes:[{path:'references/help.md',text:'KIT\nbase\nomega\n'}]}).planId});
  fs.writeFileSync(path.join(f.source,'a/references/help.md'),'alpha\nbase\nUPSTREAM\n');assert.equal(f.service.checkUpstream(f.input).status,'changed');
  const refreshed=f.service.planRefresh(f.input);assert.equal(refreshed.automatic,true);f.service.applyRefresh({planId:refreshed.planId});
  let current=f.service.source(f.input);assert.equal(current.files.find(file=>file.path==='references/help.md').text,'KIT\nbase\nUPSTREAM\n');
  f.service.applySourceRollback({planId:f.service.planSourceRollback({...f.input,revision:current.revision,checkpointId:current.history.at(-1).id}).planId});
  current=f.service.source(f.input);assert.equal(current.files.find(file=>file.path==='references/help.md').text,'KIT\nbase\nomega\n');
  assert.equal(JSON.stringify(f.doc().assets.skills[0].definition.distribution.variants[1]),other);assert.deepEqual(fs.readFileSync(f.statePath),state);f.preserved();
});

test('editing a managed variant expires its old compatibility review rather than silently deploying the draft',t=>{
  const f=fixture(t);f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});
  f.raw=f.doc();f.raw.targets={codex:{assetIds:['review']}};fs.writeFileSync(path.join(f.scopeRoot,'agent-kit.yaml'),JSON.stringify(f.raw));
  const unchanged=f.service.plan(f.input);assert.equal(unchanged.automatic,true,JSON.stringify(unchanged.blocked));
  const read=f.service.source(f.input);f.service.applySourceEdit({planId:f.service.planSourceEdit({...f.input,revision:read.revision,changes:[{path:'references/help.md',text:'New draft\n'}]}).planId});
  assert.throws(()=>f.service.plan(f.input),{code:'SKILL_COMPATIBILITY_SOURCE_CHANGED'});f.preserved();
});

test('generic declaration edits preserve managed variant records while allowing a renewed author review',t=>{
  const f=fixture(t);f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});
  const asset=f.doc().assets.skills[0],replacement=structuredClone(asset);replacement.definition.distribution.variants[0].source.record.origin.path='other';
  assert.throws(()=>f.service.planEdit({scopeRoot:f.scopeRoot,mutations:[{type:'update',kind:'skills',assetId:'review',asset:replacement}]}),{code:'MANAGED_VARIANT_EDIT_UNSUPPORTED'});
  assert.throws(()=>f.service.planEdit({scopeRoot:f.scopeRoot,mutations:[{type:'delete',kind:'skills',assetId:'review'}]}),{code:'MANAGED_VARIANT_EDIT_UNSUPPORTED'});
  asset.displayName='Review variants';asset.definition.distribution.variants[0].compatibility[0].review.treeDigest='c'.repeat(64);assert.doesNotThrow(()=>f.service.planEdit({scopeRoot:f.scopeRoot,mutations:[{type:'update',kind:'skills',assetId:'review',asset}]}));f.preserved();
});

test('partial conflict deferral retains the variant baseline and stale source plans cannot replace newer edits',t=>{
  const f=fixture(t);f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});
  let read=f.service.source(f.input);f.service.applySourceEdit({planId:f.service.planSourceEdit({...f.input,revision:read.revision,changes:[{path:'references/help.md',text:'KIT\nbase\nomega\n'}]}).planId});
  fs.writeFileSync(path.join(f.source,'a/references/help.md'),'UPSTREAM\nbase\nomega\n');
  const conflict=f.service.planRefresh(f.input);assert.equal(conflict.automatic,false);assert.throws(()=>f.service.applyRefresh({planId:conflict.planId}),{code:'SOURCE_MANAGEMENT_PLAN_BLOCKED'});
  const deferred=f.service.planRefresh({...f.input,reviewHash:conflict.reviewHash,resolutions:{'references/help.md':{choice:'defer'}}});f.service.applyRefresh({planId:deferred.planId});
  read=f.service.source(f.input);assert.deepEqual(read.lastCheck.deferred,['references/help.md']);assert.equal(f.service.checkUpstream(f.input).status,'changed');
  const stale=f.service.planRefresh({...f.input,reviewHash:f.service.planRefresh(f.input).reviewHash,resolutions:{'references/help.md':{choice:'upstream'}}});
  f.service.applySourceEdit({planId:f.service.planSourceEdit({...f.input,revision:read.revision,changes:[{path:'notes.md',text:'Newer Kit edit\n'}]}).planId});
  assert.throws(()=>f.service.applyRefresh({planId:stale.planId}),{code:'STALE_SOURCE_MANAGEMENT_PLAN'});assert.equal(f.service.source(f.input).files.find(file=>file.path==='references/help.md').text,'KIT\nbase\nomega\n');f.preserved();
});

test('pinned upstream refresh and rollback are scoped to one variant and never refetch reviewed immutable bytes during apply',async t=>{
  const f=fixture(t);let incoming='alpha\nbase\nREMOTE\n',downloads=0;
  const upstreamReader=async()=>{downloads++;const files=[{path:'SKILL.md',content:fs.readFileSync(path.join(f.source,'a/SKILL.md')),mode:0o644},{path:'references/help.md',content:Buffer.from(incoming),mode:0o644}].map(file=>({...file,sha256:sourceHash(file.content)}));const inventory=sourceInventory(files);return {files,inventory,fingerprint:sourceHash(JSON.stringify(inventory))};};
  const service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,upstreamReader});service.applyVariantRegistration({planId:service.planVariantRegistration(f.input).planId});
  const pin={schemaVersion:1,type:'git',repository:'https://github.com/example/variant.git',commit:'a'.repeat(40),subpath:'skills/a'};
  const plan=await service.planRefresh({...f.input,upstream:pin}),count=downloads;service.applyRefresh({planId:plan.planId});assert.equal(downloads,count);
  const state=service.source(f.input);assert.deepEqual(state.upstream,pin);assert.equal(state.files.find(file=>file.path==='references/help.md').text,incoming);
  service.applySourceRollback({planId:service.planSourceRollback({...f.input,revision:state.revision,checkpointId:state.history.at(-1).id}).planId});assert.equal(service.source(f.input).upstream,null);assert.equal(f.doc().assets.skills[0].definition.distribution.variants[1].source,'b');f.preserved();
});

test('managed source selection can deploy after renewed review and records the exact source revision',t=>{
  const f=fixture(t);f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});
  const source=f.service.source(f.input);f.service.applySourceEdit({planId:f.service.planSourceEdit({...f.input,revision:source.revision,changes:[{path:'references/help.md',text:'New reviewed content\n',mode:0o750}]}).planId});
  const doc=f.doc(),asset=createAgentKitManifest(doc).assets.skills[0],tree=inspectSkillDistributionSources(asset,path.join(f.scopeRoot,'review'),{scopeRoot:f.scopeRoot,variantIds:['a']}).get('a').descriptor;
  doc.assets.skills[0].definition.distribution.variants[0].compatibility[0].review.treeDigest=tree.treeDigest;doc.targets={codex:{assetIds:['review']}};fs.writeFileSync(path.join(f.scopeRoot,'agent-kit.yaml'),JSON.stringify(doc));
  const plan=f.service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.equal(plan.skillDistributions[0].selection.schemaVersion,2);
  const result=f.service.apply({planId:plan.planId}),record=f.state().transactions.find(tx=>tx.id===result.transactionId).skillSelections[0];assert.equal(record.selection.sourceRevision.revisionId,f.service.source(f.input).source.split('/').at(-1));
  assert.equal(fs.readFileSync(path.join(f.targetRoot,'.agents/skills/review/references/help.md'),'utf8'),'New reviewed content\n');assert.equal(fs.statSync(path.join(f.targetRoot,'.agents/skills/review/references/help.md')).mode&0o777,0o750);f.preserved();
});

test('managed source artifacts and local origin links are rechecked before mutation',t=>{
  const f=fixture(t);const registration=f.service.planVariantRegistration(f.input);fs.appendFileSync(path.join(f.source,'a/SKILL.md'),'Changed origin\n');assert.throws(()=>f.service.applyVariantRegistration({planId:registration.planId}),{code:'IMPORT_SOURCE_CHANGED'});
  f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});const read=f.service.source(f.input);
  const plan=f.service.planSourceEdit({...f.input,revision:read.revision,changes:[{path:'notes.md',text:'Pending\n'}]});fs.appendFileSync(path.join(f.scopeRoot,read.source,'SKILL.md'),'Tampered immutable source\n');
  assert.throws(()=>f.service.applySourceEdit({planId:plan.planId}),{code:'IMPORT_ARTIFACT_MODIFIED'});f.preserved();
});

test('local native origin registration preserves existing Kit modifications against an independent upstream baseline',t=>{
  const f=fixture(t),upstream=path.join(f.homeDir,'.agents/skills/review');fs.mkdirSync(path.join(upstream,'references'),{recursive:true});fs.copyFileSync(path.join(f.source,'a/SKILL.md'),path.join(upstream,'SKILL.md'));fs.writeFileSync(path.join(upstream,'references/help.md'),'alpha\nUPSTREAM\nomega\n');
  const client=f.service.localDiscovery({scope:'global'}).find(client=>client.id==='codex'),candidate=client.surfaces.find(surface=>surface.id==='cli').observations.find(item=>item.kind==='skills'&&item.id==='review');assert.ok(candidate);
  f.service.applyVariantRegistration({planId:f.service.planVariantRegistration({...f.input,sourceScope:'global',candidateId:candidate.candidateId}).planId});
  assert.equal(f.service.checkUpstream(f.input).status,'unchanged');assert.equal(f.service.checkUpstream(f.input).kitModified,true);
  fs.writeFileSync(path.join(upstream,'references/help.md'),'alpha\nUPSTREAM\nNEW\n');const plan=f.service.planRefresh(f.input);assert.equal(plan.automatic,true);f.service.applyRefresh({planId:plan.planId});
  assert.equal(f.service.source(f.input).files.find(file=>file.path==='references/help.md').text,'alpha\nbase\nNEW\n');assert.equal(fs.readFileSync(path.join(upstream,'references/help.md'),'utf8'),'alpha\nUPSTREAM\nNEW\n');f.preserved();
});

test('native variant metadata survives edits and external ego source binding is rejected before content is opened',t=>{
  const f=fixture(t),native=path.join(f.source,'a/agents/openai.yaml');fs.mkdirSync(path.dirname(native));fs.writeFileSync(native,'interface:\n  display_name: Native variant\n',{mode:0o600});const doc=f.doc();doc.assets.skills[0].definition.distribution.variants[0].format='native';fs.writeFileSync(path.join(f.scopeRoot,'agent-kit.yaml'),JSON.stringify(doc));
  f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});const read=f.service.source(f.input);f.service.applySourceEdit({planId:f.service.planSourceEdit({...f.input,revision:read.revision,changes:[{path:'references/help.md',text:'Native notes\n'}]}).planId});
  assert.equal(f.service.source(f.input).files.find(file=>file.path==='agents/openai.yaml').text,'interface:\n  display_name: Native variant\n');assert.equal(fs.statSync(native).mode&0o777,0o600);
  const egoRoot=path.join(f.homeDir,'.local/share/ego/ego-skills'),ego=path.join(f.homeDir,'.agents/skills/ego-browser');fs.mkdirSync(egoRoot,{recursive:true});fs.writeFileSync(path.join(egoRoot,'SKILL.md'),'External original\n');fs.mkdirSync(path.dirname(ego),{recursive:true});fs.symlinkSync(egoRoot,ego);
  const client=f.service.localDiscovery({scope:'global'}).find(client=>client.id==='codex'),candidate=client.surfaces.find(surface=>surface.id==='cli').observations.find(item=>item.id==='ego-browser');assert.equal(candidate.managementMode,'external');
  const originalRead=fs.readFileSync;fs.readFileSync=(file,...args)=>{if(String(file).startsWith(egoRoot))throw new Error('External content must not be read');return originalRead(file,...args);};
  try{assert.throws(()=>f.service.planVariantRegistration({...f.input,variantId:'b',sourceScope:'global',candidateId:candidate.candidateId}),{code:'EXTERNAL_RESOURCE_READ_ONLY'});}finally{fs.readFileSync=originalRead;}
  assert.equal(fs.readlinkSync(ego),egoRoot);f.preserved();
});

test('variant source edits recover across SIGKILL before and after Manifest commit without touching the installation or the other variant',t=>{
  for(const phase of ['source','manifest']) {
    const f=fixture(t);f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(f.input).planId});const before=f.service.source(f.input),state=fs.readFileSync(f.statePath),other=JSON.stringify(f.doc().assets.skills[0].definition.distribution.variants[1]);
    const module=pathToFileURL(path.resolve('lib/application/resource-import-service.js')).href;
    const script=`import {createResourceImportService} from ${JSON.stringify(module)};const i=${JSON.stringify(f.input)};const s=createResourceImportService({definitionsDir:${JSON.stringify(f.definitionsDir)},homeDir:${JSON.stringify(f.homeDir)},discover:()=>[],authorizeProject:()=>{},onPhase:p=>{if(p===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL')}});const plan=s.planSourceEdit({...i,revision:s.source(i).revision,changes:${JSON.stringify([{path:'notes.md',text:'Recovered variant notes\n'}])}});s.apply({kind:'source-edit',planId:plan.planId});`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:20000});assert.equal(child.signal,'SIGKILL',child.stderr);
    assert.throws(()=>f.service.source(f.input),{code:'SOURCE_MANAGEMENT_RECOVERY_REQUIRED'});const recovery=f.service.planSourceRecovery(f.input);f.service.recoverSources({planId:recovery.planId});
    const current=f.service.source(f.input);if(phase==='manifest')assert.ok(current.files.some(file=>file.path==='notes.md'));else assert.equal(current.source,before.source);
    assert.deepEqual(fs.readFileSync(f.statePath),state);assert.equal(JSON.stringify(f.doc().assets.skills[0].definition.distribution.variants[1]),other);f.preserved();
  }
});

test('updating an unselected variant preserves installed evidence for the selected variant and its project prerequisite',t=>{
  const fixture=nativePrerequisiteServiceFixture(t,{scoped:true}),{f}=fixture,source=path.join(f.scopeRoot,'review');fs.renameSync(source,source+'-old');fs.mkdirSync(source);fs.renameSync(source+'-old',path.join(source,'b'));fs.cpSync(path.join(source,'b'),path.join(source,'a'),{recursive:true});
  declareDistribution(f,{variants:[{id:'a',source:'a',targets:[]},{id:'b',source:'b',targets:[{clientId:'codex',surface:'cli'}]}]});f.raw.targets={codex:{assetIds:['review']}};f.write();f.service.apply({planId:f.service.plan(f.input).planId});
  const service=createManifestDeploymentService({...fixture.options,kitRoot:f.kitRoot}),input={kitRoot:f.kitRoot,scopeRoot:fixture.project.sourceRoot,targetRoot:fixture.project.targetRoot,scope:'project',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};
  assert.equal(service.plan(input).execution.status,'requires-observation');const state=fs.readFileSync(f.statePath),variant={...f.input,assetId:'review',variantId:'a'};
  f.service.applyVariantRegistration({planId:f.service.planVariantRegistration(variant).planId});const read=f.service.source(variant);f.service.applySourceEdit({planId:f.service.planSourceEdit({...variant,revision:read.revision,changes:[{path:'notes.md',text:'Only variant A changed.\n'}]}).planId});
  const next=service.plan(input);assert.equal(next.execution.status,'requires-observation',JSON.stringify(next.blocked));assert.deepEqual(fs.readFileSync(f.statePath),state);assert.equal(fixture.calls.length,0);f.preserved();
});
