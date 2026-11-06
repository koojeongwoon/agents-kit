import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {validDependencyPrerequisite,dependencyRegistrationId,installedBindingDigest} from '../domain/dependency-reverse-index.js';
import {selectClientSurface} from '../domain/client-definition.js';
import {loadClientDefinitions} from '../infrastructure/client-definition-loader.js';
import {loadNativePrerequisiteDefinition} from '../infrastructure/native-prerequisite-definition-loader.js';
import {observeClientBinary} from '../infrastructure/client-binary-observer.js';
import {observeNativeInventory} from '../infrastructure/native-inventory-observer.js';
import {captureNativePrerequisiteContext} from '../infrastructure/native-prerequisite-context.js';
import {coordinationSnapshot} from '../infrastructure/dependency-coordination-io.js';
import {canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';
import {prepareCodexNativePrerequisites,finishCodexNativePrerequisites,assertCodexPrerequisiteLayers} from '../adapters/native-prerequisite-inventory.js';
import {createNativePrerequisiteTransitions} from './native-prerequisite-transition.js';

const same=(a,b)=>installationDigest(a)===installationDigest(b);
const fail=code=>{throw domainError(code,'Native prerequisite observation could not prove the selected installed context');};
const denied=()=>({verified:false,digest:null});
const pinDigest=pins=>installationDigest([...pins].sort((a,b)=>a.id.localeCompare(b.id)));
function installedPairs(globalStore,pins) {
  const {state}=coordinationSnapshot(globalStore,globalStore.homeDir),receipts=latestInstallationReceipts(state);
  return pins.map(pin=>{
    const matching=receipts.filter(receipt=>receipt.scope==='global'&&['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].every(key=>receipt[key]===pin[key])
      &&installationDigest(receipt.locator)===pin.locatorDigest);
    if(matching.length!==1||![3,4].includes(matching[0].schemaVersion)||installedBindingDigest(matching[0])!==pin.bindingDigest)fail('DEPENDENCY_INSTALLATION_PREREQUISITE_CHANGED');
    const receipt=matching[0],observed=observeInstallationReceipt({receipt,state,homeDir:globalStore.homeDir});
    if(observed.status!=='ownership-observed'||observed.dependencyState!=='revision-observed'||observed.bindingDeclarationsState==='unverified')fail('DEPENDENCY_INSTALLATION_PREREQUISITE_CHANGED');
    return {pin:structuredClone(pin),receipt};
  });
}

// Async native reads produce private, expiring evidence. The synchronous port
// only rechecks sealed evidence under the coordinator's two filesystem locks.
// Public JSON cannot manufacture a positive prerequisite verifier.
export function createNativePrerequisiteService({homeDir,definitionsDir,binaryObserver=observeClientBinary,nativeInventoryObserver=observeNativeInventory,clock=Date.now,observationTtlMs=60000}) {
  const observations=new Map();
  if(!Number.isSafeInteger(observationTtlMs)||observationTtlMs<1||observationTtlMs>300000)fail('INVALID_NATIVE_PREREQUISITE_TTL');
  function environment(input,pairs) {
    const selected=pairs[0].receipt,definitions=loadClientDefinitions({definitionsDir}),definition=definitions.get(selected.clientId);
    if(!definition)fail('CLIENT_DEFINITION_NOT_FOUND');
    const profile=selectClientSurface(definition,selected.surface),auxiliary=loadNativePrerequisiteDefinition({definitionsDir,clientId:selected.clientId,surface:selected.surface,configStore:selected.configStore});
    if(pairs.some(({receipt})=>receipt.clientId!==selected.clientId||receipt.surface!==selected.surface||receipt.configStore!==selected.configStore||receipt.locator.definitionDigest!==canonicalDigest(definition))
      ||profile.configStore!==selected.configStore||!profile.nativeInventory)fail('NATIVE_PREREQUISITE_PROFILE_UNVERIFIED');
    const inventory=profile.nativeInventory,globalFile=path.join(homeDir,inventory.environment.CODEX_HOME.slice(2),'config.toml');
    if(!inventory.contextFiles.some(record=>record.scope==='global'&&path.join(homeDir,record.path.slice(2))===globalFile))fail('NATIVE_PREREQUISITE_CONTEXT_UNVERIFIED');
    if(fs.realpathSync(input.project.targetRoot)!==input.project.targetRoot)fail('NATIVE_PREREQUISITE_CONTEXT_UNVERIFIED');
    const binary=binaryObserver(profile),evidence=auxiliary.evidence.find(record=>record.binarySha256===binary?.sha256&&record.platform===process.platform&&record.arch===process.arch);
    if(!evidence||!path.isAbsolute(binary?.binaryPath||''))fail('CLIENT_BINARY_UNVERIFIED');
    return {profile,auxiliary,binary,evidence,definitionDigest:installationDigest({definition,auxiliary}),
      context:captureNativePrerequisiteContext({homeDir,cwd:input.project.targetRoot,inventory,systemFiles:auxiliary.systemFiles})};
  }
  const validateRequest=input=>{
    dependencyRegistrationId(input?.project);
    if(!input.globalStore||input.globalStore.homeDir!==homeDir||!Array.isArray(input.prerequisites)||!input.prerequisites.length||input.prerequisites.length>256
      ||input.prerequisites.some(pin=>!validDependencyPrerequisite(pin))||new Set(input.prerequisites.map(pin=>pin.id)).size!==input.prerequisites.length
      ||input.observeProviders!==undefined&&typeof input.observeProviders!=='boolean'||input.toolRequirements!==undefined&&!Array.isArray(input.toolRequirements))fail('INVALID_NATIVE_PREREQUISITE_REQUEST');
  };
  function assertUnchanged(input,before) {
    const pairs=installedPairs(input.globalStore,input.prerequisites),current=environment(input,pairs);
    if(!same(current.binary,before.binary)||current.definitionDigest!==before.definitionDigest||current.context.digest!==before.context.digest)fail('NATIVE_PREREQUISITE_CONTEXT_CHANGED');
  }
  const service={
    async observe(input) {
      validateRequest(input);const request={...input,project:structuredClone(input.project),prerequisites:structuredClone(input.prerequisites),toolRequirements:structuredClone(input.toolRequirements||[])};
      const base={schemaVersion:1,readOnly:true,modelTurnsRequested:false,toolCallsRequested:false,fulfilled:false};
      try {
        const pairs=installedPairs(request.globalStore,request.prerequisites),before=environment(request,pairs),includeSkills=pairs.some(({receipt})=>receipt.assetKind==='skills');
        const serverNames=request.observeProviders?[...new Set(pairs.filter(({receipt})=>receipt.assetKind==='mcpServers').map(({receipt})=>receipt.locator.nativeId||receipt.assetId))]:[];
        let approved;
        const prepare=response=>{assertCodexPrerequisiteLayers(response.configuration,before.context);return prepareCodexNativePrerequisites({pairs,toolRequirements:request.toolRequirements,...response,cwd:request.project.targetRoot});};
        const response=await nativeInventoryObserver({binaryPath:before.binary.binaryPath,adapter:before.auxiliary.adapter,profile:before.profile,homeDir,cwd:request.project.targetRoot,includeSkills,serverNames,
          authorizeDiscovery:metadata=>{approved=prepare(metadata);assertUnchanged(request,before);return approved.discoveryAllowed;}});
        const prepared=prepare(response);if(approved&&!same(prepared,approved))fail('NATIVE_PREREQUISITE_CONTEXT_CHANGED');
        assertUnchanged(request,before);const checks=finishCodexNativePrerequisites(prepared,response.mcpServers||[]);
        const result={...base,clientId:pairs[0].receipt.clientId,surface:pairs[0].receipt.surface,configStore:pairs[0].receipt.configStore,cwd:request.project.targetRoot,
          binarySha256:before.binary.sha256,version:before.evidence.version,checkedAt:new Date(clock()).toISOString(),checks,
          status:checks.every(check=>check.status==='observed')?'observed':'unverified',activeThreadState:'unverified',consumerActivationState:'unverified'};
        if(result.status!=='observed')return result;
        const createdAt=clock(),observationId=crypto.randomUUID(),digest=installationDigest({project:request.project,pins:pinDigest(request.prerequisites),checks,
          contextDigest:before.context.digest,definitionDigest:before.definitionDigest,binary:before.binary,createdAt});
        for(const [id,record] of observations)if(createdAt-record.createdAt>observationTtlMs)observations.delete(id);
        if(observations.size>=128)observations.delete(observations.keys().next().value);
        observations.set(observationId,{request,before,createdAt,digest});return {...result,observationId,expiresAt:new Date(createdAt+observationTtlMs).toISOString()};
      }catch(error){return {...base,status:'unverified',reason:/^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code||'')?error.code:'NATIVE_PREREQUISITE_OBSERVATION_FAILED'};}
    },
    verifier({observationId}={}) {
      return ({project,prerequisites}={})=>{
        const record=observations.get(observationId);if(!record||clock()<record.createdAt||clock()-record.createdAt>observationTtlMs)return denied();
        try {
          if(!same(project,record.request.project)||!Array.isArray(prerequisites)||pinDigest(prerequisites)!==pinDigest(record.request.prerequisites))return denied();
          assertUnchanged(record.request,record.before);return {verified:true,digest:record.digest};
        }catch{return denied();}
      };
    }
  };
  return Object.freeze({...service,...createNativePrerequisiteTransitions({lookupObservation:id=>observations.get(id),observe:input=>service.observe(input),
    environment:input=>environment(input,installedPairs(input.globalStore,input.prerequisites)),assertUnchanged,clock,observationTtlMs})});
}
