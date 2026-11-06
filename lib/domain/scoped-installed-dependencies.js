import {domainError} from './errors.js';
import {installationDigest,validInstallationReceipt,INSTALLABLE_RECEIPT_KINDS} from './installation-receipt.js';
import {installedBindingDigest} from './dependency-reverse-index.js';
import {declarationAtOrigin,matchesInstallationOrigin,scopedDeclarationDigest,scopedTargetKey,validScopedInstallationDeclaration} from './scoped-installation-declaration.js';
import {inspectInstalledDependencyRevisions} from './installed-dependency-revisions.js';

const same=(a,b)=>installationDigest(a)===installationDigest(b);
const profileMatches=(a,b)=>['clientId','surface','configStore'].every(key=>a[key]===b[key])&&a.locator.definitionDigest===b.locator.definitionDigest;
const issue=(code,target)=>({code,...(target?{assetId:target.assetId,assetKind:target.assetKind,originId:target.originId}:{})});
function validateContext(installations) {
  if(!Array.isArray(installations)||installations.length>4096||installations.some(item=>!validInstallationReceipt(item?.receipt)||!['ownership-observed','drift','unverified'].includes(item.ownershipState)))throw domainError('INVALID_INSTALLED_DEPENDENCY_CONTEXT','Scoped dependencies require verified bounded installation observations');
}
function candidatesFor(value,target,origin,installations) {
  return installations.filter(({receipt})=>receipt.assetId===target.assetId&&receipt.assetKind===target.assetKind&&profileMatches(value,receipt)&&matchesInstallationOrigin(receipt,origin));
}
function inspectChild(receipt,origin,installations) {
  const result=receipt.schemaVersion===4?inspectScopedInstalledDependencies({receipt,installations}):inspectInstalledDependencyRevisions({receipt,installations});
  return {...result,dependencyBindings:result.dependencyBindings.map(binding=>({...binding,consumerOriginId:binding.consumerOriginId||origin.id,providerOriginId:binding.providerOriginId||origin.id}))};
}

export function captureScopedDependencySnapshot({descriptor,installations}) {
  validateContext(installations);if(!validScopedInstallationDeclaration(descriptor.declaration,descriptor))throw domainError('INVALID_SCOPED_INSTALLATION_DECLARATION','Scoped snapshot requires a validated declaration');
  const declaration=descriptor.declaration;
  return {schemaVersion:2,dependencies:declaration.dependencies.filter(item=>INSTALLABLE_RECEIPT_KINDS.includes(item.target.assetKind)).map(dependency=>{
    const origin=declaration.origins.find(origin=>origin.id===dependency.target.originId),candidates=candidatesFor(descriptor,dependency.target,origin,installations),positive=candidates.filter(item=>item.ownershipState==='ownership-observed');
    let reason='SCOPED_INSTALLED_RECEIPT_UNAVAILABLE';
    if(positive.length>1)reason='SCOPED_INSTALLED_ORIGIN_AMBIGUOUS';
    else if(positive.length===1) {
      const {receipt}=positive[0],header=declarationAtOrigin(receipt,origin);
      if(!header||scopedDeclarationDigest(header)!==dependency.declarationDigest)reason='SCOPED_INSTALLED_DECLARATION_MISMATCH';
      else if(inspectChild(receipt,origin,installations).dependencyState!=='revision-observed')reason='SCOPED_INSTALLED_DEPENDENCY_UNVERIFIED';
      else return {...structuredClone(dependency),status:'pinned',revisionDigest:receipt.revisionDigest,locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)};
    }else if(candidates.length)reason='SCOPED_INSTALLED_OWNERSHIP_UNVERIFIED';
    return {...structuredClone(dependency),status:'unverified',reason};
  })};
}

export function inspectScopedInstalledDependencies({receipt,installations}) {
  validateContext(installations);if(!validInstallationReceipt(receipt)||receipt.schemaVersion!==4)throw domainError('INVALID_INSTALLATION_RECEIPT','Scoped inspection requires receipt v4');
  const memo=new Map(),visiting=new Set();
  function inspect(value,origin,depth=0) {
    const key=`${origin.id}:${value.revisionDigest}`;
    if(memo.has(key))return memo.get(key);
    if(depth>=128||visiting.has(key))return {dependencyState:'unverified',bindingDeclarationsState:'unverified',dependencyIssues:[issue('SCOPED_INSTALLED_CYCLE_OR_DEPTH_LIMIT')],dependencyBindings:[]};
    if(value.schemaVersion!==4)return inspectChild(value,origin,installations);
    visiting.add(key);let state='revision-observed',mapping='not-required';const issues=[],bindings=[],providers=new Map(),declaration=value.declaration;
    const report=(code,target,drift=false)=>{issues.push(issue(code,target));if(drift)state='drift';else if(state!=='drift')state='unverified';};
    for(const dependency of value.dependencySnapshot.dependencies) {
      if(dependency.status!=='pinned'){report(dependency.reason,dependency.target);continue;}
      const targetOrigin=declaration.origins.find(origin=>origin.id===dependency.target.originId),candidates=candidatesFor(value,dependency.target,targetOrigin,installations).filter(item=>installationDigest(item.receipt.locator)===dependency.locatorDigest);
      if(candidates.length!==1){report(candidates.length?'SCOPED_INSTALLED_ORIGIN_AMBIGUOUS':'SCOPED_INSTALLED_RECEIPT_UNAVAILABLE',dependency.target);continue;}
      const current=candidates[0];
      if(current.receipt.revisionDigest!==dependency.revisionDigest||installedBindingDigest(current.receipt)!==dependency.bindingDigest){report('SCOPED_INSTALLED_REVISION_CHANGED',dependency.target,true);continue;}
      if(current.ownershipState!=='ownership-observed'){report(current.ownershipState==='drift'?'SCOPED_INSTALLED_CONTENT_DRIFT':'SCOPED_INSTALLED_OWNERSHIP_UNVERIFIED',dependency.target,current.ownershipState==='drift');continue;}
      const header=declarationAtOrigin(current.receipt,targetOrigin);
      if(!header||scopedDeclarationDigest(header)!==dependency.declarationDigest){report('SCOPED_INSTALLED_DECLARATION_MISMATCH',dependency.target);continue;}
      for(const transitive of header.dependencies) {
        const declared=declaration.dependencies.find(item=>same(item.target,transitive.target));
        if(!declared||!transitive.legacy&&declared.declarationDigest!==transitive.declarationDigest)report('SCOPED_INSTALLED_CLOSURE_INCOMPLETE',transitive.target);
      }
      const child=inspect(current.receipt,targetOrigin,depth+1);bindings.push(...child.dependencyBindings);
      if(child.dependencyState!=='revision-observed'){report('SCOPED_INSTALLED_DEPENDENCY_UNVERIFIED',dependency.target,child.dependencyState==='drift');issues.push(...child.dependencyIssues);}
      if(child.bindingDeclarationsState==='unverified')mapping='unverified';else if(child.bindingDeclarationsState==='recorded'&&mapping!=='unverified')mapping='recorded';
      providers.set(scopedTargetKey(dependency.target),current.receipt);
    }
    for(const binding of declaration.toolBindings) {
      const provider=providers.get(scopedTargetKey(binding.provider)),names=provider?.declaration.providedToolNames?.filter(tool=>tool.id===binding.toolId)||[];
      if(state!=='revision-observed'||names.length!==1||!names[0].nativeName){mapping='unverified';issues.push({...issue('INSTALLED_NATIVE_TOOL_MAPPING_UNAVAILABLE',declaration.subject),toolId:binding.toolId,providerId:binding.provider.assetId,providerOriginId:binding.provider.originId});continue;}
      if(mapping!=='unverified')mapping='recorded';bindings.push({consumerId:declaration.subject.assetId,consumerOriginId:declaration.subject.originId,toolId:binding.toolId,capability:binding.capability,
        providerId:binding.provider.assetId,providerOriginId:binding.provider.originId,nativeName:names[0].nativeName,nativeId:provider.locator.nativeId||provider.assetId,providerRevisionDigest:provider.revisionDigest});
    }
    visiting.delete(key);const result={dependencyState:state,bindingDeclarationsState:mapping,dependencyIssues:[...new Map(issues.map(item=>[installationDigest(item),item])).values()],dependencyBindings:[...new Map(bindings.map(item=>[installationDigest(item),item])).values()]};memo.set(key,result);return result;
  }
  return {...inspect(receipt,receipt.declaration.origins.find(origin=>origin.id===receipt.declaration.subject.originId)),discoveryState:'unverified',toolUseState:'unverified',fulfilled:false};
}
