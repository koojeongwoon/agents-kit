import {domainError} from './errors.js';
import {installationDigest} from './installation-receipt.js';
import {dependencyRegistrationId,validDependencyIndex,validDependencyRegistration} from './dependency-reverse-index.js';

export const dependencyConsumerKey=value=>JSON.stringify([value?.assetKind,value?.assetId,value?.clientId,value?.surface,value?.configStore]);
const fail=code=>{throw domainError(code,'Dependency registration change requires a complete reviewed origin and consumer relation');};
const same=(a,b)=>installationDigest(a)===installationDigest(b);

// A registration generation is one logical project transition. Reservation and
// finalization advance the shared index separately; unrelated consumers and
// projects retain their exact registered revisions.
export function planDependencyRegistrationChange({index,projectRegistration,project,upsertConsumers=[],prerequisites=[],releaseConsumerIds=[],transactionId}) {
  if(!validDependencyIndex(index)||![upsertConsumers,prerequisites,releaseConsumerIds].every(value=>Array.isArray(value)&&value.length<=256)
    ||typeof transactionId!=='string'||!/^tx-[A-Za-z0-9-]{1,180}$/.test(transactionId))fail('INVALID_DEPENDENCY_CHANGE');
  const id=dependencyRegistrationId(project),current=index.projects.find(item=>item.id===id);
  if(projectRegistration&&(!validDependencyRegistration(projectRegistration)||projectRegistration.id!==id||!same(projectRegistration.project,project)))fail('DEPENDENCY_REGISTRATION_CONTEXT_MISMATCH');
  if(current?!projectRegistration||!same(current,projectRegistration):projectRegistration&&projectRegistration.status!=='released')fail('DEPENDENCY_REGISTRATION_CONTEXT_MISMATCH');
  if(index.projects.some(item=>item.id!==id&&item.project.targetRoot===project.targetRoot&&item.project.sourceRoot===project.sourceRoot))fail('DEPENDENCY_PROJECT_ORIGIN_CONFLICT');
  if(current&&current.status!=='active')fail('DEPENDENCY_REGISTRATION_PENDING');
  const oldConsumers=current?.consumers||[],oldPins=current?.prerequisites||[],consumers=new Map(oldConsumers.map(item=>[dependencyConsumerKey(item),structuredClone(item)])),released=[];
  for(const reference of releaseConsumerIds) {
    const matches=oldConsumers.filter(item=>typeof reference==='string'?item.assetId===reference:dependencyConsumerKey(item)===dependencyConsumerKey(reference));
    if(!matches.length)fail('DEPENDENCY_CONSUMER_NOT_REGISTERED');if(matches.length!==1)fail('DEPENDENCY_CONSUMER_AMBIGUOUS');
    const key=dependencyConsumerKey(matches[0]);if(released.some(item=>dependencyConsumerKey(item)===key))fail('INVALID_DEPENDENCY_CHANGE');
    released.push(matches[0]);consumers.delete(key);
  }
  if(!upsertConsumers.length&&!released.length)fail('EMPTY_DEPENDENCY_CHANGE');
  const seen=new Set();for(const consumer of upsertConsumers) {
    const key=dependencyConsumerKey(consumer);if(seen.has(key)||released.some(item=>dependencyConsumerKey(item)===key))fail('INVALID_DEPENDENCY_CHANGE');
    seen.add(key);consumers.set(key,structuredClone(consumer));
  }
  const pinMap=new Map(oldPins.map(pin=>[pin.id,pin])),seenPins=new Set();
  for(const pin of prerequisites) {
    if(seenPins.has(pin?.id))fail('INVALID_DEPENDENCY_CHANGE');seenPins.add(pin?.id);
    if(pinMap.has(pin.id)&&!same(pinMap.get(pin.id),pin)||index.projects.some(registration=>registration.prerequisites.some(old=>old.id===pin.id&&!same(old,pin))))fail('DEPENDENCY_REVISION_REPLACEMENT_REQUIRES_RELEASE');
    pinMap.set(pin.id,structuredClone(pin));
  }
  const desired=[...consumers.values()].sort((a,b)=>dependencyConsumerKey(a).localeCompare(dependencyConsumerKey(b))),required=new Set(desired.flatMap(item=>item.prerequisiteIds||[]));
  if(prerequisites.some(pin=>!required.has(pin.id)))fail('INVALID_DEPENDENCY_CHANGE');
  const generation=(projectRegistration?.generation||0)+1,indexGeneration=index.generation+1;
  if(!Number.isSafeInteger(generation)||!Number.isSafeInteger(indexGeneration+1))fail('DEPENDENCY_GENERATION_EXHAUSTED');
  const base={schemaVersion:1,id,project:structuredClone(project),generation,transactionId};
  const afterRegistration={...base,indexGeneration:indexGeneration+1,status:desired.length?'active':'released',consumers:desired,prerequisites:[...pinMap.values()].filter(pin=>required.has(pin.id)).sort((a,b)=>a.id.localeCompare(b.id))};
  if(!validDependencyRegistration(afterRegistration))fail('INVALID_DEPENDENCY_CHANGE');
  const pendingConsumers=new Map(oldConsumers.map(item=>[dependencyConsumerKey(item),structuredClone(item)]));
  for(const consumer of desired) {
    const old=pendingConsumers.get(dependencyConsumerKey(consumer));
    pendingConsumers.set(dependencyConsumerKey(consumer),{...consumer,prerequisiteIds:[...new Set([...(old?.prerequisiteIds||[]),...consumer.prerequisiteIds])].sort()});
  }
  const pendingIds=new Set([...pendingConsumers.values()].flatMap(item=>item.prerequisiteIds));
  const reservation={...base,indexGeneration,status:upsertConsumers.length?'reserved':'releasing',consumers:[...pendingConsumers.values()],prerequisites:[...pinMap.values()].filter(pin=>pendingIds.has(pin.id))};
  const replace=registration=>[...index.projects.filter(item=>item.id!==id),...(registration.status==='released'?[]:[registration])].sort((a,b)=>a.id.localeCompare(b.id));
  const reservedIndex={schemaVersion:1,generation:indexGeneration,projects:replace(reservation)},afterIndex={schemaVersion:1,generation:indexGeneration+1,projects:replace(afterRegistration)};
  if(!validDependencyIndex(reservedIndex)||!validDependencyIndex(afterIndex))fail('INVALID_DEPENDENCY_CHANGE');
  return structuredClone({schemaVersion:1,project,reservation,afterRegistration,reservedIndex,afterIndex,releasedConsumers:released});
}
