import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {loadManifestFile} from '../lib/infrastructure/manifest-loader.js';
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-scoped-catalog-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),projectPath=path.join(root,'work'),kitRoot=path.join(root,'kit'),scopeRoot=path.join(kitRoot,'projects/default');
  fs.mkdirSync(homeDir);fs.mkdirSync(projectPath);
  const reference={schemaVersion:1,kitId:'shared-kit',scope:{type:'global'},kind:'skills',assetId:'review'};
  write(path.join(kitRoot,'global/agent-kit.json'),{schemaVersion:1,kit:{id:'shared-kit'},assets:{skills:[{id:'review',scope:'global',source:'review'}]}});
  write(path.join(kitRoot,'global/review/SKILL.md'),'# DO_NOT_PERSIST_SKILL_BODY\n');
  write(path.join(scopeRoot,'agent-kit.json'),{schemaVersion:3,kit:{id:'project-kit'},management:{schemaVersion:1,resources:{}},assets:{agents:[{id:'reviewer',scope:'project',dependsOn:{skills:[reference]},definition:{schemaVersion:1,description:'Review source',instructions:'DO_NOT_PERSIST_AGENT_BODY',permissions:'client-default'}}]}});
  const external=path.join(root,'external');fs.mkdirSync(external);fs.mkdirSync(path.join(homeDir,'.agents/skills'),{recursive:true});fs.symlinkSync(external,path.join(homeDir,'.agents/skills/ego-browser'));
  return {root,homeDir,projectPath,kitRoot,scopeRoot,service:createManifestDeploymentService({homeDir,definitionsDir:path.resolve('clients')}),input:{kitRoot,projectPath,includeDependencies:true}};
}
function snapshot(root){return fs.readdirSync(root,{recursive:true}).sort().map(name=>{const file=path.join(root,name),stat=fs.lstatSync(file);return [name,stat.mode,stat.mtimeMs,stat.isSymbolicLink()?fs.readlinkSync(file):stat.isFile()?fs.readFileSync(file).toString('base64'):null];});}

test('scoped catalog remains readonly and missing installations block apply while versioned management permits source editing',t=>{
  const f=fixture(t),before=snapshot(f.root),result=f.service.catalog(f.input),graph=result.dependencyGraph;
  assert.equal(graph.valid,true);assert.equal(graph.deploymentReady,false);assert.equal(graph.globalPrerequisites.length,1);
  assert.equal(graph.globalPrerequisites[0].installationState,'unverified');
  assert.equal(result.registry.find(item=>item.id==='reviewer').references[0].qualified.scope.type,'global');
  assert.equal(result.registry.find(item=>item.id==='reviewer').previewOnly,false);assert.equal(result.registry.find(item=>item.id==='reviewer').manifestSchemaVersion,3);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_PERSIST'));
  const manifestPath=path.join(f.scopeRoot,'agent-kit.json');
  assert.throws(()=>loadManifestFile({manifestPath,resolveSources:false}),error=>error.code==='SCOPED_DEPLOYMENT_NOT_ENABLED');
  assert.equal(loadManifestFile({manifestPath,resolveSources:false,allowScopedPreview:true}).manifest.schemaVersion,3);
  const plan=f.service.plan({scopeRoot:f.scopeRoot,targetRoot:f.projectPath,clientId:'codex',scope:'project'});assert.equal(plan.kind,'scoped-apply');assert.equal(plan.automatic,false);assert.equal(plan.execution.status,'blocked');
  assert.throws(()=>f.service.apply({planId:plan.planId}),error=>error.code==='SCOPED_DEPLOYMENT_PLAN_BLOCKED');
  assert.throws(()=>f.service.planEdit({scopeRoot:f.scopeRoot,mutations:[]}),error=>error.code==='INVALID_MANIFEST_MUTATIONS');
  assert.deepEqual(snapshot(f.root),before);
});

test('catalog CLI uses the shared scoped graph and never initializes or deploys resources',t=>{
  const f=fixture(t),before=snapshot(f.root),child=spawnSync(process.execPath,[path.resolve('bin/cli.js'),'catalog','--kit',f.kitRoot,'--project',f.projectPath,'--dependencies'],{encoding:'utf8',env:{...process.env,HOME:f.homeDir,AGENTS_KIT_DIR:''}});
  assert.equal(child.status,0,child.stderr);const graph=JSON.parse(child.stdout).dependencyGraph;
  assert.equal(graph.valid,true);assert.equal(graph.globalPrerequisites[0].assetId,'review');assert.equal(graph.deploymentReady,false);
  assert.deepEqual(snapshot(f.root),before);
});

test('same project name at another checkout produces different graph origin keys',t=>{
  const f=fixture(t),other=path.join(f.root,'other');fs.mkdirSync(other);
  const left=f.service.catalog(f.input).dependencyGraph,right=f.service.catalog({...f.input,projectPath:other}).dependencyGraph;
  assert.notEqual(left.localAssetKeys[0],right.localAssetKeys[0]);
  assert.equal(left.globalPrerequisites[0].key,right.globalPrerequisites[0].key);
});

test('a Kit path alias resolves to the same physical dependency origins',t=>{
  const f=fixture(t),alias=path.join(f.root,'kit-alias');fs.symlinkSync(f.kitRoot,alias);
  const left=f.service.catalog(f.input).dependencyGraph,right=f.service.catalog({...f.input,kitRoot:alias}).dependencyGraph;
  assert.deepEqual(left.nodes.map(node=>node.key),right.nodes.map(node=>node.key));
});
