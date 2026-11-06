import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {installedBindingDigest,evaluateGlobalDependencyChanges} from '../domain/dependency-reverse-index.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {isWithinRoot} from '../security-boundary.js';
import {loadClientDefinitions} from '../infrastructure/client-definition-loader.js';
import {loadNativePrerequisiteDefinition} from '../infrastructure/native-prerequisite-definition-loader.js';
import {captureNativePrerequisiteContext} from '../infrastructure/native-prerequisite-context.js';
import {coordinationSnapshot,coordinationExists,coordinationJournalPath,readCoordinationJson,writeCoordinationJson,assertCoordinationLock} from '../infrastructure/dependency-coordination-io.js';
import {withGlobalDependencyStoreSession} from '../infrastructure/dependency-store-session.js';
import {readPathImage,imageFingerprint} from '../infrastructure/path-image.js';
import {canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';
import {inspectDependencyDependents,inspectHeldGlobalDependents} from './inspect-dependency-dependents.js';
import {predictDeploymentInstallation,predictRollbackInstallation,observePredictedInstallations,predictedInstallationFileModes,assertDeploymentPredictionInputs,assertPredictedInstallation} from './deployment-installation-prediction.js';
import {assertInstalledDependencySources} from './source-dependency-guard.js';
import {applyDeployment} from './apply-deployment.js';
import {applyDeploymentRollback} from './rollback-deployment.js';
import {deploymentStateHash} from './shared-resource-deployment.js';
import {planJournalRecovery,applyJournalRecovery} from '../infrastructure/deployment-journal.js';

const digest=installationDigest;
const fail=code=>{throw domainError(code,'Global changes must preserve every registered project, installed pin and native context');};
const sameOrigin=(receipt,pin)=>receipt.scope==='global'&&['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore'].every(key=>receipt[key]===pin[key]);
const uniquePins=index=>[...new Map(index.projects.flatMap(project=>project.prerequisites).map(pin=>[pin.id,pin])).values()];
const projectDigest=observed=>digest(observed.projects.map(project=>({id:project.registrationId,stateFingerprint:project.stateFingerprint,verification:project.verification,consumers:project.consumers,prerequisites:project.prerequisites})));

function contexts(input,state) {
  const definitions=loadClientDefinitions({definitionsDir:input.definitionsDir}),receipts=latestInstallationReceipts(state),result=[];
  for(const registration of state.dependencyIndex.projects)for(const profileKey of new Set(registration.prerequisites.map(pin=>JSON.stringify([pin.clientId,pin.surface,pin.configStore])))) {
    const [clientId,surface,configStore]=JSON.parse(profileKey),definition=definitions.get(clientId);
    if(!definition)fail('NATIVE_PREREQUISITE_PROFILE_UNVERIFIED');
    const profile=selectClientSurface(definition,surface),auxiliary=loadNativePrerequisiteDefinition({definitionsDir:input.definitionsDir,clientId,surface,configStore});
    if(profile.configStore!==configStore||!profile.nativeInventory)fail('NATIVE_PREREQUISITE_PROFILE_UNVERIFIED');
    const pins=registration.prerequisites.filter(pin=>pin.clientId===clientId&&pin.surface===surface&&pin.configStore===configStore),selected=pins.map(pin=>receipts.find(receipt=>sameOrigin(receipt,pin)&&receipt.revisionDigest===pin.revisionDigest&&digest(receipt.locator)===pin.locatorDigest));
    if(selected.some(receipt=>!receipt||receipt.locator.definitionDigest!==canonicalDigest(definition)))fail('NATIVE_PREREQUISITE_PROFILE_UNVERIFIED');
    const context=captureNativePrerequisiteContext({homeDir:input.globalStore.homeDir,cwd:registration.project.targetRoot,inventory:profile.nativeInventory,systemFiles:auxiliary.systemFiles});
    result.push({registrationId:registration.id,profileKey,digest:digest({definition,auxiliary,contextDigest:context.digest}),
      paths:context.files.map(([file])=>file),discoveryRoots:selected.filter(receipt=>receipt.assetKind==='skills').map(receipt=>path.dirname(receipt.locator.targetBase))});
  }
  return result;
}
function observations(input,{held=false}={}) {
  return held?inspectHeldGlobalDependents({globalStore:input.globalStore}):inspectDependencyDependents({homeDir:input.globalStore.homeDir});
}
function evidence(input,state,observed) {
  if(observed.status!=='observed'||observed.projects.some(project=>project.verification!=='consistent'))fail('DEPENDENT_PROJECT_REVIEW_REQUIRED');
  const pins=uniquePins(state.dependencyIndex);assertInstalledDependencySources(pins);
  const native=contexts(input,state);
  return {native,guard:{schemaVersion:1,indexDigest:digest(state.dependencyIndex),projectDigest:projectDigest(observed),contextDigest:digest(native.map(({registrationId,profileKey,digest})=>({registrationId,profileKey,digest})))}};
}
function assertPinnedState(input,state) {
  const installed=latestInstallationReceipts(state);
  for(const pin of uniquePins(state.dependencyIndex)) {
    const receipt=installed.find(receipt=>sameOrigin(receipt,pin)&&receipt.revisionDigest===pin.revisionDigest&&digest(receipt.locator)===pin.locatorDigest);
    if(!receipt||installedBindingDigest(receipt)!==pin.bindingDigest)fail('GLOBAL_REVISION_IN_USE');
    const observation=observeInstallationReceipt({receipt,state,homeDir:input.globalStore.homeDir});
    if(observation.status!=='ownership-observed'||observation.dependencyState!=='revision-observed'||observation.bindingDeclarationsState==='unverified')fail('GLOBAL_REVISION_IN_USE');
  }
}
function assertEvidence(input,expected,nextState) {
  const current=input.globalStore.load();
  if(current.schemaVersion!==8||!current.dependencyIndex||digest(current.dependencyIndex)!==expected.indexDigest)fail('GLOBAL_DEPENDENCY_CONTEXT_CHANGED');
  const actual=evidence(input,current,observations(input,{held:true})).guard;
  if(digest(actual)!==digest(expected))fail('GLOBAL_DEPENDENCY_CONTEXT_CHANGED');
  if(nextState) {
    if(nextState.schemaVersion!==8||digest(nextState.dependencyIndex)!==expected.indexDigest||nextState.dependencyRegistration)fail('GLOBAL_DEPENDENCY_CONTEXT_CHANGED');
    assertPinnedState(input,nextState);
  }
}

function buildPlan(input,{held=false}={}) {
  const store=input.globalStore;
  const plans=input.rollback?[input.rollback]:input.plans,projectionKey={plans:input.plans,rollback:input.rollback};
  if(store.targetRoot!==store.homeDir||!store.homeDir)fail('DEPENDENCY_GLOBAL_STORE_REQUIRED');
  if(coordinationExists(coordinationJournalPath(store))||coordinationExists(`${store.statePath}.journal.json`)||!held&&coordinationExists(`${store.statePath}.lock`))fail('DEPENDENCY_COORDINATION_RECOVERY_REQUIRED');
  const {state,image}=coordinationSnapshot(store,store.homeDir);
  if(plans.some(plan=>plan.stateHash&&plan.stateHash!==deploymentStateHash(state)))fail('STALE_DEPLOYMENT_STATE');
  if(state.schemaVersion!==8||!state.dependencyIndex?.projects.length)fail('GLOBAL_DEPENDENCIES_NOT_REGISTERED');
  if(plans.some(plan=>plan.blocked?.length||plan.operations.some(operation=>operation.previewOnly)))fail('GLOBAL_MUTATION_PLAN_BLOCKED');
  const observed=observations(input,{held}),blocked=[];
  if(plans.flatMap(plan=>plan.operations).some(operation=>operation.strategy==='link'||!input.rollback?.treeTransaction&&operation.operation==='RESTORE_LINK'))blocked.push({code:'GLOBAL_MUTATION_DURABILITY_UNSUPPORTED'});
  let context;
  try{context=evidence(input,state,observed);}catch(error){blocked.push({code:error.code||'GLOBAL_DEPENDENCY_CONTEXT_UNVERIFIED'});}
  const prediction=input.rollback?predictRollbackInstallation({rollback:input.rollback,state,stateStore:store,backupStore:input.backupStore,homeDir:store.homeDir})
    :predictDeploymentInstallation({plans:input.plans,state,homeDir:store.homeDir,targetRoot:store.homeDir}),predicted=observePredictedInstallations({...projectionKey,homeDir:store.homeDir});
  const changes=uniquePins(state.dependencyIndex).map(pin=>{
    const found=predicted.find(({receipt})=>sameOrigin(receipt,pin)&&digest(receipt.locator)===pin.locatorDigest),valid=found?.observation.status==='ownership-observed'&&found.observation.dependencyState==='revision-observed'&&found.observation.bindingDeclarationsState!=='unverified';
    return {...pin,nextRevisionDigest:valid?found.receipt.revisionDigest:null,nextLocatorDigest:valid?digest(found.receipt.locator):null,nextBindingDigest:valid?installedBindingDigest(found.receipt):null};
  });
  const impact=evaluateGlobalDependencyChanges({index:state.dependencyIndex,observations:observed,changes});blocked.push(...impact.blocked);
  for(const target of prediction.targets) {
    if(isWithinRoot(target.target,path.dirname(store.statePath)))fail('DEPENDENCY_COORDINATION_TARGET_SCOPE_INVALID');
    if(target.before===target.after)continue;
    if(context?.native.some(native=>[...native.paths,...native.discoveryRoots].some(file=>isWithinRoot(target.target,file)||isWithinRoot(file,target.target))))blocked.push({code:'DEPENDENCY_NATIVE_CONTEXT_TRANSITION_REQUIRED',target:target.target});
  }
  const body={schemaVersion:1,kind:'global-dependency-mutation',action:input.rollback?'rollback':'apply',readOnly:true,fulfilled:false,automatic:blocked.length===0,blocked,impact,
    beforeStateDigest:digest(state),beforeStateImage:imageFingerprint(image),guard:context?.guard||null,targets:prediction.targets,fileModes:predictedInstallationFileModes(projectionKey),predictionDigest:prediction.digest};
  return {...body,digest:digest(body)};
}

export const planGlobalDependencyMutation=input=>buildPlan(input);
export function executeGlobalDependencyMutation(input) {
  const reviewed=buildPlan(input);
  if(!reviewed.automatic)fail('GLOBAL_MUTATION_PLAN_BLOCKED');
  if(digest(input.plan)!==digest(reviewed))fail('STALE_GLOBAL_MUTATION_PLAN');
  let authorized,lease;
  const markFailure=code=>{
    if(!lease||!coordinationExists(`${input.globalStore.statePath}.journal.json`))return;
    try {
      assertCoordinationLock(input.globalStore,lease);
      const {value:journal}=readCoordinationJson(`${input.globalStore.statePath}.journal.json`,input.globalStore.homeDir);
      if(journal.statePath!==input.globalStore.statePath||digest(journal.dependencyGuard)!==digest(reviewed.guard)||digest(journal.lockOwner)!==digest(lease.owner))return;
      journal.dependencyFailure={code:/^[A-Z][A-Z0-9_]{1,80}$/.test(code||'')?code:'GLOBAL_MUTATION_FAILED',owner:lease.owner};
      writeCoordinationJson(`${input.globalStore.statePath}.journal.json`,journal,input.globalStore.homeDir);
    }catch{/* Unverifiable journals and locks remain untouched for review. */}
  };
  const projectionKey={plans:input.plans,rollback:input.rollback};
  try{return withGlobalDependencyStoreSession({globalStore:input.globalStore,onPhase:input.onPhase,journalEvidence:reviewed.guard,journalModes:reviewed.fileModes,actionKind:input.rollback?'rollback':'apply',
    authorizeMutation:(store,produce)=>{
      if(store!==input.globalStore)fail('UNREVIEWED_DEPENDENCY_MUTATION');
      const mutations=produce();if(mutations.length!==reviewed.targets.length)fail('UNREVIEWED_DEPENDENCY_MUTATION');
      for(const mutation of mutations){const target=reviewed.targets.find(target=>target.target===mutation.target);if(!target||imageFingerprint(mutation.beforeImage)!==target.before||imageFingerprint(mutation.afterImage)!==target.after)fail('UNREVIEWED_DEPENDENCY_MUTATION');}
    },
    canRestore:()=>reviewed.targets.every(target=>{const actual=imageFingerprint(readPathImage(target.target,{authorizedRoot:input.globalStore.homeDir}));return actual===target.before||actual===target.after;}),
    prepareCommit:(store,next)=>{if(store!==input.globalStore)fail('DEPENDENCY_GLOBAL_STORE_REQUIRED');assertPredictedInstallation({...projectionKey,nextState:next});assertEvidence(input,reviewed.guard,next);authorized=digest(next);},
    authorizeCommit:(store,current,next)=>store===input.globalStore&&digest(current)===reviewed.beforeStateDigest&&digest(next)===authorized
      &&imageFingerprint(coordinationSnapshot(store,store.homeDir).image)===reviewed.beforeStateImage},session=>{
    lease=session.lease();
    if(digest(buildPlan(input,{held:true}))!==digest(reviewed))fail('STALE_GLOBAL_MUTATION_PLAN');assertDeploymentPredictionInputs(projectionKey);
    const options={...input,stateStore:input.globalStore,preflight:()=>{input.preflight?.();assertEvidence(input,reviewed.guard);},beforeCommit:()=>{input.beforeCommit?.();assertEvidence(input,reviewed.guard);}};
    const result=input.rollback?applyDeploymentRollback({...options,plan:input.rollback}):applyDeployment(options);
    markFailure('GLOBAL_MUTATION_CLEANUP_PENDING');
    return {...result,outcome:'committed',fulfilled:false};
  });}catch(error){markFailure(error.code);throw error;}
}

function recoveryContext(input) {
  const store=input.globalStore;
  if(store.targetRoot!==store.homeDir||!store.homeDir)fail('DEPENDENCY_GLOBAL_STORE_REQUIRED');
  const {value:journal}=readCoordinationJson(`${store.statePath}.journal.json`,store.homeDir),guard=journal.dependencyGuard;
  if(![1,2,3].includes(journal.schemaVersion)||journal.statePath!==store.statePath||!guard||guard.schemaVersion!==1
    ||Object.keys(guard).some(key=>!['schemaVersion','indexDigest','projectDigest','contextDigest'].includes(key))
    ||!['indexDigest','projectDigest','contextDigest'].every(key=>typeof guard[key]==='string'&&/^[a-f0-9]{64}$/.test(guard[key])))fail('INVALID_GLOBAL_DEPENDENCY_JOURNAL');
  const {value:owner}=readCoordinationJson(`${store.statePath}.lock`,store.homeDir),info=store.fileSystem.lstatSync(`${store.statePath}.lock`),lease={owner,identity:{dev:info.dev,ino:info.ino}};
  if(owner.pid!==journal.lockOwner?.pid||owner.token!==journal.lockOwner?.token)fail('RECOVERY_LOCK_UNPROVEN');
  const terminal=journal.dependencyFailure!==undefined;
  if(terminal&&(!journal.dependencyFailure||Object.keys(journal.dependencyFailure).some(key=>!['code','owner'].includes(key))
    ||typeof journal.dependencyFailure.code!=='string'||!/^[A-Z][A-Z0-9_]{1,80}$/.test(journal.dependencyFailure.code)||digest(journal.dependencyFailure.owner)!==digest(journal.lockOwner)))fail('INVALID_GLOBAL_DEPENDENCY_JOURNAL');
  const recovery={terminalOwner:terminal,assertHeld:()=>assertCoordinationLock(store,lease,{dead:!terminal})};recovery.assertHeld();
  return {guard,recovery};
}
function withGlobalRecovery(input,action) {
  const context=recoveryContext(input);
  return withGlobalDependencyStoreSession({globalStore:input.globalStore,recovery:context.recovery,journalEvidence:context.guard,
    authorizeMutation:()=>fail('UNREVIEWED_DEPENDENCY_MUTATION'),authorizeCommit:()=>false,
    assertRecovery:state=>assertEvidence(input,context.guard,state)},()=>action(context));
}
export function planGlobalDependencyRecovery(input) {
  return withGlobalRecovery(input,context=>{
    const recovery=planJournalRecovery({stateStore:input.globalStore,backupStore:input.backupStore}),body={schemaVersion:1,kind:'global-dependency-recovery',readOnly:true,fulfilled:false,guard:context.guard,recovery};
    return {...body,digest:digest(body)};
  });
}
export function applyGlobalDependencyRecovery(input) {
  const current=planGlobalDependencyRecovery(input);if(digest(current)!==digest(input.plan))fail('STALE_GLOBAL_MUTATION_RECOVERY');
  return withGlobalRecovery(input,()=>applyJournalRecovery({stateStore:input.globalStore,backupStore:input.backupStore,plan:current.recovery,onPhase:input.onPhase}));
}
