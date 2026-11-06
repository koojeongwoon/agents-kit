import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {parse, stringify} from 'yaml';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';
import {createNativePrerequisiteService} from '../../lib/application/native-prerequisite-service.js';
import {GlobalDeploymentStateStore} from '../../lib/infrastructure/global-deployment-state-store.js';
import {latestInstallationReceipts} from '../../lib/application/installation-receipt-service.js';
import {installationDigest} from '../../lib/domain/installation-receipt.js';
import {installedBindingDigest,dependencyPrerequisiteId} from '../../lib/domain/dependency-reverse-index.js';
import {compileScopedDeployment} from '../../lib/application/scoped-deployment-compiler.js';
import {loadClientDefinitions} from '../../lib/infrastructure/client-definition-loader.js';
import {applyDeployment,applyDeploymentAsync} from '../../lib/application/apply-deployment.js';
import {DeploymentBackupStore} from '../../lib/infrastructure/deployment-backup-store.js';
import {planDependencyCoordination,executeDependencyCoordination,executeDependencyCoordinationAsync} from '../../lib/application/dependency-coordination-service.js';
import {prepareResourceRemoval} from '../../lib/application/prepare-resource-removal.js';
import {prepareDeploymentCommand} from '../../lib/application/deployment-command.js';
import {deploymentStateHash} from '../../lib/application/shared-resource-deployment.js';
import {selectClientSurface} from '../../lib/domain/client-definition.js';
import {readPathImage,imageFingerprint} from '../../lib/infrastructure/path-image.js';

// Opt-in isolated native probe. It never uses the user's HOME or starts a model.
const {values}=parseArgs({options:{binary:{type:'string'},'scoped-receipts':{type:'boolean',default:false},'context-transition':{type:'boolean',default:false},'public-cli':{type:'boolean',default:false},'scoped-rollback':{type:'boolean',default:false}}});
if(!values.binary||!path.isAbsolute(values.binary))throw new Error('An explicit absolute --binary is required');
if(values['scoped-rollback']&&(!values['public-cli']||!values['scoped-receipts']))throw new Error('--scoped-rollback requires --public-cli and --scoped-receipts');
const repository=path.resolve(import.meta.dirname,'../..'),binaryPath=fs.realpathSync(values.binary),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const binarySha256=sha(fs.readFileSync(binaryPath)),protocol=parse(fs.readFileSync(path.join(repository,'clients/native-prerequisites/codex-cli.yaml'),'utf8'));
const evidence=protocol.evidence.find(record=>record.binarySha256===binarySha256&&record.platform===process.platform&&record.arch===process.arch);
assert.ok(evidence,'The binary must match reviewed prerequisite protocol evidence');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-pr10-native-proof-'))),homeDir=path.join(root,'home'),projectRoot=path.join(root,'project'),scopeRoot=path.join(root,'kit/global'),serverScript=path.join(root,'fixture.cjs');
const selectedEvents=path.join(root,'selected.jsonl'),unrelatedEvents=path.join(root,'unrelated.jsonl'),events=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
try {
  for(const directory of [path.join(homeDir,'.codex'),path.join(homeDir,'.agents/skills'),path.join(projectRoot,'.git'),path.join(scopeRoot,'review'),path.join(root,'external/ego')])fs.mkdirSync(directory,{recursive:true});
  const projectConfig=path.join(projectRoot,'.codex/config.toml'),projectInitial='# Existing fixture project configuration\n';
  if(values['context-transition']||values['public-cli']){fs.mkdirSync(path.dirname(projectConfig),{recursive:true});fs.writeFileSync(projectConfig,projectInitial,{mode:0o640});}
  fs.writeFileSync(serverScript,`const fs=require('node:fs'),readline=require('node:readline');const file=process.argv[2],send=value=>process.stdout.write(JSON.stringify(value)+'\\n');fs.appendFileSync(file,JSON.stringify({event:'started'})+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);fs.appendFileSync(file,JSON.stringify({method:request.method})+'\\n');if(request.id==null)return;
if(request.method==='initialize')send({jsonrpc:'2.0',id:request.id,result:{protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'kit-fixture',version:'1.0.0'}}});
else if(request.method==='tools/list')send({jsonrpc:'2.0',id:request.id,result:{tools:[{name:'search_repository',description:'Fixture only',inputSchema:{type:'object',properties:{}}}]}});
else send({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Fixture permits no tool calls'}});});\n`);
  const initialConfig='# Existing fixture settings\nmodel = "fixture-no-model-call"\n\n[mcp_servers.unrelated]\ncommand = '+JSON.stringify(process.execPath)+'\nargs = '+JSON.stringify([serverScript,unrelatedEvents])+'\n';
  const config=path.join(homeDir,'.codex/config.toml');fs.writeFileSync(config,initialConfig,{mode:0o640});
  fs.writeFileSync(path.join(root,'external/ego/SKILL.md'),'---\nname: ego-browser\ndescription: External fixture\n---\nExternally managed.\n');
  const external=path.join(homeDir,'.agents/skills/ego-browser');fs.symlinkSync(path.join(root,'external/ego'),external);const linkBefore=fs.lstatSync(external),linkText=fs.readlinkSync(external);
  fs.writeFileSync(path.join(scopeRoot,'review/SKILL.md'),'---\nname: review\ndescription: Review fixture sources\n---\nUse repository search when needed.\n');
  const manifest={schemaVersion:1,kit:{id:'native-prerequisite-fixture'},defaults:{mcpBindings:{schemaVersion:1,executables:{node:{command:process.execPath}}}},assets:{
    skills:[{id:'review',scope:'global',source:'review',definition:{schemaVersion:1,format:'agent-skills'},requires:{tools:[{id:'repository.search',providerId:'docs',capability:'repository.read'}]}}],
    mcpServers:[{id:'docs',scope:'global',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:[serverScript,selectedEvents]},provides:{tools:[{id:'repository.search',nativeName:'search_repository'}]}}]}};
  fs.writeFileSync(path.join(scopeRoot,'agent-kit.yaml'),stringify(manifest));
  const binaryObserver=()=>({binaryPath,sha256:sha(fs.readFileSync(binaryPath))}),deployments=createManifestDeploymentService({homeDir,definitionsDir:path.join(repository,'clients'),binaryObserver}),
    planned=deployments.plan({scopeRoot,targetRoot:homeDir,scope:'global',clientId:'codex',surface:'cli',clientVersion:evidence.version});
  assert.equal(planned.automatic,true,JSON.stringify(planned.blocked));const applied=deployments.apply({planId:planned.planId});
  const store=new GlobalDeploymentStateStore({homeDir});let scopedMetadataAudit;
  if(values['scoped-receipts']) {
    const before=Object.fromEntries(Object.keys(store.load().managed).map(file=>[file,{bytes:fs.readFileSync(file),mode:fs.statSync(file).mode&0o777}]));
    manifest.schemaVersion=3;manifest.management={schemaVersion:1,resources:{}};fs.writeFileSync(path.join(scopeRoot,'agent-kit.yaml'),stringify(manifest));
    const compiled=compileScopedDeployment({kitRoot:path.join(root,'kit'),scope:'global',clientId:'codex',surface:'cli',clientVersion:evidence.version,homeDir,definitions:loadClientDefinitions({definitionsDir:path.join(repository,'clients')}),binaryObserver});
    assert.ok(compiled.review.blocked.every(block=>block.reason==='SCOPED_DEPLOYMENT_NOT_ENABLED'),JSON.stringify(compiled.review.blocked));
    assert.ok(compiled.plans.flatMap(plan=>plan.operations).every(operation=>operation.operation==='SKIP'||operation.metadataOnly));
    // The public CLI mode uses the actual dispatcher. Historical internal modes
    // remove only the generic execution gate in their isolated fixture.
    if(values['public-cli']){const reviewed=deployments.plan({scopeRoot,targetRoot:homeDir,scope:'global',clientId:'codex',surface:'cli',clientVersion:evidence.version});assert.equal(reviewed.execution.status,'ready');await deployments.apply({planId:reviewed.planId});}
    else applyDeployment({plans:compiled.plans.map(plan=>({...plan,blocked:[]})),stateStore:compiled.stateStore,backupStore:new DeploymentBackupStore({backupsRoot:store.backupsRoot})});
    for(const [file,image] of Object.entries(before)){assert.deepEqual(fs.readFileSync(file),image.bytes);assert.equal(fs.statSync(file).mode&0o777,image.mode);}
    assert.ok(latestInstallationReceipts(store.load()).every(receipt=>receipt.schemaVersion===4));scopedMetadataAudit={isolated:true,metadataOnly:true,receiptSchemaVersion:4,clientBytesAndModesUnchanged:true};
  }
  const receipts=latestInstallationReceipts(store.load()),pins=receipts.map(receipt=>{
    const pin={...Object.fromEntries(['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)};return {...pin,id:dependencyPrerequisiteId(pin)};
  });
  const project={kitId:'native-prerequisite-fixture',projectName:'default',sourceRoot:path.join(root,'kit/projects/default'),targetRoot:projectRoot},stateBefore=fs.readFileSync(store.statePath),configBefore=fs.readFileSync(config),configMode=fs.statSync(config).mode&0o777;
  const prerequisites=createNativePrerequisiteService({homeDir,definitionsDir:path.join(repository,'clients'),binaryObserver}),request={globalStore:store,project,prerequisites:pins};
  if(values['public-cli']) {
    fs.mkdirSync(project.sourceRoot,{recursive:true});const localEvents=path.join(root,'public-local.jsonl'),localId='local-fixture',reference={schemaVersion:1,kitId:manifest.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'};
    fs.writeFileSync(path.join(project.sourceRoot,'agent-kit.yaml'),stringify({schemaVersion:3,kit:{id:project.kitId},management:{schemaVersion:1,resources:{}},defaults:manifest.defaults,targets:{codex:{assetIds:['reviewer',localId]}},assets:{
      agents:[{id:'reviewer',scope:'project',dependsOn:{skills:[reference]},definition:{schemaVersion:1,description:'Fixture reviewer',instructions:'Review using installed prerequisites.',permissions:'client-default'}}],
      mcpServers:[{id:localId,scope:'project',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:[serverScript,localEvents]}}]}}));
    const run=args=>{const result=spawnSync(process.execPath,[path.join(repository,'bin/cli.js'),...args],{encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,env:{...process.env,HOME:homeDir,CODEX_HOME:path.join(homeDir,'.codex'),AGENTS_KIT_DIR:'',PATH:path.dirname(binaryPath)+path.delimiter+(process.env.PATH||'')}});assert.equal(result.status,0,result.stderr||result.error?.code);return result.stdout;};
    const common=['--kit',path.join(root,'kit'),'--project',projectRoot,'--client','codex','--surface','cli','--client-version',evidence.version];
    const dry=JSON.parse(run(['apply',...common,'--dry-run']));assert.equal(dry.execution.status,'requires-observation');assert.deepEqual(events(selectedEvents),[]);
    run(['apply',...common,'--observe-prerequisites','--discover-providers','--save-plan']);
    assert.deepEqual(fs.readFileSync(store.statePath),stateBefore);assert.deepEqual(fs.readFileSync(config),configBefore);assert.equal(fs.readFileSync(projectConfig,'utf8'),projectInitial);
    const plansRoot=path.join(root,'kit/.deployment-plans'),saved=JSON.parse(fs.readFileSync(path.join(plansRoot,fs.readdirSync(plansRoot).find(name=>name.endsWith('.json')))));assert.equal(saved.body.schemaVersion,5);
    const resume=['resume','--kit',path.join(root,'kit'),'--plan',saved.body.id,'--digest',saved.digest],result=JSON.parse(run(resume));assert.equal(result.outcome,'committed');assert.equal(result.nativePrerequisitesState,'verified-at-apply');
    const projectState=path.join(projectRoot,'.agent-kit/state.json');assert.equal(JSON.parse(fs.readFileSync(projectState)).dependencyRegistration.status,'active');
    const afterEvents=events(selectedEvents).length;assert.deepEqual(JSON.parse(run(resume)),result);assert.equal(events(selectedEvents).length,afterEvents);
    run(['remove',...common,'--assets','reviewer,'+localId]);assert.equal(JSON.parse(fs.readFileSync(projectState)).dependencyRegistration.status,'released');assert.deepEqual(store.load().dependencyIndex.projects,[]);
    if(values['scoped-rollback']) {
      const removed=JSON.parse(fs.readFileSync(projectState)).transactions.at(-1),rollback=['rollback',...common,'--transaction',removed.id],dryRollback=JSON.parse(run([...rollback,'--dry-run']));
      assert.equal(dryRollback.execution.status,'requires-observation');assert.equal(dryRollback.dependencyTransition.action,'rollback');
      run([...rollback,'--observe-prerequisites','--discover-providers','--save-plan']);assert.equal(fs.readFileSync(projectConfig,'utf8'),projectInitial);
      const savedRollback=fs.readdirSync(plansRoot).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(plansRoot,name)))).find(record=>record.body.kind==='rollback');assert.equal(savedRollback.body.schemaVersion,5);
      const resumeRollback=['resume','--kit',path.join(root,'kit'),'--plan',savedRollback.body.id,'--digest',savedRollback.digest],restored=JSON.parse(run(resumeRollback));assert.equal(restored.outcome,'committed');assert.equal(restored.rolledBackTransactionId,removed.id);assert.equal(JSON.parse(fs.readFileSync(projectState)).dependencyRegistration.status,'active');
      const count=events(selectedEvents).length;assert.deepEqual(JSON.parse(run(resumeRollback)),restored);assert.equal(events(selectedEvents).length,count);
      const initialRollback=['rollback',...common,'--transaction',result.transactionId],release=JSON.parse(run([...initialRollback,'--dry-run']));assert.equal(release.execution.status,'ready');assert.equal(release.dependencyTransition.releasedConsumers.length,1);
      run(initialRollback);assert.equal(events(selectedEvents).length,count);assert.equal(JSON.parse(fs.readFileSync(projectState)).dependencyRegistration.status,'released');assert.deepEqual(store.load().dependencyIndex.projects,[]);
    }
    assert.equal(fs.readFileSync(projectConfig,'utf8'),projectInitial);assert.equal(fs.statSync(projectConfig).mode&0o777,0o640);assert.equal(fs.existsSync(path.join(projectRoot,'.codex/agents/reviewer.toml')),false);assert.deepEqual(fs.readFileSync(config),configBefore);
    const nativeObservationCalls=values['scoped-rollback']?6:3;
    assert.deepEqual(events(localEvents),[]);assert.deepEqual(events(unrelatedEvents),[]);assert.ok(events(selectedEvents).every(event=>event.method!=='tools/call'));assert.equal(events(selectedEvents).filter(event=>event.method==='tools/list').length,nativeObservationCalls);
    deployments.rollback({planId:deployments.planRollback({transactionId:applied.transactionId,scope:'global',targetRoot:homeDir,clientId:'codex'}).planId});
    assert.equal(fs.readFileSync(config,'utf8'),initialConfig);assert.equal(fs.lstatSync(external).ino,linkBefore.ino);assert.equal(fs.lstatSync(external).mtimeMs,linkBefore.mtimeMs);assert.equal(fs.readlinkSync(external),linkText);
    process.stdout.write(JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),phase:'scoped-public-cli-deployment',binarySha256,version:evidence.version,isolatedHome:true,actualUserConfigWrites:0,actualUserStateWrites:0,
      publicGlobalV3Audit:true,publicProjectV3Apply:true,privateExecutionGateRemoved:false,savedPlanSchemaVersion:5,savedRestartNativeObservation:true,savedResumeIdempotent:true,registrationActivatedAndReleased:true,
      ...(values['scoped-rollback']?{publicScopedRollback:true,rollbackSavedPlanSchemaVersion:5,rollbackSavedRestartNativeObservation:true,rollbackResumeIdempotent:true,rollbackRestoresFrozenClosure:true,initialRollbackReleasesRegistration:true}:{}),
      projectSettingsByteExact:true,projectModeRestored:true,globalSettingsByteExact:true,externalLinkIdentityPreserved:true,nativeObservationCalls,unselectedProviderStarts:0,selectedEvents:events(selectedEvents),consumerActivationState:'unverified',fulfilled:false,modelRequests:0,threadRequests:0,toolCalls:0},null,2)+'\n');
  }else {
  if(!values['context-transition']){const metadata=await prerequisites.observe(request);assert.equal(metadata.status,'unverified',JSON.stringify(metadata));}
  assert.deepEqual(events(selectedEvents),[]);assert.deepEqual(events(unrelatedEvents),[]);
  const observation=await prerequisites.observe({...request,observeProviders:true});assert.equal(observation.status,'observed',JSON.stringify(observation));
  const verify=prerequisites.verifier({observationId:observation.observationId});assert.equal(verify({project,prerequisites:pins}).verified,true);
  assert.deepEqual(fs.readFileSync(store.statePath),stateBefore);assert.deepEqual(fs.readFileSync(config),configBefore);assert.equal(fs.statSync(config).mode&0o777,configMode);
  const selected=events(selectedEvents);assert.ok(selected.some(event=>event.method==='tools/list'));assert.ok(selected.every(event=>event.method!=='tools/call'));assert.deepEqual(events(unrelatedEvents),[]);
  let contextTransition;
  if(values['context-transition']) {
    fs.mkdirSync(project.sourceRoot,{recursive:true});
    const reference={schemaVersion:1,kitId:manifest.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'},localEvents=path.join(root,'local.jsonl'),localId='local-fixture';
    const projectManifest={schemaVersion:3,kit:{id:project.kitId},management:{schemaVersion:1,resources:{}},defaults:manifest.defaults,targets:{codex:{assetIds:['reviewer',localId]}},assets:{
      agents:[{id:'reviewer',scope:'project',dependsOn:{skills:[reference]},definition:{schemaVersion:1,description:'Fixture reviewer',instructions:'Review the selected repository using its installed prerequisites.',permissions:'client-default'}}],
      mcpServers:[{id:localId,scope:'project',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:[serverScript,localEvents]}}]}};
    fs.writeFileSync(path.join(project.sourceRoot,'agent-kit.yaml'),stringify(projectManifest));
    const definitions=loadClientDefinitions({definitionsDir:path.join(repository,'clients')}),compiled=compileScopedDeployment({kitRoot:path.join(root,'kit'),projectName:'default',projectPath:projectRoot,clientId:'codex',surface:'cli',clientVersion:evidence.version,homeDir,definitions,binaryObserver});
    assert.ok(compiled.prediction,JSON.stringify(compiled.review.blocked));assert.ok(compiled.review.blocked.every(block=>['SCOPED_DEPLOYMENT_NOT_ENABLED','DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'].includes(block.reason)),JSON.stringify(compiled.review.blocked));
    const transition=prerequisites.prepareTransition({observationId:observation.observationId,targets:compiled.targets}),transitionVerifier=prerequisites.transitionVerifier(transition);
    const coordination={globalStore:compiled.globalStore,projectStore:compiled.stateStore,project,transactionId:'tx-native-transition-project',upsertConsumers:compiled.prediction.consumers,prerequisites:compiled.prerequisites,releaseConsumerIds:[],targets:compiled.targets,verifyPrerequisites:transitionVerifier};
    const review=planDependencyCoordination(coordination);assert.deepEqual(review.blocked,[]);
    // Internal integration probe only: preserve every real capability, receipt,
    // ownership and native gate; the public v3 execution gate remains closed.
    for(const plan of compiled.plans)plan.blocked=plan.blocked.filter(block=>['SCOPED_DEPLOYMENT_NOT_ENABLED','DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'].includes(block.reason)===false);
    let after;
    const projectBackupStore=new DeploymentBackupStore({backupsRoot:path.join(projectRoot,'.agent-kit/backups')}),committed=await executeDependencyCoordinationAsync({...coordination,plan:review,
      executeProject:context=>applyDeploymentAsync({plans:compiled.plans,stateStore:context.projectStore,backupStore:projectBackupStore,createTransactionId:()=>context.transactionId,
        validate:async()=>{after=await prerequisites.observeTransition(transition);return {valid:after.status==='observed'};}})});
    assert.equal(committed.outcome,'committed');assert.equal(after.status,'observed',JSON.stringify(after));assert.equal(transitionVerifier({project,prerequisites:pins,stage:'after'}).verified,true);
    assert.equal(verify({project,prerequisites:pins}).verified,false);assert.equal(compiled.stateStore.load().dependencyRegistration.status,'active');assert.deepEqual(fs.readFileSync(config),configBefore);
    assert.deepEqual(events(localEvents),[]);assert.deepEqual(events(unrelatedEvents),[]);
    const state=compiled.stateStore.load(),profile=selectClientSurface(definitions.get('codex'),'cli'),removal=prepareResourceRemoval({state,targetRoot:projectRoot,kitId:project.kitId,clientId:'codex',profile,assetIds:['reviewer',localId],backupStore:projectBackupStore});assert.deepEqual(removal.blocked,[]);
    const commands=removal.operations.map(operation=>prepareDeploymentCommand({operation,state,plans:[removal],authorizedRoot:projectRoot,beforeImage:readPathImage(operation.target,{authorizedRoot:projectRoot})}));
    const release={...coordination,transactionId:'tx-native-transition-release',upsertConsumers:[],prerequisites:[],releaseConsumerIds:['reviewer'],targets:commands.map(command=>({target:command.target,before:imageFingerprint(command.beforeImage),after:imageFingerprint(command.afterImage)}))};
    const removed=executeDependencyCoordination({...release,plan:planDependencyCoordination(release),executeProject:context=>applyDeployment({plans:[{...removal,clientId:'codex',intent:'remove',stateHash:deploymentStateHash(state)}],stateStore:context.projectStore,backupStore:projectBackupStore,createTransactionId:()=>context.transactionId})});
    assert.equal(removed.outcome,'committed');assert.equal(compiled.stateStore.load().dependencyRegistration.status,'released');assert.deepEqual(compiled.globalStore.load().dependencyIndex.projects,[]);
    const restoredProject=fs.readFileSync(projectConfig,'utf8');assert.equal(restoredProject,projectInitial);assert.equal(fs.statSync(projectConfig).mode&0o777,0o640);assert.equal(fs.existsSync(path.join(projectRoot,'.codex/agents/reviewer.toml')),false);
    contextTransition={internalOnly:true,committed:true,actualNativeReobservation:true,registrationActivatedAndReleased:true,afterChecks:after.checks.map(({assetId,assetKind,status,reason})=>({assetId,assetKind,status,reason})),
      projectUserSettingsAndModePreserved:true,projectRestorationByteExact:restoredProject===projectInitial,globalClientBytesUnchangedByProject:true,localProviderStarted:false,consumerActivationState:'unverified',fulfilled:false};
  }else {fs.mkdirSync(path.dirname(projectConfig),{recursive:true});fs.writeFileSync(projectConfig,'# New project setting\n');assert.equal(verify({project,prerequisites:pins}).verified,false);}
  const rollback=deployments.planRollback({transactionId:applied.transactionId,scope:'global',targetRoot:homeDir,clientId:'codex'});deployments.rollback({planId:rollback.planId});
  assert.equal(fs.readFileSync(config,'utf8'),initialConfig);assert.equal(fs.lstatSync(external).ino,linkBefore.ino);assert.equal(fs.lstatSync(external).mtimeMs,linkBefore.mtimeMs);assert.equal(fs.readlinkSync(external),linkText);
  process.stdout.write(JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),binarySha256,isolatedHome:true,actualUserConfigWrites:0,actualUserStateWrites:0,
    phase:'native-prerequisite-discovery',receiptSchemaVersions:[...new Set(receipts.map(receipt=>receipt.schemaVersion))],...(scopedMetadataAudit?{scopedMetadataAudit}:{}),metadataOnlyChecked:!values['context-transition'],metadataOnlyStartedProviders:false,observation:{status:observation.status,version:observation.version,checks:observation.checks.map(({assetId,assetKind,status,reason,toolUseState,tools,activeThreadState})=>({assetId,assetKind,status,reason,toolUseState,...(tools?{tools}:{}),...(activeThreadState?{activeThreadState}:{})})),fulfilled:observation.fulfilled},
    privateVerifierAccepted:true,projectConfigChangeInvalidated:true,...(contextTransition?{contextTransition}:{}),selectedEvents:events(selectedEvents),unrelatedEvents:events(unrelatedEvents),configurationUnchangedByObservation:true,ledgerUnchangedByObservation:true,rollbackRestoredInitialSettings:true,externalLinkIdentityPreserved:true,modelRequests:0,threadRequests:0,toolCalls:0},null,2)+'\n');
  }
}finally{fs.rmSync(root,{recursive:true,force:true});}
