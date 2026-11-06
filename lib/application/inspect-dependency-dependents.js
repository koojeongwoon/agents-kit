import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {readPathImage,imageFingerprint,authorizeImagePath} from '../infrastructure/path-image.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {installedBindingDigest} from '../domain/dependency-reverse-index.js';
import {latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';
import {dependencyStoreSession} from '../infrastructure/dependency-store-session.js';
import {boundedRead} from '../infrastructure/import-source-reader.js';

const safeCode=error=>/^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code||'')?error.code:'DEPENDENCY_INDEX_UNVERIFIED';
const fail=code=>{throw domainError(code,'Registered dependency evidence is unavailable or inconsistent');};
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const pending=statePath=>[`${statePath}.lock`,`${statePath}.journal.json`].some(exists);
function projectImage(statePath,root) {
  authorizeImagePath(statePath,root);
  let info;try{info=fs.lstatSync(statePath);}catch(error){if(error.code==='ENOENT')fail('DEPENDENT_PROJECT_STATE_UNAVAILABLE');throw error;}
  if(!info.isFile()||info.nlink!==1)fail('DEPENDENT_PROJECT_STATE_UNSAFE');
  const image=readPathImage(statePath,{authorizedRoot:root});if(image.kind!=='file')fail('DEPENDENT_PROJECT_STATE_UNSAFE');return image;
}
const unknownProject=(registration,code)=>({registrationId:registration.id,project:structuredClone(registration.project),status:registration.status,
  generation:registration.generation,verification:'unverified',consumers:structuredClone(registration.consumers),
  prerequisites:registration.prerequisites.map(pin=>({...pin,revisionState:'unverified'})),issues:[{code}]});

// Reads only explicitly registered project paths. Missing/moved/corrupt paths
// preserve the index entry as unknown; they are never a reason to unlink it.
export function inspectDependencyDependents({homeDir,clock=()=>Date.now()}) {
  return inspectAtStore({store:new GlobalDeploymentStateStore({homeDir}),homeDir,clock});
}
export function inspectHeldGlobalDependents({globalStore,clock=()=>Date.now()}) {
  const session=dependencyStoreSession(globalStore);if(session?.kind!=='global-mutation')fail('DEPENDENCY_GLOBAL_SESSION_REQUIRED');session.assertHeld();
  return inspectAtStore({store:globalStore,homeDir:globalStore.homeDir,clock,held:true});
}
function inspectAtStore({store,homeDir,clock,held=false}) {
  const globalPending=()=>{
    if(exists(store.pendingPath))return true;
    if(!held)return pending(store.statePath);
    if(!exists(`${store.statePath}.journal.json`))return false;
    try {
      const journal=JSON.parse(boundedRead(`${store.statePath}.journal.json`).bytes.toString('utf8')),owner=JSON.parse(boundedRead(`${store.statePath}.lock`).bytes.toString('utf8'));
      return ![1,2,3].includes(journal.schemaVersion)||journal.statePath!==store.statePath||!journal.dependencyGuard
        ||installationDigest(journal.dependencyGuard)!==installationDigest(dependencyStoreSession(store)?.journalEvidence)
        ||journal.lockOwner?.pid!==owner.pid||journal.lockOwner?.token!==owner.token;
    }catch{return true;}
  };
  const base={schemaVersion:1,readOnly:true,coverage:'registered-projects-only',observedAt:new Date(clock()).toISOString(),fulfilled:false};
  try {
    store.authorize(store.statePath);const state=store.load(),index=state.dependencyIndex;
    if(!index) {
      if(globalPending())return {...base,status:'unverified',reason:'GLOBAL_DEPENDENCY_CONTEXT_PENDING',projects:[],issues:[{code:'GLOBAL_DEPENDENCY_CONTEXT_PENDING'}]};
      return {...base,status:'not-enabled',reason:'DEPENDENCY_INDEX_NOT_ENABLED',projects:[],issues:[]};
    }
    const indexDigest=installationDigest(index),stateDigest=installationDigest(state),registrations=index.projects;
    const unknown=code=>({...base,status:'unverified',indexGeneration:index.generation,indexDigest,stateDigest,
      projects:registrations.map(registration=>unknownProject(registration,code)),issues:[{code}]});
    if(globalPending())return unknown('GLOBAL_DEPENDENCY_CONTEXT_PENDING');
    const receipts=latestInstallationReceipts(state),ownership=new Map();
    function globalObservation(pin) {
      const candidates=receipts.filter(receipt=>receipt.scope==='global'&&['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore'].every(key=>receipt[key]===pin[key])
        &&installationDigest(receipt.locator)===pin.locatorDigest);
      if(candidates.length!==1)return {...pin,revisionState:'unverified',reason:candidates.length?'GLOBAL_DEPENDENCY_ORIGIN_AMBIGUOUS':'GLOBAL_DEPENDENCY_RECEIPT_UNAVAILABLE'};
      const receipt=candidates[0];
      if(receipt.revisionDigest!==pin.revisionDigest)return {...pin,revisionState:'unverified',reason:'GLOBAL_DEPENDENCY_REVISION_CHANGED'};
      if(![3,4].includes(receipt.schemaVersion)||installedBindingDigest(receipt)!==pin.bindingDigest)return {...pin,revisionState:'unverified',reason:'GLOBAL_DEPENDENCY_BINDING_UNVERIFIED'};
      if(!ownership.has(receipt.revisionDigest))ownership.set(receipt.revisionDigest,observeInstallationReceipt({receipt,state,homeDir}));
      const observed=ownership.get(receipt.revisionDigest);
      return {...pin,revisionState:observed.status==='ownership-observed'&&observed.dependencyState==='revision-observed'?'observed':'unverified',
        ...(observed.status!=='ownership-observed'||observed.dependencyState!=='revision-observed'?{reason:'GLOBAL_DEPENDENCY_OWNERSHIP_UNVERIFIED'}:{})};
    }
    const projects=registrations.map(registration=>{
      if(registration.status!=='active')return unknownProject(registration,'DEPENDENT_PROJECT_TRANSACTION_PENDING');
      const {targetRoot,sourceRoot}=registration.project,statePath=path.join(targetRoot,'.agent-kit/state.json');
      try {
        for(const root of [targetRoot,sourceRoot])if(resolveForAuthorization(root)!==root||!fs.statSync(root).isDirectory())fail('DEPENDENT_PROJECT_ORIGIN_UNVERIFIED');
        if(pending(statePath))fail('DEPENDENT_PROJECT_RECOVERY_OR_LOCK_PENDING');
        const image=projectImage(statePath,targetRoot),bytes=Buffer.from(image.content,'base64');
        // Parse the bounded snapshot through the same state validation port;
        // there is no second unbounded/path-following read of project state.
        const projectState=new DeploymentStateStore({statePath,fileSystem:{existsSync:()=>true,readFileSync:()=>bytes.toString('utf8')}}).load();
        if(projectState.schemaVersion!==8||installationDigest(projectState.dependencyRegistration)!==installationDigest(registration))fail('DEPENDENT_PROJECT_REGISTRATION_MISMATCH');
        if(!projectState.transactions.some(tx=>tx.id===registration.transactionId&&tx.type==='apply'&&tx.status==='committed'))fail('DEPENDENT_PROJECT_TRANSACTION_UNVERIFIED');
        const installed=latestInstallationReceipts(projectState),consumers=registration.consumers.map(reference=>{
          const matching=installed.filter(receipt=>receipt.scope==='project'&&receipt.sourceRoot===sourceRoot&&receipt.kitId===registration.project.kitId
            &&['assetId','assetKind','clientId','surface','configStore','revisionDigest'].every(key=>receipt[key]===reference[key])&&installationDigest(receipt.locator)===reference.locatorDigest);
          return {...reference,ownershipState:matching.length===1?observeInstallationReceipt({receipt:matching[0],state:projectState,homeDir,targetRoot}).status:'unverified'};
        });
        if(consumers.some(item=>item.ownershipState!=='ownership-observed'))fail('DEPENDENT_PROJECT_CONSUMER_UNVERIFIED');
        const prerequisites=registration.prerequisites.map(globalObservation);
        if(pending(statePath)||imageFingerprint(projectImage(statePath,targetRoot))!==imageFingerprint(image))fail('DEPENDENT_PROJECT_CONTEXT_CHANGED');
        return {registrationId:registration.id,project:structuredClone(registration.project),status:registration.status,generation:registration.generation,
          verification:prerequisites.every(item=>item.revisionState==='observed')?'consistent':'unverified',stateFingerprint:imageFingerprint(image),consumers,prerequisites,
          issues:prerequisites.filter(item=>item.revisionState!=='observed').map(item=>({code:item.reason,assetId:item.assetId,assetKind:item.assetKind}))};
      }catch(error){return unknownProject(registration,['ENOENT','ENOTDIR'].includes(error.code)?'DEPENDENT_PROJECT_STATE_UNAVAILABLE':safeCode(error));}
    });
    if(globalPending()||installationDigest(store.load())!==stateDigest)return unknown('GLOBAL_DEPENDENCY_CONTEXT_CHANGED');
    return {...base,status:'observed',indexGeneration:index.generation,indexDigest,stateDigest,projects,issues:[]};
  }catch(error){return {...base,status:'unverified',reason:safeCode(error),projects:[],issues:[{code:safeCode(error)}]};}
}
