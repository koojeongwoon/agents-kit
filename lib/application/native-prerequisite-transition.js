import crypto from 'node:crypto';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {authorizeImagePath,readPathImage,imageFingerprint} from '../infrastructure/path-image.js';
import {isWithinRoot} from '../security-boundary.js';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {verifyManagedSnapshots} from '../infrastructure/skill-snapshot-store.js';
import {latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';

const same=(a,b)=>installationDigest(a)===installationDigest(b);
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw domainError(code,'Native context transitions require the exact reviewed project changes and fresh native observation');};
const denied=reason=>({schemaVersion:1,readOnly:true,fulfilled:false,modelTurnsRequested:false,toolCallsRequested:false,status:'unverified',reason});

// The observation records and verifier functions are private application ports.
// Returned IDs and JSON summaries cannot create positive transition evidence.
export function createNativePrerequisiteTransitions({lookupObservation,observe,environment,assertUnchanged,clock,observationTtlMs}) {
  const transitions=new Map();
  const fresh=record=>record&&clock()>=record.createdAt&&clock()-record.createdAt<=observationTtlMs;
  function managedLink(request,target,image) {
    const state=new DeploymentStateStore({statePath:path.join(request.project.targetRoot,'.agent-kit/state.json')}).load(),record=state.managed[target];
    if(record?.connection?.strategy!=='snapshot-link'||record.linkSource!==image.source)fail('EXTERNAL_RESOURCE_READ_ONLY');
    verifyManagedSnapshots({homeDir:request.globalStore.homeDir,records:[record]});
    const matching=latestInstallationReceipts(state).filter(receipt=>receipt.schemaVersion===4&&receipt.scope==='project'&&receipt.kitId===request.project.kitId&&receipt.sourceRoot===request.project.sourceRoot
      &&receipt.locator.strategy==='snapshot-link'&&receipt.proofs.some(proof=>proof.target===target&&proof.linkSource===image.source));
    if(matching.length!==1||observeInstallationReceipt({receipt:matching[0],state,globalState:request.globalStore.load(),homeDir:request.globalStore.homeDir,targetRoot:request.project.targetRoot}).status!=='ownership-observed')fail('EXTERNAL_RESOURCE_READ_ONLY');
    return installationDigest(record);
  }
  function targetImages(record,side) {
    for(const target of record.targets)if(imageFingerprint(readPathImage(target.target,{authorizedRoot:record.before.request.project.targetRoot}))!==target[side])fail('NATIVE_PREREQUISITE_TRANSITION_CHANGED');
  }
  function contextAfter(record) {
    const current=environment(record.before.request),before=record.before.before;
    if(!same(current.binary,before.binary)||current.definitionDigest!==before.definitionDigest||!same(current.context.configPaths,before.context.configPaths)
      ||current.context.files.length!==before.context.files.length)fail('NATIVE_PREREQUISITE_CONTEXT_CHANGED');
    targetImages(record,'after');
    for(const [file,image] of before.context.files) {
      const actual=current.context.files.find(([target])=>target===file);
      if(!actual||!record.targets.some(target=>target.target===file)&&!same(actual[1],image))fail('NATIVE_PREREQUISITE_CONTEXT_CHANGED');
    }
  }
  function matches(record,{project,prerequisites}={}) {
    return fresh(record)&&same(project,record.before.request.project)&&Array.isArray(prerequisites)
      &&same([...prerequisites].sort((a,b)=>a.id.localeCompare(b.id)),[...record.before.request.prerequisites].sort((a,b)=>a.id.localeCompare(b.id)));
  }
  function assertBefore(record) {assertUnchanged(record.before.request,record.before.before);targetImages(record,'before');for(const link of record.links)if(managedLink(record.before.request,link.target,readPathImage(link.target,{authorizedRoot:record.before.request.project.targetRoot}))!==link.digest)fail('NATIVE_PREREQUISITE_TRANSITION_CHANGED');}
  function assertAfter(record) {
    contextAfter(record);
    if(!record.requiresObservation)assertUnchanged(record.before.request,record.before.before);
    else {
      if(!fresh(record.after))fail('NATIVE_PREREQUISITE_TRANSITION_UNOBSERVED');
      assertUnchanged(record.after.request,record.after.before);
    }
  }
  return {
    prepareTransition({observationId,targets}={}) {
      const before=lookupObservation(observationId);if(!fresh(before))fail('NATIVE_PREREQUISITE_TRANSITION_UNVERIFIED');
      assertUnchanged(before.request,before.before);
      if(!Array.isArray(targets)||targets.length>256)fail('INVALID_NATIVE_PREREQUISITE_TRANSITION');
      const seen=[],links=[];
      for(const target of targets) {
        if(!target||Object.keys(target).some(key=>!['target','before','after'].includes(key))||typeof target.target!=='string'||!HASH.test(target.before)||!HASH.test(target.after))fail('INVALID_NATIVE_PREREQUISITE_TRANSITION');
        authorizeImagePath(target.target,before.request.project.targetRoot);
        if(isWithinRoot(target.target,before.request.project.sourceRoot)||isWithinRoot(target.target,path.join(before.request.project.targetRoot,'.agent-kit'))
          ||seen.some(file=>isWithinRoot(file,target.target)||isWithinRoot(target.target,file)))fail('NATIVE_PREREQUISITE_TRANSITION_SCOPE_INVALID');
        for(const [file] of before.before.context.files)if((isWithinRoot(file,target.target)||isWithinRoot(target.target,file))
          &&(file!==target.target||!before.before.context.configPaths.includes(file)))fail('NATIVE_PREREQUISITE_TRANSITION_SCOPE_INVALID');
        const image=readPathImage(target.target,{authorizedRoot:before.request.project.targetRoot});
        if(image.kind==='symlink')links.push({target:target.target,digest:managedLink(before.request,target.target,image)});
        if(imageFingerprint(image)!==target.before)fail('NATIVE_PREREQUISITE_TRANSITION_CHANGED');
        seen.push(target.target);
      }
      for(const [id,record] of transitions)if(!fresh(record))transitions.delete(id);
      if(transitions.size>=128)transitions.delete(transitions.keys().next().value);
      const transitionId=crypto.randomUUID(),record={before,links,targets:structuredClone(targets),createdAt:before.createdAt,requiresObservation:targets.some(target=>target.before!==target.after)};
      record.digest=installationDigest({beforeDigest:before.digest,targets:record.targets});transitions.set(transitionId,record);
      const reviewDigest=installationDigest({project:before.request.project,prerequisites:before.request.prerequisites,toolRequirements:before.request.toolRequirements,
        binary:before.before.binary,definitionDigest:before.before.definitionDigest,contextDigest:before.before.context.digest,targets:record.targets});
      return {schemaVersion:1,transitionId,status:'prepared',requiresReobservation:record.requiresObservation,reviewDigest,fulfilled:false};
    },
    transitionVerifier({transitionId}={}) {
      return ({stage='before',...request}={})=>{
        const record=transitions.get(transitionId);
        try {if(!matches(record,request)||record.failed)return {verified:false,digest:null};if(stage==='before')assertBefore(record);else if(stage==='after')assertAfter(record);else return {verified:false,digest:null};return {verified:true,digest:record.digest};}
        catch{return {verified:false,digest:null};}
      };
    },
    async observeTransition({transitionId}={}) {
      const record=transitions.get(transitionId);
      if(!fresh(record)||record.failed||record.observing)return denied('NATIVE_PREREQUISITE_TRANSITION_UNVERIFIED');
      record.observing=true;
      try {
        contextAfter(record);
        if(record.view||!record.requiresObservation) {
          assertAfter(record);return structuredClone(record.view||{schemaVersion:1,transitionId,readOnly:true,fulfilled:false,modelTurnsRequested:false,toolCallsRequested:false,status:'observed'});
        }
        const result=await observe(record.before.request),after=lookupObservation(result.observationId);
        if(result.status!=='observed'||!fresh(record)||!fresh(after))fail(result.reason||'NATIVE_PREREQUISITE_TRANSITION_UNOBSERVED');
        contextAfter(record);assertUnchanged(after.request,after.before);record.after=after;
        const {observationId,...view}=result;record.view={...view,transitionId};return structuredClone(record.view);
      }catch(error){record.failed=true;return denied(/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'NATIVE_PREREQUISITE_TRANSITION_FAILED');}
      finally{record.observing=false;}
    }
  };
}
