import {domainError} from './errors.js';
import {installationDigest} from './installation-receipt.js';
import {dependencyPrerequisiteId,installedBindingDigest} from './dependency-reverse-index.js';
import {matchesInstallationOrigin,scopedTargetKey} from './scoped-installation-declaration.js';

const fail=()=>{throw domainError('DEPENDENCY_ROLLBACK_CLOSURE_UNVERIFIED','Restored dependency relations require the exact installed receipt closure');};
export function globalInstallationDependencies(receipt) {
  if(receipt.schemaVersion!==4)return [];
  return receipt.dependencySnapshot.dependencies.filter(dependency=>receipt.declaration.origins.find(origin=>origin.id===dependency.target.originId)?.scope.type==='global');
}

// This computes review data from frozen installation declarations, never from
// today's editable sources. The coordinator still verifies actual ownership.
export function resolveScopedInstalledRelations({project,installations,globalReceipts}) {
  const consumers=[],pins=new Map(),tools=new Map();
  for(const {receipt,observation,ownershipAnchored} of installations) {
    if(receipt.scope!=='project'||receipt.kitId!==project.kitId||receipt.sourceRoot!==project.sourceRoot)continue;
    if(observation.status!=='ownership-observed'){if(ownershipAnchored&&globalInstallationDependencies(receipt).length)fail();continue;}
    const dependencies=globalInstallationDependencies(receipt);if(!dependencies.length)continue;
    if(receipt.schemaVersion!==4||observation.dependencyState!=='revision-observed'||observation.bindingDeclarationsState==='unverified')fail();
    const ids=[],providers=new Map();
    for(const dependency of dependencies) {
      if(dependency.status!=='pinned')fail();
      const origin=receipt.declaration.origins.find(origin=>origin.id===dependency.target.originId),candidates=globalReceipts.filter(value=>matchesInstallationOrigin(value,origin)
        &&value.assetId===dependency.target.assetId&&value.assetKind===dependency.target.assetKind&&['clientId','surface','configStore'].every(key=>value[key]===receipt[key])
        &&value.revisionDigest===dependency.revisionDigest&&installationDigest(value.locator)===dependency.locatorDigest&&installedBindingDigest(value)===dependency.bindingDigest);
      if(candidates.length!==1)fail();const provider=candidates[0],pin={...Object.fromEntries(['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,provider[key]])),locatorDigest:dependency.locatorDigest,bindingDigest:dependency.bindingDigest};
      pin.id=dependencyPrerequisiteId(pin);if(pins.has(pin.id)&&installationDigest(pins.get(pin.id))!==installationDigest(pin))fail();pins.set(pin.id,pin);ids.push(pin.id);providers.set(scopedTargetKey(dependency.target),pin);
    }
    for(const binding of receipt.declaration.toolBindings) {
      if(receipt.declaration.origins.find(origin=>origin.id===binding.provider.originId)?.scope.type!=='global')continue;
      const pin=providers.get(scopedTargetKey(binding.provider));if(!pin||pin.assetKind!=='mcpServers')fail();
      const tool={providerId:pin.id,toolId:binding.toolId};tools.set(installationDigest(tool),tool);
    }
    consumers.push({...Object.fromEntries(['assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),locatorDigest:installationDigest(receipt.locator),prerequisiteIds:[...new Set(ids)].sort()});
  }
  return {consumers,prerequisites:[...pins.values()].sort((a,b)=>a.id.localeCompare(b.id)),toolRequirements:[...tools.values()]};
}
