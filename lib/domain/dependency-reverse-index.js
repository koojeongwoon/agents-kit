import path from 'node:path';
import {domainError} from './errors.js';
import {installationDigest,validInstallationReceipt,INSTALLABLE_RECEIPT_KINDS} from './installation-receipt.js';

const ID=/^[a-z0-9][a-z0-9-]{0,63}$/,CLIENT=/^[a-z][a-z0-9._-]{0,63}$/,HASH=/^[a-f0-9]{64}$/;
const text=(value,pattern)=>typeof value==='string'&&pattern.test(value);
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const generation=value=>Number.isSafeInteger(value)&&value>=1;
const absolute=value=>typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)&&value!==path.parse(value).root&&path.normalize(value)===value&&!/[\\\u0000-\u001f\u007f]/.test(value);
const referenceKeys=['assetId','assetKind','clientId','surface','configStore','revisionDigest','locatorDigest'];
const prerequisiteKeys=['id','kitId','sourceRoot',...referenceKeys,'bindingDigest'];
const referenceKey=value=>JSON.stringify([value?.assetKind,value?.assetId,value?.clientId,value?.surface,value?.configStore]);
const prerequisiteKey=value=>JSON.stringify([value?.kitId,value?.sourceRoot,referenceKey(value)]);
const unique=(values,key)=>new Set(values.map(key)).size===values.length;
function validProject(project) {
  return fields(project,['kitId','projectName','sourceRoot','targetRoot'])&&text(project.kitId,ID)&&text(project.projectName,/^[A-Za-z0-9_-]{1,128}$/)
    &&absolute(project.sourceRoot)&&absolute(project.targetRoot);
}
function validReference(value) {
  return text(value?.assetId,ID)&&INSTALLABLE_RECEIPT_KINDS.includes(value.assetKind)&&['clientId','surface','configStore'].every(key=>text(value[key],CLIENT))
    &&['revisionDigest','locatorDigest'].every(key=>text(value[key],HASH));
}
export function validDependencyPrerequisite(value) {
  return fields(value,prerequisiteKeys)&&text(value.kitId,ID)&&absolute(value.sourceRoot)&&validReference(value)&&text(value.bindingDigest,HASH)
    &&value.id===dependencyPrerequisiteId(value);
}
const validPrerequisite=validDependencyPrerequisite;
export function dependencyPrerequisiteId(value) {
  if(!text(value?.kitId,ID)||!absolute(value?.sourceRoot)||!text(value?.assetId,ID)||!INSTALLABLE_RECEIPT_KINDS.includes(value?.assetKind)
    ||!['clientId','surface','configStore'].every(key=>text(value[key],CLIENT)))throw domainError('INVALID_DEPENDENCY_PREREQUISITE','Prerequisite identity requires its registered origin and client profile');
  return `prereq-${installationDigest(prerequisiteKey(value))}`;
}
export function dependencyRegistrationId(project) {
  if(!validProject(project))throw domainError('INVALID_DEPENDENCY_PROJECT','Dependency registration requires a physical project origin');
  return `dep-${installationDigest(project)}`;
}
export function validDependencyRegistration(value) {
  const common=fields(value,['schemaVersion','id','project','generation','indexGeneration','transactionId','status','consumers','prerequisites'])&&value.schemaVersion===1
    &&validProject(value.project)&&value.id===dependencyRegistrationId(value.project)&&generation(value.generation)&&generation(value.indexGeneration)
    &&text(value.transactionId,/^tx-[A-Za-z0-9-]{1,180}$/)&&['reserved','active','releasing','released'].includes(value.status);
  if(!common)return false;
  if(value.status==='released')return Array.isArray(value.consumers)&&value.consumers.length===0&&Array.isArray(value.prerequisites)&&value.prerequisites.length===0;
  return Array.isArray(value.consumers)&&value.consumers.length>0&&value.consumers.length<=256&&unique(value.consumers,referenceKey)
    &&value.consumers.every(item=>fields(item,[...referenceKeys,'prerequisiteIds'])&&validReference(item)&&Array.isArray(item.prerequisiteIds)&&item.prerequisiteIds.length>0
      &&item.prerequisiteIds.length<=256&&unique(item.prerequisiteIds,id=>id)&&item.prerequisiteIds.every(id=>text(id,/^prereq-[a-f0-9]{64}$/)))
    &&Array.isArray(value.prerequisites)&&value.prerequisites.length>0&&value.prerequisites.length<=256&&unique(value.prerequisites,prerequisiteKey)
    &&value.prerequisites.every(validPrerequisite)
    &&value.consumers.every(consumer=>consumer.prerequisiteIds.every(id=>value.prerequisites.some(pin=>pin.id===id&&['clientId','surface','configStore'].every(key=>pin[key]===consumer[key]))))
    &&value.prerequisites.every(pin=>value.consumers.some(consumer=>consumer.prerequisiteIds.includes(pin.id)));
}
export function validDependencyIndex(value) {
  return fields(value,['schemaVersion','generation','projects'])&&value.schemaVersion===1&&Number.isSafeInteger(value.generation)&&value.generation>=0
    &&Array.isArray(value.projects)&&value.projects.length<=256&&unique(value.projects,item=>item?.id)
    &&value.projects.every(item=>validDependencyRegistration(item)&&item.status!=='released'&&item.indexGeneration<=value.generation);
}
export function validDependencyStateMetadata(state) {
  const index=state.dependencyIndex!==undefined,registration=state.dependencyRegistration!==undefined;
  if(state.schemaVersion<8)return !index&&!registration;
  return state.schemaVersion===8&&index!==registration&&(index?validDependencyIndex(state.dependencyIndex):validDependencyRegistration(state.dependencyRegistration));
}
export function installedBindingDigest(receipt) {
  if(!validInstallationReceipt(receipt)||![3,4].includes(receipt.schemaVersion))throw domainError('INSTALLED_BINDING_SNAPSHOT_UNAVAILABLE','Binding digest requires a recorded installation declaration');
  return installationDigest({requirements:receipt.declaration.requirements,providedTools:receipt.declaration.providedToolNames,toolBindings:receipt.declaration.toolBindings});
}

// This is an impact preview, not a write authorization. The coordinator must
// retain the global lock and compare both ledgers before executing any change.
export function evaluateGlobalDependencyChanges({index,observations,changes}) {
  if(!validDependencyIndex(index)||!Array.isArray(changes)||changes.length>256||changes.some(change=>{
    const {nextRevisionDigest,nextLocatorDigest,nextBindingDigest,...reference}=change||{};
    return !validPrerequisite(reference)||![nextRevisionDigest,nextLocatorDigest,nextBindingDigest].every(value=>value===null)
      &&![nextRevisionDigest,nextLocatorDigest,nextBindingDigest].every(value=>text(value,HASH));
  }))throw domainError('INVALID_DEPENDENCY_IMPACT','Dependency impact requires a validated index and explicit installation changes');
  const blocked=[],affected=new Map(),consistent=observations?.status==='observed'&&observations.indexDigest===installationDigest(index);
  for(const registration of index.projects)for(const prerequisite of registration.prerequisites)for(const change of changes) {
    if(prerequisiteKey(prerequisite)!==prerequisiteKey(change))continue;
    const changed=change.nextRevisionDigest!==prerequisite.revisionDigest||change.nextLocatorDigest!==prerequisite.locatorDigest||change.nextBindingDigest!==prerequisite.bindingDigest;
    if(!changed&&['revisionDigest','locatorDigest','bindingDigest'].every(key=>change[key]===prerequisite[key]))continue;
    const observed=Array.isArray(observations?.projects)?observations.projects.find(item=>item.registrationId===registration.id):undefined;
    const code=!consistent||observed?.verification!=='consistent'||registration.status!=='active'?'DEPENDENT_PROJECT_REVIEW_REQUIRED':'GLOBAL_REVISION_IN_USE';
    blocked.push({code,registrationId:registration.id,projectName:registration.project.projectName,assetId:prerequisite.assetId,assetKind:prerequisite.assetKind});
    const previous=affected.get(registration.id),consumers=[...(previous?.consumers||[]),...registration.consumers.filter(consumer=>consumer.prerequisiteIds.includes(prerequisite.id))];
    affected.set(registration.id,{registrationId:registration.id,project:structuredClone(registration.project),consumers:[...new Map(consumers.map(consumer=>[referenceKey(consumer),structuredClone(consumer)])).values()]});
  }
  return {schemaVersion:1,readOnly:true,allowed:blocked.length===0,blocked:[...new Map(blocked.map(item=>[JSON.stringify(item),item])).values()],affectedProjects:[...affected.values()],
    requiredSequence:blocked.length?['remove-project-consumers','change-global-installation','redeploy-project-consumers']:[]};
}

// Until the two-scope coordinator is enabled, existing single-ledger writers
// cannot mutate registered state. Empty global indexes retain compatibility.
export function assertUncoordinatedDependencyWrite(state,nextState=state) {
  const active=state.schemaVersion===8&&(state.dependencyRegistration&&state.dependencyRegistration.status!=='released'||state.dependencyIndex?.projects.length);
  const changed=state.schemaVersion<8?nextState.schemaVersion>=8:nextState.schemaVersion!==8
    ||installationDigest({index:state.dependencyIndex,registration:state.dependencyRegistration})!==installationDigest({index:nextState.dependencyIndex,registration:nextState.dependencyRegistration});
  if(active||changed||!validDependencyStateMetadata(nextState))throw domainError('DEPENDENCY_COORDINATOR_REQUIRED','Registered dependencies require a reviewed two-scope coordinator; ordinary writers cannot change or erase them');
}
