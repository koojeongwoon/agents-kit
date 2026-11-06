import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {stringify} from 'yaml';
import {compileScopedDeployment} from '../lib/application/scoped-deployment-compiler.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {latestInstallationReceipts,observeInstallationReceipt} from '../lib/application/installation-receipt-service.js';
import {installationDigest} from '../lib/domain/installation-receipt.js';
import {applyDeployment} from '../lib/application/apply-deployment.js';
import {DeploymentBackupStore} from '../lib/infrastructure/deployment-backup-store.js';
import {planDependencyCoordination,executeDependencyCoordination} from '../lib/application/dependency-coordination-service.js';
import {readPathImage,imageFingerprint} from '../lib/infrastructure/path-image.js';
import {deploymentOperationContent} from '../lib/application/deployment-operation-content.js';

function fixture(t) {
  const f=resourcePathFixture(t,{scope:'global',capabilityScopes:['global','project']}),projectPath=path.join(f.root,'project'),scopeRoot=path.join(f.kitRoot,'projects/default');fs.mkdirSync(projectPath);fs.mkdirSync(path.join(scopeRoot,'review'),{recursive:true});
  const reference={schemaVersion:1,kitId:f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'};
  const raw={schemaVersion:3,kit:{id:'project-kit'},management:{schemaVersion:1,resources:{}},targets:{codex:{assetIds:['reviewer']}},assets:{
    agents:[{id:'reviewer',scope:'project',dependsOn:{skills:['review',reference]},definition:{schemaVersion:1,description:'Review',instructions:'DO_NOT_PERSIST_AGENT_BODY',permissions:'client-default'}}],
    skills:[{id:'review',scope:'project',source:'review',definition:{schemaVersion:1,format:'agent-skills'}}]}};
  fs.writeFileSync(path.join(scopeRoot,'review/SKILL.md'),'---\nname: review\ndescription: Review\n---\nDO_NOT_PERSIST_SKILL_BODY\n');
  const write=()=>fs.writeFileSync(path.join(scopeRoot,'agent-kit.yaml'),stringify(raw));write();
  const external=path.join(projectPath,'.agents/skills/ego-browser');fs.mkdirSync(path.dirname(external),{recursive:true});fs.symlinkSync('/external/ego-skills',external);const identity=fs.lstatSync(external);
  const input={kitRoot:f.kitRoot,projectName:'default',projectPath,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})};
  return {f,raw,write,scopeRoot,projectPath,input,external,preserved:()=>{f.preserved();assert.equal(fs.readlinkSync(external),'/external/ego-skills');assert.equal(fs.lstatSync(external).ino,identity.ino);}};
}
const snapshot=root=>fs.readdirSync(root,{recursive:true}).sort().map(name=>{const file=path.join(root,name),info=fs.lstatSync(file);return [name,info.mode,info.mtimeMs,info.isSymbolicLink()?fs.readlinkSync(file):info.isFile()?fs.readFileSync(file).toString('base64'):null];});

function applyPredicted(f,compiled,extra={}) {
  // An internal synthetic verifier exercises the coordinator; it grants no
  // client support and does not open the public Manifest v3 execution gate.
  const verifyPrerequisites=()=>({verified:true,digest:installationDigest({fixture:'prediction, not native evidence'})});
  const request={globalStore:compiled.globalStore,projectStore:compiled.stateStore,project:compiled.review.project,transactionId:'tx-prediction-roundtrip',
    upsertConsumers:compiled.prediction.consumers,prerequisites:compiled.prerequisites,releaseConsumerIds:[],targets:compiled.targets,verifyPrerequisites};
  const plan=planDependencyCoordination(request);
  for(const prepared of compiled.plans)prepared.blocked=prepared.blocked.filter(block=>!['SCOPED_DEPLOYMENT_NOT_ENABLED','DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'].includes(block.reason));
  return executeDependencyCoordination({...request,plan,executeProject:context=>applyDeployment({plans:compiled.plans,stateStore:context.projectStore,
    backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.projectPath,'.agent-kit/backups')}),createTransactionId:()=>request.transactionId,...extra})});
}

test('new scoped consumer revisions are predicted without writes and match actual copy and local dependency receipts',t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.scopeRoot,'review/references'));fs.writeFileSync(path.join(f.scopeRoot,'review/references/help.md'),'DO_NOT_PERSIST_HELP');f.write();
  for(const directory of ['Znotes','anotes']){fs.mkdirSync(path.join(f.scopeRoot,'review',directory));fs.writeFileSync(path.join(f.scopeRoot,'review',directory,'help.md'),'DO_NOT_PERSIST_SORTED_HELP');}
  const before=snapshot(f.f.root),compiled=compileScopedDeployment(f.input);
  assert.equal(compiled.prediction?.status,'predicted');assert.deepEqual(snapshot(f.f.root),before);
  assert.equal(compiled.prediction.receipts.length,2);assert.ok(compiled.prediction.receipts.every(receipt=>receipt.schemaVersion===4));
  assert.deepEqual(compiled.prediction.consumers.map(consumer=>consumer.assetId),['reviewer']);assert.ok(!JSON.stringify(compiled.prediction).includes('DO_NOT_PERSIST'));
  const predicted=structuredClone(compiled.prediction);assert.equal(applyPredicted(f,compiled).outcome,'committed');
  const state=compiled.stateStore.load(),receipts=latestInstallationReceipts(state);
  for(const expected of predicted.receipts){const actual=receipts.find(receipt=>receipt.assetId===expected.assetId);assert.equal(actual.revisionDigest,expected.revisionDigest);
    assert.equal(observeInstallationReceipt({receipt:actual,state,globalState:f.f.state(),homeDir:f.f.homeDir,targetRoot:f.projectPath}).dependencyState,'revision-observed');}
  assert.equal(state.dependencyRegistration.consumers[0].revisionDigest,predicted.consumers[0].revisionDigest);f.preserved();
});

test('changing the public prediction cannot authorize different receipts and a changed declaration rolls back the new client files',t=>{
  const f=fixture(t),compiled=compileScopedDeployment(f.input);assert.equal(compiled.prediction?.status,'predicted');
  compiled.review.predictedInstallations[0].revisionDigest='0'.repeat(64);const expected=compiled.prediction.receipts[0].revisionDigest;
  assert.notEqual(expected,'0'.repeat(64));
  const target=compiled.plans.flatMap(plan=>plan.operations).find(operation=>operation.assetId==='reviewer').target;
  assert.throws(()=>applyPredicted(f,compiled,{validate:()=>{compiled.plans.flatMap(plan=>plan.installationDescriptors||[]).find(descriptor=>descriptor.assetId==='reviewer').declaration.deniedCapabilities.push('unexpected.permission');return {valid:true,results:[]};}}),{code:'INSTALLATION_PREDICTION_MISMATCH'});
  assert.equal(fs.existsSync(target),false);assert.equal(fs.existsSync(compiled.stateStore.statePath),false);f.preserved();
});

test('changed Skill, MCP and instruction predictions preserve user settings and match the installed revisions',t=>{
  const f=fixture(t);f.raw.defaults=f.f.raw.defaults;f.raw.targets.codex.assetIds.push('local-docs','rules');
  f.raw.assets.mcpServers=[{id:'local-docs',scope:'project',provides:{tools:[{id:'local.search',nativeName:'search_local'}]},definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:['DO_NOT_PERSIST_COMMAND']}}];
  f.raw.assets.skills[0].requires={tools:[{id:'local.search',providerId:'local-docs'}]};
  f.raw.assets.instructions=[{id:'rules',scope:'project',source:'rules.md',definition:{schemaVersion:1,format:'markdown'}}];f.write();fs.writeFileSync(path.join(f.scopeRoot,'rules.md'),'# DO_NOT_PERSIST_RULES\n');
  const config=path.join(f.projectPath,'.codex/config.toml'),rules=path.join(f.projectPath,'AGENTS.md');fs.mkdirSync(path.dirname(config),{recursive:true});
  fs.writeFileSync(config,'# User setting\nmodel="keep"\n\n[mcp_servers.foreign]\ncommand="keep"\n',{mode:0o640});fs.writeFileSync(rules,'# User rules\n',{mode:0o600});
  const first=compileScopedDeployment(f.input);assert.equal(first.prediction?.status,'predicted');assert.equal(first.prediction.receipts.length,4);
  applyPredicted(f,first);
  fs.appendFileSync(path.join(f.scopeRoot,'review/SKILL.md'),'\nUpdated local Skill\n');fs.writeFileSync(path.join(f.scopeRoot,'rules.md'),'# Updated Kit rules\n');
  f.raw.assets.mcpServers[0].definition.args=['DO_NOT_PERSIST_UPDATED_COMMAND'];f.write();
  const before=snapshot(f.f.root),second=compileScopedDeployment(f.input);assert.equal(second.prediction?.status,'predicted');assert.deepEqual(snapshot(f.f.root),before);
  for(const receipt of second.prediction.receipts)assert.notEqual(receipt.revisionDigest,first.prediction.receipts.find(item=>item.assetId===receipt.assetId).revisionDigest);
  const verifyPrerequisites=()=>({verified:true,digest:installationDigest({fixture:'updated prediction'})}),request={globalStore:second.globalStore,projectStore:second.stateStore,project:second.review.project,transactionId:'tx-prediction-update',
    upsertConsumers:second.prediction.consumers,prerequisites:second.prerequisites,releaseConsumerIds:[],targets:second.targets,verifyPrerequisites};
  for(const plan of second.plans)plan.blocked=[];
  executeDependencyCoordination({...request,plan:planDependencyCoordination(request),executeProject:context=>applyDeployment({plans:second.plans,stateStore:context.projectStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.projectPath,'.agent-kit/backups')}),createTransactionId:()=>request.transactionId})});
  for(const expected of second.prediction.receipts)assert.equal(latestInstallationReceipts(second.stateStore.load()).find(receipt=>receipt.assetId===expected.assetId).revisionDigest,expected.revisionDigest);
  assert.match(fs.readFileSync(config,'utf8'),/model="keep"/);assert.match(fs.readFileSync(config,'utf8'),/mcp_servers.foreign/);assert.match(fs.readFileSync(rules,'utf8'),/# User rules/);
  assert.equal(fs.statSync(config).mode&0o777,0o640);assert.equal(fs.statSync(rules).mode&0o777,0o600);f.preserved();
});

test('prediction uses the current creation permissions for new Skill directories and files',t=>{
  const f=fixture(t),old=process.umask(0o077);
  try {
    fs.mkdirSync(path.join(f.scopeRoot,'review/references'));fs.writeFileSync(path.join(f.scopeRoot,'review/references/help.md'),'private help');
    const compiled=compileScopedDeployment(f.input);assert.equal(compiled.prediction?.status,'predicted');applyPredicted(f,compiled);
    const receipt=latestInstallationReceipts(compiled.stateStore.load()).find(receipt=>receipt.assetId==='review');
    assert.ok(receipt.proofs.every(proof=>proof.mode===0o600));assert.ok(receipt.directories.every(directory=>directory.mode===0o700));
    assert.equal(receipt.revisionDigest,compiled.prediction.receipts.find(item=>item.assetId==='review').revisionDigest);f.preserved();
  }finally{process.umask(old);}
});

test('unpublished snapshot links and mixed file changes are predicted without creating a snapshot',t=>{
  const f=resourcePathFixture(t,{scope:'global',skillStrategy:'snapshot-link'});f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};
  f.raw.assets.skills.push({id:'new-review',scope:'global',source:'new-review',definition:{schemaVersion:2,format:'agent-skills',deployment:{schemaVersion:1,strategy:'snapshot-link'}}});
  f.raw.assets.agents[0].dependsOn={skills:['new-review']};f.raw.targets={codex:{assetIds:['reviewer']}};fs.mkdirSync(path.join(f.scopeRoot,'new-review'));
  fs.writeFileSync(path.join(f.scopeRoot,'new-review/SKILL.md'),'---\nname: new-review\ndescription: New review\n---\nDO_NOT_PERSIST_NEW_SNAPSHOT\n');f.write();
  const before=snapshot(f.root),compiled=compileScopedDeployment({kitRoot:f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});
  assert.equal(compiled.prediction?.status,'predicted',JSON.stringify(compiled.review.blocked));assert.deepEqual(snapshot(f.root),before);
  const link=compiled.plans.flatMap(plan=>plan.operations).find(operation=>operation.assetId==='new-review');assert.equal(fs.existsSync(link.linkSource||link.managedAfter[link.target].linkSource),false);
  for(const plan of compiled.plans)plan.blocked=[];
  applyDeployment({plans:compiled.plans,stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.homeDir,'.agents-kit/deployments/_global/backups')})});
  assert.equal(fs.lstatSync(link.target).isSymbolicLink(),true);
  for(const expected of compiled.prediction.receipts)assert.equal(latestInstallationReceipts(compiled.stateStore.load()).find(receipt=>receipt.assetId===expected.assetId).revisionDigest,expected.revisionDigest);f.preserved();
});

test('creation-permission changes invalidate a sealed prediction before any client file is written',t=>{
  const f=resourcePathFixture(t,{scope:'global'});f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.write();
  const compiled=compileScopedDeployment({kitRoot:f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});
  assert.equal(compiled.prediction?.status,'predicted');for(const plan of compiled.plans)plan.blocked=[];
  const before=snapshot(f.root),old=process.umask();
  try {process.umask(old===0o077?0o022:0o077);
    assert.throws(()=>applyDeployment({plans:compiled.plans,stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.homeDir,'.agents-kit/deployments/_global/backups')})}),{code:'STALE_INSTALLATION_PREDICTION'});
    assert.deepEqual(snapshot(f.root),before);
  }finally{process.umask(old);}f.preserved();
});

test('a changed private installation descriptor invalidates the prediction before taking the write lock',t=>{
  const f=resourcePathFixture(t,{scope:'global'});f.raw.schemaVersion=3;f.raw.management={schemaVersion:1,resources:{}};f.write();
  const compiled=compileScopedDeployment({kitRoot:f.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});
  assert.equal(compiled.prediction?.status,'predicted');for(const plan of compiled.plans)plan.blocked=[];
  compiled.plans.flatMap(plan=>plan.installationDescriptors||[])[0].declaration.deniedCapabilities.push('unexpected.permission');
  const before=snapshot(f.root);assert.throws(()=>applyDeployment({plans:compiled.plans,stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.homeDir,'.agents-kit/deployments/_global/backups')})}),{code:'STALE_INSTALLATION_PREDICTION'});
  assert.deepEqual(snapshot(f.root),before);f.preserved();
});

test('missing local installation evidence cannot produce a predicted consumer registration',t=>{
  const f=fixture(t);delete f.raw.assets.skills[0].definition;f.write();const before=snapshot(f.f.root),compiled=compileScopedDeployment(f.input);
  assert.equal(compiled.prediction,undefined);assert.ok(compiled.review.blocked.some(block=>block.reason==='SCOPED_INSTALLATION_DESCRIPTOR_REQUIRED'));assert.deepEqual(snapshot(f.f.root),before);f.preserved();
});

test('untracked files in an installed Skill remain untouched and block a positive prediction',t=>{
  const f=fixture(t),first=compileScopedDeployment(f.input);applyPredicted(f,first);
  const skill=first.prediction.receipts.find(receipt=>receipt.assetId==='review'),foreign=path.join(skill.locator.targetBase,'user-note.md');fs.writeFileSync(foreign,'keep user note',{mode:0o600});
  const before=snapshot(f.f.root),second=compileScopedDeployment(f.input);assert.equal(second.prediction,undefined);
  assert.ok(second.review.blocked.some(block=>block.reason==='INSTALLATION_PREDICTION_UNVERIFIED'));assert.deepEqual(snapshot(f.f.root),before);f.preserved();
});

test('scoped compiler reviews only local client changes, pins installed global revisions and leaves every file and link unchanged',t=>{
  const f=fixture(t),before=snapshot(f.f.root),result=compileScopedDeployment(f.input);
  assert.equal(result.review.kind,'scoped-preview');assert.equal(result.review.automatic,false);assert.equal(result.review.fulfilled,false);
  assert.ok(result.review.blocked.some(block=>block.reason==='SCOPED_DEPLOYMENT_NOT_ENABLED'));assert.ok(result.review.blocked.some(block=>block.reason==='DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'));
  assert.deepEqual(result.prerequisites.map(pin=>pin.assetId),['review']);assert.equal(result.review.globalPrerequisites[0].status,'ownership-observed');
  assert.deepEqual(result.review.selection.selectedAssetIds,['review','reviewer']);assert.ok(result.review.operations.every(operation=>operation.target.startsWith(f.projectPath+path.sep)));
  assert.equal(result.review.operations.length,2);assert.equal(result.targets.length,2);
  assert.ok(!JSON.stringify(result.review).includes('DO_NOT_PERSIST'));assert.deepEqual(snapshot(f.f.root),before);f.preserved();
  for(const target of result.targets){const operation=result.plans.flatMap(plan=>plan.operations).find(operation=>operation.target===target.target);assert.equal(target.before,imageFingerprint(readPathImage(target.target,{authorizedRoot:f.projectPath})));assert.equal(target.after,imageFingerprint({kind:'file',mode:operation.afterMode??0o644,content:Buffer.from(deploymentOperationContent(operation)).toString('base64')}));}
});

test('global source-body edits preserve installed prerequisite identity while declaration or installed ownership drift blocks a new plan',t=>{
  const f=fixture(t),first=compileScopedDeployment(f.input),receipt=latestInstallationReceipts(f.f.state()).find(receipt=>receipt.assetId==='review');
  fs.appendFileSync(path.join(f.f.scopeRoot,'review/SKILL.md'),'\nUnapplied source edit\n');const edited=compileScopedDeployment(f.input);assert.deepEqual(edited.prerequisites,first.prerequisites);
  f.f.raw.assets.skills[0].requires={tools:[{id:'repository.search',capability:'repository.read',providerId:'docs'}]};f.f.raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'search_repository'}]};f.f.write();
  const declared=compileScopedDeployment(f.input);assert.ok(declared.review.blocked.some(block=>block.reason==='DEPENDENCY_INSTALLATION_DECLARATION_CHANGED'));
  fs.appendFileSync(path.join(receipt.locator.targetBase,'SKILL.md'),'\nUser installed edit\n');const drift=compileScopedDeployment(f.input);assert.ok(drift.review.blocked.some(block=>block.reason==='DEPENDENCY_INSTALLATION_PREREQUISITE_UNVERIFIED'));f.preserved();
});

test('an installed global provider in another client profile cannot satisfy the selected scoped plan',t=>{
  const f=fixture(t);const result=compileScopedDeployment({...f.input,surface:'desktop'});assert.deepEqual(result.prerequisites,[]);
  assert.ok(result.review.blocked.some(block=>block.reason==='DEPENDENCY_INSTALLATION_PREREQUISITE_UNVERIFIED'));f.preserved();
});

test('scoped native proof is explicitly supplied through a private port and never removes the public execution gate',t=>{
  const f=fixture(t),calls=[],result=compileScopedDeployment({...f.input,verifyPrerequisites:input=>{calls.push(input);return {verified:true,digest:'a'.repeat(64)};}});
  assert.equal(calls.length,1);assert.equal(calls[0].project.sourceRoot,f.scopeRoot);assert.deepEqual(calls[0].prerequisites,result.prerequisites);
  assert.equal(result.review.nativePrerequisitesState,'observed');assert.equal(result.review.automatic,false);assert.ok(!result.review.blocked.some(block=>block.reason==='DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'));
  assert.ok(result.plans.some(plan=>plan.blocked.some(block=>block.reason==='SCOPED_DEPLOYMENT_NOT_ENABLED')));
});

test('pre-existing project files, imported/native ownership and external links retain ordinary conflict checks',t=>{
  const f=fixture(t),target=path.join(f.projectPath,'.codex/agents/reviewer.toml');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'# Existing user Agent\n',{mode:0o600});
  const before=snapshot(f.f.root),result=compileScopedDeployment(f.input);assert.ok(result.review.blocked.some(block=>['UNKNOWN_EXISTING_CONTENT','TARGET_EXISTS_UNMANAGED'].includes(block.reason)),JSON.stringify(result.review.blocked));assert.deepEqual(snapshot(f.f.root),before);f.preserved();
});

test('same-origin policy denial is validated before client file preparation',t=>{
  const f=fixture(t);f.raw.assets.skills[0].requires={tools:[{id:'repository.search',capability:'repository.read',providerId:{schemaVersion:1,kitId:f.f.raw.kit.id,scope:{type:'global'},kind:'mcpServers',assetId:'docs'}}]};f.raw.assets.agents[0].deny={capabilities:['repository.read']};f.f.raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'search_repository'}]};f.f.write();f.write();
  const before=snapshot(f.f.root);assert.throws(()=>compileScopedDeployment(f.input),error=>error.code==='MANIFEST_DEPENDENCY_INVALID'&&error.details.issues.some(issue=>issue.code==='POLICY_DENIED'));assert.deepEqual(snapshot(f.f.root),before);
});

test('scoped MCP and instruction plans retain existing project settings, user text and file modes',t=>{
  const f=fixture(t);f.raw.defaults=f.f.raw.defaults;f.raw.targets.codex.assetIds.push('local-docs','rules');
  f.raw.assets.mcpServers=[{id:'local-docs',scope:'project',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:['DO_NOT_PERSIST_MCP_COMMAND']}}];
  f.raw.assets.instructions=[{id:'rules',scope:'project',source:'rules.md',definition:{schemaVersion:1,format:'markdown'}}];f.write();fs.writeFileSync(path.join(f.scopeRoot,'rules.md'),'# DO_NOT_PERSIST_RULE_BODY\n');
  const config=path.join(f.projectPath,'.codex/config.toml'),instructions=path.join(f.projectPath,'AGENTS.md');fs.mkdirSync(path.dirname(config),{recursive:true});
  fs.writeFileSync(config,'# User setting\nmodel="keep"\n\n[mcp_servers.foreign]\ncommand="keep"\n',{mode:0o640});fs.writeFileSync(instructions,'# User instructions\n',{mode:0o640});
  const before=snapshot(f.f.root),result=compileScopedDeployment(f.input),operations=result.plans.flatMap(plan=>plan.operations);assert.equal(operations.length,4);
  for(const target of [config,instructions]) {
    const operation=operations.find(operation=>operation.target===target),content=Buffer.from(deploymentOperationContent(operation)).toString('utf8');
    assert.ok(content.includes(target===config?'model="keep"':'# User instructions'));assert.equal(result.targets.find(image=>image.target===target).after,imageFingerprint({kind:'file',mode:0o640,content:Buffer.from(content).toString('base64')}));
  }
  assert.ok(!JSON.stringify(result.review).includes('DO_NOT_PERSIST'));assert.deepEqual(snapshot(f.f.root),before);f.preserved();
});

test('changing a public scoped preview cannot alter private prerequisite or mutation authority',t=>{
  const f=fixture(t),result=compileScopedDeployment(f.input),pins=structuredClone(result.prerequisites),targets=structuredClone(result.targets);
  result.review.globalPrerequisites[0].pin.revisionDigest='0'.repeat(64);result.review.targets[0].after='0'.repeat(64);result.review.consumerPrerequisiteIds.reviewer.length=0;
  assert.deepEqual(result.prerequisites,pins);assert.deepEqual(result.targets,targets);
});

test('the common deployment service requires native evidence before applying or saving its reviewed v3 plan',async t=>{
  const f=fixture(t),before=snapshot(f.f.root),plan=f.f.service.plan({scopeRoot:f.scopeRoot,targetRoot:f.projectPath,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',scope:'project'});
  assert.equal(plan.kind,'scoped-apply');assert.equal(plan.execution.status,'requires-observation');assert.equal(plan.operations.length,2);assert.equal(plan.automatic,false);assert.equal(plan.globalPrerequisites[0].status,'ownership-observed');
  assert.match(plan.predictionDigest,/^[a-f0-9]{64}$/);assert.equal(plan.predictedInstallations.length,2);assert.ok(plan.predictedInstallations.every(receipt=>/^[a-f0-9]{64}$/.test(receipt.revisionDigest)));
  assert.throws(()=>f.f.service.savePlan({planId:plan.planId}),{code:'SAVED_PLAN_UNSUPPORTED'});plan.automatic=true;plan.blocked.length=0;
  await assert.rejects(async()=>f.f.service.apply({planId:plan.planId}),{code:'SCOPED_NATIVE_OBSERVATION_REQUIRED'});assert.deepEqual(snapshot(f.f.root),before);f.preserved();
});

test('v3 global plans remain a single scope and require no external installation or native proof',t=>{
  const f=fixture(t);f.f.raw.schemaVersion=3;f.f.raw.management={schemaVersion:1,resources:{}};f.f.write();
  const before=snapshot(f.f.root),result=compileScopedDeployment({...f.input,scope:'global',projectPath:undefined});
  assert.equal(result.review.scope,'global');assert.deepEqual(result.prerequisites,[]);assert.equal(result.review.nativePrerequisitesState,'not-required');
  assert.equal(result.review.operations.length,5);assert.equal(new Set(result.review.operations.map(operation=>operation.assetId)).size,4);assert.ok(result.review.operations.every(operation=>operation.target.startsWith(f.f.homeDir+path.sep)));assert.deepEqual(snapshot(f.f.root),before);
});

test('CLI dry-run uses the same scoped compiler and attempted execution preserves files and external links',t=>{
  const f=fixture(t),before=snapshot(f.f.root),args=[path.resolve('bin/cli.js'),'apply','--kit',f.f.kitRoot,'--project',f.projectPath,'--client','codex','--surface','cli'];
  const run=extra=>spawnSync(process.execPath,[...args,...extra],{encoding:'utf8',env:{...process.env,HOME:f.f.homeDir,AGENTS_KIT_DIR:''}});
  const dry=run(['--dry-run']);assert.equal(dry.status,0,dry.stderr);const plan=JSON.parse(dry.stdout);assert.equal(plan.kind,'scoped-apply');assert.equal(plan.automatic,false);assert.equal(plan.selection.globalPrerequisites[0].assetId,'review');
  const attempted=run([]);assert.equal(attempted.status,1);assert.match(attempted.stderr,/scoped deployment/i);assert.deepEqual(snapshot(f.f.root),before);f.preserved();
});
