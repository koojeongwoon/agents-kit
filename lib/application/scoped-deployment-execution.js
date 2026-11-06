import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {dependencyConsumerKey} from '../domain/dependency-registration-change.js';
import {matchesInstallationOrigin} from '../domain/scoped-installation-declaration.js';
import {loadClientDefinitions} from '../infrastructure/client-definition-loader.js';
import {readPathImage,imageFingerprint} from '../infrastructure/path-image.js';
import {createNativePrerequisiteService} from './native-prerequisite-service.js';
import {compileScopedDeployment} from './scoped-deployment-compiler.js';
import {loadScopedDeploymentContexts} from './resource-catalog-service.js';
import {latestInstallationReceipts} from './installation-receipt-service.js';
import {planDependencyCoordination,executeDependencyCoordinationAsync} from './dependency-coordination-service.js';
import {applyDeploymentAsync} from './apply-deployment.js';
import {compileScopedResourceRemoval} from './scoped-resource-removal.js';
import {compileScopedDeploymentRollback} from './scoped-deployment-rollback.js';
import {applyDeploymentRollbackAsync} from './rollback-deployment.js';
import {observePredictedInstallations} from './deployment-installation-prediction.js';
import {globalInstallationDependencies} from '../domain/scoped-installed-relations.js';
import {nativeSkillPolicyContext} from '../infrastructure/native-skill-policy-loader.js';

const IGNORED=new Set(['SCOPED_DEPLOYMENT_NOT_ENABLED','DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED']);
const fail=code=>{throw domainError(code,'Scoped deployment requires the reviewed sources, installed prerequisites and native context');};
const same=(a,b)=>installationDigest(a)===installationDigest(b);

function retainedToolRequirements(registration,projectState,globalState) {
  const requirements=[],global=latestInstallationReceipts(globalState);
  for(const consumer of registration?.consumers||[]) {
    const receipt=latestInstallationReceipts(projectState).find(receipt=>['assetId','assetKind','clientId','surface','configStore','revisionDigest'].every(key=>receipt[key]===consumer[key]));
    if(!receipt||receipt.schemaVersion!==4)continue;
    for(const binding of receipt.declaration.toolBindings) {
      const origin=receipt.declaration.origins.find(origin=>origin.id===binding.provider.originId);
      if(origin?.scope.type!=='global')continue;
      const candidates=registration.prerequisites.filter(pin=>pin.assetId===binding.provider.assetId&&pin.assetKind==='mcpServers'&&global.some(item=>matchesInstallationOrigin(item,origin)
        &&['assetId','assetKind','clientId','surface','configStore','revisionDigest'].every(key=>item[key]===pin[key])&&installationDigest(item.locator)===pin.locatorDigest));
      if(candidates.length!==1)fail('DEPENDENCY_INSTALLATION_PREREQUISITE_UNVERIFIED');
      requirements.push({providerId:candidates[0].id,toolId:binding.toolId});
    }
  }
  return requirements;
}

export function createScopedDeploymentExecution({homeDir,definitionsDir,binaryObserver,nativeInventoryObserver,clock}) {
  const native=createNativePrerequisiteService({homeDir,definitionsDir,binaryObserver,nativeInventoryObserver,clock});
  const compile=input=>(input.rollback?compileScopedDeploymentRollback:input.removal?compileScopedResourceRemoval:compileScopedDeployment)({...input,homeDir,definitions:loadClientDefinitions({definitionsDir}),definitionsDir,binaryObserver});
  function current(entry) {
    const compiled=compile(entry.input);if(compiled.review.digest!==entry.compiled.review.digest)fail('STALE_DEPLOYMENT_PLAN');
    return compiled;
  }
  function runtime(entry) {
    const {contexts}=loadScopedDeploymentContexts({kitRoot:entry.input.kitRoot,projectName:entry.input.projectName,projectPath:entry.input.scope==='project'?entry.input.projectPath:undefined,homeDir});
    if(!same(contexts,entry.compiled.contexts))fail('STALE_DEPLOYMENT_PLAN');
    if(!same([...loadClientDefinitions({definitionsDir})],entry.definitions))fail('STALE_DEPLOYMENT_PLAN');
    if(entry.compiled.nativePolicyContext&&!same(nativeSkillPolicyContext(definitionsDir),entry.compiled.nativePolicyContext))fail('STALE_DEPLOYMENT_PLAN');
    if(entry.compiled.runtimeCheck&&!same(binaryObserver(entry.compiled.runtimeCheck.profile),entry.compiled.runtimeCheck.observed))fail('CLIENT_BINARY_CHANGED');
    for(const source of entry.compiled.sourceImages)if(imageFingerprint(readPathImage(source.path,{authorizedRoot:entry.compiled.review.project?.sourceRoot||entry.compiled.scopes[0].scopeRoot}))!==source.fingerprint)fail('STALE_DEPLOYMENT_PLAN');
  }
  const toolRequirements=values=>[...new Map(values.map(value=>[installationDigest(value),value])).values()];
  return {
    prepare({compiled,input,transactionId=`tx-scoped-${crypto.randomUUID()}`}) {
      const entry={compiled,input,transactionId,definitions:[...loadClientDefinitions({definitionsDir})],issues:compiled.review.blocked.filter(block=>!IGNORED.has(block.reason)),observed:false};
      if(!compiled.removal&&!compiled.rollback&&!compiled.prediction)entry.issues.push({reason:'SCOPED_INSTALLATION_PREDICTION_REQUIRED'});
      if(input.scope==='project'&&!entry.issues.length)try {
        const projectState=compiled.stateStore.load(),globalState=compiled.globalStore.load(),registration=projectState.dependencyRegistration?.status==='active'?projectState.dependencyRegistration:null;
        const selected=new Set(compiled.selection.selectedAssetIds),newConsumers=compiled.prediction?.consumers||[];
        const changedToLocal=(registration?.consumers||[]).filter(consumer=>selected.has(consumer.assetId)&&!newConsumers.some(next=>dependencyConsumerKey(next)===dependencyConsumerKey(consumer)));
        if(changedToLocal.length) {
          const installations=observePredictedInstallations({plans:compiled.plans,homeDir,targetRoot:compiled.stateStore.targetRoot,globalState});
          for(const consumer of changedToLocal) {
            const replacement=installations.filter(({receipt,observation})=>dependencyConsumerKey(receipt)===dependencyConsumerKey(consumer)&&receipt.schemaVersion===4&&receipt.sourceRoot===compiled.review.project.sourceRoot&&receipt.kitId===compiled.review.project.kitId
              &&observation.status==='ownership-observed'&&observation.dependencyState==='revision-observed'&&observation.bindingDeclarationsState!=='unverified'&&!globalInstallationDependencies(receipt).length);
            if(replacement.length!==1)fail('DEPENDENCY_CONSUMER_RELEASE_REQUIRED');
          }
          compiled.releaseConsumers=[...(compiled.releaseConsumers||[]),...changedToLocal];
        }
        const released=new Set((compiled.releaseConsumers||[]).map(dependencyConsumerKey));
        const consumers=new Map((registration?.consumers||[]).filter(consumer=>!released.has(dependencyConsumerKey(consumer))).map(consumer=>[dependencyConsumerKey(consumer),consumer]));for(const consumer of newConsumers)consumers.set(dependencyConsumerKey(consumer),consumer);
        if(consumers.size||released.size) {
          const pins=new Map((registration?.prerequisites||[]).map(pin=>[pin.id,pin]));for(const pin of compiled.prerequisites){if(pins.has(pin.id)&&!same(pins.get(pin.id),pin))fail('DEPENDENCY_REVISION_REPLACEMENT_REQUIRES_RELEASE');pins.set(pin.id,pin);}
          const used=new Set([...consumers.values()].flatMap(consumer=>consumer.prerequisiteIds));
          entry.request={globalStore:compiled.globalStore,projectStore:compiled.stateStore,project:compiled.review.project,transactionId,...(compiled.rollback?{rollbackTransactionId:compiled.rollback.transactionId}:{}),upsertConsumers:[...consumers.values()],prerequisites:[...pins.values()].filter(pin=>used.has(pin.id)),releaseConsumerIds:compiled.releaseConsumers||[],targets:compiled.targets};
          const retained=registration?{...registration,consumers:registration.consumers.filter(consumer=>!released.has(dependencyConsumerKey(consumer))&&!newConsumers.some(next=>dependencyConsumerKey(next)===dependencyConsumerKey(consumer)))}:null;
          entry.toolRequirements=toolRequirements([...compiled.toolRequirements,...retainedToolRequirements(retained,projectState,globalState)]);
          planDependencyCoordination(entry.request);
        }
      }catch(error){if(error.name!=='DomainError')throw error;entry.issues.push({reason:error.code});}
      for(const plan of compiled.plans)if(plan.blocked.some(block=>IGNORED.has(block.reason)))plan.blocked=plan.blocked.filter(block=>!IGNORED.has(block.reason));
      return entry;
    },
    view(entry) {
      const status=entry.issues.length?'blocked':entry.request?.prerequisites.length&&!entry.observed?'requires-observation':'ready',blocked=[...entry.issues,...(status==='requires-observation'?[{reason:'DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'}]:[])];
      return {...entry.compiled.review,kind:entry.compiled.rollback?'rollback':entry.compiled.removal?'remove':'scoped-apply',automatic:status==='ready',blocked,fulfilled:false,nativePrerequisitesState:entry.request?.prerequisites.length?entry.observed?'observed':'unverified':'not-required',
        execution:{schemaVersion:1,status,scope:entry.input.scope,nativePrerequisiteCount:entry.request?.prerequisites.length||0,providerDiscoveryRequired:entry.request?.prerequisites.some(pin=>pin.assetKind==='mcpServers')||false},
        ...(entry.request?{dependencyTransition:{schemaVersion:1,action:entry.compiled.rollback?'rollback':entry.compiled.removal?'remove':'apply',
          ...(entry.compiled.rollback?{rolledBackTransactionId:entry.compiled.rollback.transactionId}:{}),
          releasedConsumers:entry.request.releaseConsumerIds.map(consumer=>Object.fromEntries(['assetId','assetKind','clientId','surface','configStore'].map(key=>[key,consumer[key]]))),desiredConsumers:entry.request.upsertConsumers.length,desiredPrerequisites:entry.request.prerequisites.length}}:{}),
        ...(entry.observation?{nativeObservation:structuredClone(entry.observation)}:{})};
    },
    async observe(entry,{observeProviders=false}={}) {
      if(typeof observeProviders!=='boolean')fail('INVALID_NATIVE_PREREQUISITE_REQUEST');
      if(entry.issues.length)fail('SCOPED_DEPLOYMENT_PLAN_BLOCKED');current(entry);
      if(!entry.request?.prerequisites.length)return;
      const result=await native.observe({globalStore:entry.compiled.globalStore,project:entry.request.project,prerequisites:entry.request.prerequisites,toolRequirements:entry.toolRequirements,observeProviders});
      current(entry);entry.observed=false;entry.observation={status:result.status,...(result.reason?{reason:result.reason}:{}),...(result.checks?{checks:result.checks}:{}),fulfilled:false};
      if(result.status==='observed') {
        entry.transition=native.prepareTransition({observationId:result.observationId,targets:entry.compiled.targets});entry.verifier=native.transitionVerifier(entry.transition);entry.observed=true;entry.observeProviders=observeProviders;
        entry.coordination=planDependencyCoordination({...entry.request,verifyPrerequisites:entry.verifier});
      }
    },
    assertCurrent:current,
    runtime,
    fingerprint:entry=>installationDigest({compiled:entry.compiled.review.digest,nativeReview:entry.transition?.reviewDigest}),
    async apply(entry,{backupStore,validate,createTransactionId,onPhase,assertReview=()=>{}}={}) {
      if(entry.issues.length)fail('SCOPED_DEPLOYMENT_PLAN_BLOCKED');
      if(entry.request?.prerequisites.length&&!entry.observed)fail('SCOPED_NATIVE_OBSERVATION_REQUIRED');assertReview();current(entry);runtime(entry);
      const check=()=>{assertReview();runtime(entry);},execute=entry.compiled.rollback?applyDeploymentRollbackAsync:applyDeploymentAsync,input={...(entry.compiled.rollback?{plan:entry.compiled.rollback}:{plans:entry.compiled.plans}),stateStore:entry.compiled.stateStore,backupStore,preflight:check,beforeCommit:check,createTransactionId,onPhase};
      if(!entry.request)return execute({...input,validate});
      if(entry.request.prerequisites.length&&!entry.verifier({project:entry.request.project,prerequisites:entry.request.prerequisites,stage:'before'}).verified)fail('STALE_DEPLOYMENT_PLAN');
      const request={...entry.request,transactionId:createTransactionId?.()||entry.transactionId,verifyPrerequisites:entry.verifier},plan=planDependencyCoordination(request);
      const result=await executeDependencyCoordinationAsync({...request,plan,onPhase,executeProject:context=>execute({...input,stateStore:context.projectStore,createTransactionId:()=>context.transactionId,validate:async details=>{
        const result=await (validate?.(details)||{valid:true,results:[]});if(!result.valid)return result;
        if(entry.request.prerequisites.length){const after=await native.observeTransition(entry.transition);if(after.status!=='observed')fail('DEPENDENCY_NATIVE_PREREQUISITES_CHANGED');}return result;
      }})});return {...result,...(entry.compiled.rollback?{rolledBackTransactionId:entry.compiled.rollback.transactionId}:{})};
    }
  };
}
