import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {installationDigest,createInstallationReceipt} from '../lib/domain/installation-receipt.js';
import {compileScopedDeployment} from '../lib/application/scoped-deployment-compiler.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {dependencyIndexFixture as fixture} from './helpers/dependency-index-fixture.js';
import {DeploymentStateStore} from '../lib/infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../lib/infrastructure/global-deployment-state-store.js';
import {dependencyRegistrationId,dependencyPrerequisiteId,validDependencyIndex,validDependencyRegistration,evaluateGlobalDependencyChanges,installedBindingDigest} from '../lib/domain/dependency-reverse-index.js';
import {inspectDependencyDependents} from '../lib/application/inspect-dependency-dependents.js';


test('reverse index identity separates physical project origins and rejects malformed, duplicate and coerced records',t=>{
  const f=fixture(t);assert.equal(validDependencyIndex(f.index),true);assert.equal(validDependencyRegistration(f.registration),true);
  assert.notEqual(dependencyRegistrationId({...f.registration.project,targetRoot:path.join(f.project.root,'other-checkout')}),f.registration.id);
  for(const mutate of [r=>{r.project.targetRoot+='/../escape';},r=>{r.generation='1';},r=>{r.prerequisites[0].revisionDigest=42;},r=>{r.prerequisites[0].command='do-not-store';},r=>{r.consumers=[];},r=>{r.consumers[0].clientId='antigravity';}]) {
    const changed=structuredClone(f.registration);mutate(changed);assert.equal(validDependencyRegistration(changed),false);
  }
  assert.equal(validDependencyIndex({...f.index,projects:[f.registration,f.registration]}),false);
  assert.equal(validDependencyIndex({...f.index,generation:0}),false);f.global.preserved();f.project.preserved();
});

test('reverse index and project prerequisite metadata require state v8 and cannot be downgraded by ordinary writers',t=>{
  const f=fixture(t),globalStore=new GlobalDeploymentStateStore({homeDir:f.global.homeDir}),projectStore=new DeploymentStateStore({statePath:f.project.statePath});
  assert.equal(globalStore.load().schemaVersion,8);assert.equal(projectStore.load().schemaVersion,8);
  for(const [store,file] of [[globalStore,f.global.statePath],[projectStore,f.project.statePath]]) {
    const before=fs.readFileSync(file),state=store.load();let entered=false;
    assert.throws(()=>store.withLock(()=>{entered=true;}),{code:'DEPENDENCY_COORDINATOR_REQUIRED'});assert.equal(entered,false);assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.existsSync(file+'.lock'),false);
    const downgraded=structuredClone(state);downgraded.schemaVersion=7;delete downgraded.dependencyIndex;delete downgraded.dependencyRegistration;
    assert.throws(()=>store.commit(downgraded),{code:'DEPENDENCY_COORDINATOR_REQUIRED'});assert.deepEqual(fs.readFileSync(file),before);
    state.schemaVersion=7;fs.writeFileSync(file,JSON.stringify(state));assert.throws(()=>store.load(),{code:'INVALID_DEPLOYMENT_STATE'});fs.writeFileSync(file,before);
  }
});

test('registered project and global revision observations are readonly and never promote native execution or deployment',t=>{
  const f=fixture(t),globalBefore=fs.readFileSync(f.global.statePath),projectBefore=fs.readFileSync(f.project.statePath),result=f.inspect();
  assert.equal(result.status,'observed');assert.equal(result.projects[0].verification,'consistent');assert.equal(result.projects[0].project.targetRoot,f.project.targetRoot);
  assert.equal(result.projects[0].prerequisites[0].revisionState,'observed');assert.equal(result.fulfilled,false);
  assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);assert.equal(fs.existsSync(f.global.statePath+'.lock'),false);
  assert.ok(!JSON.stringify(result).includes('Review source.'));f.global.preserved();f.project.preserved();
});

test('a registered global scoped v4 receipt retains positive reverse-index ownership observations',t=>{
  const f=fixture(t);f.global.raw.schemaVersion=3;f.global.raw.management={schemaVersion:1,resources:{}};f.global.write();
  const compiled=compileScopedDeployment({kitRoot:f.global.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.global.homeDir,
    definitions:loadClientDefinitions({definitionsDir:f.global.definitionsDir})});
  const descriptor=compiled.plans.flatMap(plan=>plan.installationDescriptors||[]).find(item=>item.assetId==='review');
  const receipt=createInstallationReceipt(descriptor,{proofs:f.globalReceipt.proofs,directories:f.globalReceipt.directories});
  assert.equal(receipt.schemaVersion,4);const state=f.global.state(),project=f.project.state(),registration=state.dependencyIndex.projects[0];
  Object.assign(registration.prerequisites[0],{revisionDigest:receipt.revisionDigest,locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)});
  state.transactions.push({id:'tx-v4-index-audit',type:'apply',status:'committed',operations:[],installationReceipts:[receipt]});project.dependencyRegistration=structuredClone(registration);
  fs.writeFileSync(f.global.statePath,JSON.stringify(state));fs.writeFileSync(f.project.statePath,JSON.stringify(project));
  const globalBefore=fs.readFileSync(f.global.statePath),projectBefore=fs.readFileSync(f.project.statePath),observed=f.inspect();
  assert.equal(observed.projects[0].verification,'consistent');assert.equal(observed.projects[0].prerequisites[0].revisionState,'observed');assert.equal(observed.fulfilled,false);
  assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);f.global.preserved();f.project.preserved();
});

test('missing or changed project state, pending registration and dangling recovery links preserve dependents as unverified',t=>{
  const f=fixture(t),before=fs.readFileSync(f.project.statePath);
  fs.renameSync(f.project.statePath,f.project.statePath+'.retained');let result=f.inspect();assert.equal(result.projects.length,1);assert.equal(result.projects[0].verification,'unverified');assert.equal(result.projects[0].issues[0].code,'DEPENDENT_PROJECT_STATE_UNAVAILABLE');fs.renameSync(f.project.statePath+'.retained',f.project.statePath);
  const changed=f.project.state();changed.dependencyRegistration.generation++;fs.writeFileSync(f.project.statePath,JSON.stringify(changed));assert.equal(f.inspect().projects[0].issues[0].code,'DEPENDENT_PROJECT_REGISTRATION_MISMATCH');fs.writeFileSync(f.project.statePath,before);
  for(const file of [f.project.statePath+'.lock',f.project.statePath+'.journal.json']) {fs.symlinkSync('missing-owner',file);result=f.inspect();assert.equal(result.projects[0].verification,'unverified');assert.equal(fs.readlinkSync(file),'missing-owner');fs.unlinkSync(file);}
  const state=f.global.state();state.dependencyIndex.projects[0].status='reserved';fs.writeFileSync(f.global.statePath,JSON.stringify(state));assert.equal(f.inspect().projects[0].issues[0].code,'DEPENDENT_PROJECT_TRANSACTION_PENDING');
  assert.deepEqual(fs.readFileSync(f.project.statePath),before);
});

test('consumer or provider content drift cannot erase a registered dependency or become a consistent record',t=>{
  const f=fixture(t),consumerFile=f.consumer.proofs[0].target,original=fs.readFileSync(consumerFile);fs.appendFileSync(consumerFile,'# external edit\n');
  assert.equal(f.inspect().projects[0].issues[0].code,'DEPENDENT_PROJECT_CONSUMER_UNVERIFIED');fs.writeFileSync(consumerFile,original);
  const providerFile=f.globalReceipt.proofs[0].target;fs.appendFileSync(providerFile,'# provider drift\n');const result=f.inspect();
  assert.equal(result.projects.length,1);assert.equal(result.projects[0].verification,'unverified');assert.equal(result.projects[0].prerequisites[0].revisionState,'unverified');
});

test('impact assessment distinguishes source/no-op and other origins from installed revision replacement or pending dependents',t=>{
  const f=fixture(t),pin=f.registration.prerequisites[0],observations=f.inspect();
  const change={...pin,nextRevisionDigest:'0'.repeat(64),nextLocatorDigest:pin.locatorDigest,nextBindingDigest:pin.bindingDigest};
  const impact=evaluateGlobalDependencyChanges({index:f.index,observations,changes:[change]});assert.equal(impact.allowed,false);assert.equal(impact.affectedProjects[0].registrationId,f.registration.id);assert.equal(impact.blocked[0].code,'GLOBAL_REVISION_IN_USE');
  assert.equal(evaluateGlobalDependencyChanges({index:f.index,observations,changes:[{...change,nextRevisionDigest:pin.revisionDigest}]}).allowed,true);
  const other={...change,sourceRoot:path.join(f.global.root,'another-kit')};other.id=dependencyPrerequisiteId(other);
  assert.equal(evaluateGlobalDependencyChanges({index:f.index,observations,changes:[other]}).allowed,true);
  assert.equal(evaluateGlobalDependencyChanges({index:f.index,observations,changes:[{...change,nextRevisionDigest:null,nextLocatorDigest:null,nextBindingDigest:null}]}).allowed,false);
  const unknown={...observations,projects:observations.projects.map(project=>({...project,verification:'unverified'}))};
  assert.equal(evaluateGlobalDependencyChanges({index:f.index,observations:unknown,changes:[change]}).blocked[0].code,'DEPENDENT_PROJECT_REVIEW_REQUIRED');
});

test('legacy state has no registered-index claim and readonly inspection initializes nothing',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),before=fs.readFileSync(f.statePath),result=inspectDependencyDependents({homeDir:f.homeDir});
  assert.equal(result.status,'not-enabled');assert.equal(result.coverage,'registered-projects-only');assert.deepEqual(result.projects,[]);assert.equal(result.fulfilled,false);assert.deepEqual(fs.readFileSync(f.statePath),before);
  fs.symlinkSync('missing-owner',f.statePath+'.lock');assert.equal(inspectDependencyDependents({homeDir:f.homeDir}).status,'unverified');fs.unlinkSync(f.statePath+'.lock');
  const missing=path.join(f.root,'uninitialized-home');assert.equal(inspectDependencyDependents({homeDir:missing}).status,'not-enabled');assert.equal(fs.existsSync(missing),false);
});

test('impact identifies only the consumers linked to the changed stable prerequisite ID',t=>{
  const f=fixture(t),index=structuredClone(f.index),registration=index.projects[0],pin=registration.prerequisites[0],other={...pin,assetId:'other-provider'};other.id=dependencyPrerequisiteId(other);
  registration.prerequisites.push(other);registration.consumers.push({...registration.consumers[0],assetId:'other-consumer',prerequisiteIds:[other.id]});assert.equal(validDependencyIndex(index),true);
  const observations={...f.inspect(),indexDigest:installationDigest(index)};
  const impact=evaluateGlobalDependencyChanges({index,observations,changes:[{...pin,nextRevisionDigest:'0'.repeat(64),nextLocatorDigest:pin.locatorDigest,nextBindingDigest:pin.bindingDigest}]});
  assert.deepEqual(impact.affectedProjects[0].consumers.map(item=>item.assetId),['reviewer']);assert.deepEqual(impact.requiredSequence,['remove-project-consumers','change-global-installation','redeploy-project-consumers']);
  const dangling=structuredClone(index);dangling.projects[0].consumers[0].prerequisiteIds=['prereq-'+'0'.repeat(64)];assert.equal(validDependencyIndex(dangling),false);
});

test('unverified global reviews and ordinary project writes stay blocked, while an empty index preserves legacy apply',t=>{
  const f=fixture(t);
  for(const environment of [f.global,f.project]) {
    const state=fs.readFileSync(environment.statePath),files=Object.fromEntries(Object.keys(environment.state().managed).map(file=>[file,fs.readFileSync(file)]));
    const blockedCode=environment===f.global?'GLOBAL_MUTATION_PLAN_BLOCKED':'DEPENDENCY_COORDINATOR_REQUIRED';
    const plan=environment.service.plan(environment.input);assert.throws(()=>environment.service.apply({planId:plan.planId}),{code:blockedCode});
    const rollback=environment.service.planRollback({scope:environment.input.scope,targetRoot:environment.targetRoot,clientId:'codex',transactionId:environment.applied.transactionId});
    assert.throws(()=>environment.service.rollback({planId:rollback.planId}),{code:environment===f.project?'ROLLBACK_PLAN_BLOCKED':blockedCode});
    assert.deepEqual(fs.readFileSync(environment.statePath),state);for(const [file,before] of Object.entries(files))assert.deepEqual(fs.readFileSync(file),before);
  }
  const empty=resourcePathFixture(t,{scope:'global'}),state=empty.state();state.schemaVersion=8;state.dependencyIndex={schemaVersion:1,generation:0,projects:[]};fs.writeFileSync(empty.statePath,JSON.stringify(state));
  empty.service.apply({planId:empty.service.plan(empty.input).planId});assert.equal(empty.state().schemaVersion,8);assert.deepEqual(empty.state().dependencyIndex,{schemaVersion:1,generation:0,projects:[]});empty.preserved();
});

test('deleting a referenced global Kit asset is rejected before creating source-management artifacts',t=>{
  const f=fixture(t),manifest=path.join(f.global.scopeRoot,'agent-kit.yaml'),before=fs.readFileSync(manifest),globalBefore=fs.readFileSync(f.global.statePath),projectBefore=fs.readFileSync(f.project.statePath);
  assert.throws(()=>f.global.service.planEdit({scopeRoot:f.global.scopeRoot,mutations:[{type:'delete',kind:'skills',assetId:'review'}]}),{code:'GLOBAL_SOURCE_IN_USE'});
  assert.deepEqual(fs.readFileSync(manifest),before);assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);
  assert.equal(fs.existsSync(path.join(f.global.scopeRoot,'.kit-sources')),false);f.global.preserved();f.project.preserved();
});

test('a source-deletion plan is checked again when a project registers the global dependency after planning',t=>{
  const f=fixture(t),state=f.global.state(),unregistered=structuredClone(state);unregistered.schemaVersion=7;delete unregistered.dependencyIndex;fs.writeFileSync(f.global.statePath,JSON.stringify(unregistered));
  const planned=f.global.service.planEdit({scopeRoot:f.global.scopeRoot,mutations:[{type:'delete',kind:'skills',assetId:'review'}]});fs.writeFileSync(f.global.statePath,JSON.stringify(state));
  const manifest=path.join(f.global.scopeRoot,'agent-kit.yaml'),before=fs.readFileSync(manifest);
  assert.throws(()=>f.global.service.applyEdit({planId:planned.planId}),{code:'GLOBAL_SOURCE_IN_USE'});assert.deepEqual(fs.readFileSync(manifest),before);
  assert.equal(fs.existsSync(path.join(f.global.scopeRoot,'.kit-sources')),false);f.global.preserved();f.project.preserved();
});

test('deleting an unrelated source preserves registered dependencies and installed files',t=>{
  const f=fixture(t),globalBefore=fs.readFileSync(f.global.statePath),projectBefore=fs.readFileSync(f.project.statePath),files=Object.fromEntries(Object.keys(f.global.state().managed).map(file=>[file,fs.readFileSync(file)]));
  const plan=f.global.service.planEdit({scopeRoot:f.global.scopeRoot,mutations:[{type:'delete',kind:'instructions',assetId:'rules'}]});assert.equal(f.global.service.applyEdit({planId:plan.planId}).success,true);
  assert.equal(f.inspect().projects[0].verification,'consistent');assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);
  for(const [file,bytes] of Object.entries(files))assert.deepEqual(fs.readFileSync(file),bytes);f.global.preserved();f.project.preserved();
});

test('source protection identifies the physical Kit origin, preserves aliases and rejects pending global changes',t=>{
  const f=fixture(t),alias=path.join(f.global.root,'kit-alias');fs.symlinkSync(f.global.scopeRoot,alias);const identity=fs.lstatSync(alias).ino;
  assert.throws(()=>f.global.service.planEdit({scopeRoot:alias,mutations:[{type:'delete',kind:'skills',assetId:'review'}]}),{code:'GLOBAL_SOURCE_IN_USE'});assert.equal(fs.lstatSync(alias).ino,identity);
  assert.throws(()=>f.global.service.planEdit({scopeRoot:f.global.scopeRoot,mutations:[{type:'update',kind:'skills',assetId:'review',asset:{scope:'project',source:'review',definition:{schemaVersion:1,format:'agent-skills'}}}]}),{code:'GLOBAL_SOURCE_IN_USE'});
  const other=path.join(f.global.root,'other-kit');fs.mkdirSync(other);fs.copyFileSync(path.join(f.global.scopeRoot,'agent-kit.yaml'),path.join(other,'agent-kit.yaml'));
  fs.cpSync(path.join(f.global.scopeRoot,'review'),path.join(other,'review'),{recursive:true});fs.copyFileSync(path.join(f.global.scopeRoot,'rules.md'),path.join(other,'rules.md'));
  const unrelated=f.global.service.planEdit({scopeRoot:other,mutations:[{type:'delete',kind:'skills',assetId:'review'}]});assert.equal(f.global.service.applyEdit({planId:unrelated.planId}).success,true);
  const pending=f.global.statePath+'.lock';fs.symlinkSync('missing-global-owner',pending);
  assert.throws(()=>f.global.service.planEdit({scopeRoot:f.global.scopeRoot,mutations:[{type:'delete',kind:'skills',assetId:'review'}]}),{code:'GLOBAL_DEPENDENCY_CONTEXT_PENDING'});assert.equal(fs.readlinkSync(pending),'missing-global-owner');fs.unlinkSync(pending);f.global.preserved();f.project.preserved();
});

test('ordinary removal, saved execution and path migration preserve registered global client files',t=>{
  const f=fixture(t),environment=f.global,state=fs.readFileSync(environment.statePath),files=Object.fromEntries(Object.keys(environment.state().managed).map(file=>[file,fs.readFileSync(file)]));
  const removal=environment.service.planRemoval({...environment.input,assetIds:['review']});assert.equal(removal.automatic,false);assert.throws(()=>environment.service.apply({planId:removal.planId}),{code:'GLOBAL_MUTATION_PLAN_BLOCKED'});
  assert.throws(()=>environment.service.savePlan({planId:environment.service.plan(environment.input).planId}),{code:'SAVED_PLAN_UNSUPPORTED'});
  environment.changePaths();const migration=environment.migrate();assert.equal(migration.automatic,false);assert.ok(migration.blocked.some(item=>item.reason==='GLOBAL_MUTATION_ACTION_UNSUPPORTED'));assert.throws(()=>environment.service.apply({planId:migration.planId}),{code:'GLOBAL_MUTATION_PLAN_BLOCKED'});
  assert.deepEqual(fs.readFileSync(environment.statePath),state);for(const [file,before] of Object.entries(files))assert.deepEqual(fs.readFileSync(file),before);environment.preserved();f.project.preserved();
});

test('registered global snapshot changes stop before publishing or changing any connection',t=>{
  const f=fixture(t),environment=resourcePathFixture(t,{scope:'global',skillStrategy:'snapshot-link'}),state=environment.state();state.schemaVersion=8;state.dependencyIndex=structuredClone(f.index);fs.writeFileSync(environment.statePath,JSON.stringify(state));
  fs.appendFileSync(path.join(environment.scopeRoot,'review/SKILL.md'),'\nChanged desired Skill\n');const before=fs.readFileSync(environment.statePath),connection=Object.entries(state.managed).find(([,record])=>record.connection),link=fs.readlinkSync(connection[0]),inode=fs.lstatSync(connection[0]).ino;
  const plan=environment.service.plan(environment.input);assert.equal(plan.automatic,false);assert.throws(()=>environment.service.apply({planId:plan.planId}),{code:'GLOBAL_MUTATION_PLAN_BLOCKED'});
  assert.deepEqual(fs.readFileSync(environment.statePath),before);assert.equal(fs.readlinkSync(connection[0]),link);assert.equal(fs.lstatSync(connection[0]).ino,inode);environment.preserved();f.global.preserved();f.project.preserved();
});

test('hard-linked or externally linked project ledgers and global recovery locks never supply positive dependent evidence',t=>{
  const f=fixture(t),before=fs.readFileSync(f.project.statePath);fs.linkSync(f.project.statePath,path.join(f.project.root,'shared-ledger'));
  assert.equal(f.inspect().projects[0].issues[0].code,'DEPENDENT_PROJECT_STATE_UNSAFE');fs.unlinkSync(path.join(f.project.root,'shared-ledger'));
  fs.renameSync(f.project.statePath,f.project.statePath+'.retained');fs.symlinkSync(f.project.statePath+'.retained',f.project.statePath);
  assert.equal(f.inspect().projects[0].verification,'unverified');assert.equal(fs.readlinkSync(f.project.statePath),f.project.statePath+'.retained');fs.unlinkSync(f.project.statePath);fs.renameSync(f.project.statePath+'.retained',f.project.statePath);
  fs.symlinkSync('missing-global-owner',f.global.statePath+'.lock');const result=f.inspect();assert.equal(result.status,'unverified');assert.equal(result.projects.length,1);assert.equal(result.projects[0].verification,'unverified');assert.equal(fs.readlinkSync(f.global.statePath+'.lock'),'missing-global-owner');fs.unlinkSync(f.global.statePath+'.lock');assert.deepEqual(fs.readFileSync(f.project.statePath),before);
});

test('CLI dependent inspection shares readonly registered-origin observation and never runs a native client',t=>{
  const f=fixture(t),before=fs.readFileSync(f.global.statePath);
  const child=spawnSync(process.execPath,[path.resolve('bin/cli.js'),'catalog','--kit',f.global.kitRoot,'--inspect-dependents'],{encoding:'utf8',env:{...process.env,HOME:f.global.homeDir,AGENTS_KIT_DIR:''}});
  assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.dependencyDependents.projects[0].verification,'consistent');assert.equal(result.dependencyDependents.fulfilled,false);
  assert.deepEqual(fs.readFileSync(f.global.statePath),before);assert.equal(fs.existsSync(f.global.statePath+'.lock'),false);f.global.preserved();f.project.preserved();
});
