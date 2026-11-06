import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse,stringify} from 'yaml';
import {spawnSync} from 'node:child_process';
import {nativePrerequisiteServiceFixture} from './helpers/native-prerequisite-service-fixture.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {canonicalDigest} from '../lib/infrastructure/saved-deployment-plan-store.js';

function fixture(t,options={}) {
  const f=nativePrerequisiteServiceFixture(t,{...options,scoped:true}),restart=()=>createManifestDeploymentService(f.options),service=restart();
  const input={scope:'project',scopeRoot:f.project.sourceRoot,targetRoot:f.project.targetRoot,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};
  return {f,service,restart,input};
}

test('public scoped review requires a private native observation and applies through both coordinated locks',async t=>{
  const {f,service,input}=fixture(t),global=fs.readFileSync(f.f.mcp),external=path.join(f.project.targetRoot,'.agents/skills/ego-browser'),identity=fs.lstatSync(external);
  const review=service.plan(input);assert.equal(review.execution?.status,'requires-observation');assert.equal(review.automatic,false);assert.equal(f.calls.length,0);
  const ready=await service.observeDeploymentPrerequisites({planId:review.planId});assert.equal(ready.execution.status,'ready');assert.equal(ready.automatic,true);assert.equal(ready.nativePrerequisitesState,'observed');
  const applied=await service.apply({planId:ready.planId});assert.equal(applied.outcome,'committed');assert.equal(applied.fulfilled,false);assert.equal(f.calls.length,2);
  assert.deepEqual(fs.readFileSync(f.f.mcp),global);assert.equal(service.history(input).at(-1).status,'committed');assert.equal(fs.readlinkSync(external),'/external/ego-skills');assert.equal(fs.lstatSync(external).ino,identity.ino);f.f.preserved();
});

test('public flags cannot replace native observation or silently authorize provider discovery',async t=>{
  const {f,service,input}=fixture(t,{bound:true}),review=service.plan(input);
  await assert.rejects(async()=>service.apply({planId:review.planId,verified:true,observeProviders:true}),{code:'SCOPED_NATIVE_OBSERVATION_REQUIRED'});assert.equal(f.calls.length,0);
  const planned=service.plan(input),metadata=await service.observeDeploymentPrerequisites({planId:planned.planId});assert.equal(metadata.execution.status,'requires-observation');assert.deepEqual(f.calls[0].serverNames,[]);
  const ready=await service.observeDeploymentPrerequisites({planId:metadata.planId,observeProviders:true});assert.equal(ready.execution.status,'ready');assert.deepEqual(f.calls[1].serverNames,['docs']);
  await service.apply({planId:ready.planId});assert.deepEqual(f.calls[2].serverNames,['docs']);f.f.preserved();
});

test('a stale scoped source or project context is rejected before client writes',async t=>{
  const {f,service,input}=fixture(t),review=service.plan(input),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config);
  const ready=await service.observeDeploymentPrerequisites({planId:review.planId});fs.appendFileSync(config,'\n# Manual update\n');
  await assert.rejects(async()=>service.apply({planId:ready.planId}),{code:'STALE_DEPLOYMENT_PLAN'});assert.equal(f.calls.length,1);assert.deepEqual(fs.readFileSync(config),Buffer.concat([before,Buffer.from('\n# Manual update\n')]));f.f.preserved();
});

test('the public v3 global plan installs v4 receipts through the existing global protection path',async t=>{
  const {f,service}=fixture(t);f.f.raw.schemaVersion=3;f.f.raw.management={schemaVersion:1,resources:{}};f.f.write();
  const plan=service.plan(f.f.input);assert.equal(plan.execution?.status,'ready');assert.equal(plan.automatic,true);await service.apply({planId:plan.planId});
  assert.ok(f.f.state().transactions.at(-1).installationReceipts.every(receipt=>receipt.schemaVersion===4));assert.equal(f.calls.length,0);f.f.preserved();
});

test('public scoped removal releases its registered consumer and restores the exact original project settings',async t=>{
  const {f,service,input}=fixture(t),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),plan=service.plan(input);
  const ready=await service.observeDeploymentPrerequisites({planId:plan.planId});await service.apply({planId:ready.planId});const count=f.calls.length;
  const removal=service.planRemoval({...input,assetIds:['reviewer','local-docs']});assert.equal(removal.execution.status,'ready');await service.apply({planId:removal.planId});
  assert.deepEqual(fs.readFileSync(config),before);assert.equal(f.calls.length,count);assert.deepEqual(f.f.state().dependencyIndex.projects,[]);f.f.preserved();
});

test('saved scoped plan v5 recollects private native evidence after restart and executes once',async t=>{
  const {f,service,input,restart}=fixture(t),review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId}),saved=service.savePlan({planId:ready.planId});
  const body=JSON.parse(fs.readFileSync(path.join(f.f.homeDir,'.agents-kit/plans',saved.planId+'.json'))).body;assert.equal(body.schemaVersion,5);assert.equal(body.contract,'scoped-deployment-v1');
  const applied=await restart().resumeSavedPlan(saved);assert.equal(applied.outcome,'committed');assert.equal(f.calls.length,3);
  assert.deepEqual(await restart().resumeSavedPlan(saved),applied);assert.equal(f.calls.length,3);f.f.preserved();
});

test('a saved scoped review rejects a changed source before attempting a new native observation',async t=>{
  const {f,service,input,restart}=fixture(t),review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId}),saved=service.savePlan({planId:ready.planId});
  fs.appendFileSync(path.join(f.project.sourceRoot,'agent-kit.yaml'),'\n# Still the same manifest\n');fs.appendFileSync(path.join(f.project.targetRoot,'.codex/config.toml'),'\n# Manual setting\n');
  await assert.rejects(async()=>restart().resumeSavedPlan(saved),{code:'STALE_SAVED_PLAN'});assert.equal(f.calls.length,1);f.f.preserved();
});

test('failed scoped post-observation can be restored through the common public recovery service',async t=>{
  const {f,service,input,restart}=fixture(t),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),global=fs.readFileSync(f.f.statePath),review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId});
  f.response.skills.data[0].skills[0].enabled=false;await assert.rejects(async()=>service.apply({planId:ready.planId}),{code:'DEPENDENCY_NATIVE_PREREQUISITES_CHANGED'});
  const resumed=restart(),recovery=resumed.planRecovery(input);assert.equal(recovery.coordination,true);assert.equal((await resumed.recover({planId:recovery.planId})).outcome,'restored');
  assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(f.f.statePath),global);f.f.preserved();
});

test('saved scoped execution preserves a replaced claim and rejects before changing client files',async t=>{
  const {f,input}=fixture(t),options={...f.options},observe=options.nativeInventoryObserver;let replace=false,saved;
  options.nativeInventoryObserver=async request=>{
    if(replace){replace=false;const claim=path.join(f.f.homeDir,'.agents-kit/plans',saved.planId+'.json.claim');fs.renameSync(claim,claim+'.original');fs.writeFileSync(claim,JSON.stringify({pid:process.pid,token:'replacement-owner'}),{mode:0o600});}
    return observe(request);
  };
  const service=createManifestDeploymentService(options),review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId});saved=service.savePlan({planId:ready.planId});
  const config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config);replace=true;
  await assert.rejects(async()=>createManifestDeploymentService(options).resumeSavedPlan(saved),{code:'SAVED_PLAN_NOT_READY'});
  assert.deepEqual(fs.readFileSync(config),before);assert.equal(JSON.parse(fs.readFileSync(path.join(f.f.homeDir,'.agents-kit/plans',saved.planId+'.json.claim'))).token,'replacement-owner');f.f.preserved();
});

test('a local-only change rechecks retained global Tool bindings without redeploying an unselected consumer',async t=>{
  const {f,service,input}=fixture(t,{bound:true}),file=path.join(f.project.sourceRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(file,'utf8'));
  raw.assets.agents[0].dependsOn={skills:['tool-review']};raw.assets.skills=[{id:'tool-review',scope:'project',source:'tool-review',definition:{schemaVersion:1,format:'agent-skills'},requires:{tools:[{id:'repository.search',providerId:{schemaVersion:1,kitId:f.f.raw.kit.id,scope:{type:'global'},kind:'mcpServers',assetId:'docs'}}]}}];
  fs.mkdirSync(path.join(f.project.sourceRoot,'tool-review'));fs.writeFileSync(path.join(f.project.sourceRoot,'tool-review/SKILL.md'),'---\nname: tool-review\ndescription: Review using installed tools\n---\nReview.\n');fs.writeFileSync(file,stringify(raw));
  let review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId,observeProviders:true});await service.apply({planId:ready.planId});
  const agent=path.join(f.project.targetRoot,'.codex/agents/reviewer.toml'),before=fs.readFileSync(agent),info=fs.statSync(agent),index=structuredClone(f.f.state().dependencyIndex);
  raw.targets.codex.assetIds=['local-docs'];raw.assets.mcpServers[0].definition.args=['updated-local.js'];fs.writeFileSync(file,stringify(raw));
  review=service.plan(input);assert.equal(review.execution.status,'requires-observation');assert.equal(review.execution.nativePrerequisiteCount,1);
  ready=await service.observeDeploymentPrerequisites({planId:review.planId,observeProviders:true});assert.equal(ready.execution.status,'ready');await service.apply({planId:ready.planId});assert.equal(f.calls.length,4);
  assert.deepEqual(fs.readFileSync(agent),before);assert.equal(fs.statSync(agent).ino,info.ino);assert.deepEqual(f.f.state().dependencyIndex.projects[0].consumers,index.projects[0].consumers);f.f.preserved();
});

test('removing a dependency declaration produces an explicit reviewed release and preserves the installed local consumer',async t=>{
  const {f,service,input}=fixture(t),review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId});await service.apply({planId:ready.planId});
  const file=path.join(f.project.sourceRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(file,'utf8'));raw.assets.agents[0].dependsOn={skills:[]};fs.writeFileSync(file,stringify(raw));
  const plan=service.plan(input);assert.equal(plan.execution.status,'ready');assert.deepEqual(plan.dependencyTransition.releasedConsumers.map(consumer=>consumer.assetId),['reviewer']);
  assert.equal(f.f.state().dependencyIndex.projects.length,1);await service.apply({planId:plan.planId});assert.equal(f.f.state().dependencyIndex.projects.length,0);assert.ok(fs.existsSync(path.join(f.project.targetRoot,'.codex/agents/reviewer.toml')));f.f.preserved();
});

for(const phase of ['project-state-prepared','project-committed'])test(`public saved scoped recovery handles ${phase} and settles the saved receipt without replay`,async t=>{
  const {f,service,input,restart}=fixture(t),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),global=fs.readFileSync(f.f.statePath),review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId}),saved=service.savePlan({planId:ready.planId});
  const child=spawnSync(process.execPath,[path.resolve('test/helpers/crash-scoped-deployment-dispatch.js'),JSON.stringify({homeDir:f.f.homeDir,definitionsDir:f.f.definitionsDir,binaryPath:f.binaryPath,response:f.response,phase,saved})],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const resumed=restart(),recovery=resumed.planRecovery(input),result=resumed.recover({planId:recovery.planId});assert.equal(result.outcome,phase==='project-committed'?'committed':'restored');
  const count=resumed.history(input).length;
  if(phase==='project-committed'){assert.deepEqual(await resumed.resumeSavedPlan(saved),result);assert.equal(f.f.state().dependencyIndex.projects.length,1);}
  else{await assert.rejects(async()=>resumed.resumeSavedPlan(saved),{code:'SAVED_PLAN_NOT_READY'});assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(f.f.statePath),global);}
  assert.equal(resumed.history(input).length,count);f.f.preserved();
});

test('a modified project rollback is blocked in the plan before approval and preserves the manual edit',async t=>{
  const {f,service,input}=fixture(t),review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId}),applied=await service.apply({planId:ready.planId});
  const file=path.join(f.project.targetRoot,'.codex/config.toml');fs.appendFileSync(file,'\n# Manual edit\n');const before=fs.readFileSync(path.join(f.project.targetRoot,'.agent-kit/state.json')),rollback=service.planRollback({...input,transactionId:applied.transactionId});
  assert.equal(rollback.automatic,false);assert.ok(rollback.blocked.some(block=>block.reason==='ROLLBACK_TARGET_MODIFIED'));
  assert.throws(()=>service.rollback({planId:rollback.planId}),{code:'ROLLBACK_PLAN_BLOCKED'});assert.deepEqual(fs.readFileSync(path.join(f.project.targetRoot,'.agent-kit/state.json')),before);assert.ok(fs.readFileSync(file,'utf8').includes('# Manual edit'));f.f.preserved();
});

test('a v3 global replay cannot use an older saved-plan contract even after its digest is recomputed',async t=>{
  const {f,service,restart}=fixture(t);f.f.raw.schemaVersion=3;f.f.raw.management={schemaVersion:1,resources:{}};f.f.write();
  const saved=service.savePlan({planId:service.plan(f.f.input).planId}),file=path.join(f.f.homeDir,'.agents-kit/plans',saved.planId+'.json'),record=JSON.parse(fs.readFileSync(file)),before=fs.readFileSync(f.f.statePath);
  record.body.schemaVersion=3;record.body.contract='physical-resource-v1';delete record.body.scopedReviewDigest;delete record.body.observeProviders;record.digest=canonicalDigest(record.body);fs.writeFileSync(file,JSON.stringify(record));
  await assert.rejects(async()=>restart().resumeSavedPlan({planId:saved.planId,digest:record.digest}),{code:'STALE_SAVED_PLAN'});assert.deepEqual(fs.readFileSync(f.f.statePath),before);assert.equal(f.calls.length,0);f.f.preserved();
});
