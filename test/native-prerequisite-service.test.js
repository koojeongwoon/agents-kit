import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import {stringify} from 'yaml';
import {createNativePrerequisiteService} from '../lib/application/native-prerequisite-service.js';
import {GlobalDeploymentStateStore} from '../lib/infrastructure/global-deployment-state-store.js';
import {latestInstallationReceipts} from '../lib/application/installation-receipt-service.js';
import {installationDigest} from '../lib/domain/installation-receipt.js';
import {dependencyPrerequisiteId,installedBindingDigest} from '../lib/domain/dependency-reverse-index.js';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {coordinationFixture,executeProjectFixture} from './helpers/dependency-coordination-fixture.js';
import {planDependencyCoordination,executeDependencyCoordination} from '../lib/application/dependency-coordination-service.js';
import * as coordination from '../lib/application/dependency-coordination-service.js';
import {compileScopedDeployment} from '../lib/application/scoped-deployment-compiler.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {applyDeployment,applyDeploymentAsync} from '../lib/application/apply-deployment.js';
import {DeploymentBackupStore} from '../lib/infrastructure/deployment-backup-store.js';
import {readPathImage,imageFingerprint} from '../lib/infrastructure/path-image.js';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const pinOf=receipt=>{const pin={...Object.fromEntries(['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)};return {...pin,id:dependencyPrerequisiteId(pin)};};
import {nativePrerequisiteServiceFixture as fixture} from './helpers/native-prerequisite-service-fixture.js';

test('sealed native Skill proof is read-only, ignores unrelated external errors and can satisfy the coordinator port',async t=>{
  const f=fixture(t,{coordination:true}),before=fs.readFileSync(f.f.statePath),result=await f.service.observe(f.request);
  assert.equal(result.status,'observed');assert.equal(result.fulfilled,false);assert.equal(result.modelTurnsRequested,false);assert.equal(result.toolCallsRequested,false);
  assert.deepEqual(f.calls,[{includeSkills:true,serverNames:[]}]);assert.equal(f.verify(result).verified,true);assert.deepEqual(fs.readFileSync(f.f.statePath),before);f.f.preserved();
  const request=f.coordinated.request(),plan=planDependencyCoordination({...request,verifyPrerequisites:f.service.verifier({observationId:result.observationId})});assert.deepEqual(plan.blocked,[]);
  const applied=executeDependencyCoordination({...request,plan,verifyPrerequisites:f.service.verifier({observationId:result.observationId}),executeProject:context=>executeProjectFixture(f.coordinated,context)});
  assert.equal(applied.outcome,'committed');assert.equal(applied.nativePrerequisitesState,'verified-at-apply');assert.equal(applied.fulfilled,false);f.f.preserved();
  assert.ok(!JSON.stringify(result).includes('SECRET'));assert.ok(!JSON.stringify(result).includes('/external/ego-skills'));
});

test('native proof cannot be forged from a public response, reused after expiry or transferred to another project or pin set',async t=>{
  const f=fixture(t),result=await f.service.observe(f.request);assert.equal(f.verify(result).verified,true);
  result.status='changed';result.checks.length=0;assert.equal(f.verify(result).verified,true);
  assert.equal(f.service.verifier({...result,observationId:'unknown',verified:true})({project:f.project,prerequisites:f.pins}).verified,false);
  const verifier=f.service.verifier({observationId:result.observationId});assert.equal(verifier({project:{...f.project,targetRoot:f.f.homeDir},prerequisites:f.pins}).verified,false);
  assert.equal(verifier({project:f.project,prerequisites:[{...f.pins[0],revisionDigest:'0'.repeat(64)}]}).verified,false);
  f.advance();assert.equal(f.verify(result).verified,false);
});

test('global settings, ancestor project settings, Git boundary, binary and definition changes invalidate captured proof',async t=>{
  for(const mutate of [f=>fs.appendFileSync(f.f.mcp,'\n# changed\n'),f=>fs.chmodSync(f.f.mcp,0o600),
    f=>{fs.mkdirSync(path.join(f.f.root,'.codex'));fs.writeFileSync(path.join(f.f.root,'.codex/config.toml'),'model="shadow"\n');},
    f=>fs.mkdirSync(path.join(f.project.targetRoot,'.git')),f=>fs.appendFileSync(f.binaryPath,'changed'),
    f=>{f.auxiliary.evidence[0].version='0.0.2-test';fs.writeFileSync(f.auxiliaryFile,stringify(f.auxiliary));}]) {
    const f=fixture(t),result=await f.service.observe(f.request);assert.equal(f.verify(result).verified,true);mutate(f);assert.equal(f.verify(result).verified,false);
  }
});

test('exact installed ownership and reviewed definition are mandatory and are rechecked before proof reuse',async t=>{
  const f=fixture(t),result=await f.service.observe(f.request);fs.appendFileSync(path.join(f.selected[0].locator.targetBase,'SKILL.md'),'\nUser edit\n');assert.equal(f.verify(result).verified,false);
  const failed=await f.service.observe(f.request);assert.equal(failed.status,'unverified');assert.equal(failed.observationId,undefined);assert.equal(f.calls.length,1);
});

test('provider discovery is opt-in and requires complete installed closure, exact origins and native tool aliases before connection',async t=>{
  const f=fixture(t,{bound:true}),metadata=await f.service.observe(f.request);assert.equal(metadata.status,'unverified');assert.deepEqual(f.calls[0].serverNames,[]);
  const observed=await f.service.observe({...f.request,observeProviders:true});assert.equal(observed.status,'observed');assert.equal(f.verify(observed).verified,true);assert.deepEqual(f.calls[1].serverNames,['docs']);assert.ok(!JSON.stringify(observed).includes('SECRET'));
  f.response.configuration.config.mcp_servers.docs.disabled_tools=['search_repository'];const denied=await f.service.observe({...f.request,observeProviders:true});assert.equal(denied.status,'unverified');assert.equal(denied.observationId,undefined);
});

test('opaque native layers, unsupported project markers and symlink or hardlink configuration cannot produce or authorize proof',async t=>{
  for(const mutate of [f=>f.response.configuration.layers.push({name:{type:'mdm',domain:'SECRET',key:'SECRET'},version:'sha256:'+'b'.repeat(64)}),
    f=>{f.response.configuration.config.project_root_markers=['custom'];},f=>{const file=f.f.mcp;fs.renameSync(file,file+'.original');fs.symlinkSync(file+'.original',file);},
    f=>fs.linkSync(f.f.mcp,f.f.mcp+'.hardlink')]) {
    const f=fixture(t,{bound:true});mutate(f);const result=await f.service.observe({...f.request,observeProviders:true});assert.equal(result.status,'unverified');assert.equal(result.observationId,undefined);
  }
});

test('configuration changes during metadata observation cannot authorize provider connection or mint a reusable proof',async t=>{
  const f=fixture(t);
  const service=createNativePrerequisiteService({homeDir:f.f.homeDir,definitionsDir:f.f.definitionsDir,binaryObserver:()=>({binaryPath:f.binaryPath,sha256:sha(fs.readFileSync(f.binaryPath))}),
    nativeInventoryObserver:async()=>{fs.appendFileSync(f.f.mcp,'# changed during read\n');return f.response;}});
  const result=await service.observe(f.request);assert.equal(result.status,'unverified');assert.equal(result.observationId,undefined);
});

test('unknown or mismatched discovery definitions and binaries remain unsupported without altering base client evidence',async t=>{
  for(const mutate of [f=>fs.rmSync(f.auxiliaryFile),f=>{f.auxiliary.configStore='different';fs.writeFileSync(f.auxiliaryFile,stringify(f.auxiliary));},
    f=>fs.appendFileSync(f.binaryPath,'unreviewed build')]) {
    const f=fixture(t),base=fs.readFileSync(f.f.definitionPath);mutate(f);const result=await f.service.observe(f.request);
    assert.equal(result.status,'unverified');assert.equal(result.observationId,undefined);assert.deepEqual(f.calls,[]);assert.deepEqual(fs.readFileSync(f.f.definitionPath),base);
  }
});

test('native observations reject unsupported or malformed selections before starting a client process',async t=>{
  const f=fixture(t);
  for(const change of [{observeProviders:'true'},{prerequisites:[]},{prerequisites:[{...f.pins[0],id:'forged'}]},{prerequisites:[f.pins[0],f.pins[0]]}])
    await assert.rejects(f.service.observe({...f.request,...change}),{code:'INVALID_NATIVE_PREREQUISITE_REQUEST'});
  assert.deepEqual(f.calls,[]);
});

function transitionTarget(f,text='# Reviewed project configuration\n') {
  const target=path.join(f.project.targetRoot,'.codex/config.toml'),before=imageFingerprint(readPathImage(target,{authorizedRoot:f.project.targetRoot})),afterImage={kind:'file',mode:0o640,content:Buffer.from(text).toString('base64')};
  return {review:{target,before,after:imageFingerprint(afterImage)},write(){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text,{mode:0o640});fs.chmodSync(target,0o640);}};
}

test('a planned native context transition requires actual post-change discovery before its after verifier succeeds',async t=>{
  const f=fixture(t),observed=await f.service.observe(f.request),target=transitionTarget(f),transition=f.service.prepareTransition({observationId:observed.observationId,targets:[target.review]}),verify=f.service.transitionVerifier(transition),request={project:f.project,prerequisites:f.pins};
  const before=verify({...request,stage:'before'});assert.equal(before.verified,true);assert.equal(verify({...request,stage:'after'}).verified,false);
  target.write();assert.equal(f.verify(observed).verified,false);assert.equal(verify({...request,stage:'before'}).verified,false);assert.equal(verify({...request,stage:'after'}).verified,false);
  const after=await f.service.observeTransition(transition);assert.equal(after.status,'observed');assert.equal(after.fulfilled,false);assert.equal(f.calls.length,2);assert.deepEqual(verify({...request,stage:'after'}),before);
  fs.appendFileSync(target.review.target,'# Manual follow-up\n');assert.equal(verify({...request,stage:'after'}).verified,false);f.f.preserved();
});

test('transition evidence cannot be forged, transferred, renewed after expiry or replayed with an unreviewed target',async t=>{
  const f=fixture(t),observed=await f.service.observe(f.request),target=transitionTarget(f),transition=f.service.prepareTransition({observationId:observed.observationId,targets:[target.review]}),request={project:f.project,prerequisites:f.pins};
  assert.equal(f.service.transitionVerifier({...transition,transitionId:'forged',verified:true})({...request,stage:'after'}).verified,false);
  const verify=f.service.transitionVerifier(transition);assert.equal(verify({...request,project:{...f.project,kitId:'other'},stage:'before'}).verified,false);
  target.write();fs.appendFileSync(target.review.target,'# Not reviewed\n');assert.equal((await f.service.observeTransition(transition)).status,'unverified');assert.equal(f.calls.length,1);assert.equal(verify({...request,stage:'after'}).verified,false);
  const g=fixture(t),initial=await g.service.observe(g.request),change=transitionTarget(g),expired=g.service.prepareTransition({observationId:initial.observationId,targets:[change.review]});change.write();g.advance();assert.equal((await g.service.observeTransition(expired)).status,'unverified');assert.equal(g.calls.length,1);
});

test('planned context changes preserve unrelated ancestor/global settings and Git boundaries as strict evidence',async t=>{
  for(const mutate of [f=>fs.appendFileSync(f.f.mcp,'# Unexpected global edit\n'),f=>fs.mkdirSync(path.join(f.project.targetRoot,'.git')),
    f=>{fs.mkdirSync(path.join(f.f.root,'.codex'));fs.writeFileSync(path.join(f.f.root,'.codex/config.toml'),'# Unexpected ancestor\n');}]) {
    const f=fixture(t),observed=await f.service.observe(f.request),target=transitionTarget(f),transition=f.service.prepareTransition({observationId:observed.observationId,targets:[target.review]});target.write();mutate(f);
    assert.equal((await f.service.observeTransition(transition)).status,'unverified');assert.equal(f.calls.length,1);f.f.preserved();
  }
});

test('an unchanged deployment context reuses its current proof without an unnecessary native call',async t=>{
  const f=fixture(t),observed=await f.service.observe(f.request),transition=f.service.prepareTransition({observationId:observed.observationId,targets:[]}),verify=f.service.transitionVerifier(transition),request={project:f.project,prerequisites:f.pins};
  assert.deepEqual(verify({...request,stage:'after'}),verify({...request,stage:'before'}));assert.equal((await f.service.observeTransition(transition)).status,'observed');assert.equal(f.calls.length,1);
});

test('a project Skill with the same native name cannot silently shadow a pinned global Skill after transition',async t=>{
  const f=fixture(t),observed=await f.service.observe(f.request),target=transitionTarget(f),transition=f.service.prepareTransition({observationId:observed.observationId,targets:[target.review]});
  target.write();f.response.skills.data[0].skills.push({name:'review',path:path.join(f.project.targetRoot,'.agents/skills/review/SKILL.md'),scope:'repo',enabled:true});
  const result=await f.service.observeTransition(transition);assert.equal(result.status,'unverified');assert.equal(f.service.transitionVerifier(transition)({project:f.project,prerequisites:f.pins,stage:'after'}).verified,false);
});

test('transition preparation rejects global paths, Git markers, external links and malformed plans without native reads',async t=>{
  const f=fixture(t),observed=await f.service.observe(f.request),target=transitionTarget(f),prepare=targets=>f.service.prepareTransition({observationId:observed.observationId,targets});
  assert.throws(()=>prepare([{...target.review,target:f.f.mcp}]),{code:'DEPLOYMENT_TARGET_OUTSIDE_SCOPE'});
  assert.throws(()=>prepare([{...target.review,target:path.join(f.project.targetRoot,'.git')}]),{code:'NATIVE_PREREQUISITE_TRANSITION_SCOPE_INVALID'});
  const external=path.join(f.project.targetRoot,'ego-browser');fs.symlinkSync('/external/ego-skills',external);assert.throws(()=>prepare([{...target.review,target:external}]),{code:'EXTERNAL_RESOURCE_READ_ONLY'});
  assert.throws(()=>prepare([{...target.review,before:'0'.repeat(64)}]),{code:'NATIVE_PREREQUISITE_TRANSITION_CHANGED'});assert.throws(()=>prepare([{...target.review,allow:true}]),{code:'INVALID_NATIVE_PREREQUISITE_TRANSITION'});
  assert.throws(()=>f.service.prepareTransition({observationId:'forged',targets:[]}),{code:'NATIVE_PREREQUISITE_TRANSITION_UNVERIFIED'});
  const transition=prepare([target.review]);assert.deepEqual(f.service.transitionVerifier(transition)(),{verified:false,digest:null});assert.equal(f.calls.length,1);assert.equal(fs.readlinkSync(external),'/external/ego-skills');
});

async function compiledTransition(f) {
  const compiled=compileScopedDeployment({kitRoot:f.f.kitRoot,projectName:'default',projectPath:f.project.targetRoot,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.f.definitionsDir})});
  assert.equal(compiled.prediction?.status,'predicted',JSON.stringify(compiled.review.blocked));
  const observed=await f.service.observe(f.request);assert.equal(observed.status,'observed');const transition=f.service.prepareTransition({observationId:observed.observationId,targets:compiled.targets});
  const request={globalStore:compiled.globalStore,projectStore:compiled.stateStore,project:compiled.review.project,transactionId:'tx-native-context-transition',upsertConsumers:compiled.prediction.consumers,
    prerequisites:compiled.prerequisites,releaseConsumerIds:[],targets:compiled.targets,verifyPrerequisites:f.service.transitionVerifier(transition)};
  for(const plan of compiled.plans)plan.blocked=plan.blocked.filter(block=>!['SCOPED_DEPLOYMENT_NOT_ENABLED','DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'].includes(block.reason));
  return {compiled,transition,request,plan:planDependencyCoordination(request),backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.project.targetRoot,'.agent-kit/backups')})};
}

test('async coordination holds both leases through real file apply, native reobservation and final registration',async t=>{
  const f=fixture(t,{scoped:true}),prepared=await compiledTransition(f),external=path.join(f.project.targetRoot,'.agents/skills/ego-browser'),identity=fs.lstatSync(external);
  const result=await coordination.executeDependencyCoordinationAsync({...prepared.request,plan:prepared.plan,executeProject:context=>applyDeploymentAsync({plans:prepared.compiled.plans,stateStore:context.projectStore,backupStore:prepared.backupStore,createTransactionId:()=>context.transactionId,validate:async()=>{
    const owners=[context.globalStore,context.projectStore].map(store=>fs.readFileSync(store.statePath+'.lock','utf8'));
    await Promise.resolve();assert.ok(context.globalStore.lockOwner);assert.ok(context.projectStore.lockOwner);assert.deepEqual([context.globalStore,context.projectStore].map(store=>fs.readFileSync(store.statePath+'.lock','utf8')),owners);
    return {valid:(await f.service.observeTransition(prepared.transition)).status==='observed'};
  }})});
  assert.equal(result.outcome,'committed');assert.equal(f.calls.length,2);assert.equal(prepared.compiled.stateStore.load().dependencyRegistration.status,'active');assert.equal(prepared.compiled.globalStore.load().dependencyIndex.projects.length,1);
  const config=path.join(f.project.targetRoot,'.codex/config.toml'),text=fs.readFileSync(config,'utf8');assert.match(text,/model="keep"/);assert.match(text,/mcp_servers.foreign/);assert.match(text,/mcp_servers.local-docs/);assert.equal(fs.statSync(config).mode&0o777,0o640);
  for(const store of [prepared.compiled.globalStore,prepared.compiled.stateStore])assert.equal(fs.existsSync(store.statePath+'.lock'),false);
  assert.equal(fs.readlinkSync(external),'/external/ego-skills');assert.equal(fs.lstatSync(external).ino,identity.ino);f.f.preserved();
});

test('failed post-change native discovery restores client settings and requires reviewed coordination recovery',async t=>{
  const f=fixture(t,{scoped:true}),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),global=fs.readFileSync(f.f.statePath),prepared=await compiledTransition(f);
  f.response.skills.data[0].skills[0].enabled=false;
  await assert.rejects(coordination.executeDependencyCoordinationAsync({...prepared.request,plan:prepared.plan,executeProject:context=>applyDeploymentAsync({plans:prepared.compiled.plans,stateStore:context.projectStore,backupStore:prepared.backupStore,createTransactionId:()=>context.transactionId,validate:async()=>({valid:(await f.service.observeTransition(prepared.transition)).status==='observed'})})}),{code:'DEPLOYMENT_VALIDATION_FAILED'});
  assert.deepEqual(fs.readFileSync(config),before);assert.equal(fs.statSync(config).mode&0o777,0o640);assert.equal(fs.existsSync(prepared.compiled.globalStore.statePath+'.lock'),true);
  const recovery=coordination.planDependencyCoordinationRecovery(prepared.request);assert.equal(coordination.applyDependencyCoordinationRecovery({...prepared.request,plan:recovery}).outcome,'restored');assert.deepEqual(fs.readFileSync(f.f.statePath),global);f.f.preserved();
});

test('a manual edit during async validation is preserved and cannot receive final dependency registration',async t=>{
  const f=fixture(t,{scoped:true}),config=path.join(f.project.targetRoot,'.codex/config.toml'),prepared=await compiledTransition(f);
  await assert.rejects(coordination.executeDependencyCoordinationAsync({...prepared.request,plan:prepared.plan,executeProject:context=>applyDeploymentAsync({plans:prepared.compiled.plans,stateStore:context.projectStore,backupStore:prepared.backupStore,createTransactionId:()=>context.transactionId,validate:async()=>{
    assert.equal((await f.service.observeTransition(prepared.transition)).status,'observed');fs.appendFileSync(config,'\n# Manual concurrent edit\n');return {valid:true};
  }})}),{code:'NATIVE_DEPLOYMENT_RECOVERY_REQUIRED'});
  assert.match(fs.readFileSync(config,'utf8'),/Manual concurrent edit/);assert.equal(prepared.compiled.stateStore.load().dependencyRegistration,undefined);
  assert.throws(()=>coordination.planDependencyCoordinationRecovery(prepared.request),{code:'RECOVERY_TARGET_CONFLICT'});f.f.preserved();
});

test('async snapshot validation retains the lock until its after hook completes and rollback restores the original link',async t=>{
  const f=resourcePathFixture(t,{scope:'global',skillStrategy:'snapshot-link'}),target=Object.keys(f.state().managed).find(file=>f.state().managed[file].connection),before=fs.readlinkSync(target);
  f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.raw.targets={codex:{assetIds:['review']}};f.write();fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'\nAsync snapshot change\n');
  const compiled=compileScopedDeployment({kitRoot:f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});assert.equal(compiled.prediction?.status,'predicted');for(const plan of compiled.plans)plan.blocked=[];
  const stages=[],result=await applyDeploymentAsync({plans:compiled.plans,stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:compiled.globalStore.backupsRoot}),validate:async()=>{stages.push('validate');await Promise.resolve();assert.ok(compiled.stateStore.lockOwner);assert.ok(fs.existsSync(compiled.stateStore.statePath+'.lock'));return {valid:true};},beforeCommit:async()=>{await Promise.resolve();assert.ok(compiled.stateStore.lockOwner);stages.push('after');}});
  assert.deepEqual(stages,['validate','after']);assert.notEqual(fs.readlinkSync(target),before);f.service.rollback({planId:f.service.planRollback({...f.input,transactionId:result.transactionId}).planId});assert.equal(fs.readlinkSync(target),before);f.preserved();
});

test('the synchronous API fails closed on async validation and restores its ordinary client files',async t=>{
  const f=resourcePathFixture(t,{scope:'global'}),before=fs.readFileSync(f.rules),state=fs.readFileSync(f.statePath);f.raw.targets={codex:{assetIds:['rules']}};f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.write();fs.appendFileSync(path.join(f.scopeRoot,'rules.md'),'\nPending change\n');
  const compiled=compileScopedDeployment({kitRoot:f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});for(const plan of compiled.plans)plan.blocked=[];
  assert.throws(()=>applyDeployment({plans:compiled.plans,stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:compiled.globalStore.backupsRoot}),validate:async()=>({valid:true})}),{code:'ASYNC_DEPLOYMENT_REQUIRED'});
  assert.deepEqual(fs.readFileSync(f.rules),before);assert.deepEqual(fs.readFileSync(f.statePath),state);assert.equal(fs.existsSync(f.statePath+'.lock'),false);f.preserved();
});

test('an ordinary async deployment preserves recovery evidence when its lock is replaced during observation',async t=>{
  const f=resourcePathFixture(t,{scope:'global'}),state=fs.readFileSync(f.statePath);f.raw.targets={codex:{assetIds:['rules']}};f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.write();fs.appendFileSync(path.join(f.scopeRoot,'rules.md'),'\nAsync lease change\n');
  const compiled=compileScopedDeployment({kitRoot:f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});for(const plan of compiled.plans)plan.blocked=[];
  await assert.rejects(applyDeploymentAsync({plans:compiled.plans,stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:compiled.globalStore.backupsRoot}),validate:async()=>{
    await Promise.resolve();fs.renameSync(f.statePath+'.lock',f.statePath+'.original-lock');fs.writeFileSync(f.statePath+'.lock',JSON.stringify({pid:process.pid,token:'replacement-owner'}),{mode:0o600});return {valid:true};
  }}),{code:'NATIVE_DEPLOYMENT_RECOVERY_REQUIRED'});
  assert.deepEqual(fs.readFileSync(f.statePath),state);assert.equal(JSON.parse(fs.readFileSync(f.statePath+'.lock')).token,'replacement-owner');assert.equal(fs.existsSync(f.statePath+'.journal.json'),true);f.preserved();
});

test('a manual ledger edit during async validation is preserved while reviewed client changes are restored',async t=>{
  const f=resourcePathFixture(t,{scope:'global'}),before=fs.readFileSync(f.rules);f.raw.targets={codex:{assetIds:['rules']}};f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.write();fs.appendFileSync(path.join(f.scopeRoot,'rules.md'),'\nAwaited change\n');
  const compiled=compileScopedDeployment({kitRoot:f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});for(const plan of compiled.plans)plan.blocked=[];
  await assert.rejects(applyDeploymentAsync({plans:compiled.plans,stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:compiled.globalStore.backupsRoot}),validate:async()=>{
    await Promise.resolve();const changed=f.state();changed.manualNote='Preserve this ledger edit';fs.writeFileSync(f.statePath,JSON.stringify(changed));return {valid:true};
  }}),{code:'STALE_DEPLOYMENT_STATE'});
  assert.equal(f.state().manualNote,'Preserve this ledger edit');assert.deepEqual(fs.readFileSync(f.rules),before);assert.equal(fs.existsSync(f.statePath+'.lock'),false);f.preserved();
});

test('scoped v4 global receipts retain frozen native aliases and complete provider requirements for private native proof',async t=>{
  const f=fixture(t,{bound:true});f.f.raw.schemaVersion=3;f.f.raw.management={schemaVersion:1,resources:{}};f.f.write();
  const compiled=compileScopedDeployment({kitRoot:f.f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.f.definitionsDir})});
  applyDeployment({plans:compiled.plans.map(plan=>({...plan,blocked:[]})),stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:compiled.globalStore.backupsRoot})});
  const receipts=latestInstallationReceipts(f.f.state()).filter(receipt=>['review','docs'].includes(receipt.assetId));assert.ok(receipts.every(receipt=>receipt.schemaVersion===4));f.pins.splice(0,f.pins.length,...receipts.map(pinOf));
  const observed=await f.service.observe({...f.request,observeProviders:true});assert.equal(observed.status,'observed',JSON.stringify(observed));assert.equal(f.verify(observed).verified,true);assert.deepEqual(f.calls[0].serverNames,['docs']);f.f.preserved();
});
