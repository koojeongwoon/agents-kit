import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {dependencyIndexFixture} from './helpers/dependency-index-fixture.js';
import {compileScopedDeployment} from '../lib/application/scoped-deployment-compiler.js';
import {loadClientDefinitions} from '../lib/infrastructure/client-definition-loader.js';
import {DeploymentBackupStore} from '../lib/infrastructure/deployment-backup-store.js';
import {resourcePathFixture} from './helpers/resource-path-fixture.js';
import {latestInstallationReceipts} from '../lib/application/installation-receipt-service.js';
import {installationDigest,createInstallationReceipt} from '../lib/domain/installation-receipt.js';
import {canonicalDigest} from '../lib/infrastructure/saved-deployment-plan-store.js';
import {dependencyPrerequisiteId,installedBindingDigest} from '../lib/domain/dependency-reverse-index.js';
import {inspectDependencyDependents} from '../lib/application/inspect-dependency-dependents.js';
import {nativeInstallationFixture} from './helpers/native-installation-fixture.js';
import {writeProfileFixture} from './helpers/client-profile-fixture.js';
import {parse,stringify} from 'yaml';
import {planGlobalDependencyMutation,executeGlobalDependencyMutation,planGlobalDependencyRecovery,applyGlobalDependencyRecovery} from '../lib/application/global-dependency-mutation.js';

function fixture(t,{assetId='rules',snapshot=false}={}) {
  const f=dependencyIndexFixture(t);
  if(snapshot) {
    const global=resourcePathFixture(t,{scope:'global',skillStrategy:'snapshot-link'}),receipt=latestInstallationReceipts(global.state()).find(receipt=>receipt.assetId==='docs'),registration=structuredClone(f.registration);
    const pin={...Object.fromEntries(['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)};pin.id=dependencyPrerequisiteId(pin);
    registration.prerequisites=[pin];registration.consumers[0].prerequisiteIds=[pin.id];const state=global.state();state.schemaVersion=8;state.dependencyIndex={schemaVersion:1,generation:1,projects:[registration]};fs.writeFileSync(global.statePath,JSON.stringify(state));
    const project=f.project.state();project.dependencyRegistration=registration;fs.writeFileSync(f.project.statePath,JSON.stringify(project));f.global=global;f.inspect=()=>inspectDependencyDependents({homeDir:global.homeDir});
  }
  f.global.raw.schemaVersion=3;f.global.raw.management={schemaVersion:1,resources:{}};
  if(assetId==='extra-agent')f.global.raw.assets.agents.push({id:'extra-agent',scope:'global',definition:{schemaVersion:1,permissions:'client-default',description:'Extra role',instructions:'Review changes.'}});
  f.global.raw.targets={codex:{assetIds:[assetId]}};
  if(assetId==='rules')fs.appendFileSync(path.join(f.global.scopeRoot,'rules.md'),'\nUpdated global rules\n');
  if(assetId==='review')fs.appendFileSync(path.join(f.global.scopeRoot,'review/SKILL.md'),'\nUpdated global Skill\n');
  if(assetId==='docs')f.global.raw.assets.mcpServers[0].definition.args=['changed-docs.js'];f.global.write();
  fs.mkdirSync(path.join(f.global.definitionsDir,'native-prerequisites'));fs.copyFileSync(path.resolve('clients/native-prerequisites/codex-cli.yaml'),path.join(f.global.definitionsDir,'native-prerequisites/codex-cli.yaml'));
  const compiled=compileScopedDeployment({kitRoot:f.global.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.global.homeDir,definitions:loadClientDefinitions({definitionsDir:f.global.definitionsDir})});
  // Internal execution fixture only; public Manifest v3 apply remains blocked.
  for(const plan of compiled.plans)plan.blocked=plan.blocked.filter(block=>block.reason!=='SCOPED_DEPLOYMENT_NOT_ENABLED');
  return {f,compiled,input:{globalStore:compiled.stateStore,plans:compiled.plans,definitionsDir:f.global.definitionsDir,
    backupStore:new DeploymentBackupStore({backupsRoot:path.join(f.global.homeDir,'.agents-kit/deployments/_global/backups')})}};
}

test('unrelated global changes preserve every registered pin and never write the project ledger',t=>{
  const {f,input}=fixture(t),before=f.global.state(),project=fs.readFileSync(f.project.statePath),plan=planGlobalDependencyMutation(input);
  assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.equal(plan.fulfilled,false);assert.deepEqual(f.global.state(),before);
  let preflight=0,beforeCommit=0;const result=executeGlobalDependencyMutation({...input,plan,preflight:()=>preflight++,beforeCommit:()=>beforeCommit++,validate:()=>{
    assert.throws(()=>planGlobalDependencyRecovery({...input,terminalOwner:true}),{code:'DEPENDENCY_COORDINATION_OWNER_ALIVE'});return {valid:true,results:[]};
  }});assert.equal(result.outcome,'committed');assert.ok(preflight>0);assert.ok(beforeCommit>0);
  assert.deepEqual(f.global.state().dependencyIndex,before.dependencyIndex);assert.deepEqual(fs.readFileSync(f.project.statePath),project);
  assert.match(fs.readFileSync(f.global.rules,'utf8'),/Updated global rules/);assert.equal(f.inspect().projects[0].verification,'consistent');f.global.preserved();f.project.preserved();
});

test('a pinned global revision cannot be replaced through a forged positive global review',t=>{
  const {f,input}=fixture(t,{assetId:'review'}),before=fs.readFileSync(f.global.statePath),plan=planGlobalDependencyMutation(input);
  assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.code==='GLOBAL_REVISION_IN_USE'));
  const forged={...plan,automatic:true,blocked:[]};assert.throws(()=>executeGlobalDependencyMutation({...input,plan:forged}));
  assert.deepEqual(fs.readFileSync(f.global.statePath),before);assert.equal(fs.existsSync(f.global.statePath+'.lock'),false);f.global.preserved();f.project.preserved();
});

test('missing registered project evidence blocks an otherwise unrelated global mutation',t=>{
  const {f,input}=fixture(t);fs.renameSync(f.project.statePath,f.project.statePath+'.retained');const before=fs.readFileSync(f.global.statePath),plan=planGlobalDependencyMutation(input);
  assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.code==='DEPENDENT_PROJECT_REVIEW_REQUIRED'));assert.deepEqual(fs.readFileSync(f.global.statePath),before);f.global.preserved();f.project.preserved();
});

test('a native configuration change requires a reviewed context transition even when its MCP asset is not pinned',t=>{
  const {f,input}=fixture(t,{assetId:'docs'}),before=fs.readFileSync(f.global.mcp),plan=planGlobalDependencyMutation(input);
  assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.code==='DEPENDENCY_NATIVE_CONTEXT_TRANSITION_REQUIRED'));
  assert.deepEqual(fs.readFileSync(f.global.mcp),before);f.global.preserved();f.project.preserved();
});

test('a project edited during global validation is preserved while the unrelated client change rolls back',t=>{
  const {f,input}=fixture(t),before=fs.readFileSync(f.global.rules),state=fs.readFileSync(f.global.statePath),target=f.consumer.proofs[0].target;
  assert.throws(()=>executeGlobalDependencyMutation({...input,plan:planGlobalDependencyMutation(input),validate:()=>{fs.appendFileSync(target,'\nManual project change\n');return {valid:true,results:[]};}}),{code:'DEPENDENT_PROJECT_REVIEW_REQUIRED'});
  assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.deepEqual(fs.readFileSync(f.global.statePath),state);assert.match(fs.readFileSync(target,'utf8'),/Manual project change/);f.global.preserved();f.project.preserved();
});

for(const phase of ['before-state','after-state'])test(`global recovery ${phase} preserves the registered index and project state`,t=>{
  const {f,input}=fixture(t),before=fs.readFileSync(f.global.rules),index=structuredClone(f.global.state().dependencyIndex),project=fs.readFileSync(f.project.statePath);
  const crashed=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-mutation.js'),JSON.stringify({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir,phase})],{encoding:'utf8'});
  assert.equal(crashed.signal,'SIGKILL',crashed.stderr);const plan=planGlobalDependencyRecovery(input);
  assert.equal(applyGlobalDependencyRecovery({...input,plan}).outcome,phase==='before-state'?'restored':'committed');
  if(phase==='before-state')assert.deepEqual(fs.readFileSync(f.global.rules),before);else assert.match(fs.readFileSync(f.global.rules,'utf8'),/Updated global rules/);
  assert.deepEqual(f.global.state().dependencyIndex,index);assert.deepEqual(fs.readFileSync(f.project.statePath),project);assert.equal(f.inspect().projects[0].verification,'consistent');f.global.preserved();f.project.preserved();
});

test('global recovery preserves a manual permission change on an unrelated target',t=>{
  const {f,input}=fixture(t),crashed=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-mutation.js'),JSON.stringify({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir,phase:'before-state'})],{encoding:'utf8'});
  assert.equal(crashed.signal,'SIGKILL',crashed.stderr);fs.chmodSync(f.global.rules,0o600);
  assert.throws(()=>planGlobalDependencyRecovery(input),{code:'RECOVERY_TARGET_CONFLICT'});assert.equal(fs.statSync(f.global.rules).mode&0o777,0o600);f.global.preserved();f.project.preserved();
});

test('a recorded failed global owner permits reviewed recovery in the still-running host',t=>{
  const {f,input}=fixture(t),before=fs.readFileSync(f.global.rules);
  assert.throws(()=>executeGlobalDependencyMutation({...input,plan:planGlobalDependencyMutation(input),validate:()=>{fs.chmodSync(f.global.rules,0o600);return {valid:true,results:[]};}}),{code:'NATIVE_DEPLOYMENT_RECOVERY_REQUIRED'});
  assert.throws(()=>planGlobalDependencyRecovery(input),{code:'RECOVERY_TARGET_CONFLICT'});fs.chmodSync(f.global.rules,0o640);
  assert.equal(applyGlobalDependencyRecovery({...input,plan:planGlobalDependencyRecovery(input)}).outcome,'restored');assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.equal(f.inspect().projects[0].verification,'consistent');f.global.preserved();f.project.preserved();
});

test('a second interruption during global recovery retains its guard and can be reviewed and resumed',t=>{
  const {f,input}=fixture(t),before=fs.readFileSync(f.global.rules),serialized={homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir};
  const run=phase=>spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-mutation.js'),JSON.stringify({...serialized,phase})],{encoding:'utf8'});
  assert.equal(run('before-state').signal,'SIGKILL');assert.equal(run('during-recovery').signal,'SIGKILL');
  assert.equal(applyGlobalDependencyRecovery({...input,plan:planGlobalDependencyRecovery(input)}).outcome,'restored');assert.deepEqual(fs.readFileSync(f.global.rules),before);
  assert.ok(fs.readdirSync(path.dirname(f.global.statePath)).some(name=>name.startsWith('state.json.recovery.lock.abandoned-')));assert.equal(f.inspect().projects[0].verification,'consistent');f.global.preserved();f.project.preserved();
});

test('global recovery refuses a changed native context and preserves that manual configuration',t=>{
  const {f,input}=fixture(t),crashed=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-mutation.js'),JSON.stringify({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir,phase:'before-state'})],{encoding:'utf8'});
  assert.equal(crashed.signal,'SIGKILL',crashed.stderr);fs.appendFileSync(f.global.mcp,'\n# Manual native context change\n');const changed=fs.readFileSync(f.global.mcp);
  assert.throws(()=>planGlobalDependencyRecovery(input),{code:'GLOBAL_DEPENDENCY_CONTEXT_CHANGED'});assert.deepEqual(fs.readFileSync(f.global.mcp),changed);f.global.preserved();f.project.preserved();
});

test('new unrelated files recover only the exact file created by the reviewed transaction',t=>{
  const {f,input,compiled}=fixture(t,{assetId:'extra-agent'}),target=compiled.plans.flatMap(plan=>plan.operations).find(operation=>operation.assetId==='extra-agent').target;
  const crashed=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-mutation.js'),JSON.stringify({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir,phase:'before-state'})],{encoding:'utf8'});
  assert.equal(crashed.signal,'SIGKILL',crashed.stderr);const content=fs.readFileSync(target);fs.renameSync(target,target+'.retained');fs.writeFileSync(target,content,{mode:0o644});
  assert.throws(()=>planGlobalDependencyRecovery(input),{code:'RECOVERY_TARGET_CONFLICT'});assert.deepEqual(fs.readFileSync(target),content);f.global.preserved();f.project.preserved();
});

for(const phase of ['before-state','after-state'])test(`global snapshot recovery ${phase} preserves MCP pins and every project record`,t=>{
  const {f,input,compiled}=fixture(t,{assetId:'review',snapshot:true}),target=compiled.plans.flatMap(plan=>plan.operations).find(operation=>operation.assetId==='review').target,link=fs.readlinkSync(target),project=fs.readFileSync(f.project.statePath),index=structuredClone(f.global.state().dependencyIndex);
  const crashed=spawnSync(process.execPath,[path.resolve('test/helpers/crash-global-dependency-mutation.js'),JSON.stringify({homeDir:f.global.homeDir,kitRoot:f.global.kitRoot,definitionsDir:f.global.definitionsDir,phase})],{encoding:'utf8'});
  assert.equal(crashed.signal,'SIGKILL',crashed.stderr);assert.equal(applyGlobalDependencyRecovery({...input,plan:planGlobalDependencyRecovery(input)}).outcome,phase==='before-state'?'restored':'committed');
  if(phase==='before-state')assert.equal(fs.readlinkSync(target),link);else assert.notEqual(fs.readlinkSync(target),link);
  assert.deepEqual(fs.readFileSync(f.project.statePath),project);assert.deepEqual(f.global.state().dependencyIndex,index);assert.equal(f.inspect().projects[0].verification,'consistent');f.global.preserved();f.project.preserved();
});

test('an unchanged native MCP origin retains its original name and baseline across an unrelated global change',t=>{
  const dependent=dependencyIndexFixture(t),native=nativeInstallationFixture(t,{kind:'mcpServers',scope:'global',assetId:'docs-alias',canonicalKitLayout:true});
  writeProfileFixture({definitionsDir:native.definitionsDir,repositoryRoot:path.resolve('.'),clientId:'codex',capabilityIds:['mcp-global','instructions-global']});native.apply('adopt');
  const state=JSON.parse(fs.readFileSync(native.statePath)),receipt=latestInstallationReceipts(state).find(receipt=>receipt.assetId==='docs-alias'),registration=structuredClone(dependent.registration);
  const pin={...Object.fromEntries(['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)};pin.id=dependencyPrerequisiteId(pin);
  registration.prerequisites=[pin];registration.consumers[0].prerequisiteIds=[pin.id];state.schemaVersion=8;state.dependencyIndex={schemaVersion:1,generation:1,projects:[registration]};fs.writeFileSync(native.statePath,JSON.stringify(state));
  const project=dependent.project.state();project.dependencyRegistration=registration;fs.writeFileSync(dependent.project.statePath,JSON.stringify(project));
  const file=path.join(native.scopeRoot,'agent-kit.yaml'),raw=parse(fs.readFileSync(file,'utf8'));raw.schemaVersion=3;raw.targets={codex:{assetIds:['rules']}};raw.assets.instructions=[{id:'rules',scope:'global',source:'rules.md',definition:{schemaVersion:1,format:'markdown'}}];
  fs.writeFileSync(path.join(native.scopeRoot,'rules.md'),'# Global native rules\n');fs.writeFileSync(file,stringify(raw));fs.mkdirSync(path.join(native.definitionsDir,'native-prerequisites'));fs.copyFileSync(path.resolve('clients/native-prerequisites/codex-cli.yaml'),path.join(native.definitionsDir,'native-prerequisites/codex-cli.yaml'));
  const compiled=compileScopedDeployment({kitRoot:native.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:native.homeDir,definitions:loadClientDefinitions({definitionsDir:native.definitionsDir})});for(const plan of compiled.plans)plan.blocked=plan.blocked.filter(block=>block.reason!=='SCOPED_DEPLOYMENT_NOT_ENABLED');
  const options={globalStore:compiled.stateStore,plans:compiled.plans,definitionsDir:native.definitionsDir,backupStore:new DeploymentBackupStore({backupsRoot:path.join(native.homeDir,'.agents-kit/deployments/_global/backups')})},before=fs.readFileSync(native.primary),projectBefore=fs.readFileSync(dependent.project.statePath),plan=planGlobalDependencyMutation(options);
  assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.equal(executeGlobalDependencyMutation({...options,plan}).outcome,'committed');assert.deepEqual(fs.readFileSync(native.primary),before);assert.deepEqual(fs.readFileSync(dependent.project.statePath),projectBefore);
  const after=latestInstallationReceipts(compiled.stateStore.load()).find(receipt=>receipt.assetId==='docs-alias');assert.equal(after.locator.nativeId,'review');assert.equal(after.revisionDigest,receipt.revisionDigest);assert.equal(inspectDependencyDependents({homeDir:native.homeDir}).projects[0].verification,'consistent');dependent.global.preserved();dependent.project.preserved();
});

test('native context checks cannot borrow another installation of the same asset under a newer client definition',t=>{
  const {f,input}=fixture(t),definitionPath=path.join(f.global.definitionsDir,'codex.yaml'),definition=parse(fs.readFileSync(definitionPath,'utf8'));definition.displayName+=' edited';fs.writeFileSync(definitionPath,stringify(definition));
  const current=loadClientDefinitions({definitionsDir:f.global.definitionsDir}),old=f.globalReceipt,{schemaVersion,revisionDigest,proofs,directories,dependencySnapshot,...descriptor}=old;
  descriptor.locator={...old.locator,targetBase:path.join(f.global.homeDir,'.agents/alternate/review'),pathTemplate:'~/.agents/alternate/{assetId}',definitionDigest:canonicalDigest(current.get('codex'))};
  const duplicate=createInstallationReceipt(descriptor,{directories,dependencySnapshot,proofs:proofs.map(proof=>({...proof,target:path.join(descriptor.locator.targetBase,path.relative(old.locator.targetBase,proof.target))}))}),state=f.global.state();
  state.transactions.push({id:'tx-other-layout',type:'apply',status:'committed',operations:[],installationReceipts:[duplicate]});fs.writeFileSync(f.global.statePath,JSON.stringify(state));
  const compiled=compileScopedDeployment({kitRoot:f.global.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.global.homeDir,definitions:current});for(const plan of compiled.plans)plan.blocked=plan.blocked.filter(block=>block.reason!=='SCOPED_DEPLOYMENT_NOT_ENABLED');
  const plan=planGlobalDependencyMutation({...input,plans:compiled.plans,globalStore:compiled.stateStore});assert.equal(plan.automatic,false);assert.ok(plan.blocked.some(block=>block.code==='NATIVE_PREREQUISITE_PROFILE_UNVERIFIED'));f.global.preserved();f.project.preserved();
});

test('an unowned second layout cannot hide the exact pinned installation in the global impact prediction',t=>{
  const {f,input}=fixture(t),old=f.globalReceipt,{schemaVersion,revisionDigest,proofs,directories,dependencySnapshot,...descriptor}=old;
  descriptor.locator={...old.locator,targetBase:path.join(f.global.homeDir,'.agents/alternate/review'),pathTemplate:'~/.agents/alternate/{assetId}'};
  const duplicate=createInstallationReceipt(descriptor,{directories,dependencySnapshot,proofs:proofs.map(proof=>({...proof,target:path.join(descriptor.locator.targetBase,path.relative(old.locator.targetBase,proof.target))}))}),state=f.global.state();
  state.transactions.push({id:'tx-unowned-layout',type:'apply',status:'committed',operations:[],installationReceipts:[duplicate]});fs.writeFileSync(f.global.statePath,JSON.stringify(state));
  const compiled=compileScopedDeployment({kitRoot:f.global.kitRoot,scope:'global',clientId:'codex',surface:'cli',clientVersion:'0.0.1-test',homeDir:f.global.homeDir,definitions:loadClientDefinitions({definitionsDir:f.global.definitionsDir})});for(const plan of compiled.plans)plan.blocked=plan.blocked.filter(block=>block.reason!=='SCOPED_DEPLOYMENT_NOT_ENABLED');
  const plan=planGlobalDependencyMutation({...input,plans:compiled.plans,globalStore:compiled.stateStore});assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));f.global.preserved();f.project.preserved();
});

test('global impact planning rejects a prepared plan after the ownership ledger has changed',t=>{
  const {f,input}=fixture(t),state=f.global.state();state.transactions.push({id:'tx-external-audit',type:'apply',status:'committed',operations:[]});fs.writeFileSync(f.global.statePath,JSON.stringify(state));
  const before=fs.readFileSync(f.global.rules);assert.throws(()=>planGlobalDependencyMutation(input),{code:'STALE_DEPLOYMENT_STATE'});assert.deepEqual(fs.readFileSync(f.global.rules),before);assert.equal(fs.existsSync(f.global.statePath+'.lock'),false);f.global.preserved();f.project.preserved();
});
