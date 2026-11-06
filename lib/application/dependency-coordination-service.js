import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {installationDigest} from '../domain/installation-receipt.js';
import {planDependencyRegistrationChange} from '../domain/dependency-registration-change.js';
import {installedBindingDigest,validDependencyIndex,validDependencyRegistration} from '../domain/dependency-reverse-index.js';
import {latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';
import {readPathImage,imageFingerprint,authorizeImagePath} from '../infrastructure/path-image.js';
import {isWithinRoot} from '../security-boundary.js';
import {withDependencyStoreSession} from '../infrastructure/dependency-store-session.js';
import {planJournalRecovery,applyJournalRecovery} from '../infrastructure/deployment-journal.js';
import {DeploymentBackupStore} from '../infrastructure/deployment-backup-store.js';
import {canonicalNativeMcpUnit} from '../adapters/mcp/native-installation.js';
import {ownedStructuredHashes} from '../domain/structured-merge.js';
import {assertInstalledDependencySources} from './source-dependency-guard.js';
import {runTransactionWorkflow} from '../infrastructure/transaction-workflow.js';
import {globalInstallationDependencies} from '../domain/scoped-installed-relations.js';
import {coordinationJournalPath,coordinationExists,coordinationFail as fail,assertCoordinationPaths,coordinationSnapshot,
  writeCoordinationJson,readCoordinationJson,createCoordinationBackups,readCoordinationBackup,assertCoordinationLock,unlinkCoordinationFile,restoreCoordinationGlobal,coordinationStateImage,coordinationImage,acquireCoordinationRecoveryGuard} from '../infrastructure/dependency-coordination-io.js';

const HASH=/^[a-f0-9]{64}$/;
const digest=installationDigest;
const same=(a,b)=>digest(a)===digest(b);
const root=store=>path.dirname(store.statePath);
const contextOf=input=>({globalStore:input.globalStore,projectStore:input.projectStore});
function assertTargets(input,targets,{after=false}={}) {
  if(!Array.isArray(targets)||targets.length>256)fail('INVALID_DEPENDENCY_COORDINATION_TARGETS');
  const seen=[];
  for(const target of targets) {
    if(!target||Object.keys(target).some(key=>!['target','before','after'].includes(key))||typeof target.target!=='string'||!HASH.test(target.before)||!HASH.test(target.after))fail('INVALID_DEPENDENCY_COORDINATION_TARGETS');
    authorizeImagePath(target.target,input.project.targetRoot);
    if(isWithinRoot(target.target,root(input.projectStore))||isWithinRoot(target.target,root(input.globalStore))||isWithinRoot(target.target,input.project.sourceRoot)
      ||seen.some(previous=>isWithinRoot(target.target,previous)||isWithinRoot(previous,target.target)))fail('DEPENDENCY_COORDINATION_TARGET_SCOPE_INVALID');
    seen.push(target.target);
    if(imageFingerprint(readPathImage(target.target,{authorizedRoot:input.project.targetRoot}))!==target[after?'after':'before'])fail('DEPENDENCY_COORDINATION_TARGET_CHANGED');
  }
}
function requiredPins(input,change) {
  const ids=new Set((input.upsertConsumers||[]).flatMap(consumer=>consumer.prerequisiteIds));return change.afterRegistration.prerequisites.filter(pin=>ids.has(pin.id));
}
function assertInstalledPins(globalStore,state,pins) {
  assertInstalledDependencySources(pins);
  const receipts=latestInstallationReceipts(state);
  for(const pin of pins) {
    const matching=receipts.filter(receipt=>receipt.scope==='global'&&['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].every(key=>receipt[key]===pin[key])&&digest(receipt.locator)===pin.locatorDigest);
    if(matching.length!==1||![3,4].includes(matching[0].schemaVersion)||installedBindingDigest(matching[0])!==pin.bindingDigest)fail('DEPENDENCY_INSTALLATION_PREREQUISITE_CHANGED');
    const observed=observeInstallationReceipt({receipt:matching[0],state,homeDir:globalStore.homeDir});
    if(observed.status!=='ownership-observed'||observed.dependencyState!=='revision-observed'||observed.bindingDeclarationsState==='unverified')fail('DEPENDENCY_INSTALLATION_PREREQUISITE_CHANGED');
  }
}
function nativeProof(input,pins,stage='before') {
  if(!pins.length)return {verified:true,digest:digest({releaseOnly:true})};
  let proof;try{proof=input.verifyPrerequisites?.({project:input.project,prerequisites:structuredClone(pins),stage});}catch{return {verified:false,digest:null};}
  return {verified:proof?.verified===true&&typeof proof.digest==='string'&&HASH.test(proof.digest),digest:typeof proof?.digest==='string'&&HASH.test(proof.digest)?proof.digest:null};
}
function consumerReceipt(registration,reference,state) {
  const matching=latestInstallationReceipts(state).filter(receipt=>receipt.scope==='project'&&receipt.kitId===registration.project.kitId&&receipt.sourceRoot===registration.project.sourceRoot
    &&['assetId','assetKind','clientId','surface','configStore','revisionDigest'].every(key=>receipt[key]===reference[key])&&digest(receipt.locator)===reference.locatorDigest);
  if(matching.length!==1)fail('DEPENDENCY_PROJECT_CONSUMER_CHANGED');return matching[0];
}
function assertConsumers(input,registration,state,scopedConsumers=[]) {
  for(const reference of registration?.consumers||[]) {
    const receipt=consumerReceipt(registration,reference,state),observed=observeInstallationReceipt({receipt,state,globalState:input.globalStore.load(),homeDir:input.globalStore.homeDir,targetRoot:input.project.targetRoot});
    const scoped=receipt.schemaVersion===4&&scopedConsumers.some(consumer=>['assetId','assetKind','clientId','surface','configStore'].every(key=>consumer[key]===reference[key]));
    if(observed.status!=='ownership-observed'||scoped&&(observed.dependencyState!=='revision-observed'||observed.bindingDeclarationsState==='unverified'))fail('DEPENDENCY_PROJECT_CONSUMER_CHANGED');
  }
}
function assertRemoved(input,change,before,after) {
  for(const consumer of change.releasedConsumers) {
    const receipt=consumerReceipt({project:change.project},consumer,before);
    const replacement=latestInstallationReceipts(after).filter(value=>value.scope==='project'&&value.kitId===receipt.kitId&&value.sourceRoot===receipt.sourceRoot
      &&['assetId','assetKind','clientId','surface','configStore'].every(key=>value[key]===consumer[key])&&value.revisionDigest!==consumer.revisionDigest);
    if(replacement.length===1&&[3,4].includes(replacement[0].schemaVersion)&&!globalInstallationDependencies(replacement[0]).length) {
      const observed=observeInstallationReceipt({receipt:replacement[0],state:after,globalState:input.globalStore.load(),homeDir:input.globalStore.homeDir,targetRoot:input.project.targetRoot});
      if(observed.status==='ownership-observed'&&observed.dependencyState==='revision-observed'&&observed.bindingDeclarationsState!=='unverified')continue;
    }
    for(const proof of receipt.proofs) {
      const record=after.managed[proof.target];if(record&&(record.assetId===consumer.assetId||record.owners?.[consumer.assetId]))fail('DEPENDENCY_CONSUMER_REMOVAL_UNPROVEN');
      const image=readPathImage(proof.target,{authorizedRoot:change.project.targetRoot});if(image.kind==='absent')continue;
      if(image.kind!=='file')fail('DEPENDENCY_CONSUMER_REMOVAL_UNPROVEN');
      const text=Buffer.from(image.content,'base64').toString('utf8');
      if(receipt.assetKind==='mcpServers') {
        if(canonicalNativeMcpUnit(text,{format:receipt.locator.format,nativeId:receipt.locator.nativeId||receipt.assetId},true)!==null)fail('DEPENDENCY_CONSUMER_REMOVAL_UNPROVEN');
      }else if(proof.units&&receipt.locator.format==='markdown') {
        if(text.includes(`<!-- agents-kit:${receipt.assetId}:start -->`)||text.includes(`<!-- agents-kit:${receipt.assetId}:end -->`))fail('DEPENDENCY_CONSUMER_REMOVAL_UNPROVEN');
      }else if(!proof.units||Object.values(ownedStructuredHashes({format:receipt.locator.format,current:text,assetId:receipt.assetId,selectors:Object.keys(proof.units)})).some(Boolean))fail('DEPENDENCY_CONSUMER_REMOVAL_UNPROVEN');
    }
  }
}
function assertProjectCommit(input,plan,before,next) {
  const transaction=next.transactions.find(tx=>tx.id===plan.transactionId&&tx.type===(plan.rollbackTransactionId?'rollback':'apply')&&tx.status==='committed');
  if(plan.rollbackTransactionId&&(transaction?.transactionId!==plan.rollbackTransactionId||!next.transactions.some(tx=>tx.id===plan.rollbackTransactionId&&tx.type==='apply'&&tx.status==='rolled-back'&&tx.rolledBackBy===plan.transactionId)))fail('DEPENDENCY_PROJECT_COMMIT_UNPROVEN');
  if(!transaction||!same(next.dependencyRegistration,plan.change.afterRegistration))fail('DEPENDENCY_PROJECT_COMMIT_UNPROVEN');
  if(!same(transaction.operations.map(operation=>operation.target).sort(),plan.targets.map(target=>target.target).sort()))fail('UNREVIEWED_DEPENDENCY_MUTATION');
  assertConsumers(input,plan.change.afterRegistration,next,plan.request.upsertConsumers);assertRemoved(input,plan.change,before,next);assertTargets(input,plan.targets,{after:true});
}
function buildPlan(input,{locked=false}={}) {
  assertCoordinationPaths(input);
  if([input.globalStore,input.projectStore].some(store=>coordinationExists(coordinationJournalPath(store))||!locked&&coordinationExists(`${store.statePath}.lock`)))fail('DEPENDENCY_COORDINATION_RECOVERY_REQUIRED');
  const global=coordinationSnapshot(input.globalStore,input.globalStore.homeDir),project=coordinationSnapshot(input.projectStore,input.project.targetRoot);
  if(project.state.transactions.some(tx=>tx.id===input.transactionId))fail('DEPENDENCY_PROJECT_TRANSACTION_ALREADY_USED');
  if(input.rollbackTransactionId&&(!/^tx-[A-Za-z0-9-]{1,180}$/.test(input.rollbackTransactionId)||!project.state.transactions.some(tx=>tx.id===input.rollbackTransactionId&&tx.type==='apply'&&tx.status==='committed')))fail('TRANSACTION_NOT_ROLLBACKABLE');
  const change=planDependencyRegistrationChange({index:global.state.dependencyIndex||{schemaVersion:1,generation:0,projects:[]},projectRegistration:project.state.dependencyRegistration,
    project:input.project,upsertConsumers:input.upsertConsumers,prerequisites:input.prerequisites,releaseConsumerIds:input.releaseConsumerIds,transactionId:input.transactionId});
  assertConsumers(input,project.state.dependencyRegistration,project.state);assertTargets(input,input.targets||[]);
  for(const target of input.targets||[]) {
    const image=readPathImage(target.target,{authorizedRoot:input.project.targetRoot}),record=project.state.managed[target.target];
    if(image.kind==='symlink'&&(!record?.connection||record.linkSource!==image.source))fail('EXTERNAL_RESOURCE_READ_ONLY');
  }
  const pins=requiredPins(input,change);assertInstalledPins(input.globalStore,global.state,pins);const native=nativeProof(input,pins);
  const body={schemaVersion:1,coordinationId:`tx-dependency-${digest([input.project,input.transactionId])}`,transactionId:input.transactionId,project:structuredClone(input.project),
    ...(input.rollbackTransactionId?{rollbackTransactionId:input.rollbackTransactionId}:{}),
    globalBeforeDigest:digest(global.state),projectBeforeDigest:digest(project.state),globalBeforeImage:global.digest,projectBeforeImage:project.digest,
    request:{upsertConsumers:structuredClone(input.upsertConsumers||[]),prerequisites:structuredClone(input.prerequisites||[]),releaseConsumerIds:structuredClone(change.releasedConsumers)},
    change,targets:structuredClone(input.targets||[]),requiredPins:pins,nativeDigest:native.digest,blocked:native.verified?[]:[{code:'DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'}]};
  return {...body,digest:digest(body)};
}
export const planDependencyCoordination=input=>buildPlan(input);

function assertPlan(plan) {
  const {digest:hash,...body}=plan||{};
  if(plan?.schemaVersion!==1||typeof hash!=='string'||hash!==digest(body)||!/^tx-dependency-[a-f0-9]{64}$/.test(plan.coordinationId)||!Array.isArray(plan.blocked)
    ||Object.keys(plan).some(key=>!['schemaVersion','coordinationId','transactionId','project','rollbackTransactionId','globalBeforeDigest','projectBeforeDigest','globalBeforeImage','projectBeforeImage','request','change','targets','requiredPins','nativeDigest','blocked','digest'].includes(key))
    ||plan.rollbackTransactionId!==undefined&&!/^tx-[A-Za-z0-9-]{1,180}$/.test(plan.rollbackTransactionId)
    ||!plan.request||!['upsertConsumers','prerequisites','releaseConsumerIds'].every(key=>Array.isArray(plan.request[key])&&plan.request[key].length<=256)
    ||!validDependencyRegistration(plan.change?.afterRegistration)||!validDependencyIndex(plan.change?.reservedIndex)||!validDependencyIndex(plan.change?.afterIndex)
    ||!same(plan.project,plan.change.project)||plan.transactionId!==plan.change.afterRegistration.transactionId)fail('INVALID_DEPENDENCY_COORDINATION_PLAN');
}
function journalWrite(globalStore,journal,{exclusive=false}={}) {writeCoordinationJson(coordinationJournalPath(globalStore),journal,globalStore.homeDir,{exclusive});}
function completeJournal(input,journal,outcome,onPhase=()=>{}) {
  journal.stage='complete';journal.outcome=outcome;journal.finalGlobalDigest=digest(input.globalStore.load());journal.finalProjectRegistrationDigest=digest(input.projectStore.load().dependencyRegistration||null);
  journalWrite(input.globalStore,journal);onPhase('coordination-completed');
  for(const [store,evidence,phase] of [[input.projectStore,journal.locks.project,'project-lock-released'],[input.globalStore,journal.locks.global,'global-lock-released']]) {
    if(assertCoordinationLock(store,evidence,{allowMissing:true}))unlinkCoordinationFile(`${store.statePath}.lock`,store===input.globalStore?input.globalStore.homeDir:input.project.targetRoot);onPhase(phase);
  }
  unlinkCoordinationFile(coordinationJournalPath(input.globalStore),input.globalStore.homeDir);onPhase('journal-finished');
}
export const executeDependencyCoordination=input=>executeCoordination(input,false);
export const executeDependencyCoordinationAsync=async input=>executeCoordination(input,true);
function executeCoordination(input,async) {
  const {plan,onPhase=()=>{}}=input;assertPlan(plan);if(plan.blocked.length)fail('DEPENDENCY_COORDINATION_BLOCKED');
  if(buildPlan(input).digest!==plan.digest)fail('STALE_DEPENDENCY_COORDINATION_PLAN');
  let journal,beforeProjectState;const allowedGlobal=new Map();
  const execute=()=>withDependencyStoreSession({...contextOf(input),onPhase,rollbackTransactionId:plan.rollbackTransactionId,retainLocks:()=>coordinationExists(coordinationJournalPath(input.globalStore)),
    authorizeMutation:(store,produce)=>{
      if(store!==input.projectStore)fail('UNREVIEWED_DEPENDENCY_MUTATION');
      const mutations=produce();if(mutations.length!==plan.targets.length)fail('UNREVIEWED_DEPENDENCY_MUTATION');
      for(const mutation of mutations){const reviewed=plan.targets.find(target=>target.target===mutation.target);if(!reviewed||imageFingerprint(mutation.beforeImage)!==reviewed.before||imageFingerprint(mutation.afterImage)!==reviewed.after)fail('UNREVIEWED_DEPENDENCY_MUTATION');}
    },
    canRestore:()=>plan.targets.every(target=>{const observed=imageFingerprint(readPathImage(target.target,{authorizedRoot:plan.project.targetRoot}));return observed===target.before||observed===target.after;}),
    authorizeCommit:(store,current,next)=>{
      if(store===input.globalStore){const expected=allowedGlobal.get(digest(next));return expected?.digest===digest(current)&&imageFingerprint(coordinationImage(store.statePath,store.homeDir))===expected.image;}
      if(!journal?.projectAfterDigest||digest(current)!==plan.projectBeforeDigest||digest(next)!==journal.projectAfterDigest)return false;
      if(imageFingerprint(coordinationImage(store.statePath,plan.project.targetRoot))!==plan.projectBeforeImage)return false;
      assertTargets(input,plan.targets,{after:true});return true;
    },
    prepareCommit:(store,next)=>{
      if(store!==input.projectStore)fail('DEPENDENCY_PROJECT_STORE_REQUIRED');
      next.schemaVersion=8;next.dependencyRegistration=structuredClone(plan.change.afterRegistration);
      assertProjectCommit(input,plan,beforeProjectState,next);assertInstalledPins(input.globalStore,input.globalStore.load(),plan.requiredPins);
      const proof=nativeProof(input,plan.requiredPins,'after');if(!proof.verified||proof.digest!==plan.nativeDigest)fail('DEPENDENCY_NATIVE_PREREQUISITES_CHANGED');
      journal.projectAfterDigest=digest(next);journal.projectAfterImage=coordinationStateImage(next);journalWrite(input.globalStore,journal);onPhase('project-state-prepared');
    }},session=>runTransactionWorkflow((function*(){
      if(buildPlan(input,{locked:true}).digest!==plan.digest)fail('STALE_DEPENDENCY_COORDINATION_PLAN');
      const global=coordinationSnapshot(input.globalStore,input.globalStore.homeDir),project=coordinationSnapshot(input.projectStore,input.project.targetRoot);
      const reserved={...structuredClone(global.state),schemaVersion:8,dependencyIndex:plan.change.reservedIndex},after={...structuredClone(global.state),schemaVersion:8,dependencyIndex:plan.change.afterIndex};
      beforeProjectState=project.state;allowedGlobal.set(digest(reserved),{digest:plan.globalBeforeDigest,image:plan.globalBeforeImage});allowedGlobal.set(digest(after),{digest:digest(reserved),image:coordinationStateImage(reserved)});
      const backups=createCoordinationBackups({globalStore:input.globalStore,projectStore:input.projectStore,id:plan.coordinationId,globalImage:global.image,projectImage:project.image});
      journal={schemaVersion:4,kind:'dependency-coordination',plan:structuredClone(plan),backups,locks:session.evidence(),stage:'working',executionState:'running',globalReservedDigest:digest(reserved),globalAfterDigest:digest(after),
        globalReservedImage:coordinationStateImage(reserved),globalAfterImage:coordinationStateImage(after),projectAfterDigest:null,projectAfterImage:null};
      journalWrite(input.globalStore,journal,{exclusive:true});onPhase('journal-prepared');
      input.globalStore.commit(reserved);onPhase('index-reserved');
      const result=yield input.executeProject?.({projectStore:input.projectStore,globalStore:input.globalStore,transactionId:plan.transactionId});
      if(result?.then||result?.transactionId!==plan.transactionId||!journal.projectAfterDigest)fail('DEPENDENCY_PROJECT_COMMIT_UNPROVEN');
      if(digest(input.projectStore.load())!==journal.projectAfterDigest)fail('DEPENDENCY_PROJECT_COMMIT_UNPROVEN');onPhase('project-committed');
      assertProjectCommit(input,plan,project.state,input.projectStore.load());assertInstalledPins(input.globalStore,input.globalStore.load(),plan.requiredPins);
      const proof=nativeProof(input,plan.requiredPins,'after');if(!proof.verified||proof.digest!==plan.nativeDigest)fail('DEPENDENCY_NATIVE_PREREQUISITES_CHANGED');
      if(digest(input.globalStore.load())!==journal.globalReservedDigest)fail('DEPENDENCY_STATE_CONTEXT_CHANGED');
      input.globalStore.commit(after);onPhase('index-active');completeJournal(input,journal,'committed',onPhase);
      return {coordinationId:plan.coordinationId,transactionId:plan.transactionId,outcome:'committed',fulfilled:false,nativePrerequisitesState:'verified-at-apply'};
    })(),{async}));
  const failed=error=>{
    if(journal&&coordinationExists(coordinationJournalPath(input.globalStore)))try{
      for(const [store,evidence] of [[input.globalStore,journal.locks.global],[input.projectStore,journal.locks.project]])assertCoordinationLock(store,evidence,{allowMissing:journal.stage==='complete'});
      journal.executionState='failed';journal.failureCode=/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'DEPENDENCY_EXECUTOR_FAILED';journalWrite(input.globalStore,journal);
    }catch{/* Unproven ownership keeps the running lease and all evidence. */}
    throw error;
  };
  try{const result=execute();return async?Promise.resolve(result).catch(failed):result;}catch(error){return failed(error);}
}

function loadRecovery(input) {
  const loaded=readCoordinationJson(coordinationJournalPath(input.globalStore),input.globalStore.homeDir),journal=loaded.value;
  if(journal.schemaVersion!==4||journal.kind!=='dependency-coordination'||!['working','complete'].includes(journal.stage)||!['running','failed'].includes(journal.executionState)||!Array.isArray(journal.backups)||journal.backups.length!==2
    ||Object.keys(journal).some(key=>!['schemaVersion','kind','plan','backups','locks','stage','executionState','globalReservedDigest','globalAfterDigest','globalReservedImage','globalAfterImage','projectAfterDigest','projectAfterImage','failureCode','outcome','finalGlobalDigest','finalProjectRegistrationDigest'].includes(key)))fail('INVALID_DEPENDENCY_COORDINATION_JOURNAL');
  assertPlan(journal.plan);input={...input,project:journal.plan.project};assertCoordinationPaths(input);
  for(const [store,evidence] of [[input.globalStore,journal.locks?.global],[input.projectStore,journal.locks?.project]])assertCoordinationLock(store,evidence,{dead:journal.executionState!=='failed',allowMissing:journal.stage==='complete'});
  const beforeGlobalBytes=readCoordinationBackup({globalStore:input.globalStore,id:journal.plan.coordinationId,entry:journal.backups[0],index:0}),beforeProjectBytes=readCoordinationBackup({globalStore:input.globalStore,id:journal.plan.coordinationId,entry:journal.backups[1],index:1});
  let globalBefore,projectBefore;try{globalBefore=JSON.parse(beforeGlobalBytes);projectBefore=beforeProjectBytes?JSON.parse(beforeProjectBytes):{schemaVersion:1,managed:{},transactions:[]};}catch{fail('INVALID_DEPENDENCY_COORDINATION_BACKUP');}
  if(digest(globalBefore)!==journal.plan.globalBeforeDigest||digest(projectBefore)!==journal.plan.projectBeforeDigest)fail('DEPENDENCY_COORDINATION_BACKUP_CHANGED');
  const replay=planDependencyRegistrationChange({index:globalBefore.dependencyIndex||{schemaVersion:1,generation:0,projects:[]},projectRegistration:projectBefore.dependencyRegistration,
    project:journal.plan.project,transactionId:journal.plan.transactionId,...journal.plan.request});
  if(!same(replay,journal.plan.change)||!same(requiredPins(journal.plan.request,replay),journal.plan.requiredPins))fail('INVALID_DEPENDENCY_COORDINATION_JOURNAL');
  const reserved={...structuredClone(globalBefore),schemaVersion:8,dependencyIndex:journal.plan.change.reservedIndex},after={...structuredClone(globalBefore),schemaVersion:8,dependencyIndex:journal.plan.change.afterIndex};
  if(digest(reserved)!==journal.globalReservedDigest||digest(after)!==journal.globalAfterDigest||coordinationStateImage(reserved)!==journal.globalReservedImage||coordinationStateImage(after)!==journal.globalAfterImage)fail('INVALID_DEPENDENCY_COORDINATION_JOURNAL');
  if(journal.stage==='complete') {
    const committed=journal.outcome==='committed',restored=journal.outcome==='restored';
    if(!committed&&!restored||journal.finalGlobalDigest!==(committed?journal.globalAfterDigest:journal.plan.globalBeforeDigest)
      ||journal.finalProjectRegistrationDigest!==digest(committed?journal.plan.change.afterRegistration:projectBefore.dependencyRegistration||null))fail('INVALID_DEPENDENCY_COORDINATION_JOURNAL');
  }
  return {...loaded,journal,input,globalBefore,projectBefore,after};
}
function recoverySession(loaded,action) {
  const {input,journal}=loaded;
  return withDependencyStoreSession({...contextOf(input),recovery:{terminalOwner:journal.executionState==='failed',assertHeld:()=>{
    loaded.guardCheck?.();
    for(const [store,evidence] of [[input.globalStore,journal.locks.global],[input.projectStore,journal.locks.project]])assertCoordinationLock(store,evidence,{allowMissing:journal.stage==='complete'});
  }},retainLocks:()=>true,authorizeCommit:(store,current,next)=>store===input.globalStore&&[journal.plan.globalBeforeDigest,journal.globalReservedDigest,journal.globalAfterDigest].includes(digest(current))&&digest(next)===journal.globalAfterDigest},action);
}
export function planDependencyCoordinationRecovery(input) {
  const loaded=loadRecovery(input),{journal}=loaded;input=loaded.input;
  return recoverySession(loaded,()=>{
    const globalDigest=digest(input.globalStore.load()),project=input.projectStore.load();
    if(journal.stage==='complete') {
      if(globalDigest!==journal.finalGlobalDigest||digest(project.dependencyRegistration||null)!==journal.finalProjectRegistrationDigest)fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');
      return {schemaVersion:1,journalHash:loaded.hash,coordinationId:journal.plan.coordinationId,outcome:journal.outcome,cleanupOnly:true,globalDigest,projectDigest:digest(project),childPlan:null};
    }
    if(![journal.plan.globalBeforeDigest,journal.globalReservedDigest,journal.globalAfterDigest].includes(globalDigest))fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');
    const expectedImage=globalDigest===journal.plan.globalBeforeDigest?journal.plan.globalBeforeImage:globalDigest===journal.globalReservedDigest?journal.globalReservedImage:journal.globalAfterImage;
    if(imageFingerprint(coordinationImage(input.globalStore.statePath,input.globalStore.homeDir))!==expectedImage)fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');
    const childPlan=coordinationExists(coordinationJournalPath(input.projectStore))?planJournalRecovery({stateStore:input.projectStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(root(input.projectStore),'backups')})}):null;
    let outcome;
    if(journal.projectAfterDigest&&digest(project)===journal.projectAfterDigest) {
      if(imageFingerprint(coordinationImage(input.projectStore.statePath,input.project.targetRoot))!==journal.projectAfterImage)fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');
      assertProjectCommit(input,journal.plan,loaded.projectBefore,project);assertInstalledPins(input.globalStore,input.globalStore.load(),journal.plan.requiredPins);outcome='committed';
    }else if(digest(project)===journal.plan.projectBeforeDigest&&globalDigest!==journal.globalAfterDigest) {
      if(imageFingerprint(coordinationImage(input.projectStore.statePath,input.project.targetRoot))!==journal.plan.projectBeforeImage)fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');
      if(!childPlan)assertTargets(input,journal.plan.targets);else if(childPlan.committed)fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');outcome='restored';
    }else fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');
    return {schemaVersion:1,journalHash:loaded.hash,coordinationId:journal.plan.coordinationId,outcome,cleanupOnly:false,globalDigest,projectDigest:digest(project),childPlan};
  });
}
export function applyDependencyCoordinationRecovery(input) {
  const reviewed=input.plan,loaded=loadRecovery(input);input={...input,project:loaded.input.project};
  const guard=path.join(root(input.globalStore),'dependency-recovery.lock');authorizeImagePath(guard,input.globalStore.homeDir);
  const descriptor=acquireCoordinationRecoveryGuard(guard,input.globalStore.homeDir);
  const identity=fs.fstatSync(descriptor),owner={pid:process.pid,token:crypto.randomUUID()};fs.writeFileSync(descriptor,JSON.stringify(owner));
  loaded.guardCheck=()=>{const info=fs.lstatSync(guard),current=readCoordinationJson(guard,input.globalStore.homeDir).value;if(info.dev!==identity.dev||info.ino!==identity.ino||!same(owner,current))fail('DEPENDENCY_COORDINATION_RECOVERY_GUARD_CHANGED');};
  try {
    const fresh=planDependencyCoordinationRecovery(input);if(!same(fresh,reviewed)||loaded.hash!==reviewed.journalHash)fail('STALE_DEPENDENCY_COORDINATION_RECOVERY');
    return recoverySession(loaded,()=>{
      if(fresh.childPlan)applyJournalRecovery({plan:fresh.childPlan,stateStore:input.projectStore,backupStore:new DeploymentBackupStore({backupsRoot:path.join(root(input.projectStore),'backups')})});
      loaded.guardCheck();if(!fresh.cleanupOnly) {
        if(fresh.outcome==='committed'){assertProjectCommit(input,loaded.journal.plan,loaded.projectBefore,input.projectStore.load());input.globalStore.commit(loaded.after);}
        else {if(digest(input.projectStore.load())!==loaded.journal.plan.projectBeforeDigest)fail('DEPENDENCY_COORDINATION_RECOVERY_CONFLICT');assertTargets(input,loaded.journal.plan.targets);restoreCoordinationGlobal({globalStore:input.globalStore,entry:loaded.journal.backups[0],id:loaded.journal.plan.coordinationId});}
        input.onPhase?.(fresh.outcome==='committed'?'recovery-index-active':'recovery-index-restored');
      }
      completeJournal(input,loaded.journal,fresh.outcome,input.onPhase);
      return {coordinationId:loaded.journal.plan.coordinationId,outcome:fresh.outcome,fulfilled:false,nativePrerequisitesState:'unverified-after-recovery'};
    });
  }finally{fs.closeSync(descriptor);try{const current=fs.lstatSync(guard);if(current.dev===identity.dev&&current.ino===identity.ino)fs.unlinkSync(guard);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
