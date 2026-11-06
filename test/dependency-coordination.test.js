import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {readPathImage,imageFingerprint} from '../lib/infrastructure/path-image.js';
import {dependencyIndexFixture} from './helpers/dependency-index-fixture.js';
import {installationDigest} from '../lib/domain/installation-receipt.js';
import {planDependencyRegistrationChange} from '../lib/domain/dependency-registration-change.js';
import {dependencyRegistrationId,validDependencyRegistration,validDependencyIndex} from '../lib/domain/dependency-reverse-index.js';
import {planDependencyCoordination,executeDependencyCoordination,planDependencyCoordinationRecovery,applyDependencyCoordinationRecovery} from '../lib/application/dependency-coordination-service.js';
import {coordinationFixture,coordinationStores,executeProjectFixture,executeUnreviewedProjectFixture} from './helpers/dependency-coordination-fixture.js';
import {stringify} from 'yaml';
import {applyKitSourceMutation,sourceHash} from '../lib/infrastructure/kit-source-transaction.js';
import {validateManifestDocument} from '../lib/infrastructure/manifest-loader.js';
import {assertSourceDependencyRemovalAllowed} from '../lib/application/source-dependency-guard.js';

test('dependency registration rejects a removed global source even while its old installed receipt is intact',t=>{
  const f=coordinationFixture(t),input=f.request(),before=fs.readFileSync(f.global.statePath);f.global.raw.assets.skills=[];f.global.write();
  assert.throws(()=>planDependencyCoordination(input),{code:'DEPENDENCY_SOURCE_UNAVAILABLE'});assert.deepEqual(fs.readFileSync(f.global.statePath),before);assert.equal(fs.existsSync(input.globalStore.statePath+'.lock'),false);f.global.preserved();f.project.preserved();
  fs.renameSync(f.global.scopeRoot,f.global.scopeRoot+'.retained');assert.throws(()=>planDependencyCoordination(input),{code:'DEPENDENCY_SOURCE_UNAVAILABLE'});assert.deepEqual(fs.readFileSync(f.global.statePath),before);
});

test('a Kit source lock appearing after planning prevents registration before any client or index writes',t=>{
  const f=coordinationFixture(t),input=f.request(),plan=planDependencyCoordination(input),before=fs.readFileSync(f.global.statePath),projectBefore=fs.readFileSync(f.project.statePath),targetBefore=fs.readFileSync(f.target);
  assert.throws(()=>executeDependencyCoordination({...input,plan,executeProject:context=>executeProjectFixture(f,context),onPhase:phase=>{
    if(phase==='global-locked'){const root=path.join(f.global.scopeRoot,'.kit-sources');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'lock'),JSON.stringify({pid:process.pid,token:'fixture-source-lock'}));}
  }}),{code:'SOURCE_MANAGEMENT_LOCKED'});
  assert.deepEqual(fs.readFileSync(f.global.statePath),before);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);assert.deepEqual(fs.readFileSync(f.target),targetBefore);f.global.preserved();f.project.preserved();
});

test('source deletion and project registration reject each other in both lock acquisition orders',t=>{
  const f=coordinationFixture(t),input=f.request(),plan=planDependencyCoordination(input),manifestPath=path.join(f.global.scopeRoot,'agent-kit.yaml'),before=fs.readFileSync(manifestPath),globalBefore=fs.readFileSync(f.global.statePath);
  const after=structuredClone(f.global.raw);after.assets.skills=[];let checked=false;
  const check=()=>assertSourceDependencyRemovalAllowed({homeDir:f.global.homeDir,scopeRoot:f.global.scopeRoot,beforeManifest:validateManifestDocument(f.global.raw),afterManifest:validateManifestDocument(after)});
  applyKitSourceMutation({scopeRoot:f.global.scopeRoot,manifestPath,beforeHash:sourceHash(before),content:stringify(after),revalidate:check,onPhase:phase=>{
    if(phase==='journal'){checked=true;assert.throws(()=>executeDependencyCoordination({...input,plan,executeProject:context=>executeProjectFixture(f,context)}),{code:'SOURCE_MANAGEMENT_RECOVERY_REQUIRED'});}
  }});
  assert.equal(checked,true);assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.throws(()=>executeDependencyCoordination({...input,plan,executeProject:context=>executeProjectFixture(f,context)}),{code:'DEPENDENCY_SOURCE_UNAVAILABLE'});
  fs.writeFileSync(manifestPath,before);
  const deletion=f.global.service.planEdit({scopeRoot:f.global.scopeRoot,mutations:[{type:'delete',kind:'skills',assetId:'review'}]});let refused=false;
  assert.equal(executeDependencyCoordination({...input,plan,executeProject:context=>executeProjectFixture(f,context),onPhase:phase=>{
    if(phase==='global-locked'){assert.throws(()=>f.global.service.applyEdit({planId:deletion.planId}),{code:'GLOBAL_DEPENDENCY_CONTEXT_PENDING'});refused=true;}
  }}).outcome,'committed');
  assert.equal(refused,true);assert.deepEqual(fs.readFileSync(manifestPath),before);f.global.preserved();f.project.preserved();
});

test('a source removed during apply preserves the manual edit, restores client changes and permits reviewed metadata recovery',t=>{
  const f=coordinationFixture(t,{edit:true}),input=f.request(),plan=planDependencyCoordination(input),before=fs.readFileSync(f.target),globalBefore=fs.readFileSync(f.global.statePath),projectBefore=fs.readFileSync(f.project.statePath);
  assert.throws(()=>executeDependencyCoordination({...input,plan,executeProject:context=>executeProjectFixture(f,context),onPhase:phase=>{
    if(phase==='index-reserved'){f.global.raw.assets.skills=[];f.global.write();}
  }}),{code:'DEPENDENCY_SOURCE_UNAVAILABLE'});
  assert.deepEqual(fs.readFileSync(f.target),before);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);
  assert.equal(applyDependencyCoordinationRecovery({...input,plan:planDependencyCoordinationRecovery(input)}).outcome,'restored');
  assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);assert.deepEqual(f.global.raw.assets.skills,[]);f.global.preserved();f.project.preserved();
});

test('registration changes merge consumers without dropping shared pins and finish release with a monotonic tombstone',t=>{
  const f=dependencyIndexFixture(t),project=f.registration.project,consumer=f.registration.consumers[0],pin=f.registration.prerequisites[0];
  const added={...consumer,assetId:'another-consumer'};
  const change=planDependencyRegistrationChange({index:f.index,projectRegistration:f.registration,project,upsertConsumers:[added],prerequisites:[pin],releaseConsumerIds:[],transactionId:'tx-update'});
  assert.equal(change.reservation.status,'reserved');assert.equal(change.afterRegistration.consumers.length,2);assert.equal(change.afterRegistration.prerequisites.length,1);
  assert.equal(change.afterRegistration.indexGeneration,3);assert.equal(validDependencyIndex(change.afterIndex),true);
  const partial=planDependencyRegistrationChange({index:change.afterIndex,projectRegistration:change.afterRegistration,project,upsertConsumers:[],prerequisites:[],releaseConsumerIds:['another-consumer'],transactionId:'tx-partial'});
  assert.equal(partial.afterRegistration.consumers.length,1);assert.equal(partial.afterRegistration.prerequisites[0].id,pin.id);
  const last=planDependencyRegistrationChange({index:partial.afterIndex,projectRegistration:partial.afterRegistration,project,upsertConsumers:[],prerequisites:[],releaseConsumerIds:[consumer.assetId],transactionId:'tx-release'});
  assert.equal(last.reservation.status,'releasing');assert.equal(last.afterRegistration.status,'released');assert.equal(last.afterRegistration.generation,4);
  assert.deepEqual(last.afterIndex.projects,[]);assert.equal(validDependencyRegistration(last.afterRegistration),true);
  assert.equal(validDependencyIndex({...last.afterIndex,projects:[last.afterRegistration]}),false);
});

test('registration cannot replace another consumer pin, erase an unknown consumer or reuse a conflicting installed revision',t=>{
  const f=dependencyIndexFixture(t),input={index:f.index,projectRegistration:f.registration,project:f.registration.project,transactionId:'tx-next',upsertConsumers:[],prerequisites:[],releaseConsumerIds:[]};
  assert.throws(()=>planDependencyRegistrationChange({...input,releaseConsumerIds:['unknown']}),{code:'DEPENDENCY_CONSUMER_NOT_REGISTERED'});
  const changed={...f.registration.prerequisites[0],revisionDigest:'0'.repeat(64)};
  assert.throws(()=>planDependencyRegistrationChange({...input,upsertConsumers:[{...f.registration.consumers[0],assetId:'new-consumer'}],prerequisites:[changed]}),{code:'DEPENDENCY_REVISION_REPLACEMENT_REQUIRES_RELEASE'});
  assert.throws(()=>planDependencyRegistrationChange({...input,projectRegistration:{...f.registration,generation:2}}),{code:'DEPENDENCY_REGISTRATION_CONTEXT_MISMATCH'});
});

test('returned registration review data cannot mutate an input index or another registered project',t=>{
  const f=dependencyIndexFixture(t),other=structuredClone(f.registration);other.project.targetRoot=path.join(f.project.root,'other-checkout');other.id=dependencyRegistrationId(other.project);f.index.projects.push(other);
  const before=installationDigest(f.index),consumer={...f.registration.consumers[0],assetId:'new-consumer'};
  const change=planDependencyRegistrationChange({index:f.index,projectRegistration:f.registration,project:f.registration.project,transactionId:'tx-isolation',upsertConsumers:[consumer],prerequisites:[],releaseConsumerIds:[]});
  change.afterRegistration.prerequisites[0].revisionDigest='0'.repeat(64);change.afterIndex.projects.find(item=>item.id===other.id).consumers[0].assetId='edited-in-review';assert.equal(installationDigest(f.index),before);
});

test('coordinator plans are readonly and execute a real client file change under global then project locks',t=>{
  const f=coordinationFixture(t,{edit:true}),beforeGlobal=fs.readFileSync(f.global.statePath),beforeProject=fs.readFileSync(f.project.statePath),phases=[];
  const plan=planDependencyCoordination(f.request());assert.equal(plan.blocked.length,0);assert.deepEqual(fs.readFileSync(f.global.statePath),beforeGlobal);assert.deepEqual(fs.readFileSync(f.project.statePath),beforeProject);
  assert.equal(fs.existsSync(f.global.statePath+'.lock'),false);
  const result=executeDependencyCoordination({...f.request(),plan,executeProject:context=>executeProjectFixture(f,context),onPhase:phase=>{
    phases.push(phase);if(['index-reserved','project-state-prepared','project-committed'].includes(phase))assert.equal(fs.existsSync(f.global.statePath+'.lock')&&fs.existsSync(f.project.statePath+'.lock'),true);
  }});
  assert.equal(result.outcome,'committed');assert.ok(phases.indexOf('global-locked')<phases.indexOf('project-locked'));
  assert.match(fs.readFileSync(f.target,'utf8'),/Coordinated update/);assert.equal(f.global.state().dependencyIndex.projects[0].status,'active');
  assert.equal(f.project.state().dependencyRegistration.status,'active');assert.equal(f.project.state().dependencyRegistration.transactionId,f.transactionId);
  assert.equal(f.inspect().projects[0].verification,'consistent');assert.equal(fs.existsSync(f.global.statePath+'.journal.json'),false);f.global.preserved();f.project.preserved();
});

test('native preconditions and planned revisions are checked before reservation, while unrelated ordinary writes stay blocked',t=>{
  const f=coordinationFixture(t),before=fs.readFileSync(f.global.statePath);
  const denied=planDependencyCoordination({...f.request(),verifyPrerequisites:()=>({verified:false,digest:'0'.repeat(64)})});assert.equal(denied.blocked[0].code,'DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED');
  assert.throws(()=>executeDependencyCoordination({...f.request(),plan:denied,executeProject:()=>assert.fail('must not execute')}),{code:'DEPENDENCY_COORDINATION_BLOCKED'});
  const plan=planDependencyCoordination(f.request());fs.appendFileSync(f.globalReceipt.proofs[0].target,'# provider drift\n');
  assert.throws(()=>executeDependencyCoordination({...f.request(),plan,executeProject:()=>assert.fail('must not execute')}),{code:'DEPENDENCY_INSTALLATION_PREREQUISITE_CHANGED'});
  assert.deepEqual(fs.readFileSync(f.global.statePath),before);assert.equal(fs.existsSync(f.global.statePath+'.journal.json'),false);
});

test('full release requires actual consumer removal and retains a project tombstone without touching unrelated files',t=>{
  const f=coordinationFixture(t);executeDependencyCoordination({...f.request(),plan:planDependencyCoordination(f.request()),executeProject:context=>executeProjectFixture(f,context)});
  const release=f.request({release:true}),plan=planDependencyCoordination(release),other=fs.readFileSync(f.project.rules);
  executeDependencyCoordination({...release,plan,executeProject:context=>executeProjectFixture(f,context,{release:true})});
  assert.equal(fs.existsSync(f.target),false);assert.deepEqual(f.global.state().dependencyIndex.projects,[]);
  assert.equal(f.project.state().dependencyRegistration.status,'released');assert.deepEqual(fs.readFileSync(f.project.rules),other);f.global.preserved();f.project.preserved();
});

test('SIGKILL at reservation, project state and final index boundaries recovers both ledgers from recorded evidence',t=>{
  for(const phase of ['journal-prepared','index-reserved','project-state-prepared','child-before-state','project-committed','index-active','coordination-completed','project-lock-released','global-lock-released']) {
    const f=coordinationFixture(t,{edit:true}),globalBefore=fs.readFileSync(f.global.statePath),projectBefore=fs.readFileSync(f.project.statePath),body=fs.readFileSync(f.target);
    const file=path.join(f.project.root,'coordination-child.json');fs.writeFileSync(file,JSON.stringify({...f.serialized,phase}));
    const child=spawnSync(process.execPath,['test/helpers/crash-dependency-coordination.js',file],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:20000});assert.equal(child.signal,'SIGKILL',child.stderr);
    const stores=coordinationStores(f.serialized),plan=planDependencyCoordinationRecovery(stores);
    const result=applyDependencyCoordinationRecovery({...stores,plan});const committed=['project-committed','index-active','coordination-completed','project-lock-released','global-lock-released'].includes(phase);
    assert.equal(result.outcome,committed?'committed':'restored');
    if(committed){assert.match(fs.readFileSync(f.target,'utf8'),/Coordinated update/);assert.equal(f.inspect().projects[0].verification,'consistent');}
    else {assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.deepEqual(fs.readFileSync(f.project.statePath),projectBefore);assert.deepEqual(fs.readFileSync(f.target),body);}
    assert.equal(fs.existsSync(f.global.statePath+'.journal.json'),false);assert.equal(fs.existsSync(f.global.statePath+'.lock'),false);assert.equal(fs.existsSync(f.project.statePath+'.lock'),false);f.global.preserved();f.project.preserved();
  }
});

test('manual global metadata changes after planning are retained rather than overwritten by reservation',t=>{
  const f=coordinationFixture(t),request=f.request(),plan=planDependencyCoordination(request);
  assert.throws(()=>executeDependencyCoordination({...request,plan,executeProject:context=>executeProjectFixture(f,context),onPhase:phase=>{
    if(phase==='journal-prepared'){const state=f.global.state();state.userReviewNote='preserve manual state change';fs.writeFileSync(f.global.statePath,JSON.stringify(state));}
  }}),{code:'UNREVIEWED_DEPENDENCY_STATE_COMMIT'});
  assert.equal(f.global.state().userReviewNote,'preserve manual state change');assert.equal(f.global.state().dependencyIndex,undefined);assert.equal(f.project.state().dependencyRegistration,undefined);
});

test('concurrent client edits during a child failure remain intact with both recovery journals retained',t=>{
  const f=coordinationFixture(t,{edit:true}),request=f.request(),plan=planDependencyCoordination(request);
  assert.throws(()=>executeDependencyCoordination({...request,plan,executeProject:context=>executeProjectFixture(f,context),onPhase:phase=>{
    if(phase==='project-state-prepared'){fs.appendFileSync(f.target,'# manual client edit must survive\n');throw new Error('recorded child validation failure');}
  }}));
  assert.match(fs.readFileSync(f.target,'utf8'),/manual client edit must survive/);assert.equal(fs.existsSync(f.project.statePath+'.journal.json'),true);
  assert.equal(fs.existsSync(f.global.statePath+'.journal.json'),true);assert.equal(f.global.state().dependencyIndex.projects[0].status,'reserved');
});

test('a dependency cannot be released by removing metadata while the consumer file is still present',t=>{
  const f=coordinationFixture(t),request=f.request();executeDependencyCoordination({...request,plan:planDependencyCoordination(request),executeProject:context=>executeProjectFixture(f,context)});
  const release=f.request({release:true});release.targets=[];
  const plan=planDependencyCoordination(release),body=fs.readFileSync(f.target);
  assert.throws(()=>executeDependencyCoordination({...release,plan,executeProject:context=>executeProjectFixture(f,context,{release:false})}),{code:'DEPENDENCY_CONSUMER_REMOVAL_UNPROVEN'});
  assert.deepEqual(fs.readFileSync(f.target),body);assert.equal(f.global.state().dependencyIndex.projects[0].status,'releasing');assert.equal(f.project.state().dependencyRegistration.status,'active');
});

test('concurrent global/project writers and changed recovery targets preserve the reservation for reviewed recovery',t=>{
  const f=coordinationFixture(t,{edit:true}),plan=planDependencyCoordination(f.request());
  assert.throws(()=>executeDependencyCoordination({...f.request(),plan,executeProject:()=>{throw new Error('recorded executor failure');},onPhase:phase=>{
    if(phase==='index-reserved')assert.throws(()=>planDependencyCoordinationRecovery(coordinationStores(f.serialized)),{code:'DEPENDENCY_COORDINATION_OWNER_ALIVE'});
  }}),/recorded executor failure/);
  const stores=coordinationStores(f.serialized);assert.throws(()=>stores.globalStore.withLock(()=>assert.fail('locked')));
  assert.equal(f.global.state().dependencyIndex.projects[0].status,'reserved');assert.ok(fs.existsSync(f.global.statePath+'.journal.json'));assert.equal(installationDigest(f.project.state()),plan.projectBeforeDigest);
  // A returned failure has a durable terminal lease marker, so a long-lived
  // daemon can recover without killing its own process or stealing a live task.
  const recovery=planDependencyCoordinationRecovery(stores);assert.equal(applyDependencyCoordinationRecovery({...stores,plan:recovery}).outcome,'restored');
});

test('metadata formatting changes after review and edited recovery targets are not silently restored',t=>{
  const f=coordinationFixture(t),request=f.request(),plan=planDependencyCoordination(request);
  assert.throws(()=>executeDependencyCoordination({...request,plan,executeProject:context=>executeProjectFixture(f,context),onPhase:phase=>{
    if(phase==='journal-prepared')fs.appendFileSync(f.global.statePath,'\n\n');
  }}),{code:'UNREVIEWED_DEPENDENCY_STATE_COMMIT'});
  assert.ok(fs.readFileSync(f.global.statePath,'utf8').endsWith('\n\n'));assert.equal(f.global.state().dependencyIndex,undefined);
});

test('an uncommitted reservation cannot be relabeled as completed cleanup to discard its journal',t=>{
  const f=coordinationFixture(t),request=f.request(),plan=planDependencyCoordination(request);
  assert.throws(()=>executeDependencyCoordination({...request,plan,executeProject:()=>{throw new Error('recorded pre-commit failure');}}));
  const journalPath=f.global.statePath+'.journal.json',journal=JSON.parse(fs.readFileSync(journalPath,'utf8'));
  journal.stage='complete';journal.outcome='restored';journal.finalGlobalDigest=installationDigest(f.global.state());journal.finalProjectRegistrationDigest=installationDigest(f.project.state().dependencyRegistration||null);fs.writeFileSync(journalPath,JSON.stringify(journal));
  assert.throws(()=>planDependencyCoordinationRecovery(coordinationStores(f.serialized)),{code:'INVALID_DEPENDENCY_COORDINATION_JOURNAL'});
  assert.equal(f.global.state().dependencyIndex.projects[0].status,'reserved');assert.equal(fs.existsSync(journalPath),true);
});

test('SIGKILL during recovery can resume its stale guard without touching a live recovery owner',t=>{
  const f=coordinationFixture(t,{edit:true}),beforeGlobal=fs.readFileSync(f.global.statePath),beforeProject=fs.readFileSync(f.project.statePath),body=fs.readFileSync(f.target);
  const file=path.join(f.project.root,'recovery-child.json');fs.writeFileSync(file,JSON.stringify({...f.serialized,phase:'index-reserved',recoveryPhase:'recovery-index-restored'}));
  const run=script=>spawnSync(process.execPath,[`test/helpers/${script}`,file],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:20000});
  const initial=run('crash-dependency-coordination.js');assert.equal(initial.signal,'SIGKILL',initial.stderr);
  const interrupted=run('crash-dependency-recovery.js');assert.equal(interrupted.signal,'SIGKILL',interrupted.stderr);
  const stores=coordinationStores(f.serialized),plan=planDependencyCoordinationRecovery(stores),result=applyDependencyCoordinationRecovery({...stores,plan});assert.equal(result.outcome,'restored');
  assert.deepEqual(fs.readFileSync(f.global.statePath),beforeGlobal);assert.deepEqual(fs.readFileSync(f.project.statePath),beforeProject);assert.deepEqual(fs.readFileSync(f.target),body);
  assert.equal(fs.readdirSync(path.dirname(f.global.statePath)).filter(name=>name.startsWith('dependency-recovery.lock.abandoned-')).length,1);
});

test('changed recovery targets, backups or lock identities never remove the reserved dependency',t=>{
  for(const kind of ['target','backup','lock']) {
    const f=coordinationFixture(t,{edit:true}),file=path.join(f.project.root,'conflict-child.json');fs.writeFileSync(file,JSON.stringify({...f.serialized,phase:'index-reserved'}));
    const child=spawnSync(process.execPath,['test/helpers/crash-dependency-coordination.js',file],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:20000});assert.equal(child.signal,'SIGKILL',child.stderr);
    const journal=JSON.parse(fs.readFileSync(f.global.statePath+'.journal.json','utf8')),globalBefore=fs.readFileSync(f.global.statePath);let code;
    if(kind==='target'){fs.appendFileSync(f.target,'# manual recovery edit\n');code='DEPENDENCY_COORDINATION_TARGET_CHANGED';}
    else if(kind==='backup'){fs.appendFileSync(journal.backups[0].path,'\n');code='DEPENDENCY_COORDINATION_BACKUP_CHANGED';}
    else {const lock=f.project.statePath+'.lock',body=fs.readFileSync(lock);fs.renameSync(lock,lock+'.retained');fs.writeFileSync(lock,body);code='DEPENDENCY_COORDINATION_LOCK_UNPROVEN';}
    assert.throws(()=>planDependencyCoordinationRecovery(coordinationStores(f.serialized)),{code});assert.deepEqual(fs.readFileSync(f.global.statePath),globalBefore);assert.equal(f.global.state().dependencyIndex.projects[0].status,'reserved');
    if(kind==='target')assert.match(fs.readFileSync(f.target,'utf8'),/manual recovery edit/);
  }
});

test('a live recovery guard is preserved and cannot be archived by another recovery',t=>{
  const f=coordinationFixture(t),request=f.request(),plan=planDependencyCoordination(request);assert.throws(()=>executeDependencyCoordination({...request,plan,executeProject:()=>{throw new Error('recorded failure');}}));
  const stores=coordinationStores(f.serialized),review=planDependencyCoordinationRecovery(stores),guard=path.join(path.dirname(f.global.statePath),'dependency-recovery.lock'),body=JSON.stringify({pid:process.pid,token:crypto.randomUUID()});fs.writeFileSync(guard,body);
  const before=fs.readFileSync(f.global.statePath);assert.throws(()=>applyDependencyCoordinationRecovery({...stores,plan:review}),{code:'DEPENDENCY_COORDINATION_RECOVERY_LOCKED'});
  assert.equal(fs.readFileSync(guard,'utf8'),body);assert.deepEqual(fs.readFileSync(f.global.statePath),before);assert.equal(fs.readdirSync(path.dirname(guard)).some(name=>name.startsWith('dependency-recovery.lock.abandoned-')),false);
});

test('external ego-browser links cannot become coordinator mutation targets',t=>{
  const f=coordinationFixture(t),request=f.request(),target=f.project.external,identity=fs.lstatSync(target),link=fs.readlinkSync(target);
  request.targets=[{target,before:imageFingerprint(readPathImage(target,{authorizedRoot:f.project.targetRoot})),after:imageFingerprint({kind:'absent'})}];
  assert.throws(()=>planDependencyCoordination(request),{code:'EXTERNAL_RESOURCE_READ_ONLY'});assert.equal(fs.readlinkSync(target),link);assert.equal(fs.lstatSync(target).ino,identity.ino);assert.equal(fs.existsSync(f.global.statePath+'.journal.json'),false);
});

test('removing a consumer remains possible when its old upstream content has changed, without granting a new native prerequisite',t=>{
  const f=coordinationFixture(t),request=f.request();executeDependencyCoordination({...request,plan:planDependencyCoordination(request),executeProject:context=>executeProjectFixture(f,context)});
  const upstream=f.globalReceipt.proofs[0].target;fs.appendFileSync(upstream,'# existing manual upstream change\n');const body=fs.readFileSync(upstream),release=f.request({release:true});release.verifyPrerequisites=()=>assert.fail('release cannot require an unavailable new provider');
  executeDependencyCoordination({...release,plan:planDependencyCoordination(release),executeProject:context=>executeProjectFixture(f,context,{release:true})});
  assert.deepEqual(fs.readFileSync(upstream),body);assert.equal(f.global.state().dependencyIndex.projects.length,0);assert.equal(f.project.state().dependencyRegistration.status,'released');
});

test('a child executor cannot write unreviewed project targets or any global client files',t=>{
  for(const global of [false,true]) {
    const f=coordinationFixture(t),request=f.request(),plan=planDependencyCoordination(request),before=fs.readFileSync(f.project.statePath);
    assert.throws(()=>executeDependencyCoordination({...request,plan,executeProject:context=>executeUnreviewedProjectFixture(f,context,{global})}),{code:'UNREVIEWED_DEPENDENCY_MUTATION'});
    assert.equal(fs.existsSync(path.join(global?f.global.homeDir:f.project.targetRoot,'unreviewed.txt')),false);assert.deepEqual(fs.readFileSync(f.project.statePath),before);
  }
});
