import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {resolveForAuthorization,assertSafeProjectTarget} from '../security-boundary.js';
import {resolveAssetSources} from '../infrastructure/manifest-loader.js';
import {DeploymentStateStore} from '../infrastructure/deployment-state-store.js';
import {GlobalDeploymentStateStore} from '../infrastructure/global-deployment-state-store.js';
import {coordinationSnapshot} from '../infrastructure/dependency-coordination-io.js';
import {readPathImage,imageFingerprint} from '../infrastructure/path-image.js';
import {loadScopedDeploymentContexts} from './resource-catalog-service.js';
import {planVerifiedScopedClientDeployment} from './plan-verified-client-deployment.js';
import {prepareCopyDeployment} from './prepare-copy-deployment.js';
import {prepareMergeDeployment} from './prepare-merge-deployment.js';
import {prepareManagedLinkDeployment} from './prepare-managed-link-deployment.js';
import {prepareSharedDeployment,sharedConsumerId,deploymentStateHash} from './shared-resource-deployment.js';
import {preparePhysicalResourceDeployment} from './prepare-physical-resource-deployment.js';
import {deploymentOperationImage} from './deployment-command.js';
import {predictDeploymentInstallation} from './deployment-installation-prediction.js';
import {deploymentPathDriftBlocks} from './deployment-path-drift.js';
import {createDeploymentLocators} from './deployment-locator-evidence.js';
import {resolveScopedDeploymentPrerequisites} from './scoped-deployment-prerequisites.js';
import {describeScopedInstallationResources} from './installation-receipt-service.js';
import {skillDistributionReviews,describeSkillSelections} from './skill-distribution-deployment.js';
import {loadNativeSkillPolicy,nativeSkillPolicyContext} from '../infrastructure/native-skill-policy-loader.js';

const fail=code=>{throw domainError(code,'Scoped compilation requires authorized source and client contexts');};
function operationImages(operation,targetRoot) {
  const beforeImage=readPathImage(operation.target,{authorizedRoot:targetRoot}),afterImage=deploymentOperationImage(operation,beforeImage,{newFileMode:0o666&~process.umask()});
  return {target:operation.target,before:imageFingerprint(beforeImage),after:imageFingerprint(afterImage)};
}
const safeBlock=block=>Object.fromEntries(['reason','assetId','assetKind','clientId','target','prerequisiteKey'].filter(key=>block[key]!==undefined).map(key=>[key,block[key]]));

// Internal read-only compiler. It reuses the ordinary conversion, ownership,
// merge and snapshot planners. Its prepared plans retain the execution gate;
// receipt/registration dispatch must be integrated before any public apply.
export function compileScopedDeployment({kitRoot,projectName='default',projectPath,scope='project',clientId,surface,clientVersion,selectedAssetIds,previewOptIn=false,
  homeDir,definitions,definitionsDir,binaryObserver,verifyPrerequisites}) {
  if(!['project','global'].includes(scope))fail('INVALID_SCOPE');
  if(scope==='project'&&!projectPath)fail('PROJECT_PATH_REQUIRED');
  if(!definitions?.has(clientId))fail('CLIENT_DEFINITION_NOT_FOUND');
  homeDir=resolveForAuthorization(homeDir);
  if(scope==='project')assertSafeProjectTarget({targetDir:projectPath,homeDir,projectRoot:path.resolve(import.meta.dirname,'../..'),kitRoot});
  const {contexts,scopes}=loadScopedDeploymentContexts({kitRoot,projectName,projectPath:scope==='project'?projectPath:undefined,homeDir}),index=scope==='project'?1:0,source=contexts[index],origin=scopes[index];
  if(source.status!=='ready')fail('SCOPED_CONTEXT_UNAVAILABLE');
  const sourceRoot=resolveForAuthorization(origin.scopeRoot),targetRoot=resolveForAuthorization(origin.targetRoot),manifest=source.manifest,definition=definitions.get(clientId),profile=selectClientSurface(definition,surface);
  const nativeSkillPolicy=loadNativeSkillPolicy({definitionsDir,clientId,surface:profile.id,configStore:profile.configStore}),nativePolicyContext=definitionsDir?nativeSkillPolicyContext(definitionsDir):[];
  const {plan:capabilityPlan,runtimeCheck}=planVerifiedScopedClientDeployment({contexts,sourceContextId:source.id,definition,clientVersion,surface,selectedAssetIds,previewOptIn,
    platform:process.platform,arch:process.arch,binaryObserver,nativeSkillPolicy});
  const selection=capabilityPlan.selection,globalStore=new GlobalDeploymentStateStore({homeDir}),global=coordinationSnapshot(globalStore,homeDir),
    stateStore=scope==='global'?globalStore:new DeploymentStateStore({statePath:path.join(targetRoot,'.agent-kit/state.json')});stateStore.homeDir=homeDir;stateStore.targetRoot=targetRoot;
  const state=scope==='global'?global.state:coordinationSnapshot(stateStore,targetRoot).state;
  const skillSelections=new Map([...capabilityPlan.operations,...capabilityPlan.blocked].filter(item=>item.skillSelection).map(item=>[item.assetId,item.skillSelection]));
  const sources=resolveAssetSources(manifest,sourceRoot,selection.selectedAssetIds,{boundedAssetIds:selection.selectedAssetIds,skillSelections});
  const consumerId=sharedConsumerId(manifest.kit.id,clientId,profile.id),desired=capabilityPlan.operations.map(planned=>({planned,kitId:manifest.kit.id,consumerId}));
  const contributions=desired.filter(item=>item.planned.commonSource).map(item=>({...item,source:sources.get(item.planned.assetId)}));
  const strategyPlan={...capabilityPlan,blocked:[],operations:capabilityPlan.operations.filter(operation=>!operation.commonSource)},physical=preparePhysicalResourceDeployment({contributions:strategyPlan.operations.filter(item=>item.rendered&&item.resource),state,targetRoot,homeDir,scope,sourceRoot});
  const remaining={capabilityPlan:{...strategyPlan,operations:strategyPlan.operations.filter(item=>!physical.handled.has(item))},state,sources,targetRoot,homeDir};
  const plans=[{clientId,operations:[],blocked:[...capabilityPlan.blocked,...deploymentPathDriftBlocks({state,desired,targetRoot,homeDir,scope})]},
    {operations:physical.operations,blocked:physical.blocked},prepareCopyDeployment(remaining),prepareMergeDeployment(remaining),prepareManagedLinkDeployment(remaining),
    prepareSharedDeployment({contributions,state,targetRoot,homeDir,scope,sourceRoot})];
  const seen=new Set();for(const operation of plans.flatMap(plan=>plan.operations)){if(seen.has(operation.target))plans[0].blocked.push({...operation,reason:'DUPLICATE_DEPLOYMENT_TARGET'});seen.add(operation.target);}
  const installation=resolveScopedDeploymentPrerequisites({selection,contexts,scopes,definition,profile,clientVersion:capabilityPlan.targetProfile.clientVersion,nativeSkillPolicy,state:global.state,homeDir});plans[0].blocked.push(...installation.blocked);
  const project=scope==='project'?{kitId:manifest.kit.id,projectName,sourceRoot,targetRoot}:null;
  let native={verified:!installation.entries.length,digest:null};
  if(project&&installation.prerequisites.length&&!installation.blocked.length)try{const result=verifyPrerequisites?.({project,prerequisites:structuredClone(installation.prerequisites)});native={verified:result?.verified===true&&/^[a-f0-9]{64}$/.test(result.digest||''),digest:result?.digest||null};}catch{/* Missing/failed proof remains unknown. */}
  if(!native.verified)plans[0].blocked.push({reason:'DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'});
  plans[0].blocked.push({reason:'SCOPED_DEPLOYMENT_NOT_ENABLED'});
  const locators=createDeploymentLocators({desired,definitions,targetRoot,homeDir,scope}),installationDescriptors=describeScopedInstallationResources({contexts,scopes,sourceContextId:source.id,locators}),
    skillSelectionDescriptors=describeSkillSelections({manifest,locators,desired}),
    stamped=plans.map((plan,index)=>({...plan,stateHash:deploymentStateHash(state),...(index===0?{locators,installationDescriptors,...(skillSelectionDescriptors.length?{skillSelectionDescriptors}:{})}:{})}));
  for(const {planned} of desired)if(!locators.some(locator=>locator.assetId===planned.assetId&&locator.assetKind===planned.assetKind))stamped[0].blocked.push({reason:'SCOPED_INSTALLATION_DESCRIPTOR_REQUIRED',assetId:planned.assetId,assetKind:planned.assetKind});
  let targets=plans.flatMap(plan=>plan.operations).filter(operation=>operation.operation!=='SKIP').map(operation=>operationImages(operation,targetRoot));
  let prediction;
  if(!plans.flatMap(plan=>plan.blocked).some(block=>!['SCOPED_DEPLOYMENT_NOT_ENABLED','DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'].includes(block.reason)))try {
    prediction=predictDeploymentInstallation({plans:stamped,state,globalState:scope==='project'?global.state:undefined,homeDir,targetRoot,consumerPrerequisiteIds:installation.consumers});targets=prediction.targets;
  }catch(error){if(error.name!=='DomainError')throw error;stamped[0].blocked.push({reason:error.code});}
  const sourceImages=[...sources].map(([assetId,file])=>({assetId,path:file,fingerprint:imageFingerprint(readPathImage(file,{authorizedRoot:sourceRoot}))}));
  const operations=plans.flatMap(plan=>plan.operations).map(operation=>Object.fromEntries(['clientId','assetId','assetKind','target','strategy','format','operation','reason','beforeHash','expectedHash','ownership','beforeMode','afterMode'].filter(key=>operation[key]!==undefined).map(key=>[key,operation[key]])));
  const body={schemaVersion:1,kind:'scoped-preview',readOnly:true,automatic:false,fulfilled:false,targetProfile:capabilityPlan.targetProfile,scope,project,selection,
    operations,targets,globalPrerequisites:installation.entries,consumerPrerequisiteIds:installation.consumers,nativePrerequisitesState:!installation.entries.length?'not-required':native.verified?'observed':'unverified',
    ...(skillSelections.size?{skillDistributions:skillDistributionReviews({plan:capabilityPlan,definitions,homeDir,targetRoot,scope})}:{}),
    ...(prediction?{predictionDigest:prediction.digest,predictedInstallations:prediction.receipts.map(receipt=>({assetId:receipt.assetId,assetKind:receipt.assetKind,revisionDigest:receipt.revisionDigest,locatorDigest:installationDigest(receipt.locator)}))}:{}),
    blocked:plans.flatMap(plan=>plan.blocked).map(safeBlock),
    inputDigest:installationDigest({contexts,sourceRoot,targetRoot,definition,nativePolicyContext,globalState:global.state,state,sourceImages,runtimeCheck,nativeDigest:native.digest})};
  return {review:structuredClone({...body,digest:installationDigest(body)}),plans:stamped,stateStore,globalStore,contexts,scopes,manifest,selection,locators,targets,sourceImages,
    prerequisites:installation.prerequisites,toolRequirements:installation.toolRequirements,nativePolicyContext,...(prediction?{prediction}:{}),...(runtimeCheck?{runtimeCheck}:{})};
}
