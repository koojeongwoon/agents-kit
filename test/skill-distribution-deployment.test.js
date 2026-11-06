import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
import {inspectSkillDistributionSources} from '../lib/infrastructure/skill-distribution-source.js';
import {validateCommonSource} from '../lib/infrastructure/common-source-validator.js';
import {resolveAssetSources} from '../lib/infrastructure/manifest-loader.js';
import {selectSkillDistribution} from '../lib/domain/skill-distribution.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {nativePrerequisiteServiceFixture} from './helpers/native-prerequisite-service-fixture.js';
import {declareDistribution} from './helpers/skill-distribution-fixture.js';

test('source review selects only the named bundle and expires when its bytes or file modes change',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),source=path.join(f.scopeRoot,'review');fs.renameSync(source,source+'-old');fs.mkdirSync(source);fs.renameSync(source+'-old',path.join(source,'common'));
  const asset=declareDistribution(f,{variantSource:'common'}),selection=selectSkillDistribution(asset,{clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'});
  const sources=()=>resolveAssetSources(createAgentKitManifest(f.raw),f.scopeRoot,['review'],{skillSelections:new Map([['review',selection]])});
  assert.equal(sources().get('review'),path.join(source,'common'));
  const tampered={...selection,source:'../outside'};
  assert.throws(()=>resolveAssetSources(createAgentKitManifest(f.raw),f.scopeRoot,['review'],{skillSelections:new Map([['review',tampered]])}),{code:'SKILL_DISTRIBUTION_SELECTION_CHANGED'});
  const file=path.join(source,'common/references/help.md'),before=fs.readFileSync(file),mode=fs.statSync(file).mode&0o777;
  fs.appendFileSync(file,'Changed source\n');assert.throws(sources,{code:'SKILL_COMPATIBILITY_SOURCE_CHANGED'});fs.writeFileSync(file,before);
  fs.chmodSync(file,mode===0o600?0o644:0o600);assert.throws(sources,{code:'SKILL_COMPATIBILITY_SOURCE_CHANGED'});f.preserved();
});

test('native metadata remains byte-for-byte in the source without claiming portable or native support',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),source=path.join(f.scopeRoot,'review'),file=path.join(source,'agents/openai.yaml');
  fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,'interface:\n  display_name: Native review\n',{mode:0o600});
  const asset=declareDistribution(f,{format:'native'}),before=fs.readFileSync(file),identity=fs.lstatSync(file);
  assert.doesNotThrow(()=>validateCommonSource(asset,source));
  assert.equal(selectSkillDistribution(asset,{clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'}).reason,'SKILL_NATIVE_VARIANT_UNVERIFIED');
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.lstatSync(file).ino,identity.ino);assert.equal(fs.statSync(file).mode&0o777,0o600);f.preserved();
});

test('variant bundle roots reject symbolic links and missing source directories without changing the existing installation',t=>{
  const f=resourcePathFixture(t,{scope:'global'}),asset=declareDistribution(f),source=path.join(f.scopeRoot,'review'),link=path.join(f.scopeRoot,'linked-review');fs.symlinkSync(source,link);
  assert.throws(()=>inspectSkillDistributionSources(asset,link),{code:'SKILL_VARIANT_SOURCE_UNSAFE'});
  assert.throws(()=>inspectSkillDistributionSources(asset,path.join(source,'missing')),{code:'SKILL_VARIANT_SOURCE_UNSAFE'});f.preserved();
  assert.throws(()=>inspectSkillDistributionSources(asset,source,{variantIds:['missing']}),{code:'SKILL_VARIANT_SOURCE_UNSAFE'});
  f.raw.assets.skills[0].source='linked-review';assert.throws(()=>resolveAssetSources(createAgentKitManifest(f.raw),f.scopeRoot,['review']),{code:'SKILL_VARIANT_SOURCE_UNSAFE'});
});

test('ordinary copy and snapshot deployment attach selected variant evidence and roll back without changing existing settings or links',t=>{
  for(const strategy of ['copy','snapshot-link']) {
    const f=resourcePathFixture(t,{scope:'global',skillStrategy:strategy}),source=path.join(f.scopeRoot,'review'),target=path.join(f.homeDir,'.agents/skills/review');
    const before=fs.readFileSync(path.join(target,'SKILL.md')),config=fs.readFileSync(f.mcp),mode=fs.statSync(f.mcp).mode;
    fs.renameSync(source,source+'-old');fs.mkdirSync(source);fs.renameSync(source+'-old',path.join(source,'selected'));fs.appendFileSync(path.join(source,'selected/SKILL.md'),'\nSelected variant\n');
    declareDistribution(f,{variantSource:'selected',strategy});f.raw.targets={codex:{assetIds:['review']}};f.write();
    const plan=f.service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.equal(plan.skillDistributions[0].selection.source,'selected');
    const result=f.service.apply({planId:plan.planId});assert.match(fs.readFileSync(path.join(target,'SKILL.md'),'utf8'),/Selected variant/);assert.equal(fs.existsSync(path.join(target,'selected')),false);
    const transaction=f.state().transactions.find(tx=>tx.id===result.transactionId);assert.equal(transaction.skillSelections.length,1);assert.equal(transaction.skillSelections[0].selection.variantId,'common');
    const rollback=f.service.planRollback({transactionId:result.transactionId,...f.input});assert.equal(rollback.automatic,true,JSON.stringify(rollback.blocked));f.service.rollback({planId:rollback.planId});
    assert.deepEqual(fs.readFileSync(path.join(target,'SKILL.md')),before);assert.deepEqual(fs.readFileSync(f.mcp),config);assert.equal(fs.statSync(f.mcp).mode,mode);f.preserved();
  }
});

test('scoped global deployment records the selected common variant',t=>{
  const f=resourcePathFixture(t,{scope:'global'});f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};declareDistribution(f);f.raw.targets={codex:{assetIds:['review']}};f.write();
  const service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,kitRoot:f.kitRoot}),state=fs.readFileSync(f.statePath),plan=service.plan({...f.input,kitRoot:f.kitRoot});
  assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.deepEqual(fs.readFileSync(f.statePath),state);const result=service.apply({planId:plan.planId});
  assert.equal(f.state().transactions.find(tx=>tx.id===result.transactionId).skillSelections[0].selection.variantId,'common');f.preserved();
});

test('an old installed global receipt cannot satisfy a newly distribution-controlled prerequisite',t=>{
  const fixture=nativePrerequisiteServiceFixture(t,{scoped:true}),{f}=fixture;declareDistribution(f);const state=fs.readFileSync(f.statePath);
  const service=createManifestDeploymentService({...fixture.options,kitRoot:f.kitRoot});
  const plan=service.plan({kitRoot:f.kitRoot,scopeRoot:fixture.project.sourceRoot,targetRoot:fixture.project.targetRoot,scope:'project',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'});
  assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.assetId==='review'&&block.reason==='SKILL_DISTRIBUTION_INSTALLATION_UNVERIFIED'));
  assert.equal(fixture.calls.length,0);assert.deepEqual(fs.readFileSync(f.statePath),state);f.preserved();
});
