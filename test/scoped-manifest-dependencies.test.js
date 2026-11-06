import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentKitManifest,validateManifestAssetContracts,resolveManifestDependencies} from '../lib/domain/manifest.js';
import {selectManifestDeployment} from '../lib/domain/manifest-targets.js';
import {planClientDeployment} from '../lib/application/plan-client-deployment.js';
import {normalizeAssetReference} from '../lib/domain/scoped-resource-reference.js';
import {resolveScopedManifestDependencies} from '../lib/domain/scoped-manifest-dependencies.js';

const ref=(assetId,kind='skills',scope={type:'global'},kitId='shared-kit')=>({schemaVersion:1,kitId,scope,kind,assetId});
function context(id,scope,assets,kitId=scope==='global'?'shared-kit':'project-kit',projectName='default') {
  const manifest=createAgentKitManifest({schemaVersion:3,kit:{id:kitId},management:{schemaVersion:1,resources:{}},assets:Object.fromEntries(Object.entries(assets).map(([kind,entries])=>[kind,entries.map(asset=>({...asset,scope:scope==='global'?'global':{type:'project',projectName}}))]))});
  validateManifestAssetContracts(manifest);return {id,catalogId:'selected-kit',scope,projectName:scope==='project'?projectName:'',status:'ready',manifest};
}
const resolve=(contexts,selectedAssetIds=['reviewer'],sourceContextId='project')=>resolveScopedManifestDependencies({contexts,sourceContextId,selectedAssetIds});

test('qualified reference shapes are versioned, bounded and never accept paths or unknown fields',()=>{
  const value=ref('review');assert.deepEqual(normalizeAssetReference(value,'skills',{allowQualified:true}),value);
  assert.ok(Object.isFrozen(normalizeAssetReference(value,'skills',{allowQualified:true}).scope));
  for(const invalid of [{...value,schemaVersion:2},{...value,path:'/tmp/review'},{...value,kitId:42},{...value,assetId:42},{...value,assetId:'../review'},{...value,scope:{type:'global',projectName:'other'}},{...value,scope:{type:'project'}},{...value,kind:'agents'}]) {
    assert.throws(()=>normalizeAssetReference(invalid,'skills',{allowQualified:true}),error=>error.code==='INVALID_ASSET_REFERENCE');
  }
  assert.throws(()=>normalizeAssetReference(value,'skills'),error=>error.code==='INVALID_ASSET_REFERENCE');
  assert.equal(normalizeAssetReference('review','skills'),'review');
});

test('Manifest v3 can describe qualified dependencies while ordinary deployment remains blocked',()=>{
  const project=context('project','project',{agents:[{id:'reviewer',dependsOn:{skills:[ref('review')]}}]});
  assert.equal(project.manifest.schemaVersion,3);
  assert.throws(()=>selectManifestDeployment(project.manifest,{clientId:'codex',scope:'project'}),error=>error.code==='SCOPED_DEPLOYMENT_NOT_ENABLED');
  assert.throws(()=>planClientDeployment({manifest:project.manifest}),error=>error.code==='SCOPED_DEPLOYMENT_NOT_ENABLED');
  assert.equal(resolveManifestDependencies(project.manifest,{selectedAssetIds:['reviewer']}).issues[0].code,'SCOPED_CATALOG_REQUIRED');
  for(const schemaVersion of [1,2]) {
    const manifest=createAgentKitManifest({...project.manifest,schemaVersion,...(schemaVersion===1?{management:undefined}:{})});
    assert.throws(()=>validateManifestAssetContracts(manifest),error=>error.code==='INVALID_ASSET_REFERENCE');
  }
});

test('project local and explicit global names remain distinct and global transitive providers become unverified prerequisites',()=>{
  const global=context('global','global',{skills:[{id:'review',requires:{tools:['repository.search']}}],mcpServers:[{id:'provider',provides:{tools:['repository.search']}}]});
  const project=context('project','project',{skills:[{id:'review'}],agents:[{id:'reviewer',dependsOn:{skills:['review',ref('review')]}}]});
  const before=JSON.stringify([global,project]),result=resolve([global,project]);
  assert.equal(result.valid,true);assert.equal(result.deploymentReady,false);assert.equal(result.readOnly,true);
  assert.equal(result.nodes.filter(node=>node.assetId==='review').length,2);
  assert.deepEqual(result.globalPrerequisites.map(node=>node.assetId).sort(),['provider','review']);
  assert.ok(result.globalPrerequisites.every(node=>node.installationState==='unverified'));
  assert.equal(result.localAssetKeys.length,2);assert.equal(new Set(result.nodes.map(node=>node.key)).size,4);
  assert.equal(JSON.stringify([global,project]),before);
});

test('bare references and implicit providers never fall back to a global Manifest',()=>{
  const global=context('global','global',{skills:[{id:'review'}],mcpServers:[{id:'provider',provides:{tools:['repository.search']}}]});
  const project=context('project','project',{agents:[{id:'reviewer',dependsOn:{skills:['review']},requires:{tools:['repository.search']}}]});
  const result=resolve([global,project]);assert.equal(result.valid,false);
  assert.deepEqual(result.issues.map(issue=>issue.code).sort(),['MISSING_REFERENCE','MISSING_TOOL_PROVIDER']);
  assert.equal(result.globalPrerequisites.length,0);
});

test('qualified provider selects its exact scope and an optional explicit missing provider still fails',()=>{
  const global=context('global','global',{mcpServers:[{id:'provider',provides:{tools:['repository.search']}}]});
  const project=context('project','project',{mcpServers:[{id:'provider',provides:{tools:['repository.search']}}],agents:[{id:'reviewer',requires:{tools:[{id:'repository.search',providerId:ref('provider','mcpServers')}]}}]});
  const result=resolve([global,project]);assert.equal(result.valid,true);
  assert.equal(result.toolBindings[0].providerContextId,'global');
  assert.equal(result.nodes.filter(node=>node.kind==='mcpServers').length,1);
  const missing=context('project','project',{agents:[{id:'reviewer',requires:{tools:[{id:'repository.search',optional:true,providerId:ref('missing','mcpServers')}]}}]});
  assert.equal(resolve([global,missing]).valid,false);
});

test('global-to-project, other projects and other physical Kits cannot satisfy a scoped reference',()=>{
  const project=context('project','project',{skills:[{id:'review'}],agents:[{id:'reviewer',dependsOn:{skills:[ref('review','skills',{type:'project',projectName:'other'},'other-kit')]}}]});
  const other=context('other','project',{skills:[{id:'review'}]},'other-kit','other');
  assert.equal(resolve([project,other]).issues[0].code,'SCOPE_VIOLATION');
  const global=context('global','global',{agents:[{id:'reviewer',dependsOn:{skills:[ref('review','skills',{type:'project',projectName:'default'},'project-kit')]}}]});
  assert.equal(resolve([global,project],['reviewer'],'global').issues[0].code,'SCOPE_VIOLATION');
  const consumer=context('project','project',{agents:[{id:'reviewer',dependsOn:{skills:[ref('review')]}}]});
  const foreign={...context('foreign','global',{skills:[{id:'review'}]}),catalogId:'other-physical-kit'};
  assert.equal(resolve([foreign,consumer]).valid,false);
});

test('duplicate global origins and inaccessible scope contexts remain unresolved',()=>{
  const global=context('global','global',{skills:[{id:'review'}]}),duplicate={...global,id:'duplicate'};
  const project=context('project','project',{agents:[{id:'reviewer',dependsOn:{skills:[ref('review')]}}]});
  assert.equal(resolve([global,duplicate,project]).issues[0].code,'SCOPED_REFERENCE_AMBIGUOUS');
  const unreadable={id:'unreadable',catalogId:'selected-kit',scope:'global',projectName:'',status:'unreadable'};
  assert.equal(resolve([unreadable,project]).issues[0].code,'SCOPED_CONTEXT_UNAVAILABLE');
});

test('qualified policy denial and cycles use origin keys instead of colliding bare IDs',()=>{
  const global=context('global','global',{policies:[{id:'readonly',deny:{capabilities:['repository.write']}}],mcpServers:[{id:'provider',provides:{tools:['repository.write']}}],skills:[{id:'a',dependsOn:{skills:['b']}},{id:'b',dependsOn:{skills:['a']}}]});
  const project=context('project','project',{agents:[{id:'reviewer',policies:[ref('readonly','policies')],requires:{tools:[{id:'repository.write',capability:'repository.write',providerId:ref('provider','mcpServers')}]},dependsOn:{skills:[ref('a')]}}]});
  const result=resolve([global,project]);assert.equal(result.valid,false);
  assert.ok(result.issues.some(issue=>issue.code==='POLICY_DENIED'));assert.ok(result.issues.some(issue=>issue.code==='CYCLIC_DEPENDENCY'));
  assert.ok(result.issues.find(issue=>issue.code==='CYCLIC_DEPENDENCY').path.every(key=>typeof key==='string'&&key.includes('global')));
});

test('Agent policy follows transitive global dependencies even if an unrestricted root visited the shared Skill first',()=>{
  const global=context('global','global',{skills:[{id:'review',requires:{tools:[{id:'repository.write',capability:'repository.write'}]}}],mcpServers:[{id:'provider',provides:{tools:['repository.write']}}]});
  const project=context('project','project',{policies:[{id:'readonly',deny:{capabilities:['repository.write']}}],agents:[
    {id:'open',dependsOn:{skills:[ref('review')]}},
    {id:'reviewer',policies:['readonly'],dependsOn:{skills:[ref('review')]}}
  ]});
  const result=resolve([global,project],['open','reviewer']);
  assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.code==='POLICY_DENIED'&&issue.sourceAssetId==='review'));
});

test('implicit local provider ambiguity is retained for optional Tools',()=>{
  const project=context('project','project',{agents:[{id:'reviewer',requires:{tools:[{id:'repository.search',optional:true}]}}],mcpServers:[{id:'one',provides:{tools:['repository.search']}},{id:'two',provides:{tools:['repository.search']}}]});
  const result=resolve([project]);assert.equal(result.valid,false);assert.equal(result.issues[0].code,'AMBIGUOUS_TOOL_PROVIDER');
});
