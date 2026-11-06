import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse,stringify} from 'yaml';
import {nativePrerequisiteServiceFixture} from './helpers/native-prerequisite-service-fixture.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {spawnSync} from 'node:child_process';

function fixture(t,options={}) {
  const f=nativePrerequisiteServiceFixture(t,{...options,scoped:true}),restart=()=>createManifestDeploymentService(f.options),service=restart();
  const input={scope:'project',scopeRoot:f.project.sourceRoot,targetRoot:f.project.targetRoot,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};
  const config=path.join(input.targetRoot,'.codex/config.toml'),state=()=>JSON.parse(fs.readFileSync(path.join(input.targetRoot,'.agent-kit/state.json')));
  const apply=async()=>{const review=service.plan(input),ready=await service.observeDeploymentPrerequisites({planId:review.planId,observeProviders:options.bound===true});return service.apply({planId:ready.planId});};
  const edit=update=>{const file=path.join(input.scopeRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(file,'utf8'));update(raw);fs.writeFileSync(file,stringify(raw));};
  return {f,service,restart,input,config,state,apply,edit};
}

test('rollback of the first scoped installation restores user files and releases both dependency records without native calls',async t=>{
  const {f,service,input,config,state,apply}=fixture(t),before=fs.readFileSync(config),mode=fs.statSync(config).mode&0o777,global=fs.readFileSync(f.f.mcp),link=path.join(input.targetRoot,'.agents/skills/ego-browser'),identity=fs.lstatSync(link),applied=await apply(),calls=f.calls.length;
  const review=service.planRollback({...input,transactionId:applied.transactionId});assert.equal(review.kind,'rollback');assert.equal(review.execution?.status,'ready');assert.equal(review.automatic,true);
  const result=await service.rollback({planId:review.planId});assert.equal(result.outcome,'committed');assert.equal(result.rolledBackTransactionId,applied.transactionId);assert.equal(result.fulfilled,false);
  assert.deepEqual(fs.readFileSync(config),before);assert.equal(fs.statSync(config).mode&0o777,mode);assert.equal(state().dependencyRegistration.status,'released');assert.deepEqual(f.f.state().dependencyIndex.projects,[]);assert.equal(f.calls.length,calls);
  assert.deepEqual(fs.readFileSync(f.f.mcp),global);assert.equal(fs.lstatSync(link).ino,identity.ino);assert.equal(fs.readlinkSync(link),'/external/ego-skills');f.f.preserved();
});

test('rollback of a scoped update restores frozen consumer revisions and reobserves the restored native context',async t=>{
  const {f,service,input,config,state,apply,edit}=fixture(t);await apply();const before=fs.readFileSync(config),consumers=structuredClone(state().dependencyRegistration.consumers);
  edit(raw=>{raw.assets.agents[0].definition.instructions='Updated reviewer.';raw.assets.mcpServers[0].definition.args=['updated.js'];});const updated=await apply(),calls=f.calls.length;
  const review=service.planRollback({...input,transactionId:updated.transactionId});assert.equal(review.execution?.status,'requires-observation');
  await service.observeDeploymentPrerequisites({planId:review.planId});const result=await service.rollback({planId:review.planId});assert.equal(result.outcome,'committed');assert.equal(f.calls.length,calls+2);
  assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(state().dependencyRegistration.consumers,consumers);assert.deepEqual(f.f.state().dependencyIndex.projects[0].consumers,consumers);f.f.preserved();
});

test('rollback of scoped removal restores and registers the original installed closure rather than the current source declaration',async t=>{
  const {f,service,input,config,state,apply,edit}=fixture(t);await apply();const installed=fs.readFileSync(config),consumers=structuredClone(state().dependencyRegistration.consumers);
  const removed=await service.apply({planId:service.planRemoval({...input,assetIds:['reviewer','local-docs']}).planId});assert.equal(state().dependencyRegistration.status,'released');
  edit(raw=>{raw.assets.agents[0].dependsOn={skills:[]};});const calls=f.calls.length,review=service.planRollback({...input,transactionId:removed.transactionId});assert.equal(review.execution?.status,'requires-observation');
  await service.observeDeploymentPrerequisites({planId:review.planId});await service.rollback({planId:review.planId});assert.equal(f.calls.length,calls+2);assert.deepEqual(fs.readFileSync(config),installed);assert.deepEqual(state().dependencyRegistration.consumers,consumers);f.f.preserved();
});

test('saved scoped rollback restarts with fresh native evidence and never rolls back twice',async t=>{
  const {f,service,restart,input,apply,edit,state}=fixture(t);await apply();edit(raw=>{raw.assets.agents[0].definition.instructions='Updated.';});const updated=await apply(),review=service.planRollback({...input,transactionId:updated.transactionId});
  await service.observeDeploymentPrerequisites({planId:review.planId});const saved=service.savePlan({planId:review.planId}),body=JSON.parse(fs.readFileSync(path.join(f.f.homeDir,'.agents-kit/plans',saved.planId+'.json'))).body;assert.equal(body.schemaVersion,5);assert.equal(body.kind,'rollback');
  const count=f.calls.length,result=await restart().resumeSavedPlan(saved);assert.equal(result.rolledBackTransactionId,updated.transactionId);assert.equal(f.calls.length,count+2);const length=state().transactions.length;
  assert.deepEqual(await restart().resumeSavedPlan(saved),result);assert.equal(state().transactions.length,length);f.f.preserved();
});

test('a reviewed declaration-only update releases the last global relation while keeping the installed local consumer',async t=>{
  const {f,service,input,state,apply,edit}=fixture(t);await apply();const calls=f.calls.length;
  edit(raw=>{raw.assets.agents[0].dependsOn={skills:[]};});const review=service.plan(input);assert.equal(review.execution.status,'ready');
  const result=await service.apply({planId:review.planId});assert.equal(result.outcome,'committed');assert.equal(state().dependencyRegistration.status,'released');assert.deepEqual(f.f.state().dependencyIndex.projects,[]);assert.equal(f.calls.length,calls);
  assert.ok(fs.existsSync(path.join(input.targetRoot,'.codex/agents/reviewer.toml')));
  const rollback=service.planRollback({...input,transactionId:result.transactionId});assert.equal(rollback.execution.status,'requires-observation');await service.observeDeploymentPrerequisites({planId:rollback.planId});await service.rollback({planId:rollback.planId});assert.equal(state().dependencyRegistration.status,'active');f.f.preserved();
});

test('rollback from an added global dependency to an installed local declaration releases the relation without deleting the consumer',async t=>{
  const {f,service,input,config,state,apply,edit}=fixture(t);edit(raw=>{raw.assets.agents[0].dependsOn={skills:[]};});await apply();const before=fs.readFileSync(config),agent=fs.readFileSync(path.join(input.targetRoot,'.codex/agents/reviewer.toml'));
  edit(raw=>{raw.assets.agents[0].dependsOn={skills:[{schemaVersion:1,kitId:f.f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'}]};});const added=await apply(),calls=f.calls.length;
  const review=service.planRollback({...input,transactionId:added.transactionId});assert.equal(review.execution.status,'ready');await service.rollback({planId:review.planId});assert.equal(state().dependencyRegistration.status,'released');assert.equal(f.calls.length,calls);
  assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(path.join(input.targetRoot,'.codex/agents/reviewer.toml')),agent);f.f.preserved();
});

test('rollback requires its own private native proof and provider discovery stays opt-in for frozen Tool bindings',async t=>{
  const {f,service,input,apply,edit,state}=fixture(t,{bound:true});await apply();edit(raw=>{raw.assets.agents[0].definition.instructions='Updated.';});const updated=await apply(),before=state(),review=service.planRollback({...input,transactionId:updated.transactionId});
  assert.equal(review.execution.providerDiscoveryRequired,true);await assert.rejects(async()=>service.rollback({planId:review.planId,verified:true}),{code:'SCOPED_NATIVE_OBSERVATION_REQUIRED'});assert.deepEqual(state(),before);
  const next=service.planRollback({...input,transactionId:updated.transactionId}),metadata=await service.observeDeploymentPrerequisites({planId:next.planId});assert.equal(metadata.execution.status,'requires-observation');assert.deepEqual(f.calls.at(-1).serverNames,[]);
  await service.observeDeploymentPrerequisites({planId:next.planId,observeProviders:true});await service.rollback({planId:next.planId});assert.deepEqual(f.calls.at(-1).serverNames,['docs']);f.f.preserved();
});

test('failed rollback reobservation restores the updated files and reviewed recovery keeps the prior registration',async t=>{
  const {f,service,restart,input,config,state,apply,edit}=fixture(t);await apply();edit(raw=>{raw.assets.agents[0].definition.instructions='Updated.';});const updated=await apply(),before=fs.readFileSync(config),ledger=fs.readFileSync(f.f.statePath),registration=structuredClone(state().dependencyRegistration),review=service.planRollback({...input,transactionId:updated.transactionId});
  await service.observeDeploymentPrerequisites({planId:review.planId});f.response.skills.data[0].skills[0].enabled=false;
  await assert.rejects(async()=>service.rollback({planId:review.planId}),{code:'DEPENDENCY_NATIVE_PREREQUISITES_CHANGED'});assert.deepEqual(fs.readFileSync(config),before);assert.equal(state().transactions.find(tx=>tx.id===updated.transactionId).status,'committed');
  const resumed=restart(),recovery=resumed.planRecovery(input);assert.equal(recovery.coordination,true);assert.equal(resumed.recover({planId:recovery.planId}).outcome,'restored');assert.deepEqual(fs.readFileSync(f.f.statePath),ledger);assert.deepEqual(state().dependencyRegistration,registration);f.f.preserved();
});

test('async rollback holds both locks and preserves a manual setting edit made while native observation is pending',async t=>{
  const {f,input,config,apply,edit,state}=fixture(t);await apply();edit(raw=>{raw.assets.agents[0].definition.instructions='Updated.';raw.assets.mcpServers[0].definition.args=['updated.js'];});const updated=await apply();let pause=false,entered,release;
  const observing=new Promise(resolve=>{entered=resolve;}),barrier=new Promise(resolve=>{release=resolve;}),observe=f.options.nativeInventoryObserver;
  const service=createManifestDeploymentService({...f.options,nativeInventoryObserver:async request=>{if(pause){entered();await barrier;}return observe(request);}}),review=service.planRollback({...input,transactionId:updated.transactionId});
  await service.observeDeploymentPrerequisites({planId:review.planId});pause=true;const pending=service.rollback({planId:review.planId});await observing;
  assert.ok(fs.existsSync(f.f.statePath+'.lock'));assert.ok(fs.existsSync(path.join(input.targetRoot,'.agent-kit/state.json.lock')));assert.equal(state().transactions.find(tx=>tx.id===updated.transactionId).status,'committed');
  fs.appendFileSync(config,'\n# Concurrent user setting\n');const manual=fs.readFileSync(config);release();await assert.rejects(pending,{code:'NATIVE_DEPLOYMENT_RECOVERY_REQUIRED'});assert.deepEqual(fs.readFileSync(config),manual);
  assert.throws(()=>service.planRecovery(input),{code:'RECOVERY_TARGET_CONFLICT'});f.f.preserved();
});

for(const phase of ['project-state-prepared','project-committed'])test(`saved scoped rollback recovery handles ${phase} without a second rollback`,async t=>{
  const {f,service,restart,input,config,state,apply,edit}=fixture(t);await apply();const first=fs.readFileSync(config);edit(raw=>{raw.assets.agents[0].definition.instructions='Updated.';raw.assets.mcpServers[0].definition.args=['updated.js'];});const updated=await apply(),before=fs.readFileSync(config),review=service.planRollback({...input,transactionId:updated.transactionId});
  await service.observeDeploymentPrerequisites({planId:review.planId});const saved=service.savePlan({planId:review.planId}),child=spawnSync(process.execPath,[path.resolve('test/helpers/crash-scoped-deployment-dispatch.js'),JSON.stringify({homeDir:f.f.homeDir,definitionsDir:f.f.definitionsDir,binaryPath:f.binaryPath,response:f.response,phase,saved})],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const resumed=restart(),recovery=resumed.planRecovery(input),result=resumed.recover({planId:recovery.planId});assert.equal(result.outcome,phase==='project-committed'?'committed':'restored');const length=state().transactions.length;
  assert.deepEqual(fs.readFileSync(config),phase==='project-committed'?first:before);
  if(phase==='project-committed'){assert.deepEqual(await resumed.resumeSavedPlan(saved),result);assert.equal(state().transactions.find(tx=>tx.id===updated.transactionId).status,'rolled-back');}
  else await assert.rejects(async()=>resumed.resumeSavedPlan(saved),{code:'SAVED_PLAN_NOT_READY'});
  assert.equal(state().transactions.length,length);f.f.preserved();
});

test('scoped snapshot rollback uses the same async native transition while restoring the prior immutable link',async t=>{
  const {f,service,input,apply,edit,state}=fixture(t,{skillStrategy:'snapshot-link'}),source=path.join(input.scopeRoot,'local-review');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'SKILL.md'),'---\nname: local-review\ndescription: Review\n---\nFirst.\n');
  edit(raw=>{raw.assets.skills=[{id:'local-review',scope:'project',source:'local-review',definition:{schemaVersion:2,format:'agent-skills',deployment:{schemaVersion:1,strategy:'snapshot-link'}},dependsOn:{skills:raw.assets.agents[0].dependsOn.skills}}];raw.targets.codex.assetIds.push('local-review');});
  await apply();const target=path.join(input.targetRoot,'.agents/skills/local-review'),first=fs.readlinkSync(target);fs.appendFileSync(path.join(source,'SKILL.md'),'Updated.\n');const updated=await apply(),calls=f.calls.length,review=service.planRollback({...input,transactionId:updated.transactionId});
  assert.equal(review.execution.status,'requires-observation');await service.observeDeploymentPrerequisites({planId:review.planId});await service.rollback({planId:review.planId});assert.equal(fs.readlinkSync(target),first);assert.equal(f.calls.length,calls+2);assert.equal(state().transactions.find(tx=>tx.id===updated.transactionId).status,'rolled-back');f.f.preserved();
});

test('rollback cannot resurrect an unregistered consumer when its restored global provider has drifted',async t=>{
  const {f,service,input,config,state,apply}=fixture(t);await apply();const removed=await service.apply({planId:service.planRemoval({...input,assetIds:['reviewer','local-docs']}).planId}),before=fs.readFileSync(config),ledger=fs.readFileSync(f.f.statePath),provider=path.join(f.f.homeDir,'.agents/skills/review/SKILL.md');
  fs.appendFileSync(provider,'\nUser provider change\n');const manual=fs.readFileSync(provider),review=service.planRollback({...input,transactionId:removed.transactionId});assert.equal(review.execution.status,'blocked');assert.ok(review.blocked.some(block=>block.reason==='DEPENDENCY_ROLLBACK_CLOSURE_UNVERIFIED'));
  assert.throws(()=>service.rollback({planId:review.planId}),{code:'ROLLBACK_PLAN_BLOCKED'});assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(provider),manual);assert.deepEqual(fs.readFileSync(f.f.statePath),ledger);assert.equal(state().dependencyRegistration.status,'released');f.f.preserved();
});
