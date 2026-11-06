import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse,stringify} from 'yaml';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {declareDistribution} from './helpers/skill-distribution-fixture.js';
import {inspectSkillDistributionSources} from '../lib/infrastructure/skill-distribution-source.js';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
const PROFILE='codex-skill-interface-v1';

function fixture(t,{strategy='copy',scope='global'}={}) {
  const f=resourcePathFixture(t,{scope,skillStrategy:strategy,capabilityScopes:['global','project']}),file=path.join(f.scopeRoot,'review/agents/openai.yaml');fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,'interface:\n  display_name: Native review\n  short_description: Native interface review\n',{mode:0o600});
  declareDistribution(f,{format:'native',strategy});f.raw.assets.skills[0].definition.distribution.variants[0].native={schemaVersion:1,clientId:'codex',profile:PROFILE};f.raw.targets={codex:{assetIds:['review']}};f.write();
  const directory=path.join(f.definitionsDir,'native-skills');fs.mkdirSync(directory);
  const policy={schemaVersion:1,clientId:'codex',surface:'cli',configStore:'codex-local',profile:PROFILE,evidence:[{capabilityId:`skills-${scope}`,strategy,version:'0.0.1-test',binarySha256:'a'.repeat(64),platform:process.platform,arch:process.arch,verifiedAt:'2026-11-06',source:'test/native-skill-variants.test.js (synthetic)'}]};
  const policyFile=path.join(directory,'codex-cli.yaml');fs.writeFileSync(policyFile,stringify(policy));
  return {...f,file,policy,policyFile};
}

test('declared client-native variants preserve metadata bytes and modes through copy/snapshot apply and rollback',async t=>{
  const {createManifestDeploymentService}=await import('../lib/application/manifest-deployment-service.js');
  for(const strategy of ['copy','snapshot-link']) {
    const f=fixture(t,{strategy}),before=fs.readFileSync(f.statePath),service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,binaryObserver:()=>({binaryPath:'/synthetic/codex',sha256:'a'.repeat(64)})});
    const plan=service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.equal(plan.skillDistributions[0].selection.schemaVersion,3);assert.deepEqual(fs.readFileSync(f.statePath),before);
    const result=service.apply({planId:plan.planId}),installed=path.join(f.homeDir,'.agents/skills/review/agents/openai.yaml');assert.deepEqual(fs.readFileSync(installed),fs.readFileSync(f.file));
    if(strategy==='copy')assert.equal(fs.statSync(installed).mode&0o777,0o600);
    const transaction=f.state().transactions.find(tx=>tx.id===result.transactionId);assert.equal(transaction.skillSelections[0].selection.native.profile,PROFILE);
    service.rollback({planId:service.planRollback({...f.input,transactionId:result.transactionId}).planId});assert.equal(fs.existsSync(installed),false);f.preserved();
  }
});

test('project-native managed variant deploys the edited and reimported revision with its interface metadata',async t=>{
  const {createManifestDeploymentService}=await import('../lib/application/manifest-deployment-service.js');
  const f=fixture(t,{scope:'project'}),service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,kitRoot:f.kitRoot,binaryObserver:()=>({binaryPath:'/synthetic/codex',sha256:'a'.repeat(64)})}),input={...f.input,assetId:'review',variantId:'common'};
  f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.write();
  service.applyVariantRegistration({planId:service.planVariantRegistration(input).planId});
  service.applySourceEdit({planId:service.planSourceEdit({...input,revision:service.source(input).revision,changes:[{path:'notes.md',text:'Retain project Kit edit.\n'}]}).planId});
  fs.writeFileSync(path.join(f.scopeRoot,'review/remote.md'),'Reimported project addition.\n');service.applyRefresh({planId:service.planRefresh(input).planId});
  const manifestPath=path.join(f.scopeRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(manifestPath,'utf8')),asset=createAgentKitManifest(raw).assets.skills[0];
  raw.assets.skills[0].definition.distribution.variants[0].compatibility[0].review.treeDigest=inspectSkillDistributionSources(asset,path.join(f.scopeRoot,'review'),{scopeRoot:f.scopeRoot,variantIds:['common']}).get('common').descriptor.treeDigest;fs.writeFileSync(manifestPath,stringify(raw));
  const plan=service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));const installed=path.join(f.targetRoot,'.agents/skills/review');assert.ok(plan.operations.some(operation=>operation.target===path.join(installed,'notes.md')),JSON.stringify(plan.operations));const result=await service.apply({planId:plan.planId});
  assert.equal(fs.readFileSync(path.join(installed,'notes.md'),'utf8'),'Retain project Kit edit.\n');assert.equal(fs.readFileSync(path.join(installed,'remote.md'),'utf8'),'Reimported project addition.\n');assert.deepEqual(fs.readFileSync(path.join(installed,'agents/openai.yaml')),fs.readFileSync(f.file));
  const record=service.history(f.input).find(tx=>tx.id===result.transactionId).skillSelections[0];assert.equal(record.selection.schemaVersion,3);assert.equal(record.selection.sourceBase,'kit');
  await service.rollback({planId:service.planRollback({...f.input,transactionId:result.transactionId}).planId});assert.equal(fs.existsSync(path.join(installed,'notes.md')),false);f.preserved();
});

test('native selection evidence survives scoped global/project planning and a changed auxiliary policy blocks the project prerequisite',async t=>{
  const {createManifestDeploymentService}=await import('../lib/application/manifest-deployment-service.js');
  const f=fixture(t),options={homeDir:f.homeDir,definitionsDir:f.definitionsDir,kitRoot:f.kitRoot,binaryObserver:()=>({binaryPath:'/synthetic/codex',sha256:'a'.repeat(64)})},service=createManifestDeploymentService(options);
  f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.write();const plan=service.plan(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));service.apply({planId:plan.planId});
  const project=path.join(f.root,'project'),scopeRoot=path.join(f.kitRoot,'projects/default');fs.mkdirSync(scopeRoot,{recursive:true});fs.mkdirSync(project,{recursive:true});
  const raw={schemaVersion:3,kit:{id:'native-project'},management:{schemaVersion:1,resources:{}},targets:{codex:{assetIds:['reviewer']}},assets:{agents:[{id:'reviewer',scope:'project',dependsOn:{skills:[{schemaVersion:1,kitId:f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'}]},definition:{schemaVersion:1,permissions:'client-default',description:'Native prerequisite',instructions:'Use the selected Skill.'}}]}};fs.writeFileSync(path.join(scopeRoot,'agent-kit.yaml'),stringify(raw));
  const input={scopeRoot,targetRoot:project,scope:'project',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'},ready=service.plan(input);assert.equal(ready.execution.status,'requires-observation',JSON.stringify(ready.blocked));
  f.policy.evidence=[];fs.writeFileSync(f.policyFile,stringify(f.policy));const blocked=service.plan(input);assert.equal(blocked.execution.status,'blocked');assert.ok(blocked.blocked.some(block=>block.reason==='SKILL_DISTRIBUTION_INSTALLATION_UNVERIFIED'));f.preserved();
});

test('native policy/dependencies/unknown extensions stay in the source and block deployment rather than being stripped',async t=>{
  const {createManifestDeploymentService}=await import('../lib/application/manifest-deployment-service.js');
  for(const extra of ['policy:\n  allow_implicit_invocation: false\n','dependencies:\n  tools: []\n','unknown: value\n']) {
    const f=fixture(t);fs.appendFileSync(f.file,extra);const asset=createAgentKitManifest(f.raw).assets.skills[0],tree=inspectSkillDistributionSources(asset,path.join(f.scopeRoot,'review')).get('common').descriptor;f.raw.assets.skills[0].definition.distribution.variants[0].compatibility[0].review.treeDigest=tree.treeDigest;f.write();const before=fs.readFileSync(f.statePath);
    const service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,binaryObserver:()=>({binaryPath:'/synthetic/codex',sha256:'a'.repeat(64)})});
    assert.throws(()=>service.plan(f.input),error=>/^NATIVE_SKILL_/.test(error.code));assert.ok(fs.readFileSync(f.file,'utf8').endsWith(extra));assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
  }
});

test('client, version, binary, native evidence and exclusive isolation gates cannot be replaced by author review',async t=>{
  const {createManifestDeploymentService}=await import('../lib/application/manifest-deployment-service.js');
  for(const [mutate,sha,input,reason] of [
    [f=>fs.unlinkSync(f.policyFile),'a'.repeat(64),{},'SKILL_NATIVE_VARIANT_UNVERIFIED'],
    [()=>{},'b'.repeat(64),{},'SKILL_NATIVE_PROFILE_UNVERIFIED'],
    [()=>{},'a'.repeat(64),{clientVersion:'0.0.2-test'},'SKILL_COMPATIBILITY_UNVERIFIED'],
    [f=>{f.raw.assets.skills[0].definition.distribution.variants[0].native.clientId='antigravity';f.write();},'a'.repeat(64),{},'SKILL_NATIVE_CLIENT_MISMATCH'],
    [f=>{f.raw.assets.skills[0].definition.distribution.exposure='exclusive-client';f.write();},'a'.repeat(64),{},'SKILL_EXCLUSIVE_ISOLATION_UNVERIFIED']]) {
    const f=fixture(t);mutate(f);const state=fs.readFileSync(f.statePath),service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,binaryObserver:()=>({binaryPath:'/synthetic/codex',sha256:sha})});
    const plan=service.plan({...f.input,...input});assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.reason===reason),JSON.stringify(plan.blocked));assert.deepEqual(fs.readFileSync(f.statePath),state);f.preserved();
  }
});

test('native UI icons stay within the selected bundle and malformed metadata never authorizes a deployment',async t=>{
  const {createManifestDeploymentService}=await import('../lib/application/manifest-deployment-service.js');
  for(const text of ['interface:\n  icon_small: ../outside.svg\n','interface:\n  icon_small: https://example.com/icon.svg\n','interface:\n  display_name: One\n  display_name: Two\n','interface: &one\n  display_name: Test\nunknown: *one\n']) {
    const f=fixture(t);fs.writeFileSync(f.file,text);const asset=createAgentKitManifest(f.raw).assets.skills[0];f.raw.assets.skills[0].definition.distribution.variants[0].compatibility[0].review.treeDigest=inspectSkillDistributionSources(asset,path.join(f.scopeRoot,'review')).get('common').descriptor.treeDigest;f.write();
    const service=createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,binaryObserver:()=>({binaryPath:'/synthetic/codex',sha256:'a'.repeat(64)})});assert.throws(()=>service.plan(f.input),error=>/^NATIVE_SKILL_/.test(error.code));f.preserved();
  }
});

test('native auxiliary policy and metadata cannot change after review, including during validation and saved resume',async t=>{
  const {createManifestDeploymentService}=await import('../lib/application/manifest-deployment-service.js');
  for(const mode of ['policy','binary','validation','saved']) {
    const f=fixture(t);let sha='a'.repeat(64);const service=()=>createManifestDeploymentService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,binaryObserver:()=>({binaryPath:'/synthetic/codex',sha256:sha})}),s=service(),plan=s.plan(f.input),before=fs.readFileSync(f.statePath);
    const changePolicy=()=>{f.policy.evidence[0].verifiedAt='2026-11-07';fs.writeFileSync(f.policyFile,stringify(f.policy));};
    if(mode==='saved'){const saved=s.savePlan({planId:plan.planId});changePolicy();assert.throws(()=>service().resumeSavedPlan({planId:saved.planId,digest:saved.digest}),{code:'STALE_SAVED_PLAN'});}
    else {if(mode==='policy')changePolicy();if(mode==='binary')sha='b'.repeat(64);assert.throws(()=>s.apply({planId:plan.planId,...(mode==='validation'?{validate:()=>{changePolicy();return {valid:true};}}:{})}),{code:mode==='binary'?'CLIENT_BINARY_CHANGED':'STALE_DEPLOYMENT_PLAN'});}
    assert.deepEqual(fs.readFileSync(f.statePath),before);assert.equal(fs.existsSync(path.join(f.homeDir,'.agents/skills/review/agents/openai.yaml')),false);f.preserved();
  }
});
