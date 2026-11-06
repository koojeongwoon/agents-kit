import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {dependencyIndexFixture} from './dependency-index-fixture.js';
import {GlobalDeploymentStateStore} from '../../lib/infrastructure/global-deployment-state-store.js';
import {DeploymentStateStore} from '../../lib/infrastructure/deployment-state-store.js';
import {DeploymentBackupStore} from '../../lib/infrastructure/deployment-backup-store.js';
import {latestInstallationReceipts} from '../../lib/application/installation-receipt-service.js';
import {installationDigest,createInstallationReceipt} from '../../lib/domain/installation-receipt.js';
import {readPathImage,imageFingerprint} from '../../lib/infrastructure/path-image.js';
import {prepareCopyDeployment} from '../../lib/application/prepare-copy-deployment.js';
import {applyDeployment} from '../../lib/application/apply-deployment.js';
import {deploymentStateHash} from '../../lib/application/shared-resource-deployment.js';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function coordinationStores(input) {
  const globalStore=new GlobalDeploymentStateStore({homeDir:input.homeDir}),projectStore=new DeploymentStateStore({statePath:path.join(input.project.targetRoot,'.agent-kit/state.json')});
  projectStore.targetRoot=input.project.targetRoot;projectStore.homeDir=input.homeDir;
  return {globalStore,projectStore};
}
export function coordinationRequest(input,{release=false}={}) {
  const stores=coordinationStores(input),before=readPathImage(input.target,{authorizedRoot:input.project.targetRoot});
  return {...stores,project:input.project,transactionId:release?input.releaseTransactionId:input.transactionId,upsertConsumers:release?[]:[input.consumer],prerequisites:release?[]:[input.pin],releaseConsumerIds:release?[input.consumer.assetId]:[],
    targets:release||input.edit?[{target:input.target,before:imageFingerprint(before),after:imageFingerprint(release?{kind:'absent'}:{kind:'file',mode:before.mode,content:Buffer.from(input.updatedBody).toString('base64')})}]:[],
    verifyPrerequisites:()=>({verified:true,digest:installationDigest({fixture:'synthetic native prerequisites only',pin:input.pin})})};
}
export function coordinationFixture(t,{edit=false}={}) {
  const f=dependencyIndexFixture(t),target=f.consumer.proofs[0].target,body=fs.readFileSync(target,'utf8');
  for(const environment of [f.global,f.project]) {const state=environment.state();state.schemaVersion=7;delete state.dependencyIndex;delete state.dependencyRegistration;fs.writeFileSync(environment.statePath,JSON.stringify(state));}
  const {schemaVersion,proofs,directories,revisionDigest,...descriptor}=f.consumer,updatedBody=body+'\n# Coordinated update\n';
  const predicted=edit?createInstallationReceipt(descriptor,{proofs:proofs.map(proof=>({...proof,contentHash:sha(updatedBody)})),directories}):f.consumer;
  const consumer={...f.registration.consumers[0],revisionDigest:predicted.revisionDigest},serialized={homeDir:f.global.homeDir,project:f.registration.project,target,edit,updatedBody,consumer,pin:f.registration.prerequisites[0],transactionId:`tx-project-${crypto.randomUUID()}`,releaseTransactionId:`tx-release-${crypto.randomUUID()}`};
  return {...f,target,transactionId:serialized.transactionId,serialized,request:options=>coordinationRequest(serialized,options)};
}
export function executeProjectFixture(f,context,{release=false,phase}={}) {
  const input=f.serialized||f,state=context.projectStore.load(),target=input.target,receipt=latestInstallationReceipts(state).find(item=>item.assetId===input.consumer.assetId);
  let prepared;
  if(release)prepared={clientId:'codex',blocked:[],operations:[{clientId:'codex',assetId:receipt.assetId,assetKind:'agents',strategy:'resource-removal',operation:'REMOVE',ownership:'file',target,
    beforeHash:sha(fs.readFileSync(target)),expectedHash:null,modeAware:true,beforeMode:fs.statSync(target).mode&0o777,afterMode:null,nextManaged:null,authorizedRoot:input.project.targetRoot}]};
  else if(input.edit) {
    prepared=prepareCopyDeployment({capabilityPlan:{clientId:'codex',blocked:[],operations:[{clientId:'codex',assetId:receipt.assetId,assetKind:'agents',scope:'project',strategy:'copy',target:path.relative(input.project.targetRoot,target),rendered:{content:input.updatedBody},resource:state.managed[target].resource,dependencyIds:state.managed[target].resource?.dependencyIds}]},sources:new Map(),state,targetRoot:input.project.targetRoot,homeDir:input.homeDir});
    const {schemaVersion,proofs,directories,revisionDigest,...descriptor}=receipt;prepared={...prepared,locators:[receipt.locator],installationDescriptors:[descriptor]};
  }else prepared={clientId:'codex',blocked:[],operations:[]};
  return applyDeployment({plans:[{...prepared,stateHash:deploymentStateHash(state)}],stateStore:context.projectStore,
    backupStore:new DeploymentBackupStore({backupsRoot:path.join(input.project.targetRoot,'.agent-kit/backups')}),createTransactionId:()=>context.transactionId,
    beforeCommit:()=>{if(phase==='child-before-state')process.kill(process.pid,'SIGKILL');}});
}
export function executeUnreviewedProjectFixture(f,context,{global=false}={}) {
  const input=f.serialized||f,store=global?context.globalStore:context.projectStore,targetRoot=global?input.homeDir:input.project.targetRoot;
  const prepared=prepareCopyDeployment({capabilityPlan:{clientId:'codex',blocked:[],operations:[{clientId:'codex',assetId:'unreviewed',assetKind:'agents',scope:global?'global':'project',strategy:'copy',target:'unreviewed.txt',rendered:{content:'Unreviewed client mutation\n'}}]},sources:new Map(),state:store.load(),targetRoot,homeDir:input.homeDir});
  return applyDeployment({plans:[prepared],stateStore:store,backupStore:new DeploymentBackupStore({backupsRoot:path.join(targetRoot,'.agent-kit/unreviewed-backups')}),createTransactionId:()=>context.transactionId});
}
