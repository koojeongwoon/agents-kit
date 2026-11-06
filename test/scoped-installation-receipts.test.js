import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {parse,stringify} from 'yaml';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {compileScopedDeployment} from '../lib/application/scoped-deployment-compiler.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {latestInstallationReceipts,observeInstallationReceipt,describeScopedInstallationResources,attachInstallationReceipts} from '../lib/application/installation-receipt-service.js';
import {createInstallationReceipt,validInstallationReceipt,installationDigest} from '../lib/domain/installation-receipt.js';
import {captureScopedDependencySnapshot,inspectScopedInstalledDependencies} from '../lib/domain/scoped-installed-dependencies.js';
import {scopedDeclarationDigest,createInstallationOrigin,matchesInstallationOrigin} from '../lib/domain/scoped-installation-declaration.js';
import {nativeInstallationFixture} from './helpers/native-installation-fixture.js';
import {loadManifestFile} from '../lib/infrastructure/manifest-loader.js';
import {applyDeployment} from '../lib/application/apply-deployment.js';
import {DeploymentBackupStore} from '../lib/infrastructure/deployment-backup-store.js';
import {planDependencyCoordination,executeDependencyCoordination,planDependencyCoordinationRecovery,applyDependencyCoordinationRecovery} from '../lib/application/dependency-coordination-service.js';

function fixture(t) {
  const f=resourcePathFixture(t,{scope:'global',capabilityScopes:['global','project']});
  f.raw.assets.skills[0].requires={tools:[{id:'repository.search',providerId:'docs',capability:'repository.read'}]};f.raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'search_repository'}]};f.write();f.service.apply({planId:f.service.plan(f.input).planId});
  const projectPath=path.join(f.root,'project'),scopeRoot=path.join(f.kitRoot,'projects/default');fs.mkdirSync(projectPath);fs.mkdirSync(path.join(scopeRoot,'review'),{recursive:true});
  fs.writeFileSync(path.join(scopeRoot,'review/SKILL.md'),'---\nname: review\ndescription: Review\n---\nDO_NOT_PERSIST_LOCAL_BODY\n');
  const raw={schemaVersion:1,kit:{id:'project-kit'},targets:{codex:{assetIds:['reviewer']}},assets:{skills:[{id:'review',scope:'project',source:'review',definition:{schemaVersion:1,format:'agent-skills'}}],agents:[{id:'reviewer',scope:'project',dependsOn:{skills:['review']},definition:{schemaVersion:1,description:'Review',instructions:'DO_NOT_PERSIST_AGENT_BODY',permissions:'client-default'}}]}};
  const write=()=>fs.writeFileSync(path.join(scopeRoot,'agent-kit.yaml'),stringify(raw));write();
  const input={scopeRoot,targetRoot:projectPath,scope:'project',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};f.service.apply({planId:f.service.plan(input).planId});
  raw.schemaVersion=3;raw.management={schemaVersion:1,resources:{}};raw.assets.agents[0].dependsOn.skills.push({schemaVersion:1,kitId:f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'});write();
  const compiled=compileScopedDeployment({kitRoot:f.kitRoot,projectPath,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.definitionsDir})});
  const statePath=path.join(projectPath,'.agent-kit/state.json'),projectState=()=>JSON.parse(fs.readFileSync(statePath));
  const installations=()=>[...latestInstallationReceipts(f.state()).map(receipt=>({receipt,ownershipState:observeInstallationReceipt({receipt,state:f.state(),homeDir:f.homeDir}).status})),
    ...latestInstallationReceipts(projectState()).map(receipt=>({receipt,ownershipState:observeInstallationReceipt({receipt,state:projectState(),homeDir:f.homeDir,targetRoot:projectPath}).status}))];
  const descriptors=describeScopedInstallationResources({contexts:compiled.contexts,scopes:compiled.scopes,sourceContextId:compiled.selection.graph.nodes.find(node=>node.scope.type==='project').contextId,locators:compiled.locators});
  const descriptor=descriptors.find(item=>item.assetId==='reviewer'),previous=latestInstallationReceipts(projectState()).find(item=>item.assetId==='reviewer');
  const make=()=>createInstallationReceipt(descriptor,{proofs:previous.proofs,directories:previous.directories,dependencySnapshot:captureScopedDependencySnapshot({descriptor,installations:installations()})});
  return {f,compiled,scopeRoot,projectPath,statePath,projectState,installations,descriptors,descriptor,previous,make};
}

test('scoped receipt v4 pins same-name local/global resources and their transitive provider without body or connection values',t=>{
  const f=fixture(t),receipt=f.make();assert.equal(receipt.schemaVersion,4);assert.equal(receipt.declaration.schemaVersion,3);assert.equal(receipt.dependencySnapshot.schemaVersion,2);assert.equal(validInstallationReceipt(receipt),true);
  const reviews=receipt.dependencySnapshot.dependencies.filter(item=>item.target.assetId==='review');assert.equal(reviews.length,2);assert.notEqual(reviews[0].target.originId,reviews[1].target.originId);
  assert.equal(receipt.dependencySnapshot.dependencies.length,3);assert.ok(receipt.dependencySnapshot.dependencies.every(item=>item.status==='pinned'));
  assert.ok(!JSON.stringify(receipt).includes('DO_NOT_PERSIST'));assert.ok(!JSON.stringify(receipt).includes('docs.js'));f.f.preserved();
});

test('scoped installed inspection preserves native tool mapping, never borrows the local namesake and reports global provider drift',t=>{
  const f=fixture(t),receipt=f.make(),installations=f.installations(),observed=inspectScopedInstalledDependencies({receipt,installations});
  assert.equal(observed.dependencyState,'revision-observed');assert.equal(observed.bindingDeclarationsState,'recorded');assert.equal(observed.dependencyBindings[0].nativeName,'search_repository');
  const missing=installations.filter(item=>!(item.receipt.scope==='global'&&item.receipt.assetId==='review'));
  assert.equal(inspectScopedInstalledDependencies({receipt,installations:missing}).dependencyState,'unverified');
  const provider=installations.find(item=>item.receipt.scope==='global'&&item.receipt.assetId==='docs'),changed=structuredClone(provider.receipt);
  const {schemaVersion,proofs,directories,revisionDigest,dependencySnapshot,...descriptor}=changed;descriptor.declaration.providedToolNames[0].nativeName='changed_search';
  provider.receipt=createInstallationReceipt(descriptor,{proofs,directories,dependencySnapshot});
  assert.equal(inspectScopedInstalledDependencies({receipt,installations}).dependencyState,'drift');f.f.preserved();
});

test('receipt validation rejects missing mandatory pins, duplicate origins, cross-project references and forged logical Tool bindings',t=>{
  const f=fixture(t),receipt=f.make();
  for(const mutate of [r=>r.dependencySnapshot.dependencies.pop(),r=>r.declaration.origins.push(r.declaration.origins[0]),
    r=>{r.declaration.references[0].target.originId='origin-'+'0'.repeat(64);},r=>{r.declaration.subject.assetId='other';},
    r=>{r.dependencySnapshot.dependencies[0].target.assetId='other';}]) {
    const changed=structuredClone(receipt);mutate(changed);const {revisionDigest,proofs,...body}=changed;changed.revisionDigest=installationDigest({...body,proofs:proofs.map(({managedTransactionId,...proof})=>proof)});assert.equal(validInstallationReceipt(changed),false);
  }
  const origin=createInstallationOrigin({kitId:'project-kit',sourceRoot:f.scopeRoot,targetRoot:path.join(f.f.root,'other-checkout'),scope:{type:'project',projectName:'default'}});
  assert.notEqual(origin.id,receipt.declaration.subject.originId);
  assert.equal(matchesInstallationOrigin(f.previous,origin),false);
});

test('scoped dependency snapshot never upgrades missing or ambiguous installed evidence and requires the complete closure',t=>{
  const f=fixture(t),installations=f.installations();
  const missing=captureScopedDependencySnapshot({descriptor:f.descriptor,installations:installations.filter(item=>item.receipt.scope!=='global')});assert.ok(missing.dependencies.some(item=>item.status==='unverified'));
  const receipt=f.make(),changed=structuredClone(receipt),globalProvider=changed.declaration.dependencies.find(item=>item.target.assetId==='docs');
  changed.declaration.dependencies=changed.declaration.dependencies.filter(item=>item!==globalProvider);changed.dependencySnapshot.dependencies=changed.dependencySnapshot.dependencies.filter(item=>item.target.assetId!=='docs');
  const {schemaVersion,proofs,directories,revisionDigest,dependencySnapshot,...descriptor}=changed;const incomplete=createInstallationReceipt(descriptor,{proofs,directories,dependencySnapshot});
  const observed=inspectScopedInstalledDependencies({receipt:incomplete,installations});assert.equal(observed.dependencyState,'unverified');assert.ok(observed.dependencyIssues.some(issue=>issue.code==='SCOPED_INSTALLED_CLOSURE_INCOMPLETE'));
});

test('origin identities and logical declaration digests are stable across metadata transaction anchors',t=>{
  const f=fixture(t),before=f.make(),after=f.make();after.proofs[0].managedTransactionId='tx-another-anchor';
  const {schemaVersion,proofs,directories,revisionDigest,dependencySnapshot,...descriptor}=after,rebuilt=createInstallationReceipt(descriptor,{proofs,directories,dependencySnapshot});
  assert.equal(rebuilt.revisionDigest,before.revisionDigest);assert.equal(scopedDeclarationDigest(rebuilt.declaration),scopedDeclarationDigest(before.declaration));
});

test('malformed scoped metadata never coerces Tool identifiers or aliases and validation returns false',t=>{
  const f=fixture(t),receipt=f.make();
  for(const mutate of [r=>{r.declaration.providedTools=['tool'];r.declaration.providedToolNames=[{id:'tool',nativeName:123}];},
    r=>r.declaration.requirements.push({id:42,capability:'',optional:true,provider:null}),r=>{r.declaration.references=[undefined];}]) {
    const changed=structuredClone(receipt);mutate(changed);const {revisionDigest,proofs,...body}=changed;changed.revisionDigest=installationDigest({...body,proofs:proofs.map(({managedTransactionId,...proof})=>proof)});
    assert.equal(validInstallationReceipt(changed),false);
  }
  assert.throws(()=>createInstallationOrigin({kitId:42,sourceRoot:f.scopeRoot,targetRoot:f.projectPath,scope:{type:'project',projectName:'default'}}),{code:'INVALID_SCOPED_INSTALLATION_DECLARATION'});
});

test('missing history remains unverified even after providers become available and duplicate ownership is ambiguous',t=>{
  const f=fixture(t),snapshot=captureScopedDependencySnapshot({descriptor:f.descriptor,installations:[]}),receipt=createInstallationReceipt(f.descriptor,{proofs:f.previous.proofs,directories:f.previous.directories,dependencySnapshot:snapshot});
  assert.equal(inspectScopedInstalledDependencies({receipt,installations:f.installations()}).dependencyState,'unverified');
  const installations=f.installations(),provider=installations.find(item=>item.receipt.scope==='global'&&item.receipt.assetId==='docs'),ambiguous=captureScopedDependencySnapshot({descriptor:f.descriptor,installations:[...installations,provider]});
  assert.ok(ambiguous.dependencies.some(item=>item.reason==='SCOPED_INSTALLED_ORIGIN_AMBIGUOUS'));
});

test('application inspection reads an explicit global ledger for scoped receipts without writing or falling back to local namesakes',t=>{
  const f=fixture(t),receipt=f.make(),state=f.projectState();state.transactions.push({id:'tx-scoped-audit',type:'apply',status:'committed',createdAt:new Date().toISOString(),operations:[],installationReceipts:[receipt]});fs.writeFileSync(f.statePath,JSON.stringify(state));
  const before=fs.readFileSync(f.statePath),missing=observeInstallationReceipt({receipt,state,homeDir:f.f.homeDir,targetRoot:f.projectPath});assert.equal(missing.status,'ownership-observed');assert.equal(missing.dependencyState,'unverified');
  const observed=observeInstallationReceipt({receipt,state,globalState:f.f.state(),homeDir:f.f.homeDir,targetRoot:f.projectPath});assert.equal(observed.dependencyState,'revision-observed');assert.equal(observed.fulfilled,false);
  assert.equal(f.compiled.stateStore.load().transactions.at(-1).installationReceipts[0].schemaVersion,4);assert.deepEqual(fs.readFileSync(f.statePath),before);f.f.preserved();
});

test('v4 native receipt preserves the original MCP server ID, owned baseline, config bytes and mode',t=>{
  const f=nativeInstallationFixture(t,{kind:'mcpServers',scope:'global',assetId:'docs-alias',canonicalKitLayout:true}),manifestPath=path.join(f.scopeRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(manifestPath,'utf8'));
  raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'search_repository'}]};fs.writeFileSync(manifestPath,stringify(raw));f.apply('adopt');
  const state=JSON.parse(fs.readFileSync(f.statePath)),previous=latestInstallationReceipts(state).find(receipt=>receipt.assetId==='docs-alias'),before=fs.readFileSync(f.primary),mode=fs.statSync(f.primary).mode&0o777,managed=structuredClone(state.managed);
  const {manifest}=loadManifestFile({manifestPath,resolveSources:false}),contexts=[{id:'global',catalogId:'native-kit',scope:'global',projectName:'',status:'ready',manifest}],scopes=[{scope:'global',scopeRoot:f.scopeRoot,targetRoot:f.homeDir}];
  const descriptor=describeScopedInstallationResources({contexts,scopes,sourceContextId:'global',locators:[previous.locator]})[0],receipt=createInstallationReceipt(descriptor,{proofs:previous.proofs,directories:previous.directories,dependencySnapshot:captureScopedDependencySnapshot({descriptor,installations:[]})});
  state.transactions.push({id:'tx-native-scoped-audit',type:'apply',status:'committed',createdAt:new Date().toISOString(),operations:[],installationReceipts:[receipt]});fs.writeFileSync(f.statePath,JSON.stringify(state));
  const observed=observeInstallationReceipt({receipt,state,homeDir:f.homeDir});assert.equal(observed.status,'ownership-observed');assert.equal(observed.nativeId,'review');assert.equal(receipt.locator.nativeId,'review');assert.equal(receipt.schemaVersion,4);
  assert.deepEqual(state.managed,managed);assert.deepEqual(fs.readFileSync(f.primary),before);assert.equal(fs.statSync(f.primary).mode&0o777,mode);
});

test('ordinary single-ledger execution cannot commit scoped external dependencies even after stripping preview flags',t=>{
  const f=fixture(t),before=fs.readFileSync(f.statePath),globalBefore=fs.readFileSync(f.f.statePath),plans=f.compiled.plans.map(plan=>({...plan,blocked:[]}));
  assert.ok(plans.flatMap(plan=>plan.installationDescriptors||[]).some(descriptor=>descriptor.declaration.schemaVersion===3&&descriptor.declaration.origins.length===2));
  assert.throws(()=>applyDeployment({plans,stateStore:f.compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.projectPath,'.agent-kit/backups')})}),{code:'DEPENDENCY_COORDINATOR_REQUIRED'});
  assert.deepEqual(fs.readFileSync(f.statePath),before);assert.deepEqual(fs.readFileSync(f.f.statePath),globalBefore);f.f.preserved();
});

function coordinatedMetadata(f,{incomplete=false}={}) {
  const plans=f.compiled.plans.map(plan=>({...plan,blocked:[],installationDescriptors:structuredClone(plan.installationDescriptors||[])}));
  if(incomplete)for(const descriptor of plans.flatMap(plan=>plan.installationDescriptors))if(descriptor.assetId==='reviewer')descriptor.declaration.dependencies=descriptor.declaration.dependencies.filter(item=>item.target.assetId!=='docs');
  const transaction={id:'tx-scoped-coordinated',type:'apply',status:'committed',createdAt:new Date().toISOString(),operations:[]},before=f.projectState(),predicted=structuredClone(before);predicted.transactions.push(transaction);
  attachInstallationReceipts({previousState:before,nextState:predicted,transaction,plans,globalState:f.f.state(),homeDir:f.f.homeDir,targetRoot:f.projectPath});
  const receipt=transaction.installationReceipts.find(receipt=>receipt.assetId==='reviewer'),consumer={...Object.fromEntries(['assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),locatorDigest:installationDigest(receipt.locator),prerequisiteIds:f.compiled.prerequisites.map(pin=>pin.id)};
  const request={globalStore:f.compiled.globalStore,projectStore:f.compiled.stateStore,project:f.compiled.review.project,transactionId:transaction.id,upsertConsumers:[consumer],prerequisites:f.compiled.prerequisites,releaseConsumerIds:[],targets:[],
    verifyPrerequisites:()=>({verified:true,digest:installationDigest({fixture:'synthetic native proof, not client support'})})};
  return {...request,plan:planDependencyCoordination(request),executeProject:context=>applyDeployment({plans,stateStore:context.projectStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.projectPath,'.agent-kit/backups')}),createTransactionId:()=>transaction.id}),predictedReceipt:receipt};
}

test('coordinator commits scoped receipts and reverse registration together while existing client bytes and modes remain unchanged',t=>{
  const f=fixture(t),before=Object.fromEntries(Object.keys(f.projectState().managed).map(file=>[file,{bytes:fs.readFileSync(file),mode:fs.statSync(file).mode&0o777}])),input=coordinatedMetadata(f),result=executeDependencyCoordination(input);
  assert.equal(result.outcome,'committed');const state=f.projectState(),receipt=latestInstallationReceipts(state).find(receipt=>receipt.assetId==='reviewer');assert.equal(receipt.schemaVersion,4);assert.equal(receipt.revisionDigest,input.predictedReceipt.revisionDigest);assert.equal(state.schemaVersion,8);
  assert.equal(observeInstallationReceipt({receipt,state,globalState:f.f.state(),homeDir:f.f.homeDir,targetRoot:f.projectPath}).dependencyState,'revision-observed');
  assert.equal(state.dependencyRegistration.consumers[0].revisionDigest,receipt.revisionDigest);for(const [file,image] of Object.entries(before)){assert.deepEqual(fs.readFileSync(file),image.bytes);assert.equal(fs.statSync(file).mode&0o777,image.mode);}f.f.preserved();
});

test('coordinator rejects an incomplete scoped closure before project commit and reviewed recovery restores the reserved metadata',t=>{
  const f=fixture(t),before=fs.readFileSync(f.statePath),input=coordinatedMetadata(f,{incomplete:true});
  assert.throws(()=>executeDependencyCoordination(input),{code:'DEPENDENCY_PROJECT_CONSUMER_CHANGED'});assert.deepEqual(fs.readFileSync(f.statePath),before);
  const recovery=planDependencyCoordinationRecovery(input);assert.equal(recovery.outcome,'restored');applyDependencyCoordinationRecovery({...input,plan:recovery});assert.deepEqual(fs.readFileSync(f.statePath),before);f.f.preserved();
});

test('recovery completes the reserved index after a scoped v4 project commit without claiming native execution',t=>{
  const f=fixture(t),input=coordinatedMetadata(f),before=Object.fromEntries(Object.keys(f.projectState().managed).map(file=>[file,fs.readFileSync(file)]));
  assert.throws(()=>executeDependencyCoordination({...input,onPhase:phase=>{if(phase==='project-committed')throw new Error('fixture stop after scoped commit');}}),/fixture stop/);
  assert.equal(latestInstallationReceipts(f.projectState()).find(receipt=>receipt.assetId==='reviewer').schemaVersion,4);assert.equal(f.f.state().dependencyIndex.projects[0].status,'reserved');
  const recovery=planDependencyCoordinationRecovery(input);assert.equal(recovery.outcome,'committed');const result=applyDependencyCoordinationRecovery({...input,plan:recovery});assert.equal(result.nativePrerequisitesState,'unverified-after-recovery');assert.equal(result.fulfilled,false);
  assert.equal(f.f.state().dependencyIndex.projects[0].status,'active');for(const [file,bytes] of Object.entries(before))assert.deepEqual(fs.readFileSync(file),bytes);f.f.preserved();
});

test('scoped compiler compares v3 global declarations with compatible legacy and v4 installed receipts without changing native files',t=>{
  const f=fixture(t);f.f.raw.schemaVersion=3;f.f.raw.management={schemaVersion:1,resources:{}};f.f.write();
  const input={kitRoot:f.f.kitRoot,projectPath:f.projectPath,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.f.definitionsDir})};
  const legacy=compileScopedDeployment(input);assert.ok(legacy.review.globalPrerequisites.every(entry=>entry.status==='ownership-observed'));
  const global=compileScopedDeployment({...input,scope:'global',projectPath:undefined}),before=fs.readFileSync(f.f.mcp);
  applyDeployment({plans:global.plans.map(plan=>({...plan,blocked:[]})),stateStore:global.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:global.globalStore.backupsRoot})});
  const compiled=compileScopedDeployment(input);assert.ok(compiled.review.globalPrerequisites.every(entry=>entry.status==='ownership-observed'));assert.ok(latestInstallationReceipts(f.f.state()).every(receipt=>receipt.schemaVersion===4));
  assert.deepEqual(fs.readFileSync(f.f.mcp),before);assert.equal(f.make().dependencySnapshot.dependencies.find(item=>item.target.assetId==='docs').revisionDigest,latestInstallationReceipts(f.f.state()).find(receipt=>receipt.assetId==='docs').revisionDigest);f.f.preserved();
  const previousProvider=latestInstallationReceipts(f.f.state()).find(receipt=>receipt.assetId==='docs');f.f.raw.assets.mcpServers.push({id:'other',scope:'global',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:['other.js']}});f.f.raw.targets={codex:{assetIds:['other']}};f.f.write();
  const other=compileScopedDeployment({...input,scope:'global',projectPath:undefined});applyDeployment({plans:other.plans.map(plan=>({...plan,blocked:[]})),stateStore:other.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:other.globalStore.backupsRoot})});
  const carried=latestInstallationReceipts(f.f.state()).find(receipt=>receipt.assetId==='docs');assert.equal(carried.revisionDigest,previousProvider.revisionDigest);assert.notEqual(carried.proofs[0].managedTransactionId,previousProvider.proofs[0].managedTransactionId);
  const installedSkill=latestInstallationReceipts(f.f.state()).find(receipt=>receipt.assetId==='review');assert.equal(observeInstallationReceipt({receipt:installedSkill,state:f.f.state(),homeDir:f.f.homeDir}).dependencyState,'revision-observed');
  f.compiled=compileScopedDeployment(input);const configAfterOther=fs.readFileSync(f.f.mcp),coordinated=coordinatedMetadata(f);assert.equal(executeDependencyCoordination(coordinated).outcome,'committed');assert.deepEqual(fs.readFileSync(f.f.mcp),configAfterOther);
});

test('Kit path aliases produce the same physical scoped origins and positive installed dependency pins',t=>{
  const f=fixture(t),alias=path.join(f.f.root,'kit-alias');fs.symlinkSync(f.f.kitRoot,alias);const identity=fs.lstatSync(alias);
  const compiled=compileScopedDeployment({kitRoot:alias,projectPath:f.projectPath,clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.f.homeDir,definitions:loadClientDefinitions({definitionsDir:f.f.definitionsDir})});
  const descriptor=compiled.plans.flatMap(plan=>plan.installationDescriptors||[]).find(descriptor=>descriptor.assetId==='reviewer');
  assert.deepEqual(descriptor.declaration,f.descriptor.declaration);assert.ok(captureScopedDependencySnapshot({descriptor,installations:f.installations()}).dependencies.every(item=>item.status==='pinned'));
  const scopes=f.compiled.scopes.map(scope=>({...scope,scopeRoot:scope.scopeRoot.replace(f.f.kitRoot,alias)})),sourceContextId=f.compiled.selection.graph.nodes.find(node=>node.scope.type==='project').contextId,
    described=describeScopedInstallationResources({contexts:f.compiled.contexts,scopes,sourceContextId,locators:f.compiled.locators});
  assert.deepEqual(described.find(item=>item.assetId==='reviewer').declaration,f.descriptor.declaration);
  assert.equal(fs.lstatSync(alias).ino,identity.ino);f.f.preserved();
});
