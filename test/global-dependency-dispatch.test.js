import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {dependencyIndexFixture} from './helpers/dependency-index-fixture.js';
import {createManifestDeploymentService} from '../lib/application/manifest-deployment-service.js';
import {canonicalDigest} from '../lib/infrastructure/saved-deployment-plan-store.js';

function fixture(t,{assetId='rules',snapshot=false}={}) {
  const f=dependencyIndexFixture(t,snapshot?{globalOptions:{skillStrategy:'snapshot-link'},prerequisiteAssetId:'docs'}:{});f.global.raw.targets={codex:{assetIds:[assetId]}};f.global.write();
  fs.appendFileSync(path.join(f.global.scopeRoot,assetId==='rules'?'rules.md':'review/SKILL.md'),'\nDispatched global change\n');
  fs.mkdirSync(path.join(f.global.definitionsDir,'native-prerequisites'));fs.copyFileSync(path.resolve('clients/native-prerequisites/codex-cli.yaml'),path.join(f.global.definitionsDir,'native-prerequisites/codex-cli.yaml'));
  const options={homeDir:f.global.homeDir,definitionsDir:f.global.definitionsDir},restart=()=>createManifestDeploymentService(options);
  return {f,restart,service:restart(),input:f.global.input};
}

test('the common service reviews and applies a pin-preserving global change without writing project state',t=>{
  const {f,service,input}=fixture(t),state=f.global.state(),project=fs.readFileSync(f.project.statePath),plan=service.plan(input);
  assert.equal(plan.dependencyProtection?.status,'ready');assert.equal(plan.automatic,true);assert.equal(plan.dependencyProtection.registeredProjects,1);
  assert.equal(service.apply({planId:plan.planId}).outcome,'committed');assert.match(fs.readFileSync(f.global.rules,'utf8'),/Dispatched global change/);
  assert.deepEqual(f.global.state().dependencyIndex,state.dependencyIndex);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});

test('public review flags cannot force a pinned global change through the common apply service',t=>{
  const {f,service,input}=fixture(t,{assetId:'review'}),before=fs.readFileSync(f.global.statePath),plan=service.plan(input);
  assert.equal(plan.automatic,false);assert.equal(plan.dependencyProtection.status,'blocked');assert.ok(plan.blocked.some(block=>block.reason==='GLOBAL_REVISION_IN_USE'));
  assert.throws(()=>service.apply({planId:plan.planId,automatic:true,dependencyProtection:{status:'ready'}}),{code:'GLOBAL_MUTATION_PLAN_BLOCKED'});assert.deepEqual(fs.readFileSync(f.global.statePath),before);f.global.preserved();f.project.preserved();
});

test('global saved plan v4 resumes through the guarded service after restart and remains single-use',t=>{
  const {f,service,input,restart}=fixture(t),saved=service.savePlan({planId:service.plan(input).planId}),record=JSON.parse(fs.readFileSync(path.join(f.global.homeDir,'.agents-kit/plans',saved.planId+'.json')));
  assert.equal(record.body.schemaVersion,4);assert.equal(record.body.contract,'global-dependency-mutation-v1');
  const first=restart().resumeSavedPlan(saved),count=f.global.state().transactions.length;assert.equal(first.outcome,'committed');assert.deepEqual(restart().resumeSavedPlan(saved),first);assert.equal(f.global.state().transactions.length,count);f.global.preserved();f.project.preserved();
});

test('a saved global plan becomes stale after registered project native settings change',t=>{
  const {f,service,input,restart}=fixture(t),saved=service.savePlan({planId:service.plan(input).planId}),before=fs.readFileSync(f.global.rules);
  fs.appendFileSync(f.project.mcp,'\n# Manual project setting\n');assert.throws(()=>restart().resumeSavedPlan(saved),{code:'STALE_SAVED_PLAN'});assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.match(fs.readFileSync(f.project.mcp,'utf8'),/Manual project setting/);f.global.preserved();f.project.preserved();
});

test('a saved global plan rechecks auxiliary native context definitions after restart',t=>{
  const {f,service,input,restart}=fixture(t),saved=service.savePlan({planId:service.plan(input).planId}),before=fs.readFileSync(f.global.rules),auxiliary=path.join(f.global.definitionsDir,'native-prerequisites/codex-cli.yaml');
  fs.writeFileSync(auxiliary,fs.readFileSync(auxiliary,'utf8').replace('  - /etc/codex/config.toml','  - /etc/codex/changed-config.toml'));
  assert.throws(()=>restart().resumeSavedPlan(saved),{code:'STALE_SAVED_PLAN'});assert.deepEqual(fs.readFileSync(f.global.rules),before);f.global.preserved();f.project.preserved();
});

test('saved global v4 records reject an incomplete guard even with a recomputed record digest',t=>{
  const {f,service,input,restart}=fixture(t),saved=service.savePlan({planId:service.plan(input).planId}),file=path.join(f.global.homeDir,'.agents-kit/plans',saved.planId+'.json'),record=JSON.parse(fs.readFileSync(file)),before=fs.readFileSync(f.global.statePath);
  delete record.body.globalMutationDigest;record.digest=canonicalDigest(record.body);fs.writeFileSync(file,JSON.stringify(record));
  assert.throws(()=>restart().resumeSavedPlan({planId:saved.planId,digest:record.digest}),{code:'SAVED_PLAN_DIGEST_MISMATCH'});assert.deepEqual(fs.readFileSync(f.global.statePath),before);f.global.preserved();f.project.preserved();
});

test('the actual CLI reviews, saves, resumes and rolls back a protected global change through the shared service',t=>{
  const {f}=fixture(t),repository=path.join(f.global.root,'cli-repository'),before=fs.readFileSync(f.global.rules),project=fs.readFileSync(f.project.statePath),index=structuredClone(f.global.state().dependencyIndex);
  fs.mkdirSync(path.join(repository,'bin'),{recursive:true});fs.copyFileSync('bin/cli.js',path.join(repository,'bin/cli.js'));fs.writeFileSync(path.join(repository,'package.json'),'{"type":"module"}');fs.symlinkSync(path.resolve('lib'),path.join(repository,'lib'));fs.cpSync(f.global.definitionsDir,path.join(repository,'clients'),{recursive:true});
  const run=args=>spawnSync(process.execPath,[path.join(repository,'bin/cli.js'),...args],{encoding:'utf8',timeout:20000,env:{...process.env,HOME:f.global.homeDir,CODEX_HOME:path.join(f.global.homeDir,'.codex'),AGENTS_KIT_DIR:''}}),common=['--kit',f.global.kitRoot,'--client','codex','--surface','cli','--client-version','0.0.1-test'];
  let result=run(['apply',...common,'--dry-run']);assert.equal(result.status,0,result.stderr);const review=JSON.parse(result.stdout);assert.equal(review.dependencyProtection.status,'ready',JSON.stringify(review.blocked));
  result=run(['apply',...common,'--save-plan']);assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readFileSync(f.global.rules),before);
  const root=path.join(f.global.kitRoot,'.deployment-plans'),record=JSON.parse(fs.readFileSync(path.join(root,fs.readdirSync(root).find(name=>name.endsWith('.json')))));assert.equal(record.body.schemaVersion,4);
  result=run(['resume','--kit',f.global.kitRoot,'--plan',record.body.id,'--digest',record.digest]);assert.equal(result.status,0,result.stderr);const applied=JSON.parse(result.stdout);assert.match(fs.readFileSync(f.global.rules,'utf8'),/Dispatched global change/);
  result=run(['rollback',...common,'--transaction',applied.transactionId]);assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.deepEqual(f.global.state().dependencyIndex,index);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});

test('a successful guarded global change can be rolled back and its saved rollback keeps every pin',t=>{
  const {f,service,input,restart}=fixture(t),before=fs.readFileSync(f.global.rules),index=structuredClone(f.global.state().dependencyIndex),project=fs.readFileSync(f.project.statePath);
  const applied=service.apply({planId:service.plan(input).planId}),review=service.planRollback({scope:'global',targetRoot:f.global.homeDir,clientId:'codex',transactionId:applied.transactionId});
  assert.equal(review.dependencyProtection?.status,'ready');const saved=service.savePlan({planId:review.planId}),result=restart().resumeSavedPlan(saved);assert.equal(result.rolledBackTransactionId,applied.transactionId);
  assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.deepEqual(f.global.state().dependencyIndex,index);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});

test('rolling back the original provider installation is blocked while a project pins it',t=>{
  const {f,service}=fixture(t),before=fs.readFileSync(f.global.statePath),plan=service.planRollback({scope:'global',targetRoot:f.global.homeDir,clientId:'codex',transactionId:f.global.applied.transactionId});
  assert.equal(plan.automatic,false);assert.equal(plan.dependencyProtection.status,'blocked');assert.ok(plan.blocked.some(block=>block.reason==='GLOBAL_REVISION_IN_USE'));
  assert.throws(()=>service.rollback({planId:plan.planId}),{code:'GLOBAL_MUTATION_PLAN_BLOCKED'});assert.deepEqual(fs.readFileSync(f.global.statePath),before);f.global.preserved();f.project.preserved();
});

test('guarded global removal and explicit rollback preserve unrelated pins and user instructions',t=>{
  const {f,service,input}=fixture(t),before=fs.readFileSync(f.global.rules),index=structuredClone(f.global.state().dependencyIndex);
  const plan=service.planRemoval({...input,assetIds:['rules']});assert.equal(plan.dependencyProtection.status,'ready');
  const removed=service.apply({planId:plan.planId});assert.equal(fs.readFileSync(f.global.rules,'utf8').trimEnd(),'# User rules');
  service.rollback({planId:service.planRollback({...input,transactionId:removed.transactionId}).planId});
  assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.deepEqual(f.global.state().dependencyIndex,index);f.global.preserved();f.project.preserved();
});

test('a guarded snapshot update and saved tree rollback retain the original link and MCP pin',t=>{
  const {f,service,input,restart}=fixture(t,{assetId:'review',snapshot:true}),target=Object.keys(f.global.state().managed).find(file=>f.global.state().managed[file].connection),before=fs.readlinkSync(target),index=structuredClone(f.global.state().dependencyIndex);
  const review=service.plan(input);assert.equal(review.dependencyProtection.status,'ready',JSON.stringify(review.blocked));
  const applied=service.apply({planId:review.planId});assert.notEqual(fs.readlinkSync(target),before);
  const rollback=service.planRollback({...input,transactionId:applied.transactionId});assert.equal(rollback.dependencyProtection.status,'ready',JSON.stringify(rollback.blocked));
  restart().resumeSavedPlan(service.savePlan({planId:rollback.planId}));assert.equal(fs.readlinkSync(target),before);assert.deepEqual(f.global.state().dependencyIndex,index);f.global.preserved();f.project.preserved();
});

test('global rollback preserves manual permission changes and cannot be forced by a public flag',t=>{
  const {f,service,input}=fixture(t),applied=service.apply({planId:service.plan(input).planId}),before=fs.readFileSync(f.global.rules),state=fs.readFileSync(f.global.statePath);
  fs.chmodSync(f.global.rules,0o600);const plan=service.planRollback({...input,transactionId:applied.transactionId});assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.reason==='ROLLBACK_TARGET_MODIFIED'));
  assert.throws(()=>service.rollback({planId:plan.planId,automatic:true}),{code:'GLOBAL_MUTATION_PLAN_BLOCKED'});assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.equal(fs.statSync(f.global.rules).mode&0o777,0o600);assert.deepEqual(fs.readFileSync(f.global.statePath),state);f.global.preserved();f.project.preserved();
});

for(const phase of ['before-state','after-state'])test(`common global recovery dispatch handles ${phase} without weakening its guard`,t=>{
  const {f,input,restart}=fixture(t),before=fs.readFileSync(f.global.rules),index=structuredClone(f.global.state().dependencyIndex),project=fs.readFileSync(f.project.statePath);
  const child=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-dispatch.js'),JSON.stringify({homeDir:f.global.homeDir,definitionsDir:f.global.definitionsDir,input,phase})],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const service=restart(),review=service.planRecovery({scope:'global',targetRoot:f.global.homeDir,clientId:'codex'});assert.equal(review.dependencyProtection?.status,'ready');
  assert.equal(service.recover({planId:review.planId}).outcome,phase==='before-state'?'restored':'committed');
  if(phase==='before-state')assert.deepEqual(fs.readFileSync(f.global.rules),before);else assert.match(fs.readFileSync(f.global.rules,'utf8'),/Dispatched global change/);
  assert.deepEqual(f.global.state().dependencyIndex,index);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});

for(const phase of ['before-state','after-state'])test(`saved global recovery settles ${phase} once without replaying project writes`,t=>{
  const {f,service,input,restart}=fixture(t),saved=service.savePlan({planId:service.plan(input).planId}),project=fs.readFileSync(f.project.statePath);
  const child=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-dispatch.js'),JSON.stringify({homeDir:f.global.homeDir,definitionsDir:f.global.definitionsDir,saved,phase})],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const resumed=restart();resumed.recover({planId:resumed.planRecovery({...input}).planId});const count=f.global.state().transactions.length;
  if(phase==='after-state')assert.equal(resumed.resumeSavedPlan(saved).outcome,'committed');else assert.throws(()=>resumed.resumeSavedPlan(saved),{code:'SAVED_PLAN_NOT_READY'});
  assert.equal(f.global.state().transactions.length,count);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});

for(const snapshot of [false,true])for(const phase of ['before-state','after-state'])test(`global ${snapshot?'tree':'file'} rollback recovery ${phase} preserves every registered pin`,t=>{
  const {f,service,input,restart}=fixture(t,snapshot?{snapshot,assetId:'review'}:{}),target=snapshot?Object.keys(f.global.state().managed).find(file=>f.global.state().managed[file].connection):f.global.rules;
  const read=()=>snapshot?fs.readlinkSync(target):fs.readFileSync(target,'utf8'),original=read(),applied=service.apply({planId:service.plan(input).planId}),changed=read(),index=structuredClone(f.global.state().dependencyIndex),project=fs.readFileSync(f.project.statePath);
  const child=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-dispatch.js'),JSON.stringify({homeDir:f.global.homeDir,definitionsDir:f.global.definitionsDir,input,rollbackTransactionId:applied.transactionId,phase})],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const recovered=restart();assert.equal(recovered.recover({planId:recovered.planRecovery(input).planId}).outcome,phase==='before-state'?'restored':'committed');
  assert.equal(read(),phase==='before-state'?changed:original);assert.deepEqual(f.global.state().dependencyIndex,index);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});
