import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse} from 'yaml';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
import {createClientDefinition} from '../lib/domain/client-definition.js';
import {selectScopedManifestDeployment} from '../lib/domain/scoped-deployment-selection.js';
import {planScopedClientDeployment,planClientDeployment} from '../lib/application/plan-client-deployment.js';
import {planVerifiedScopedClientDeployment} from '../lib/application/plan-verified-client-deployment.js';

const ref=(assetId,kind='skills')=>({schemaVersion:1,kitId:'shared',scope:{type:'global'},kind,assetId});
const scope={type:'project',projectName:'default'};
function fixture({assets={},target={},globalAssets={}}={}) {
  const global=createAgentKitManifest({schemaVersion:3,kit:{id:'shared'},management:{schemaVersion:1,resources:{}},assets:{skills:[{id:'review',scope:'global',source:'global-review',definition:{schemaVersion:1,format:'agent-skills'}}],...globalAssets}});
  const project=createAgentKitManifest({schemaVersion:3,kit:{id:'project'},management:{schemaVersion:1,resources:{}},targets:{codex:{assetIds:['reviewer'],...target}},assets:{
    skills:[{id:'review',scope,source:'local-review',definition:{schemaVersion:1,format:'agent-skills'}}],
    agents:[{id:'reviewer',scope,dependsOn:{skills:['review',ref('review')]},definition:{schemaVersion:1,description:'Review',instructions:'Review source.',permissions:'client-default'}}],...assets}});
  const contexts=[{id:'global',catalogId:'physical-kit',scope:'global',projectName:'',status:'ready',manifest:global},{id:'project',catalogId:'physical-kit',scope:'project',projectName:'default',status:'ready',manifest:project}];
  const raw=parse(fs.readFileSync(path.resolve('clients/codex.yaml'),'utf8'));
  for(const surface of raw.surfaces)surface.runtimeEvidence=['skills-project','agents-project','instructions-project','mcp-project'].map(capabilityId=>({capabilityId,version:'0.0.1-test',platform:process.platform,arch:process.arch,verifiedAt:'2026-11-06',source:'test/scoped-deployment-plan.test.js (synthetic)'}));
  const input={contexts,sourceContextId:'project',definition:createClientDefinition(raw),clientVersion:'0.0.1-test',surface:'cli',platform:process.platform,arch:process.arch};
  return {global,project,contexts,input};
}

test('scoped selection preserves same-name origins, local closure and consumer-specific external prerequisites',()=>{
  const f=fixture(),before=JSON.stringify(f.contexts),result=selectScopedManifestDeployment({...f.input,clientId:'codex'});
  assert.deepEqual(result.rootAssetIds,['reviewer']);assert.deepEqual(result.selectedAssetIds,['review','reviewer']);
  assert.deepEqual(result.dependenciesByAsset.reviewer,['review']);assert.deepEqual(result.dependenciesByAsset.review,[]);
  assert.equal(result.globalPrerequisites.length,1);assert.equal(result.globalPrerequisites[0].contextId,'global');
  assert.deepEqual(result.prerequisitesByAsset.reviewer,[result.globalPrerequisites[0].key]);assert.deepEqual(result.prerequisitesByAsset.review,[]);
  assert.equal(JSON.stringify(f.contexts),before);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.dependenciesByAsset.reviewer));
});

test('scoped capability planning renders original local assets and never emits a global Skill copy or synthetic reference',()=>{
  const f=fixture(),plan=planScopedClientDeployment(f.input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));
  assert.deepEqual(plan.operations.map(operation=>operation.assetId).sort(),['review','reviewer']);
  assert.ok(plan.operations.every(operation=>operation.scope==='project'&&!operation.target.startsWith('~/')));
  assert.equal(plan.operations.find(operation=>operation.assetId==='review').source,'local-review');assert.deepEqual(plan.operations.find(operation=>operation.assetId==='reviewer').dependencyIds,['review']);
  assert.ok(plan.operations.find(operation=>operation.assetId==='reviewer').rendered.content.includes('developer_instructions'));
  assert.equal(plan.selection.globalPrerequisites[0].assetId,'review');assert.equal(plan.selection.graph.deploymentReady,false);
  assert.throws(()=>planClientDeployment({manifest:f.project,definition:f.input.definition}),{code:'SCOPED_DEPLOYMENT_NOT_ENABLED'});
});

test('explicit local roots respect client target enablement, scope and asset allowlist',()=>{
  const f=fixture();
  assert.throws(()=>selectScopedManifestDeployment({...f.input,clientId:'antigravity'}),{code:'MANIFEST_TARGET_DISABLED'});
  assert.throws(()=>selectScopedManifestDeployment({...f.input,clientId:'constructor'}),{code:'MANIFEST_TARGET_DISABLED'});
  assert.throws(()=>selectScopedManifestDeployment({...f.input,clientId:'codex',selectedAssetIds:['review']}),{code:'INVALID_SCOPED_DEPLOYMENT_SELECTION'});
  assert.throws(()=>selectScopedManifestDeployment({...f.input,clientId:'codex',selectedAssetIds:['missing']}),{code:'INVALID_SCOPED_DEPLOYMENT_SELECTION'});
  assert.throws(()=>selectScopedManifestDeployment({...f.input,clientId:'codex',selectedAssetIds:[]}),{code:'NO_ASSETS_FOR_SCOPE'});
  const mismatch=fixture({target:{projectName:'other'}});assert.throws(()=>planScopedClientDeployment(mismatch.input),{code:'SCOPED_DEPLOYMENT_TARGET_MISMATCH'});
});

test('scoped planning keeps unsupported runtime Skill activation, Tool policy and model fields blocked',()=>{
  for(const extra of [{uses:{skills:[ref('review')]}},{requires:{tools:[{id:'repository.search',providerId:ref('docs','mcpServers')}]}},{model:'unverified-model'}]) {
    const f=fixture({globalAssets:{mcpServers:[{id:'docs',scope:'global',provides:{tools:[{id:'repository.search',nativeName:'search_repository'}]}}]},assets:{agents:[{id:'reviewer',scope,...extra,definition:{schemaVersion:1,description:'Review',instructions:'Review',permissions:'client-default'}}]}});
    const plan=planScopedClientDeployment(f.input);assert.equal(plan.automatic,false);assert.equal(plan.blocked.find(item=>item.assetId==='reviewer').reason,'AGENT_POLICY_MAPPING_UNSUPPORTED');
  }
});

test('scoped planning preserves native binary and surface gates from the common verified planner',()=>{
  const f=fixture(),raw=parse(fs.readFileSync(path.resolve('clients/codex.yaml'),'utf8')),definition=createClientDefinition(raw);
  const result=planVerifiedScopedClientDeployment({...f.input,definition,clientVersion:'0.166.0-alpha.6',binaryObserver:()=>({binaryPath:'/fixture/codex',sha256:'0'.repeat(64)})});
  assert.equal(result.plan.automatic,false);assert.ok(result.plan.blocked.some(item=>item.reason==='CLIENT_BINARY_UNVERIFIED'));
  const desktop=planScopedClientDeployment({...f.input,definition,surface:'desktop'});assert.equal(desktop.automatic,false);assert.ok(desktop.blocked.length);
});

test('invalid scoped graph is rejected before rendering and never falls back to same-name global providers',()=>{
  const f=fixture({assets:{skills:[],agents:[{id:'reviewer',scope,dependsOn:{skills:['review']},definition:{schemaVersion:1,description:'Review',instructions:'Review',permissions:'client-default'}}]}});
  assert.throws(()=>planScopedClientDeployment(f.input),error=>error.code==='MANIFEST_DEPENDENCY_INVALID'&&error.details.issues.some(issue=>issue.code==='MISSING_REFERENCE'));
});

test('global transitive Skill Tool providers remain external and each local consumer records its complete global closure',()=>{
  const f=fixture({globalAssets:{skills:[{id:'review',scope:'global',source:'review',requires:{tools:[{id:'repository.search',providerId:'docs'}]}}],mcpServers:[{id:'docs',scope:'global',provides:{tools:[{id:'repository.search',nativeName:'search_repository'}]}}]}});
  const result=selectScopedManifestDeployment({...f.input,clientId:'codex'});assert.deepEqual(result.globalPrerequisites.map(node=>node.assetId).sort(),['docs','review']);
  assert.equal(result.prerequisitesByAsset.reviewer.length,2);assert.deepEqual(result.prerequisitesByAsset.review,[]);assert.equal(result.graph.toolBindings[0].providerContextId,'global');
});

test('scoped closure limits match bounded consumer/prerequisite registration before expanding per-consumer reachability',()=>{
  const skills=Array.from({length:256},(_,index)=>({id:`review-${index}`,scope})),f=fixture({assets:{skills,agents:[{id:'reviewer',scope,dependsOn:{skills:skills.map(skill=>skill.id)}}]}});
  assert.throws(()=>selectScopedManifestDeployment({...f.input,clientId:'codex'}),{code:'SCOPED_DEPLOYMENT_LIMIT_EXCEEDED'});
});
