import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import request from 'supertest';
import {parse, stringify} from 'yaml';
import {createControlPlaneApp} from '../app.js';
import {createAppContext} from '../context.js';
import {nativeInstallationFixture} from '../../../test/helpers/native-installation-fixture.js';
import {dependencyIndexFixture} from '../../../test/helpers/dependency-index-fixture.js';
import {nativePrerequisiteServiceFixture} from '../../../test/helpers/native-prerequisite-service-fixture.js';

test('HTTP v3 validation, readonly doctor and source edits preserve installed files and require the mutation session',async t=>{
  const f=nativePrerequisiteServiceFixture(t,{scoped:true}),{app,apiToken}=createControlPlaneApp({context:createAppContext({...f.options,kitRoot:f.f.kitRoot}),logRequest:()=>{}}),input={scope:'project',projectPath:f.project.targetRoot,projectName:'default'},file=path.join(f.project.sourceRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(file,'utf8')),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config),ledger=fs.readFileSync(f.f.statePath);
  const post=(route,body)=>request(app).post(route).set('X-Agents-Kit-Token',apiToken).send(body),registry=await request(app).get('/api/manifest/registry').query(input).expect(200);assert.equal(registry.body.manifestSchemaVersion,3);assert.equal(registry.body.registry.find(asset=>asset.id==='reviewer').previewOnly,false);
  const valid=await post('/api/deployment/validate',input).expect(200);assert.equal(valid.body.valid,true);assert.equal(valid.body.deploymentReady,false);
  const doctor=await post('/api/deployment/doctor',{...input,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'}).expect(200);assert.equal(doctor.body.readOnly,true);assert.equal(doctor.body.healthy,true);assert.equal(doctor.body.nativePrerequisitesState,'unverified');assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.project.targetRoot,'.agent-kit')),false);
  const body={...input,mutations:[{type:'update',kind:'agents',assetId:'reviewer',asset:{...raw.assets.agents[0],displayName:'HTTP source'}}]};await request(app).post('/api/manifest/edit/plan').send(body).expect(403);
  let planned=await post('/api/manifest/edit/plan',body).expect(200);assert.equal(planned.body.scoped.deploymentChanged,false);fs.appendFileSync(path.join(f.f.scopeRoot,'agent-kit.yaml'),'\n# Companion update\n');await post('/api/manifest/edit/apply',{planId:planned.body.planId}).expect(409);
  planned=await post('/api/manifest/edit/plan',body).expect(200);await post('/api/manifest/edit/apply',{planId:planned.body.planId}).expect(200);assert.equal(parse(fs.readFileSync(file,'utf8')).assets.agents[0].displayName,'HTTP source');assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(f.f.statePath),ledger);assert.equal(f.calls.length,0);f.f.preserved();
});

test('HTTP scoped plan uses private observation, saved restart, coordinated apply and exact removal',async t=>{
  const f=nativePrerequisiteServiceFixture(t,{scoped:true,bound:true}),config=path.join(f.project.targetRoot,'.codex/config.toml'),before=fs.readFileSync(config);
  const context=()=>createAppContext({...f.options,kitRoot:f.f.kitRoot});let {app,apiToken}=createControlPlaneApp({context:context(),logRequest:()=>{}});
  const post=(endpoint,body)=>request(app).post('/api/deployment/'+endpoint).set('X-Agents-Kit-Token',apiToken).send(body),input={scope:'project',projectPath:f.project.targetRoot,projectName:'default',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};
  const review=await post('plan',input).expect(200);assert.equal(review.body.execution.status,'requires-observation');assert.equal(f.calls.length,0);
  await request(app).post('/api/deployment/prerequisites/observe').send({planId:review.body.planId,observeProviders:true}).expect(403);assert.equal(f.calls.length,0);
  const ready=await post('prerequisites/observe',{planId:review.body.planId,observeProviders:true}).expect(200);assert.equal(ready.body.execution.status,'ready');assert.equal(ready.body.coordination,undefined);assert.equal(ready.body.transition,undefined);
  const saved=await post('save-plan',{planId:ready.body.planId}).expect(200);({app,apiToken}=createControlPlaneApp({context:context(),logRequest:()=>{}}));
  const applied=await post('resume',{planId:saved.body.planId,digest:saved.body.digest}).expect(200);assert.equal(applied.body.outcome,'committed');assert.equal(f.calls.length,3);
  const remove=await post('removal-plan',{...input,assetIds:['reviewer','local-docs']}).expect(200);assert.equal(remove.body.execution.status,'ready');const removed=await post('apply',{planId:remove.body.planId}).expect(200);
  assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(f.f.state().dependencyIndex.projects,[]);f.f.preserved();
  const rollback=await post('rollback-plan',{...input,transactionId:removed.body.transactionId}).expect(200);assert.equal(rollback.body.execution.status,'requires-observation');
  await request(app).post('/api/deployment/rollback').send({planId:rollback.body.planId}).expect(403);
  await post('prerequisites/observe',{planId:rollback.body.planId,observeProviders:true}).expect(200);const savedRollback=await post('save-plan',{planId:rollback.body.planId}).expect(200);
  ({app,apiToken}=createControlPlaneApp({context:context(),logRequest:()=>{}}));const restored=await post('resume',{planId:savedRollback.body.planId,digest:savedRollback.body.digest}).expect(200);assert.equal(restored.body.rolledBackTransactionId,removed.body.transactionId);assert.equal(f.calls.length,6);assert.equal(f.f.state().dependencyIndex.projects.length,1);
  const initialRollback=await post('rollback-plan',{...input,transactionId:applied.body.transactionId}).expect(200);assert.equal(initialRollback.body.execution.status,'ready');const reverted=await post('rollback',{planId:initialRollback.body.planId}).expect(200);assert.equal(reverted.body.outcome,'committed');assert.equal(f.calls.length,6);
  assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(f.f.state().dependencyIndex.projects,[]);f.f.preserved();
});

test('HTTP global review, saved resume and rollback preserve registered pins and reject a forced provider update',async t=>{
  const f=dependencyIndexFixture(t),project=fs.readFileSync(f.project.statePath),index=structuredClone(f.global.state().dependencyIndex),before=fs.readFileSync(f.global.rules);
  fs.mkdirSync(path.join(f.global.definitionsDir,'native-prerequisites'));fs.copyFileSync(path.resolve(import.meta.dirname,'../../../clients/native-prerequisites/codex-cli.yaml'),path.join(f.global.definitionsDir,'native-prerequisites/codex-cli.yaml'));
  f.global.raw.targets={codex:{assetIds:['rules']}};f.global.write();fs.appendFileSync(path.join(f.global.scopeRoot,'rules.md'),'\nHTTP global change\n');
  const context=()=>createAppContext({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir});
  let {app,apiToken}=createControlPlaneApp({context:context(),logRequest:()=>{}});
  const post=(endpoint,body)=>request(app).post('/api/deployment/'+endpoint).set('X-Agents-Kit-Token',apiToken).send(body),input={scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};
  const review=await post('plan',input).expect(200);assert.equal(review.body.dependencyProtection.status,'ready');assert.equal(review.body.fulfilled,false);assert.equal(review.body.guard,undefined);
  const saved=await post('save-plan',{planId:review.body.planId}).expect(200);
  ({app,apiToken}=createControlPlaneApp({context:context(),logRequest:()=>{}}));
  const applied=await post('resume',{planId:saved.body.planId,digest:saved.body.digest}).expect(200);assert.match(fs.readFileSync(f.global.rules,'utf8'),/HTTP global change/);
  const rollback=await post('rollback-plan',{...input,transactionId:applied.body.transactionId}).expect(200);assert.equal(rollback.body.dependencyProtection.status,'ready');
  await post('rollback',{planId:rollback.body.planId}).expect(200);assert.deepEqual(fs.readFileSync(f.global.rules),before);
  f.global.raw.targets={codex:{assetIds:['review']}};f.global.write();fs.appendFileSync(path.join(f.global.scopeRoot,'review/SKILL.md'),'\nPinned change\n');
  const blocked=await post('plan',input).expect(200);assert.equal(blocked.body.automatic,false);assert.equal(blocked.body.dependencyProtection.status,'blocked');assert.ok(blocked.body.blocked.some(item=>item.reason==='GLOBAL_REVISION_IN_USE'));
  const rejected=await post('apply',{planId:blocked.body.planId,automatic:true,dependencyProtection:{status:'ready'}}).expect(409);assert.equal(rejected.body.code,'GLOBAL_MUTATION_PLAN_BLOCKED');
  assert.deepEqual(f.global.state().dependencyIndex,index);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});

for(const phase of ['before-state','after-state'])test(`HTTP guarded global recovery reviews ${phase} before restoring or keeping committed files`,async t=>{
  const f=dependencyIndexFixture(t),before=fs.readFileSync(f.global.rules),project=fs.readFileSync(f.project.statePath),index=structuredClone(f.global.state().dependencyIndex);
  fs.mkdirSync(path.join(f.global.definitionsDir,'native-prerequisites'));fs.copyFileSync(path.resolve(import.meta.dirname,'../../../clients/native-prerequisites/codex-cli.yaml'),path.join(f.global.definitionsDir,'native-prerequisites/codex-cli.yaml'));
  f.global.raw.targets={codex:{assetIds:['rules']}};f.global.write();fs.appendFileSync(path.join(f.global.scopeRoot,'rules.md'),'\nHTTP recovery change\n');
  const child=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../../../test/helpers/crash-global-dependency-dispatch.js'),JSON.stringify({homeDir:f.global.homeDir,definitionsDir:f.global.definitionsDir,input:f.global.input,phase})],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const {app,apiToken}=createControlPlaneApp({context:createAppContext({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir}),logRequest:()=>{}}),post=(endpoint,body)=>request(app).post('/api/deployment/'+endpoint).set('X-Agents-Kit-Token',apiToken).send(body);
  const review=await post('recovery-plan',{scope:'global',clientId:'codex'}).expect(200);assert.equal(review.body.dependencyProtection.status,'ready');assert.equal(review.body.recovery,undefined);assert.equal(review.body.guard,undefined);
  const result=await post('recover',{planId:review.body.planId}).expect(200);assert.equal(result.body.outcome,phase==='before-state'?'restored':'committed');
  if(phase==='before-state')assert.deepEqual(fs.readFileSync(f.global.rules),before);else assert.match(fs.readFileSync(f.global.rules,'utf8'),/HTTP recovery change/);
  assert.deepEqual(f.global.state().dependencyIndex,index);assert.deepEqual(fs.readFileSync(f.project.statePath),project);f.global.preserved();f.project.preserved();
});

test('HTTP source deletion returns a conflict for registered global dependencies without changing client or Kit files',async t=>{
  const f=dependencyIndexFixture(t),manifest=path.join(f.global.scopeRoot,'agent-kit.yaml'),before=fs.readFileSync(manifest),state=fs.readFileSync(f.global.statePath);
  const {app,apiToken}=createControlPlaneApp({context:createAppContext({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir}),logRequest:()=>{}});
  const response=await request(app).post('/api/manifest/edit/plan').set('X-Agents-Kit-Token',apiToken).send({scope:'global',mutations:[{type:'delete',kind:'skills',assetId:'review'}]}).expect(409);
  assert.equal(response.body.code,'GLOBAL_SOURCE_IN_USE');assert.equal(response.body.references,undefined);assert.deepEqual(fs.readFileSync(manifest),before);assert.deepEqual(fs.readFileSync(f.global.statePath),state);f.global.preserved();f.project.preserved();
});

test('registered dependent API retains missing projects and blocks ordinary writes before changing client files',async t=>{
  const f=dependencyIndexFixture(t),before=fs.readFileSync(f.global.statePath),clientFiles=Object.fromEntries(Object.keys(f.global.state().managed).map(file=>[file,fs.readFileSync(file)]));
  let calls=0;const {app,apiToken}=createControlPlaneApp({context:createAppContext({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir,nativeInventoryObserver:async()=>{calls++;throw new Error('unexpected native invocation');}}),logRequest:()=>{}});
  const query={view:'catalog',dependents:'true'};
  const initial=await request(app).get('/api/manifest/registry').query(query).expect(200);
  assert.equal(initial.body.dependencyDependents.projects[0].verification,'consistent');assert.equal(initial.body.dependencyDependents.fulfilled,false);assert.ok(!JSON.stringify(initial.body).includes('Review source.'));
  fs.renameSync(f.project.statePath,f.project.statePath+'.retained');const unavailable=await request(app).get('/api/manifest/registry').query(query).expect(200);
  assert.equal(unavailable.body.dependencyDependents.projects.length,1);assert.equal(unavailable.body.dependencyDependents.projects[0].issues[0].code,'DEPENDENT_PROJECT_STATE_UNAVAILABLE');
  await request(app).get('/api/manifest/registry').query({...query,dependents:'yes'}).expect(400);
  const plan=await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token',apiToken).send({scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'}).expect(200);
  assert.equal(plan.body.automatic,false);assert.equal(plan.body.dependencyProtection.status,'blocked');
  const applied=await request(app).post('/api/deployment/apply').set('X-Agents-Kit-Token',apiToken).send({planId:plan.body.planId}).expect(409);assert.equal(applied.body.code,'GLOBAL_MUTATION_PLAN_BLOCKED');
  assert.equal(calls,0);assert.deepEqual(fs.readFileSync(f.global.statePath),before);for(const [file,bytes] of Object.entries(clientFiles))assert.deepEqual(fs.readFileSync(file),bytes);f.global.preserved();f.project.preserved();
});

test('native legacy audit API preserves the original MCP server and reports metadata-only application',async t=>{
  const f=nativeInstallationFixture(t,{kind:'mcpServers',scope:'global',clientId:'antigravity',assetId:'docs-alias',canonicalKitLayout:true});f.apply('adopt');
  const legacy=JSON.parse(fs.readFileSync(f.statePath,'utf8'));for(const transaction of legacy.transactions)delete transaction.installationReceipts;fs.writeFileSync(f.statePath,JSON.stringify(legacy));
  const before=fs.readFileSync(f.primary),info=fs.statSync(f.primary),{app,apiToken}=createControlPlaneApp({context:createAppContext({homeDir:f.homeDir,kitRoot:f.kitRoot,definitionsDir:f.definitionsDir}),logRequest:()=>{}});
  const planned=await request(app).post('/api/manifest/installation/plan').set('X-Agents-Kit-Token',apiToken).send({scope:'global',assetId:'docs-alias',mode:'adopt'}).expect(200);
  assert.equal(planned.body.operations.length,0);assert.equal(planned.body.installationEvidence.required,true);assert.equal(planned.body.installationEvidence.nativeId,'review');
  assert.ok(!JSON.stringify(planned.body).includes('existing-unmanaged-value'));
  const applied=await request(app).post('/api/manifest/installation/apply').set('X-Agents-Kit-Token',apiToken).send({planId:planned.body.planId}).expect(200);
  assert.equal(applied.body.metadataOnly,true);assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(fs.statSync(f.primary).ino,info.ino);assert.equal(fs.statSync(f.primary).mtimeMs,info.mtimeMs);
});
import {resourcePathFixture} from '../../../test/helpers/resource-path-fixture.js';

test('installation inspection API reads committed revisions without native calls or client writes',async t=>{
  const f=resourcePathFixture(t,{scope:'global'}),projectPath=path.join(f.root,'consumer'),scopeRoot=path.join(f.kitRoot,'projects/default');
  f.raw.assets.skills[0].requires={tools:[{id:'repository.search',providerId:'docs'}]};f.raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'old_search'}]};
  f.raw.targets={codex:{assetIds:['review']}};f.write();f.service.apply({planId:f.service.plan(f.input).planId});
  fs.copyFileSync(path.resolve(import.meta.dirname,'../../../clients/antigravity.yaml'),path.join(f.definitionsDir,'antigravity.yaml'));
  fs.mkdirSync(projectPath);fs.mkdirSync(scopeRoot,{recursive:true});
  fs.writeFileSync(path.join(scopeRoot,'agent-kit.json'),JSON.stringify({schemaVersion:3,kit:{id:'consumer-kit'},management:{schemaVersion:1,resources:{}},assets:{agents:[{id:'consumer',scope:'project',definition:{schemaVersion:1,description:'Review',instructions:'PRIVATE_AGENT_BODY',permissions:'client-default'},dependsOn:{skills:[{schemaVersion:1,kitId:f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'}]}}]}}));
  let nativeCalls=0;const before=fs.readFileSync(f.statePath),{app}=createControlPlaneApp({context:createAppContext({homeDir:f.homeDir,kitRoot:f.kitRoot,definitionsDir:f.definitionsDir,nativeInventoryObserver:async()=>{nativeCalls++;throw new Error('unexpected native request');}}),logRequest:()=>{}});
  const query={view:'catalog',projectPath,clientId:'codex',surface:'cli',installations:'true',includeOtherClients:'true'};
  const result=await request(app).get('/api/manifest/registry').query(query).expect(200);
  assert.equal(result.body.installationPrerequisites.checks[0].status,'ownership-observed');assert.equal(result.body.installationPrerequisites.fulfilled,false);
  const skill=result.body.installationPrerequisites.checks.find(item=>item.assetId==='review');assert.equal(skill.dependencyState,'revision-observed');assert.equal(skill.bindingDeclarationsState,'recorded');
  assert.equal(skill.dependencyBindings[0].nativeName,'old_search');assert.equal(skill.bindingState,'unverified');
  f.raw.assets.mcpServers[0].provides.tools[0].nativeName='draft_search';f.write();
  const draft=await request(app).get('/api/manifest/registry').query(query).expect(200);assert.equal(draft.body.installationPrerequisites.checks.find(item=>item.assetId==='review').dependencyBindings[0].nativeName,'old_search');
  assert.ok(result.body.clients.some(client=>client.id==='antigravity'));assert.ok(!JSON.stringify(result.body).includes('PRIVATE_AGENT_BODY'));
  await request(app).get('/api/manifest/registry').query({...query,installations:'yes'}).expect(400);
  assert.equal(nativeCalls,0);assert.deepEqual(fs.readFileSync(f.statePath),before);f.preserved();
});

test('scoped dependency catalog reads v3 declarations while missing installations block apply and source edits require valid mutations',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-scoped-http-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),kitRoot=path.join(root,'kit'),projectPath=path.join(root,'work'),scopeRoot=path.join(kitRoot,'projects/default');
  fs.mkdirSync(homeDir);fs.mkdirSync(projectPath);fs.mkdirSync(path.join(kitRoot,'global/review'),{recursive:true});fs.mkdirSync(scopeRoot,{recursive:true});
  fs.writeFileSync(path.join(kitRoot,'global/review/SKILL.md'),'# BODY_NOT_IN_HTTP\n');
  fs.writeFileSync(path.join(kitRoot,'global/agent-kit.json'),JSON.stringify({schemaVersion:1,kit:{id:'shared-kit'},assets:{skills:[{id:'review',source:'review'}]}}));
  const manifestPath=path.join(scopeRoot,'agent-kit.json'),body=JSON.stringify({schemaVersion:3,kit:{id:'project-kit'},management:{schemaVersion:1,resources:{}},assets:{agents:[{id:'reviewer',scope:'project',definition:{schemaVersion:1,description:'Review',instructions:'BODY_NOT_IN_HTTP',permissions:'client-default'},dependsOn:{skills:[{schemaVersion:1,kitId:'shared-kit',scope:{type:'global'},kind:'skills',assetId:'review'}]}}]}});
  fs.writeFileSync(manifestPath,body);
  const {app,apiToken}=createControlPlaneApp({context:createAppContext({homeDir,kitRoot}),logRequest:()=>{}});
  const result=await request(app).get('/api/manifest/registry').query({view:'catalog',projectPath,dependencies:'true'}).expect(200);
  assert.equal(result.body.dependencyGraph.valid,true);assert.equal(result.body.dependencyGraph.deploymentReady,false);
  assert.equal(result.body.dependencyGraph.globalPrerequisites[0].installationState,'unverified');
  assert.ok(!JSON.stringify(result.body).includes('BODY_NOT_IN_HTTP'));
  await request(app).get('/api/manifest/registry').query({view:'catalog',dependencies:'yes'}).expect(400);
  const input={clientId:'codex',surface:'cli',scope:'project',projectName:'default',projectPath};
  const planned=await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token',apiToken).send({...input,automatic:true,verifyPrerequisites:{verified:true,digest:'a'.repeat(64)}}).expect(200);
  assert.equal(planned.body.kind,'scoped-apply');assert.equal(planned.body.execution.status,'blocked');assert.equal(planned.body.automatic,false);assert.equal(planned.body.globalPrerequisites[0].status,'unverified');assert.ok(!JSON.stringify(planned.body).includes('BODY_NOT_IN_HTTP'));
  await request(app).post('/api/deployment/save-plan').set('X-Agents-Kit-Token',apiToken).send({planId:planned.body.planId}).expect(400);
  for(const [route,payload,code,status] of [['/api/deployment/apply',{planId:planned.body.planId,automatic:true},'SCOPED_DEPLOYMENT_PLAN_BLOCKED',409],['/api/manifest/edit/plan',{...input,mutations:[]},'INVALID_MANIFEST_MUTATIONS',400]]) {
    const response=await request(app).post(route).set('X-Agents-Kit-Token',apiToken).send(payload).expect(status);
    assert.equal(response.body.code,code);
  }
  assert.equal(fs.readFileSync(manifestPath,'utf8'),body);assert.equal(fs.existsSync(path.join(projectPath,'.agent-kit')),false);assert.equal(fs.existsSync(path.join(homeDir,'.agents-kit')),false);
});

test('instruction settings API returns readonly prediction without instruction text or injection claims',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-guidance-http-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),kitRoot=path.join(root,'kit'),targetRoot=path.join(root,'work');
  fs.mkdirSync(path.join(homeDir,'.codex'),{recursive:true});fs.mkdirSync(targetRoot,{recursive:true});fs.writeFileSync(path.join(homeDir,'.codex/config.toml'),'# settings\n');fs.writeFileSync(path.join(targetRoot,'AGENTS.md'),'# DO_NOT_PERSIST_BODY\n');
  let calls=0;const context=createAppContext({homeDir,kitRoot,binaryObserver:()=>({binaryPath:'/reviewed/codex',sha256:'508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44'}),nativeInventoryObserver:async input=>{calls++;assert.equal(input.adapter,'codex-instruction-settings-v1');return {config:{project_doc_max_bytes:32768,project_doc_fallback_filenames:[],project_root_markers:['.git']},origins:{},layers:[]};}});
  const {app,apiToken}=createControlPlaneApp({context,apiToken:'e'.repeat(64),logRequest:()=>{}});
  const response=await request(app).post('/api/manifest/inventory/observe').set('X-Agents-Kit-Token',apiToken).send({clientId:'codex',surface:'cli',kind:'instructions',projectPath:targetRoot}).expect(200);
  assert.equal(calls,1);assert.equal(response.body.nativeObservation.status,'partial');assert.equal(response.body.nativeObservation.instructionPreview.loadedSourcesState,'unverified');
  assert.equal(JSON.stringify(response.body).includes('DO_NOT_PERSIST_BODY'),false);assert.equal(fs.existsSync(path.join(targetRoot,'.agent-kit')),false);
});

test('MCP native metadata API preserves source scope, redacts settings and proves no connection or tool use',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-mcp-catalog-http-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),kitRoot=path.join(root,'kit'),config=path.join(homeDir,'.codex/config.toml');
  fs.mkdirSync(path.dirname(config),{recursive:true});const text='# user setting\n[mcp_servers.shared]\ncommand = "fixture-command"\n';fs.writeFileSync(config,text);
  let calls=0;
  const context=createAppContext({homeDir,kitRoot,binaryObserver:()=>({binaryPath:'/reviewed/codex',sha256:'508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44'}),nativeInventoryObserver:async input=>{
    calls++;assert.equal(input.adapter,'codex-mcp-config-v1');return {config:{mcp_servers:{shared:{enabled:false,command:'DO_NOT_PERSIST'}}},origins:{'mcp_servers.shared.command':{name:{type:'user',file:config,profile:null},version:'sha256:'+'a'.repeat(64)}},layers:[]};}});
  const {app,apiToken}=createControlPlaneApp({context,apiToken:'d'.repeat(64),logRequest:()=>{}}),input={clientId:'codex',surface:'cli',kind:'mcpServers',includeOtherClients:true};
  await request(app).post('/api/manifest/inventory/observe').send(input).expect(403);assert.equal(calls,0);
  const result=await request(app).post('/api/manifest/inventory/observe').set('X-Agents-Kit-Token',apiToken).send(input).expect(200);
  assert.equal(calls,1);assert.equal(result.body.nativeObservation.kind,'mcpServers');assert.equal(result.body.nativeObservation.connectionState,'unverified');
  const source=result.body.observations.find(item=>item.id==='shared'&&item.surface==='cli');assert.equal(source.activation,'disabled');
  assert.ok(result.body.observations.filter(item=>item.surface!=='cli'||item.clientId!=='codex').every(item=>item.activation==='unknown'));
  assert.equal(JSON.stringify(result.body).includes('DO_NOT_PERSIST'),false);assert.equal(fs.readFileSync(config,'utf8'),text);assert.equal(fs.existsSync(path.join(homeDir,'.agents-kit')),false);
});

test('native inventory requires the mutation session, executes only explicit reading and preserves user files',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-native-catalog-http-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const homeDir=path.join(root,'home'),kitRoot=path.join(root,'kit'),targetRoot=path.join(root,'work'),skill=path.join(targetRoot,'.agents/skills/review/SKILL.md');
  fs.mkdirSync(path.dirname(skill),{recursive:true});fs.mkdirSync(path.join(homeDir,'.codex'),{recursive:true});
  fs.writeFileSync(skill,'---\nname: review\ndescription: Review source\n---\nReview.\n');const config=path.join(homeDir,'.codex/config.toml');fs.writeFileSync(config,'# user config\n');
  let calls=0;
  const context=createAppContext({homeDir,kitRoot,binaryObserver:()=>({binaryPath:'/reviewed/codex',sha256:'508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44'}),
    nativeInventoryObserver:async input=>{calls++;return {data:[{cwd:input.cwd,skills:[{name:'review',path:skill,enabled:false,scope:'repo',description:'DO_NOT_PERSIST'}],errors:[]}]};}});
  const {app,apiToken}=createControlPlaneApp({context,apiToken:'f'.repeat(64),logRequest:()=>{}}),input={clientId:'codex',surface:'cli',projectPath:targetRoot,projectName:'default',includeOtherClients:true};
  await request(app).post('/api/manifest/inventory/observe').send(input).expect(403);assert.equal(calls,0);
  const result=await request(app).post('/api/manifest/inventory/observe').set('X-Agents-Kit-Token',apiToken).send(input).expect(200);
  assert.equal(calls,1);assert.equal(result.body.nativeObservation.status,'observed');
  assert.equal(result.body.effective.find(item=>item.name==='review'&&item.surface==='cli'&&item.clientId==='codex').entries[0].activation,'disabled');
  assert.equal(JSON.stringify(result.body).includes('DO_NOT_PERSIST'),false);assert.equal(fs.readFileSync(config,'utf8'),'# user config\n');assert.equal(fs.existsSync(path.join(homeDir,'.agents-kit')),false);
});

test('read-only catalog preserves both origins and existing links without bootstrapping state', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-catalog-http-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project');
  for (const dir of [homeDir, targetRoot, path.join(kitRoot, 'global'), path.join(kitRoot, 'projects/default')]) fs.mkdirSync(dir, {recursive:true});
  for (const scope of ['global', 'project']) {
    const scopeRoot = scope === 'global' ? path.join(kitRoot, 'global') : path.join(kitRoot, 'projects/default');
    fs.writeFileSync(path.join(scopeRoot, 'agent-kit.json'), JSON.stringify({schemaVersion:1, kit:{id:`catalog-${scope}`}, assets:{instructions:[{id:'same', scope, source:'rules.md'}]}}));
    if (scope === 'global') fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Rules\n');
  }
  const link = path.join(homeDir, '.agents/skills/ego-browser'); fs.mkdirSync(path.dirname(link), {recursive:true}); fs.symlinkSync('/external/ego-skills', link);
  const before = fs.lstatSync(link);
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot}), apiToken:'e'.repeat(64), logRequest:()=>{}});
  // Existing localhost GET policy remains read-only; mutation token policy is unchanged.
  await request(app).get('/api/manifest/registry?view=catalog').expect(200);
  const response = await request(app).get('/api/manifest/registry').query({view:'catalog', projectPath:targetRoot, projectName:'default', clientId:'codex', surface:'cli'}).set('X-Agents-Kit-Token',apiToken).expect(200);
  assert.equal(response.body.registry.length,2); assert.equal(response.body.registry[1].source.status,'missing');
  const cli = spawnSync(process.execPath, [path.resolve(import.meta.dirname,'../../../bin/cli.js'), 'catalog', '--kit',kitRoot,'--project',targetRoot,'--client','codex','--surface','cli'], {encoding:'utf8',env:{...process.env,HOME:homeDir,AGENTS_KIT_DIR:''}});
  assert.equal(cli.status,0,cli.stderr); const catalog=JSON.parse(cli.stdout);
  assert.deepEqual(catalog.registry,response.body.registry); assert.deepEqual(catalog.effective,response.body.effective);
  assert.equal(fs.readlinkSync(link),'/external/ego-skills'); assert.equal(fs.lstatSync(link).ino,before.ino); assert.equal(fs.lstatSync(link).mtimeMs,before.mtimeMs);
  assert.equal(fs.existsSync(path.join(homeDir,'.agents-kit')),false); assert.equal(fs.existsSync(path.join(targetRoot,'.agent-kit')),false);
});
import {writeProfileFixture} from '../../../test/helpers/client-profile-fixture.js';
import {createManifestDeploymentService} from '../../../lib/application/manifest-deployment-service.js';
import {sourceHash} from '../../../lib/infrastructure/kit-source-transaction.js';
import {sourceInventory} from '../../../lib/infrastructure/kit-source-snapshot.js';
import {writeSnapshotProfileFixture} from '../../../test/helpers/snapshot-profile-fixture.js';
test('HTTP explicitly reviews, saves, applies and restores old and new resource locations', async t => {
  const f = resourcePathFixture(t); f.changePaths();
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir: f.homeDir, kitRoot: f.kitRoot, definitionsDir: f.definitionsDir}), apiToken: 'c'.repeat(64), logRequest: () => {}});
  const post = (endpoint, body) => request(app).post(endpoint).set('X-Agents-Kit-Token', apiToken).send(body);
  const input = {scope: 'project', projectPath: f.targetRoot, projectName: 'default', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const planned = await post('/api/deployment/migration-plan', {...input, migration: 'resource-path', assetIds: ['rules', 'review', 'reviewer', 'docs']}).expect(200);
  assert.equal(planned.body.automatic, true, JSON.stringify(planned.body.blocked)); assert.equal(planned.body.pathMigrations.length, 4);
  assert.deepEqual(f.state().managed, f.managed); assert.ok(planned.body.operations.every(op => op.nextManaged === undefined && op.beforeImage === undefined));
  const saved = await post('/api/deployment/save-plan', {planId: planned.body.planId}).expect(200);
  await request(app).post('/api/deployment/resume').send({planId: saved.body.planId, digest: saved.body.digest}).expect(403);
  const applied = await post('/api/deployment/resume', {planId: saved.body.planId, digest: saved.body.digest}).expect(200);
  assert.ok(Object.keys(f.state().managed).every(file => file.includes('/moved/')));
  const rollback = await post('/api/deployment/rollback-plan', {...input, transactionId: applied.body.transactionId}).expect(response=>assert.equal(response.status,200,JSON.stringify({status:response.status,hasAppRequestId:!!response.headers['x-request-id'],contentType:response.headers['content-type'],code:/^[A-Z_]+$/.test(response.body?.code||'')?response.body.code:undefined})));
  await post('/api/deployment/rollback', {planId: rollback.body.planId}).expect(200); assert.deepEqual(f.state().managed, f.managed); f.preserved();
});

test('HTTP coalesces typed store changes, retains affected readers in saved plans and removes/restores the store resource', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-physical-http-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'project'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [homeDir, scopeRoot, path.join(targetRoot, '.codex'), path.join(targetRoot, '.agents/skills')]) fs.mkdirSync(dir, {recursive: true});
  const external = path.join(targetRoot, '.agents/skills/ego-browser'), mcp = path.join(targetRoot, '.codex/config.toml'); fs.symlinkSync('/external/ego-skills', external); fs.writeFileSync(mcp, '# User setting\nmodel = "user-model"\n', {mode: 0o640});
  const manifest = {schemaVersion: 1, kit: {id: 'physical-http'}, defaults: {mcpBindings: {schemaVersion: 1, executables: {node: {command: process.execPath}}}}, assets: {
    agents: [{id: 'reviewer', scope: 'project', definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Review source.'}}],
    mcpServers: [{id: 'docs', scope: 'project', definition: {schemaVersion: 1, transport: 'stdio', executableId: 'node', args: ['docs']}}]}};
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.json'), JSON.stringify(manifest));
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['agents-project', 'mcp-project']});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'c'.repeat(64), logRequest: () => {}});
  const input = {scope: 'project', projectPath: targetRoot, targets: ['cli', 'desktop'].map(surface => ({clientId: 'codex', surface, clientVersion: '0.0.1-test'}))};
  const post = (endpoint, body) => request(app).post(endpoint).set('X-Agents-Kit-Token', apiToken).send(body);
  const plan = await post('/api/deployment/plan', input).expect(200); assert.equal(plan.body.automatic, true); assert.equal(plan.body.operations.length, 2);
  assert.deepEqual(plan.body.stateUpgrade, {from: 1, to: 7});
  assert.ok(plan.body.operations.every(op => op.affectedTargets.length === 2 && op.nextManaged === undefined));
  const saved = await post('/api/deployment/save-plan', {planId: plan.body.planId}).expect(200); assert.ok(saved.body.operations.every(op => op.affectedTargets.length === 2));
  await post('/api/deployment/resume', {planId: saved.body.planId, digest: saved.body.digest}).expect(200);
  const removal = await post('/api/deployment/removal-plan', {scope: 'project', projectPath: targetRoot, clientId: 'codex', surface: 'desktop', assetIds: ['docs', 'reviewer']}).expect(200);
  assert.equal(removal.body.automatic, true); assert.ok(removal.body.operations.every(op => op.storeEffect === 'configuration' && op.affectedTargets.length === 2));
  const removed = await post('/api/deployment/apply', {planId: removal.body.planId}).expect(200); assert.doesNotMatch(fs.readFileSync(mcp, 'utf8'), /mcp_servers.docs/);
  const rollback = await post('/api/deployment/rollback-plan', {scope: 'project', projectPath: targetRoot, clientId: 'codex', transactionId: removed.body.transactionId}).expect(200);
  await post('/api/deployment/rollback', {planId: rollback.body.planId}).expect(200);
  assert.match(fs.readFileSync(mcp, 'utf8'), /mcp_servers.docs/); assert.equal(fs.statSync(mcp).mode & 0o777, 0o640); assert.equal(fs.readlinkSync(external), '/external/ego-skills');
});

test('HTTP path drift blocks duplicate installation and a reviewed plan using the previous client mapping', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-path-http-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'project'), definitionsDir = path.join(root, 'definitions');
  for (const dir of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.json'), JSON.stringify({schemaVersion: 1, kit: {id: 'path-http'}, assets: {agents: [{id: 'reviewer', scope: 'project', definition: {schemaVersion: 1, permissions: 'client-default', description: 'Review', instructions: 'Review source.'}}]}}));
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['agents-project']});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'c'.repeat(64), logRequest: () => {}});
  const input = {scope: 'project', projectPath: targetRoot, clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const post = (endpoint, body) => request(app).post(endpoint).set('X-Agents-Kit-Token', apiToken).send(body);
  const first = await post('/api/deployment/plan', input).expect(200); await post('/api/deployment/apply', {planId: first.body.planId}).expect(200);
  const target = first.body.operations[0].target, original = fs.readFileSync(target), reviewed = await post('/api/deployment/plan', input).expect(200);
  const definitionPath = path.join(definitionsDir, 'codex.yaml'), definition = parse(fs.readFileSync(definitionPath, 'utf8'));
  definition.capabilities.find(cap => cap.id === 'agents-project').path = 'moved/agents/{assetId}.toml'; fs.writeFileSync(definitionPath, stringify(definition));
  await post('/api/deployment/apply', {planId: reviewed.body.planId}).expect(409);
  const changed = await post('/api/deployment/plan', input).expect(200); assert.equal(changed.body.automatic, false);
  assert.ok(changed.body.blocked.some(block => block.reason === 'RESOURCE_PATH_MIGRATION_REQUIRED' && block.previousTargets.includes(target)));
  await post('/api/deployment/apply', {planId: changed.body.planId}).expect(409);
  assert.deepEqual(fs.readFileSync(target), original); assert.equal(fs.existsSync(path.join(targetRoot, 'moved')), false);
});

test('HTTP shared snapshot deployment, multi-client strategy migration and rollback preserve unrelated external links', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-link-http-')));
  t.after(() => {const visit = file => {if (fs.lstatSync(file).isDirectory()) {fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) visit(path.join(file, name));}}; visit(root); fs.rmSync(root, {recursive: true, force: true});});
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'project'), definitionsDir = path.join(root, 'definitions');
  for (const directory of [homeDir, path.join(scopeRoot, 'review'), path.join(targetRoot, '.agents/skills')]) fs.mkdirSync(directory, {recursive: true});
  const target = path.join(targetRoot, '.agents/skills/review'), external = path.join(targetRoot, '.agents/skills/ego-browser'); fs.symlinkSync('/external/ego-skills', external);
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review source\n---\n\nPRIVATE_MARKER_BODY\n');
  const manifest = {schemaVersion: 1, kit: {id: 'link-http'}, assets: {skills: [{id: 'review', source: 'review', scope: 'project', definition: {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: 'snapshot-link'}}}]}};
  const write = () => fs.writeFileSync(path.join(scopeRoot, 'agent-kit.json'), JSON.stringify(manifest)); write();
  for (const clientId of ['codex', 'antigravity']) writeSnapshotProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), clientId});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'c'.repeat(64), logRequest: () => {}});
  const input = {scope: 'project', projectPath: targetRoot, targets: ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}))};
  const post = (endpoint, body) => request(app).post(endpoint).set('X-Agents-Kit-Token', apiToken).send(body);
  const plan = await post('/api/deployment/plan', input).expect(200); assert.equal(plan.body.automatic, true); assert.equal(JSON.stringify(plan.body).includes('PRIVATE_MARKER_BODY'), false);
  await post('/api/deployment/apply', {planId: plan.body.planId}).expect(200); assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
  manifest.assets.skills[0].definition.deployment.strategy = 'copy'; write();
  const migration = await post('/api/deployment/migration-plan', {...input, migration: 'skill-strategy', assetIds: ['review']}).expect(200);
  assert.equal(migration.body.automatic, true); const installed = await post('/api/deployment/apply', {planId: migration.body.planId}).expect(200); assert.equal(fs.lstatSync(target).isDirectory(), true);
  const rollback = await post('/api/deployment/rollback-plan', {scope: 'project', projectPath: targetRoot, clientId: 'codex', transactionId: installed.body.transactionId}).expect(200);
  await post('/api/deployment/rollback', {planId: rollback.body.planId}).expect(200); assert.equal(fs.lstatSync(target).isSymbolicLink(), true); assert.equal(fs.readlinkSync(external), '/external/ego-skills');
});

test('HTTP snapshot preview is pure and the token-protected apply cannot execute it', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-snapshot-http-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project'), scopeRoot = path.join(kitRoot, 'projects/default');
  fs.mkdirSync(homeDir); fs.mkdirSync(targetRoot); fs.mkdirSync(path.join(scopeRoot, 'review'), {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review source\n---\n\nReview it.\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.json'), JSON.stringify({schemaVersion: 1, kit: {id: 'snapshot-http'}, assets: {skills: [{id: 'review', source: 'review', scope: 'project', definition: {schemaVersion: 2, format: 'agent-skills', deployment: {schemaVersion: 1, strategy: 'snapshot-link'}}}]}}));
  fs.mkdirSync(path.join(targetRoot, '.agents/skills'), {recursive: true}); const external = path.join(targetRoot, '.agents/skills/ego-browser'); fs.symlinkSync('/external/ego-skills', external);
  const context = createAppContext({homeDir, kitRoot, definitionsDir: path.resolve(import.meta.dirname, '../../../clients')});
  const {app, apiToken} = createControlPlaneApp({context, apiToken: 'c'.repeat(64), logRequest: () => {}});
  const input = {scope: 'project', projectPath: targetRoot, projectName: 'default', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const planned = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken).send(input).expect(200);
  assert.equal(planned.body.automatic, false); assert.equal(planned.body.operations[0].connection.strategy, 'snapshot-link');
  assert.equal(planned.body.operations[0].previewOnly, true); assert.equal(planned.body.stateUpgrade.to, 6);
  await request(app).post('/api/deployment/apply').send({planId: planned.body.planId}).expect(403);
  const applied = await request(app).post('/api/deployment/apply').set('X-Agents-Kit-Token', apiToken).send({planId: planned.body.planId}).expect(409);
  assert.equal(applied.body.code, 'DEPLOYMENT_PREVIEW_ONLY'); assert.equal(fs.existsSync(path.join(targetRoot, '.agent-kit')), false);
  assert.equal(fs.existsSync(path.join(homeDir, '.agents-kit/snapshots')), false); assert.equal(fs.readlinkSync(external), '/external/ego-skills');
});

test('HTTP pinned refresh connects and restores upstream metadata through the shared source service without changing installed links', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-upstream-http-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'global');
  const original = path.join(homeDir, '.agents/skills/review/SKILL.md'), external = path.join(homeDir, '.agents/skills/ego-browser');
  fs.mkdirSync(path.dirname(original), {recursive: true}); fs.writeFileSync(original, '# Original\n'); fs.symlinkSync('/external/ego-skills', external);
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: pinned-http}\nassets: {}\n');
  const definitionsDir = path.resolve(import.meta.dirname, '../../../clients');
  const context = createAppContext({homeDir, kitRoot, definitionsDir});
  context.manifestDeploymentService = createManifestDeploymentService({homeDir, definitionsDir, upstreamReader: async () => {
    const content = Buffer.from('# Upstream\n'), files = [{path: 'SKILL.md', content, mode: 0o644, sha256: sourceHash(content)}];
    return {files, inventory: sourceInventory(files), fingerprint: sourceHash(content)};
  }});
  const {app, apiToken} = createControlPlaneApp({context, apiToken: 'c'.repeat(64), logRequest: () => {}});
  const input = {scope: 'global', assetId: 'review'};
  const post = (endpoint, body) => request(app).post(endpoint).set('X-Agents-Kit-Token', apiToken).send(body);
  const discovery = await request(app).get('/api/local-discovery').expect(200);
  const candidateId = discovery.body.clients.find(client => client.id === 'codex').observations.find(item => item.id === 'review').candidateId;
  const imported = await post('/api/manifest/import/plan', {...input, clientId: 'codex', surface: 'cli', candidateId}).expect(200);
  await post('/api/manifest/import/apply', {planId: imported.body.planId}).expect(200);
  const upstream = {schemaVersion: 1, type: 'git', repository: 'https://github.com/example/review.git', commit: 'a'.repeat(40), subpath: 'skills/review'};
  await request(app).post('/api/manifest/upstream/check').send({...input, upstream}).expect(403);
  const check = await post('/api/manifest/upstream/check', {...input, upstream}).expect(200); assert.equal(check.body.status, 'changed');
  const plan = await post('/api/manifest/refresh/plan', {...input, upstream}).expect(200);
  assert.equal(plan.body.managementUpgrade.to, 3); assert.equal(fs.readFileSync(original, 'utf8'), '# Original\n');
  await post('/api/manifest/refresh/apply', {planId: plan.body.planId}).expect(200);
  const state = (await request(app).get('/api/manifest/source').query(input).expect(200)).body;
  assert.deepEqual(state.upstream, upstream); assert.equal(state.files[0].text, '# Upstream\n');
  const bound = await request(app).get('/api/manifest/upstream/check').query(input).expect(200); assert.equal(bound.body.status, 'unchanged');
  const rollback = await post('/api/manifest/source-rollback/plan', {...input, revision: state.revision, checkpointId: state.history.at(-1).id}).expect(200);
  await post('/api/manifest/source-rollback/apply', {planId: rollback.body.planId}).expect(200);
  const restored = (await request(app).get('/api/manifest/source').query(input).expect(200)).body;
  assert.equal(restored.upstream, null); assert.equal(restored.files[0].text, '# Original\n');
  assert.equal(fs.readFileSync(original, 'utf8'), '# Original\n'); assert.equal(fs.readlinkSync(external), '/external/ego-skills');
});

test('HTTP native installation separates adoption, guarded apply, installed merge and ownership release', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-native-http-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), targetRoot = path.join(root, 'project'), definitionsDir = path.join(root, 'definitions');
  for (const directory of [homeDir, targetRoot, path.join(kitRoot, 'projects/default')]) fs.mkdirSync(directory, {recursive: true});
  const primary = path.join(targetRoot, '.agents/skills/review/SKILL.md'); fs.mkdirSync(path.dirname(primary), {recursive: true}); fs.writeFileSync(primary, 'alpha\nbase\nomega\n'); fs.chmodSync(primary, 0o640);
  fs.writeFileSync(path.join(kitRoot, 'projects/default/agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: http-native}\nassets: {}\n');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['skills-project']});
  const context = createAppContext({homeDir, kitRoot, definitionsDir}); const {app, apiToken} = createControlPlaneApp({context, apiToken: 'c'.repeat(64), logRequest: () => {}});
  const input = {scope: 'project', projectPath: targetRoot, projectName: 'default', assetId: 'review', clientVersion: '0.0.1-test'};
  const post = (endpoint, body) => request(app).post(endpoint).set('X-Agents-Kit-Token', apiToken).send(body);
  const discovery = await request(app).get('/api/local-discovery').query(input).expect(200);
  const candidateId = discovery.body.clients.find(client => client.id === 'codex').observations.find(item => item.id === 'review').candidateId;
  const imported = await post('/api/manifest/import/plan', {...input, clientId: 'codex', surface: 'cli', candidateId}).expect(200); await post('/api/manifest/import/apply', {planId: imported.body.planId}).expect(200);
  await request(app).post('/api/manifest/installation/plan').send(input).expect(403); await request(app).post('/api/manifest/installation/apply').send(input).expect(403);
  const adopt = await post('/api/manifest/installation/plan', {...input, mode: 'adopt', target: '/ignored', runtimeEvidence: [{fake: true}]}).expect(200);
  assert.equal(fs.existsSync(path.join(targetRoot, '.agent-kit')), false); const mtime = fs.statSync(primary).mtimeMs;
  await post('/api/manifest/installation/apply', {planId: adopt.body.planId}).expect(200); assert.equal(fs.statSync(primary).mtimeMs, mtime);
  const source = await request(app).get('/api/manifest/source').query(input).expect(200);
  const edit = await post('/api/manifest/source-edit/plan', {...input, revision: source.body.revision, changes: [{path: 'SKILL.md', text: 'KIT\nbase\nomega\n'}]}).expect(200); await post('/api/manifest/source-edit/apply', {planId: edit.body.planId}).expect(200);
  fs.writeFileSync(primary, 'alpha\nbase\nINSTALLED\n');
  const conflict = await post('/api/manifest/installation/plan', {...input, mode: 'apply'}).expect(200); assert.equal(conflict.body.automatic, false); await post('/api/manifest/installation/apply', {planId: conflict.body.planId}).expect(409);
  const merge = await post('/api/manifest/installation/plan', {...input, mode: 'import-installed'}).expect(200); assert.equal(merge.body.sourceOnly, true);
  await post('/api/manifest/installation/apply', {planId: merge.body.planId}).expect(200); assert.equal(fs.readFileSync(primary, 'utf8'), 'alpha\nbase\nINSTALLED\n');
  const deploy = await post('/api/manifest/installation/plan', {...input, mode: 'apply'}).expect(200); assert.equal(deploy.body.automatic, true, JSON.stringify(deploy.body.blocked));
  const deployed=await post('/api/manifest/installation/apply', {planId: deploy.body.planId}).expect(200); assert.equal(fs.readFileSync(primary, 'utf8'), 'KIT\nbase\nINSTALLED\n'); assert.equal(fs.statSync(primary).mode & 0o777, 0o640);
  const rollback=await post('/api/deployment/rollback-plan',{...input,clientId:'codex',surface:'cli',transactionId:deployed.body.transactionId}).expect(200);assert.equal(rollback.body.automatic,true,JSON.stringify(rollback.body.blocked));
  await post('/api/deployment/rollback',{planId:rollback.body.planId}).expect(200);assert.equal(fs.readFileSync(primary,'utf8'),'alpha\nbase\nINSTALLED\n');assert.equal(fs.statSync(primary).mode&0o777,0o640);
  const released = await post('/api/manifest/installation/plan', {...input, mode: 'detach'}).expect(200); await post('/api/manifest/installation/apply', {planId: released.body.planId}).expect(200);
  assert.equal(fs.readFileSync(primary, 'utf8'), 'alpha\nbase\nINSTALLED\n');
});

test('HTTP Kit edit, conflict resolution, partial refresh and rollback preserve upstream and reject stale plans', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-revisions-http-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), original = path.join(homeDir, '.agents/skills/review/SKILL.md');
  fs.mkdirSync(path.dirname(original), {recursive: true}); fs.writeFileSync(original, '# Original\n');
  fs.mkdirSync(path.join(kitRoot, 'global'), {recursive: true});
  fs.writeFileSync(path.join(kitRoot, 'global/agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: http-revisions}\nassets: {}\n');
  const context = createAppContext({homeDir, kitRoot, definitionsDir: path.resolve(import.meta.dirname, '../../../clients')});
  const requests=[];
  const {app, apiToken} = createControlPlaneApp({context, apiToken: 'a'.repeat(64), logRequest: event => requests.push(event)});
  const input = {scope: 'global', assetId: 'review'};
  const post = (endpoint, body) => request(app).post(endpoint).set('X-Agents-Kit-Token', apiToken).send(body).expect(response=>{
    if(response.status===403)assert.fail(JSON.stringify({status:response.status,appRequestId:!!response.headers['x-request-id'],
      appOriginProven:requests.some(event=>event.requestId===response.headers['x-request-id']),contentType:response.headers['content-type'],code:typeof response.body?.code==='string'?response.body.code.replace(/[^A-Z0-9_]/g,'').slice(0,80):null}));
  });
  const get = endpoint => request(app).get(endpoint).query(input);
  const discovery = await request(app).get('/api/local-discovery').expect(200);
  const candidateId = discovery.body.clients.find(client => client.id === 'codex').observations.find(item => item.id === 'review').candidateId;
  const imported = await post('/api/manifest/import/plan', {...input, clientId: 'codex', surface: 'cli', candidateId}).expect(200);
  await post('/api/manifest/import/apply', {planId: imported.body.planId}).expect(200);
  for (const action of ['source-edit', 'refresh', 'source-rollback']) for (const stage of ['plan', 'apply']) await request(app).post(`/api/manifest/${action}/${stage}`).send(input).expect(403);
  const initial = await get('/api/manifest/source').expect(200);
  const unsafe = await post('/api/manifest/source-edit/plan', {...input, revision: initial.body.revision, changes: [{path: 'SKILL.md', text: 'API_TOKEN = "never-return-me"'}]}).expect(400);
  assert.equal(unsafe.body.code, 'LITERAL_SECRET'); assert.equal(JSON.stringify(unsafe.body).includes('never-return-me'), false);
  const edit = await post('/api/manifest/source-edit/plan', {...input, revision: initial.body.revision, changes: [{path: 'SKILL.md', text: '# Kit\n'}], source: '/ignored/arbitrary/path'}).expect(200);
  assert.equal(fs.readFileSync(original, 'utf8'), '# Original\n');
  await post('/api/manifest/source-edit/apply', {planId: edit.body.planId}).expect(200);
  await post('/api/manifest/source-edit/apply', {planId: edit.body.planId}).expect(404);
  await post('/api/manifest/source-edit/plan', {...input, revision: initial.body.revision, changes: [{path: 'SKILL.md', text: 'stale'}]}).expect(409);
  fs.writeFileSync(original, '# Upstream\n');
  const check = await get('/api/manifest/upstream/check').expect(200); assert.equal(check.body.status, 'changed');
  const conflict = await post('/api/manifest/refresh/plan', input).expect(200); assert.equal(conflict.body.automatic, false);
  await post('/api/manifest/refresh/apply', {planId: conflict.body.planId}).expect(409);
  const partial = await post('/api/manifest/refresh/plan', {...input, reviewHash: conflict.body.reviewHash, resolutions: {'SKILL.md': {choice: 'defer'}}}).expect(200);
  await post('/api/manifest/refresh/apply', {planId: partial.body.planId}).expect(200);
  const kept = await get('/api/manifest/source').expect(200); assert.equal(kept.body.files[0].text, '# Kit\n'); assert.deepEqual(kept.body.lastCheck.deferred, ['SKILL.md']);
  const review = await post('/api/manifest/refresh/plan', input).expect(200);
  const resolved = await post('/api/manifest/refresh/plan', {...input, reviewHash: review.body.reviewHash, resolutions: {'SKILL.md': {choice: 'manual', text: '# Kit + Upstream\n'}}}).expect(200);
  await post('/api/manifest/refresh/apply', {planId: resolved.body.planId}).expect(200);
  const merged = await get('/api/manifest/source').expect(200); assert.equal(merged.body.files[0].text, '# Kit + Upstream\n');
  const rollback = await post('/api/manifest/source-rollback/plan', {...input, revision: merged.body.revision, checkpointId: merged.body.history.at(-1).id}).expect(200);
  await post('/api/manifest/source-rollback/apply', {planId: rollback.body.planId}).expect(200);
  const restored = await get('/api/manifest/source').expect(200); assert.equal(restored.body.files[0].text, '# Kit\n'); assert.deepEqual(restored.body.lastCheck.deferred, ['SKILL.md']);
  assert.equal(fs.readFileSync(original, 'utf8'), '# Upstream\n');
});

test('HTTP selected source registration requires a session, plans before applying, and detaches without deleting originals', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-source-http-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit');
  const source = path.join(homeDir, '.agents/skills/review/SKILL.md');
  fs.mkdirSync(path.dirname(source), {recursive: true}); fs.writeFileSync(source, '# Review\n');
  fs.mkdirSync(path.join(kitRoot, 'global'), {recursive: true});
  const manifest = path.join(kitRoot, 'global/agent-kit.yaml');
  fs.writeFileSync(manifest, 'schemaVersion: 1\nkit: {id: http-import}\nassets: {}\n');
  const context = createAppContext({homeDir, kitRoot, definitionsDir: path.resolve(import.meta.dirname, '../../../clients')});
  const {app, apiToken} = createControlPlaneApp({context, apiToken: 'f'.repeat(64), logRequest: () => {}});
  const discovery = await request(app).get('/api/local-discovery').expect(200);
  const candidate = discovery.body.clients.find(client => client.id === 'codex').observations.find(item => item.id === 'review');
  const input = {scope: 'global', clientId: 'codex', surface: 'cli', candidateId: candidate.candidateId};
  for (const action of ['import', 'detach', 'source-recovery']) for (const stage of ['plan', 'apply']) {
    await request(app).post(`/api/manifest/${action}/${stage}`).send(input).expect(403);
  }
  const plan = await request(app).post('/api/manifest/import/plan').set('X-Agents-Kit-Token', apiToken).send({...input, source: '/arbitrary/path', files: [{path: '/do-not-use'}]}).expect(200);
  assert.match(fs.readFileSync(manifest, 'utf8'), /schemaVersion: 1/);
  assert.equal(fs.existsSync(path.join(kitRoot, 'global/assets/imported')), false);
  await request(app).post('/api/manifest/import/apply').set('X-Agents-Kit-Token', apiToken).send({planId: plan.body.planId}).expect(200);
  await request(app).post('/api/manifest/import/apply').set('X-Agents-Kit-Token', apiToken).send({planId: plan.body.planId}).expect(404);
  const registry = await request(app).get('/api/manifest/registry').query({scope: 'global'}).expect(200);
  assert.equal(registry.body.registry[0].managementMode, 'kit-source');
  assert.equal(registry.body.registry[0].importedFrom.candidateId, input.candidateId);
  const detach = await request(app).post('/api/manifest/detach/plan').set('X-Agents-Kit-Token', apiToken).send({scope: 'global', assetId: 'review'}).expect(200);
  await request(app).post('/api/manifest/detach/apply').set('X-Agents-Kit-Token', apiToken).send({planId: detach.body.planId}).expect(200);
  assert.equal(fs.readFileSync(source, 'utf8'), '# Review\n');
  assert.equal(fs.readFileSync(path.join(kitRoot, 'global/assets/imported/review/bundle/SKILL.md'), 'utf8'), '# Review\n');
});

test('HTTP control plane completes plan, apply, history, and rollback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-e2e-'));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects', 'default');
  const targetRoot = path.join(root, 'target');
  fs.mkdirSync(path.join(scopeRoot, 'skills', 'review'), {recursive: true});
  fs.mkdirSync(homeDir);
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'skills', 'review', 'SKILL.md'), '# Review\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `
schemaVersion: 1
kit:
  id: http-e2e
assets:
  skills:
    - id: review
      source: skills/review
      scope: project
`);

  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..')});
  const context = createAppContext({
    homeDir,
    kitRoot,
    definitionsDir
  });
  const {app, apiToken} = createControlPlaneApp({
    context,
    apiToken: 'e'.repeat(64),
    logRequest: () => {}
  });
  const input = {
    clientId: 'codex',
    surface: 'desktop',
    clientVersion: '0.0.1-test',
    scope: 'project',
    projectName: 'default',
    projectPath: targetRoot
  };

  const session = await request(app).get('/api/session').expect(200);
  assert.equal(session.body.token, apiToken);
  await request(app).post('/api/deployment/plan').send(input).expect(403);

  const plan = await request(app)
    .post('/api/deployment/plan')
    .set('X-Agents-Kit-Token', apiToken)
    .send(input)
    .expect(200);
  assert.equal(plan.body.kind, 'apply');
  assert.equal(plan.body.automatic, true);
  assert.equal(plan.body.operations.length, 1);

  const applied = await request(app)
    .post('/api/deployment/apply')
    .set('X-Agents-Kit-Token', apiToken)
    .send({planId: plan.body.planId})
    .expect(200);
  assert.ok(applied.body.transactionId);
  assert.equal(
    fs.readFileSync(path.join(targetRoot, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8'),
    '# Review\n'
  );

  const history = await request(app)
    .get('/api/deployment/history')
    .query(input);
  assert.equal(history.status,200,JSON.stringify({code:history.body.code,error:history.body.error,
    contentType:history.headers['content-type'],server:history.headers.server}));
  assert.equal(history.body.transactions.length, 1);
  assert.equal(history.body.transactions[0].id, applied.body.transactionId);

  const rollbackPlan = await request(app)
    .post('/api/deployment/rollback-plan')
    .set('X-Agents-Kit-Token', apiToken)
    .send({...input, transactionId: applied.body.transactionId})
    .expect(200);
  assert.equal(rollbackPlan.body.kind, 'rollback');
  assert.equal(rollbackPlan.body.automatic, true);

  await request(app)
    .post('/api/deployment/rollback')
    .set('X-Agents-Kit-Token', apiToken)
    .send({planId: rollbackPlan.body.planId})
    .expect(200);
  assert.equal(
    fs.existsSync(path.join(targetRoot, '.agents', 'skills', 'review', 'SKILL.md')),
    false
  );
});

test('HTTP control plane self-target prevention returns 400 when projectPath is forbidden', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-security-'));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  fs.mkdirSync(homeDir);
  fs.mkdirSync(kitRoot);

  const context = createAppContext({
    homeDir,
    kitRoot
  });
  const {app, apiToken} = createControlPlaneApp({
    context,
    apiToken: 'e'.repeat(64),
    logRequest: () => {}
  });

  // Try planning into kit root
  await request(app)
    .post('/api/deployment/plan')
    .set('X-Agents-Kit-Token', apiToken)
    .send({
      clientId: 'codex',
      scope: 'project',
      projectName: 'default',
      projectPath: kitRoot
    })
    .expect(400);

  // Try doctor with forbidden kit root
  await request(app)
    .post('/api/deployment/doctor')
    .set('X-Agents-Kit-Token', apiToken)
    .send({
      clientId: 'codex',
      scope: 'project',
      projectName: 'default',
      projectPath: kitRoot
    })
    .expect(400);
});

test('HTTP plans expose typed MCP previews without bypassing runtime gates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-mcp-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(directory, {recursive: true});
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  fs.copyFileSync(path.join(repositoryRoot, 'docs/examples/mcp-common.yaml'), path.join(scopeRoot, 'agent-kit.yaml'));
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot}), apiToken: 'f'.repeat(64), logRequest: () => {}});
  for (const clientId of ['codex', 'antigravity']) {
    const response = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken)
      .send({clientId, surface: 'cli', scope: 'project', projectPath: targetRoot}).expect(200);
    assert.equal(response.body.automatic, false);
    assert.equal(response.body.previews.length, 2);
    assert.match(response.body.previews[1].desired, clientId === 'codex' ? /mcp_servers.remote-docs/ : /serverUrl/);
    const applied = await request(app).post('/api/deployment/apply').set('X-Agents-Kit-Token', apiToken).send({planId: response.body.planId});
    assert.ok(applied.status >= 400);
    assert.equal(applied.body.code, 'DEPLOYMENT_PLAN_BLOCKED');
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  }
});
test('HTTP plans expose selected common Agent previews without bypassing runtime gates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-mcp-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(directory, {recursive: true});
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  fs.copyFileSync(path.join(repositoryRoot, 'docs/examples/agent-common.yaml'), path.join(scopeRoot, 'agent-kit.yaml'));
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot}), apiToken: 'f'.repeat(64), logRequest: () => {}});
  for (const clientId of ['codex', 'antigravity']) {
    const response = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken)
      .send({clientId, surface: 'cli', clientVersion: '9.9.9', scope: 'project', projectPath: targetRoot}).expect(200);
    assert.equal(response.body.automatic, false);
    assert.deepEqual(response.body.selection.rootAssetIds, ['reviewer']);
    assert.equal(response.body.previews.length, 1);
    assert.match(response.body.previews[0].desired, clientId === 'codex' ? /developer_instructions/ : /subagent: true/);
    const applied = await request(app).post('/api/deployment/apply').set('X-Agents-Kit-Token', apiToken).send({planId: response.body.planId});
    assert.ok(applied.status >= 400);
    assert.equal(applied.body.code, 'DEPLOYMENT_PLAN_BLOCKED');
    assert.deepEqual(fs.readdirSync(targetRoot), []);
  }
});

test('HTTP shares four-resource source validation and returns actionable malformed Skill errors', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-four-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home');
  const kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default');
  const targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, path.dirname(scopeRoot), targetRoot]) fs.mkdirSync(directory, {recursive: true});
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  fs.cpSync(path.join(repositoryRoot, 'docs/examples/common-resources'), scopeRoot, {recursive: true});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot}), apiToken: 'f'.repeat(64), logRequest: () => {}});
  const input = {clientId: 'codex', surface: 'cli', scope: 'project', projectPath: targetRoot};
  const plan = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken).send(input).expect(200);
  assert.deepEqual(plan.body.selection.selectedAssetIds, ['docs', 'reviewer', 'shared-rules', 'source-review']);
  assert.equal(plan.body.automatic, false);
  fs.writeFileSync(path.join(scopeRoot, 'skills/source-review/SKILL.md'), '# Missing frontmatter\n');
  const invalid = await request(app).post('/api/deployment/plan').set('X-Agents-Kit-Token', apiToken).send(input).expect(400);
  assert.equal(invalid.body.code, 'INVALID_SKILL_FRONTMATTER');
  assert.deepEqual(fs.readdirSync(targetRoot), []);
});

test('HTTP batch ownership and two-step removal preserve the other client', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-shared-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit');
  const scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'target');
  for (const directory of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Shared rules\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: shared}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n');
  const definitionsDir = path.join(root, 'definitions');
  for (const clientId of ['codex', 'antigravity']) writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), clientId, capabilityIds: ['instructions-project']});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'a'.repeat(64), logRequest: () => {}});
  const base = {scope: 'project', projectPath: targetRoot};
  const post = (url, input) => request(app).post(url).set('X-Agents-Kit-Token', apiToken).send(input);
  const plan = await post('/api/deployment/plan', {...base, targets: ['codex', 'antigravity'].map(clientId => ({clientId, surface: 'cli', clientVersion: '0.0.1-test'}))}).expect(200);
  assert.equal(plan.body.automatic, true);
  assert.equal(plan.body.operations.length, 1);
  assert.equal(plan.body.operations[0].consumers.length, 2);
  await post('/api/deployment/apply', {planId: plan.body.planId}).expect(200);
  const target = path.join(targetRoot, 'AGENTS.md');
  for (const clientId of ['codex', 'antigravity']) {
    const removal = await post('/api/deployment/removal-plan', {...base, clientId, surface: 'cli', assetIds: ['rules']}).expect(200);
    assert.equal(removal.body.kind, 'remove');
    assert.equal(fs.existsSync(target), true);
    await post('/api/deployment/apply', {planId: removal.body.planId}).expect(200);
    assert.equal(fs.existsSync(target), clientId === 'codex');
  }
  await post('/api/deployment/removal-plan', {...base, projectPath: kitRoot, clientId: 'codex', assetIds: ['rules']}).expect(400);
});

test('HTTP global ledger and ownership migration preserve files and permit later shared removal', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-migration-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'global');
  for (const directory of [homeDir, scopeRoot]) fs.mkdirSync(directory, {recursive: true});
  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['instructions-global']});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review evidence.\n');
  const manifest = 'schemaVersion: 1\nkit: {id: migration}\nassets:\n  instructions:\n    - {id: rules, scope: global, source: rules.md';
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `${manifest}}\n`);
  const context = createAppContext({homeDir, kitRoot, definitionsDir});
  const {app, apiToken} = createControlPlaneApp({context, apiToken: 'b'.repeat(64), logRequest: () => {}});
  const post = (url, input) => request(app).post(url).set('X-Agents-Kit-Token', apiToken).send(input);
  const base = {scope: 'global', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  // Seed through the native application path, then represent the pre-unification layout.
  const nativePlan = await post('/api/deployment/plan', base).expect(200);
  await post('/api/deployment/apply', {planId: nativePlan.body.planId}).expect(200);
  const unified = path.join(homeDir, '.agents-kit/deployments/_global/state.json');
  const legacy = path.join(homeDir, '.agents-kit/deployments/codex/state.json');
  fs.mkdirSync(path.dirname(legacy), {recursive: true}); fs.renameSync(unified, legacy);
  const target = path.join(homeDir, '.codex/AGENTS.md'), before = fs.readFileSync(target);
  const blocked = await post('/api/deployment/plan', base).expect(409);
  assert.equal(blocked.body.code, 'GLOBAL_LEDGER_MIGRATION_REQUIRED');
  await request(app).post('/api/deployment/migration-plan').send({...base, migration: 'global-ledger'}).expect(403);
  const ledger = await post('/api/deployment/migration-plan', {...base, migration: 'global-ledger'}).expect(200);
  assert.equal(fs.existsSync(unified), false);
  await post('/api/deployment/apply', {planId: ledger.body.planId}).expect(200);
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `${manifest}, definition: {schemaVersion: 1, format: markdown}}\n`);
  const ownership = await post('/api/deployment/migration-plan', {...base, migration: 'shared-ownership', assetIds: ['rules']}).expect(200);
  assert.equal(ownership.body.automatic, true);
  assert.equal(ownership.body.operations[0].metadataOnly, true);
  await post('/api/deployment/apply', {planId: ownership.body.planId}).expect(200);
  assert.deepEqual(fs.readFileSync(target), before);
  const removal = await post('/api/deployment/removal-plan', {...base, assetIds: ['rules']}).expect(200);
  await post('/api/deployment/apply', {planId: removal.body.planId}).expect(200);
  assert.equal(fs.readFileSync(target, 'utf8').trim(), ''); // Migrated legacy file conservatively retained.
  await post('/api/deployment/migration-plan', {...base, scope: 'project', projectPath: kitRoot, migration: 'shared-ownership', assetIds: ['rules']}).expect(400);
});

test('HTTP mixed Agent/MCP removal uses the same approval and rollback transaction', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-removal-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default'), targetRoot = path.join(root, 'target');
  for (const dir of [homeDir, scopeRoot, targetRoot]) fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), `schemaVersion: 1
kit: {id: removal}
defaults:
  mcpBindings: {schemaVersion: 1, endpoints: {docs: {url: https://example.test/mcp}}}
assets:
  agents:
    - id: reviewer
      scope: project
      definition: {schemaVersion: 1, permissions: client-default, description: Review, instructions: Check evidence.}
  mcpServers:
    - id: docs
      scope: project
      definition: {schemaVersion: 1, transport: http, endpointId: docs}
`);
  const definitionsDir = path.join(root, 'definitions');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['agents-project', 'mcp-project']});
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'c'.repeat(64), logRequest: () => {}});
  const post = (url, input) => request(app).post(url).set('X-Agents-Kit-Token', apiToken).send(input);
  const input = {scope: 'project', projectPath: targetRoot, clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const initial = await post('/api/deployment/plan', input).expect(200);
  assert.deepEqual(initial.body.stateUpgrade, {from: 1, to: 4});
  await post('/api/deployment/apply', {planId: initial.body.planId}).expect(200);
  const config = path.join(targetRoot, '.codex/config.toml'), agent = path.join(targetRoot, '.codex/agents/reviewer.toml');
  const before = fs.readFileSync(config);
  const removal = await post('/api/deployment/removal-plan', {...input, assetIds: ['docs', 'reviewer']}).expect(200);
  assert.equal(removal.body.automatic, true);
  assert.ok(fs.existsSync(agent));
  const removed = await post('/api/deployment/apply', {planId: removal.body.planId}).expect(200);
  assert.equal(fs.existsSync(agent), false); assert.equal(fs.readFileSync(config, 'utf8').trim(), '');
  const rollback = await post('/api/deployment/rollback-plan', {...input, transactionId: removed.body.transactionId}).expect(200);
  await post('/api/deployment/rollback', {planId: rollback.body.planId}).expect(200);
  assert.ok(fs.existsSync(agent)); assert.deepEqual(fs.readFileSync(config), before);
});

test('HTTP saved plans survive app restart and require digest and CSRF before execution', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-http-saved-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'kit'), homeDir = path.join(root, 'home'), targetRoot = path.join(root, 'target');
  const scopeRoot = path.join(kitRoot, 'projects/default'), definitionsDir = path.join(root, 'definitions');
  fs.mkdirSync(scopeRoot, {recursive: true}); fs.mkdirSync(homeDir); fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), '# Review\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: http-saved}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n');
  writeProfileFixture({definitionsDir, repositoryRoot: path.resolve(import.meta.dirname, '../../..'), capabilityIds: ['instructions-project']});
  const options = {homeDir, kitRoot, definitionsDir}, apiToken = 'c'.repeat(64);
  const makeApp = () => createControlPlaneApp({context: createAppContext(options), apiToken, logRequest: () => {}}).app;
  let app = makeApp();
  const post = (route, body) => request(app).post(`/api/deployment/${route}`).set('X-Agents-Kit-Token', apiToken).send(body);
  const input = {scope: 'project', projectPath: targetRoot, projectName: 'default', clientId: 'codex', surface: 'cli', clientVersion: '0.0.1-test'};
  const plan = await post('plan', input).expect(200);
  await request(app).post('/api/deployment/save-plan').send({planId: plan.body.planId}).expect(403);
  const saved = await post('save-plan', {planId: plan.body.planId}).expect(200);
  assert.equal(fs.existsSync(path.join(targetRoot, 'AGENTS.md')), false);
  app = makeApp();
  const listed = await request(app).get('/api/deployment/saved-plans').expect(200);
  assert.equal(listed.body.plans[0].digest, saved.body.digest);
  await post('resume', {planId: saved.body.planId}).expect(400);
  await post('resume', {planId: saved.body.planId, digest: '0'.repeat(64)}).expect(409);
  await request(app).post('/api/deployment/resume').send(saved.body).expect(403);
  const resumed = await post('resume', saved.body).expect(200);
  assert.equal(resumed.body.transactionId, `tx-plan-${saved.body.planId}`);
  await post('resume', saved.body).expect(200);
  const history = await request(app).get('/api/deployment/history').query(input).expect(200);
  assert.equal(history.body.transactions.length, 1);
  await post('recovery-plan', input).expect(404);
  await post('recovery-plan', {...input, projectPath: kitRoot}).expect(400);
  await request(app).post('/api/deployment/recover').send({planId: 'none'}).expect(403);
  const target = path.join(targetRoot, 'AGENTS.md'), before = fs.readFileSync(target);
  fs.appendFileSync(path.join(scopeRoot, 'rules.md'), 'Updated rules.');
  const childConfig = path.join(root, 'crash.json');
  fs.writeFileSync(childConfig, JSON.stringify({options: {...options, planStoreRoot: path.join(kitRoot, '.deployment-plans')},
    input: {...input, scopeRoot, targetRoot, crashTarget: target}, stage: 'mutation'}));
  const killed = spawnSync(process.execPath, ['test/helpers/crash-deployment.js', childConfig], {cwd: path.resolve(import.meta.dirname, '../../..'), encoding: 'utf8'});
  assert.equal(killed.signal, 'SIGKILL', killed.stderr);
  app = makeApp();
  const recovery = await post('recovery-plan', input).expect(200);
  assert.equal(recovery.body.outcome, 'restore-original');
  assert.notDeepEqual(fs.readFileSync(target), before);
  await post('recover', {planId: recovery.body.planId}).expect(200);
  assert.deepEqual(fs.readFileSync(target), before);

});

test('HTTP applies reviewed global Skills and preserves project/version capability gates for observed CLI builds', {skip: process.platform !== 'darwin' || process.arch !== 'arm64'}, async t => {
  const {observeClientBinary} = await import('../../../lib/infrastructure/client-binary-observer.js');
  const {loadClientDefinitions} = await import('../../../lib/infrastructure/client-definition-loader.js');
  const definitionsDir = path.resolve(import.meta.dirname, '../../../clients');
  const definitions = loadClientDefinitions({definitionsDir});
  for (const clientId of ['codex', 'antigravity']) {
    const profile = definitions.get(clientId).surfaces[0];
    if (!profile.runtimeEvidence.some(record => record.binarySha256 === observeClientBinary(profile)?.sha256)) return t.skip('Reviewed native client builds are not installed');
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-http-activation-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'), kitRoot = path.join(root, 'kit'), scopeRoot = path.join(kitRoot, 'projects/default');
  fs.mkdirSync(homeDir); fs.mkdirSync(scopeRoot, {recursive: true});
  fs.writeFileSync(path.join(scopeRoot, 'rules.md'), 'Review carefully.\n');
  fs.writeFileSync(path.join(scopeRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: http-activation}\nassets:\n  instructions:\n    - {id: rules, scope: project, source: rules.md, definition: {schemaVersion: 1, format: markdown}}\n');
  const {app, apiToken} = createControlPlaneApp({context: createAppContext({homeDir, kitRoot, definitionsDir}), apiToken: 'a'.repeat(64), logRequest: () => {}});
  const post = (route, body) => request(app).post(`/api/deployment/${route}`).set('X-Agents-Kit-Token', apiToken).send(body).expect(200);
  for (const clientId of ['codex', 'antigravity']) {
    const projectPath = path.join(root, clientId); fs.mkdirSync(projectPath);
    const input = {clientId, surface: 'cli', scope: 'project', projectName: 'default', projectPath};
    const {body: plan} = await post('plan', input);
    const profile = definitions.get(clientId).surfaces[0], observed = observeClientBinary(profile);
    const supported = profile.runtimeEvidence.some(record => record.capabilityId === 'instructions-project' && record.binarySha256 === observed.sha256 && record.platform === process.platform && record.arch === process.arch);
    assert.equal(plan.automatic, supported);
    const target = path.join(projectPath, 'AGENTS.md');
    if (!supported) {
      assert.ok(plan.blocked.length); assert.ok(plan.blocked.every(item => item.reason === 'CLIENT_PROFILE_UNVERIFIED'));
      await request(app).post('/api/deployment/apply').set('X-Agents-Kit-Token', apiToken).send({planId: plan.planId}).expect(409);
      assert.equal(fs.existsSync(target), false);
    } else {
      assert.equal(plan.targetProfile.versionSource, 'binary-sha256');
      await post('apply', {planId: plan.planId});
      const content = fs.readFileSync(target, 'utf8');
      const {body: removal} = await post('removal-plan', {...input, assetIds: ['rules']});
      const {body: removed} = await post('apply', {planId: removal.planId});
      assert.notEqual(fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '', content);
      const {body: rollback} = await post('rollback-plan', {...input, transactionId: removed.transactionId});
      await post('rollback', {planId: rollback.planId});
      assert.equal(fs.readFileSync(target, 'utf8'), content);
    }
    const {body: appPlan} = await post('plan', {...input, surface: 'desktop', clientVersion: definitions.get(clientId).surfaces[0].runtimeEvidence[0].version});
    assert.equal(appPlan.automatic, false);
  }
  const globalRoot = path.join(kitRoot, 'global'); fs.mkdirSync(path.join(globalRoot, 'review'), {recursive: true});
  fs.writeFileSync(path.join(globalRoot, 'review/SKILL.md'), '---\nname: review\ndescription: Review a change\n---\nPreserve user content.\n');
  fs.writeFileSync(path.join(globalRoot, 'agent-kit.yaml'), 'schemaVersion: 1\nkit: {id: http-activation}\nassets:\n  skills:\n    - {id: review, scope: global, source: review, definition: {schemaVersion: 1, format: agent-skills}}\n');
  for (const clientId of ['codex', 'antigravity']) {
    const input = {clientId, surface: 'cli', scope: 'global'}, {body: plan} = await post('plan', input);
    assert.equal(plan.automatic, true, JSON.stringify(plan.blocked)); assert.equal(plan.targetProfile.versionSource, 'binary-sha256');
    await post('apply', {planId: plan.planId});
    const target = path.join(homeDir, clientId === 'codex' ? '.agents/skills/review/SKILL.md' : '.gemini/config/skills/review/SKILL.md');
    const content = fs.readFileSync(target, 'utf8');
    const {body: removal} = await post('removal-plan', {...input, assetIds: ['review']});
    const {body: removed} = await post('apply', {planId: removal.planId}); assert.equal(fs.existsSync(target), false);
    const {body: rollback} = await post('rollback-plan', {...input, transactionId: removed.transactionId});
    await post('rollback', {planId: rollback.planId}); assert.equal(fs.readFileSync(target, 'utf8'), content);
  }
});
