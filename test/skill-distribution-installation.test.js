import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {declareDistribution} from './helpers/skill-distribution-fixture.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {nativePrerequisiteServiceFixture} from './helpers/native-prerequisite-service-fixture.js';
import {prepareSharedDeployment} from '../lib/application/shared-resource-deployment.js';
import {selectSkillDistribution} from '../lib/domain/skill-distribution.js';

const selectOnly=f=>{f.raw.targets={codex:{assetIds:['review']}};f.write();};
const restart=f=>createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir});
const target=f=>path.join(f.targetRoot,'.agents/skills/review');

test('copy variants preserve declared executable modes, including a mode-only update and rollback',t=>{
  const f=resourcePathFixture(t),file=path.join(f.scopeRoot,'review/references/help.md'),installed=path.join(target(f),'references/help.md'),before=fs.statSync(installed).mode&0o777;
  fs.chmodSync(file,0o750);declareDistribution(f);selectOnly(f);const plan=f.service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));
  const result=f.service.apply({planId:plan.planId});assert.equal(fs.statSync(installed).mode&0o777,0o750);
  f.service.rollback({planId:f.service.planRollback({...f.input,transactionId:result.transactionId}).planId});assert.equal(fs.statSync(installed).mode&0o777,before);f.preserved();
});

test('source changes before apply or during validation invalidate the selected copy and preserve installed bytes and ledger',t=>{
  for(const duringValidation of [false,true]) {
    const f=resourcePathFixture(t),file=path.join(f.scopeRoot,'review/SKILL.md'),installed=path.join(target(f),'SKILL.md');
    fs.appendFileSync(file,'\nPlanned copy\n');declareDistribution(f);selectOnly(f);const plan=f.service.plan(f.input),state=fs.readFileSync(f.statePath),before=fs.readFileSync(installed);
    const change=()=>fs.appendFileSync(file,'\nExternal source edit\n');if(!duringValidation)change();
    assert.throws(()=>f.service.apply({planId:plan.planId,...(duringValidation?{validate:()=>{change();return {valid:true};}}:{})}),{code:'STALE_SOURCE_REVISION'});
    assert.deepEqual(fs.readFileSync(f.statePath),state);assert.deepEqual(fs.readFileSync(installed),before);f.preserved();
  }
});

test('shared exposure lists other clients from definitions and exclusive deployment stays blocked even without known additional readers',t=>{
  for(const scope of ['global','project']) {
    const f=resourcePathFixture(t,{scope});writeProfileFixture({definitionsDir:f.definitionsDir,repositoryRoot:path.resolve('.'),clientId:'antigravity'});
    declareDistribution(f);selectOnly(f);const shared=f.service.plan(f.input),review=shared.skillDistributions[0];assert.equal(shared.automatic,true,JSON.stringify(shared.blocked));
    assert.equal(review.exposure.coverage,'known-roots-only');assert.equal(review.exposure.additionalDiscoveryState,'unverified');
    if(scope==='project')assert.ok(review.exposure.readers.some(reader=>reader.clientId==='antigravity'));
    f.raw.assets.skills[0].definition.distribution.exposure='exclusive-client';f.write();const blocked=f.service.plan(f.input);
    assert.equal(blocked.automatic,false);assert.ok(blocked.blocked.some(block=>block.reason==='SKILL_EXCLUSIVE_ISOLATION_UNVERIFIED'));f.preserved();
  }
});

test('distinct bundles sharing a physical target cannot be merged from disjoint file lists',t=>{
  const f=resourcePathFixture(t),source=path.join(f.scopeRoot,'review');writeProfileFixture({definitionsDir:f.definitionsDir,repositoryRoot:path.resolve('.'),clientId:'antigravity'});
  fs.renameSync(source,source+'-old');fs.mkdirSync(source);fs.renameSync(source+'-old',path.join(source,'a'));fs.mkdirSync(path.join(source,'b'));
  fs.copyFileSync(path.join(source,'a/SKILL.md'),path.join(source,'b/SKILL.md'));fs.writeFileSync(path.join(source,'b/only-b.md'),'Different file set\n');
  declareDistribution(f,{variants:[{id:'a',source:'a',targets:[{clientId:'codex',surface:'cli'}]},{id:'b',source:'b',targets:[{clientId:'antigravity',surface:'cli'}]}]});
  const plan=f.service.plan({scopeRoot:f.scopeRoot,targetRoot:f.targetRoot,scope:'project',targets:['codex','antigravity'].map(clientId=>({clientId,surface:'cli',clientVersion:'0.0.1-test'}))});
  assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.reason==='SHARED_RESOURCE_CONTENT_CONFLICT'));f.preserved();
});

test('same-byte variant switches are recorded and their metadata-only transaction can be rolled back',t=>{
  const f=resourcePathFixture(t),source=path.join(f.scopeRoot,'review');fs.renameSync(source,source+'-old');fs.mkdirSync(source);fs.renameSync(source+'-old',path.join(source,'a'));fs.cpSync(path.join(source,'a'),path.join(source,'b'),{recursive:true,preserveTimestamps:true});
  declareDistribution(f,{variants:[{id:'a',source:'a',targets:[{clientId:'codex',surface:'cli'}]},{id:'b',source:'b',targets:[]}]});selectOnly(f);
  const first=f.service.apply({planId:f.service.plan(f.input).planId});
  const distribution=f.raw.assets.skills[0].definition.distribution;distribution.selection[0].variantId='b';distribution.variants[1].compatibility=structuredClone(distribution.variants[0].compatibility);f.write();
  const plan=f.service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.ok(plan.operations.every(operation=>operation.operation==='SKIP'));
  const second=f.service.apply({planId:plan.planId});assert.equal(f.state().transactions.find(tx=>tx.id===second.transactionId).skillSelections[0].selection.variantId,'b');
  const rollback=f.service.planRollback({...f.input,transactionId:second.transactionId});assert.equal(rollback.automatic,true,JSON.stringify(rollback.blocked));f.service.rollback({planId:rollback.planId});
  assert.equal(f.state().transactions.find(tx=>tx.id===first.transactionId).status,'committed');assert.equal(f.state().transactions.find(tx=>tx.id===second.transactionId).status,'rolled-back');f.preserved();
});

test('saved copy and snapshot plans retain selection review across service restart and reject unreviewed source changes',t=>{
  for(const strategy of ['copy','snapshot-link']) {
    const f=resourcePathFixture(t,{scope:'global',skillStrategy:strategy});declareDistribution(f,{strategy});selectOnly(f);
    const saved=f.service.savePlan({planId:f.service.plan(f.input).planId});assert.equal(f.service.savedPlans()[0].skillDistributions[0].selection.variantId,'common');
    const result=restart(f).resumeSavedPlan({planId:saved.planId,digest:saved.digest});assert.equal(f.state().transactions.find(tx=>tx.id===result.transactionId).skillSelections[0].selection.variantId,'common');
    const second=restart(f),stale=second.savePlan({planId:second.plan(f.input).planId});fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'\nChanged source\n');
    assert.throws(()=>restart(f).resumeSavedPlan({planId:stale.planId,digest:stale.digest}));f.preserved();
  }
});

test('a distribution-controlled global installation satisfies project prerequisites only with matching selection evidence',t=>{
  const fixture=nativePrerequisiteServiceFixture(t,{scoped:true}),{f}=fixture;declareDistribution(f);selectOnly(f);f.service.apply({planId:f.service.plan(f.input).planId});
  const service=createManifestDeploymentService({...fixture.options,kitRoot:f.kitRoot}),input={kitRoot:f.kitRoot,scopeRoot:fixture.project.sourceRoot,targetRoot:fixture.project.targetRoot,scope:'project',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};
  const plan=service.plan(input);assert.equal(plan.execution.status,'requires-observation',JSON.stringify(plan.blocked));assert.equal(fixture.calls.length,0);
  const rule=f.raw.assets.skills[0].definition.distribution.variants[0].compatibility[0];rule.status='incompatible';delete rule.review;f.write();
  const changed=service.plan(input);assert.equal(changed.execution.status,'blocked');assert.ok(changed.blocked.some(block=>block.reason==='SKILL_DISTRIBUTION_INSTALLATION_UNVERIFIED'));assert.equal(fixture.calls.length,0);f.preserved();
});

test('invalid or unbound selection receipt metadata makes the ledger fail closed',t=>{
  const f=resourcePathFixture(t);declareDistribution(f);selectOnly(f);const result=f.service.apply({planId:f.service.plan(f.input).planId}),state=f.state();
  const record=state.transactions.find(tx=>tx.id===result.transactionId).skillSelections[0];record.receiptDigest='0'.repeat(64);fs.writeFileSync(f.statePath,JSON.stringify(state));
  assert.throws(()=>f.service.plan(f.input),{code:'INVALID_DEPLOYMENT_STATE'});f.preserved();
});

test('validation cannot replace the reviewed selection metadata before committing a legacy Manifest deployment',t=>{
  const f=resourcePathFixture(t);declareDistribution(f);selectOnly(f);const plan=f.service.plan(f.input),before=fs.readFileSync(f.statePath);
  assert.throws(()=>f.service.apply({planId:plan.planId,validate:({plans})=>{plans.flatMap(plan=>plan.skillSelectionDescriptors||[])[0].definitionDigest='0'.repeat(64);return {valid:true};}}),{code:'STALE_DEPLOYMENT_PLAN'});
  assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
});

test('copy and snapshot preparers bind their captured bytes to the author-reviewed tree',t=>{
  for(const strategy of ['copy','snapshot-link']) {
    const f=resourcePathFixture(t),asset=declareDistribution(f,{strategy}),selection=selectSkillDistribution(asset,{clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'});
    fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'\nChanged after source resolution\n');
    const planned={clientId:'codex',assetId:'review',assetKind:'skills',scope:'project',commonSource:true,target:'.agents/skills/review',strategy,skillSelection:selection,dependencyIds:[]};
    const prepared=prepareSharedDeployment({contributions:[{planned,source:path.join(f.scopeRoot,'review'),kitId:f.raw.kit.id,consumerId:`${f.raw.kit.id}:codex:cli`}],state:f.state(),scope:'project',targetRoot:f.targetRoot,homeDir:f.homeDir,sourceRoot:f.scopeRoot});
    assert.ok(prepared.blocked.some(block=>block.reason==='SKILL_COMPATIBILITY_SOURCE_CHANGED'));assert.equal(prepared.operations.length,0);f.preserved();
  }
});

test('project Manifest v3 applies a selected variant, resumes a saved review and restores the previous installation',async t=>{
  const f=resourcePathFixture(t),installed=path.join(target(f),'SKILL.md'),before=fs.readFileSync(installed);
  f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'\nScoped selected variant\n');declareDistribution(f);selectOnly(f);
  const service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,kitRoot:f.kitRoot}),plan=service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));
  const saved=service.savePlan({planId:plan.planId}),next=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,kitRoot:f.kitRoot});
  const result=await next.resumeSavedPlan({planId:saved.planId,digest:saved.digest});assert.match(fs.readFileSync(installed,'utf8'),/Scoped selected variant/);
  assert.equal(f.state().transactions.find(tx=>tx.id===result.transactionId).skillSelections[0].selection.variantId,'common');
  const rollback=next.planRollback({...f.input,transactionId:result.transactionId});assert.equal(rollback.automatic,true,JSON.stringify(rollback.blocked));await next.rollback({planId:rollback.planId});
  assert.deepEqual(fs.readFileSync(installed),before);f.preserved();
});
