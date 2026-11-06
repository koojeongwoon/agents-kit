import {domainError} from './errors.js';
import {installationDigest,validInstallationReceipt,INSTALLABLE_RECEIPT_KINDS} from './installation-receipt.js';
import {installationDeclarationDigest} from './installation-declaration.js';
import {inspectScopedInstalledDependencies} from './scoped-installed-dependencies.js';

const sameContext=(a,b)=>['sourceRoot','kitId','scope','clientId','surface','configStore'].every(key=>a[key]===b[key])
  &&a.locator.definitionDigest===b.locator.definitionDigest;
const related=(source,dependency,installations)=>installations.filter(({receipt})=>sameContext(source,receipt)
  &&receipt.assetId===dependency.assetId&&receipt.assetKind===dependency.assetKind);
const issue=(code,dependency)=>({code,...(dependency?{assetId:dependency.assetId,assetKind:dependency.assetKind}:{})});
function validateContext(installations) {
  if(!Array.isArray(installations)||installations.length>4096||installations.some(item=>!validInstallationReceipt(item?.receipt)
    ||!['ownership-observed','drift','unverified'].includes(item.ownershipState)))throw domainError('INVALID_INSTALLED_DEPENDENCY_CONTEXT','Installed dependencies require bounded receipt and ownership observations');
}

// Pin only the installed declaration reviewed by this apply, never a source
// revision or a provider selected later. Ownership observations are input ports;
// the domain neither reads files nor starts native clients.
export function captureInstalledDependencySnapshot({descriptor,installations}) {
  validateContext(installations);
  return {schemaVersion:1,dependencies:descriptor.declaration.dependencies.filter(item=>INSTALLABLE_RECEIPT_KINDS.includes(item.assetKind)).map(dependency=>{
    const candidates=related(descriptor,dependency,installations),positive=candidates.filter(item=>item.ownershipState==='ownership-observed');
    let reason='INSTALLED_DEPENDENCY_RECEIPT_UNAVAILABLE';
    if(positive.length>1)reason='INSTALLED_DEPENDENCY_ORIGIN_AMBIGUOUS';
    else if(positive.length===1) {
      const {receipt}=positive[0];
      if(receipt.declaration.schemaVersion!==2)reason='INSTALLED_DEPENDENCY_DECLARATION_UNVERIFIED';
      else if(installationDeclarationDigest(receipt.declaration)!==dependency.declarationDigest)reason='INSTALLED_DEPENDENCY_DECLARATION_MISMATCH';
      else return {...dependency,status:'pinned',revisionDigest:receipt.revisionDigest,locatorDigest:installationDigest(receipt.locator)};
    }else if(candidates.length)reason='INSTALLED_DEPENDENCY_OWNERSHIP_UNVERIFIED';
    return {...dependency,status:'unverified',reason};
  })};
}

// Revision consistency and declared native names are independent of actual
// native loading, available tools and model/tool execution. No result here can
// fulfill a deployment prerequisite by itself.
export function inspectInstalledDependencyRevisions({receipt,installations}) {
  validateContext(installations);
  if(!validInstallationReceipt(receipt))throw domainError('INVALID_INSTALLATION_RECEIPT','Dependency inspection requires a valid installed receipt');
  if(receipt.schemaVersion===4)return inspectScopedInstalledDependencies({receipt,installations});
  const memo=new Map(),visiting=new Set();
  function inspect(value,depth=0) {
    if(memo.has(value.revisionDigest))return memo.get(value.revisionDigest);
    if(depth>=128||visiting.has(value.revisionDigest))return {state:'unverified',issues:[issue('INSTALLED_DEPENDENCY_CYCLE_OR_DEPTH_LIMIT')],bindings:[],mappingState:'unverified'};
    if(value.schemaVersion!==3)return {state:'unverified',issues:[issue('INSTALLED_DEPENDENCY_SNAPSHOT_UNAVAILABLE')],bindings:[],mappingState:'unverified'};
    visiting.add(value.revisionDigest);
    const issues=[],bindings=[],providers=new Map();let state='revision-observed',mappingState='not-required';
    const report=(code,dependency,drift=false)=>{issues.push(issue(code,dependency));if(drift)state='drift';else if(state!=='drift')state='unverified';};
    for(const dependency of value.dependencySnapshot.dependencies) {
      if(dependency.status!=='pinned'){report(dependency.reason,dependency);continue;}
      const candidates=related(value,dependency,installations).filter(item=>installationDigest(item.receipt.locator)===dependency.locatorDigest);
      if(candidates.length!==1){report(candidates.length?'INSTALLED_DEPENDENCY_ORIGIN_AMBIGUOUS':'INSTALLED_DEPENDENCY_RECEIPT_UNAVAILABLE',dependency);continue;}
      const current=candidates[0];
      if(current.receipt.revisionDigest!==dependency.revisionDigest){report('INSTALLED_DEPENDENCY_REVISION_CHANGED',dependency,true);continue;}
      if(current.ownershipState!=='ownership-observed'){report(current.ownershipState==='drift'?'INSTALLED_DEPENDENCY_CONTENT_DRIFT':'INSTALLED_DEPENDENCY_OWNERSHIP_UNVERIFIED',dependency,current.ownershipState==='drift');continue;}
      if(current.receipt.declaration.schemaVersion!==2||installationDeclarationDigest(current.receipt.declaration)!==dependency.declarationDigest){report('INSTALLED_DEPENDENCY_DECLARATION_MISMATCH',dependency);continue;}
      const child=inspect(current.receipt,depth+1);bindings.push(...child.bindings);
      if(child.state!=='revision-observed'){report('INSTALLED_DEPENDENCY_SNAPSHOT_UNVERIFIED',dependency,child.state==='drift');issues.push(...child.issues);}
      if(child.mappingState==='unverified')mappingState='unverified';
      else if(child.mappingState==='recorded'&&mappingState!=='unverified')mappingState='recorded';
      issues.push(...child.issues.filter(item=>item.code==='INSTALLED_NATIVE_TOOL_MAPPING_UNAVAILABLE'));
      providers.set(current.receipt.assetId,current.receipt);
    }
    for(const binding of value.declaration.toolBindings) {
      const provider=providers.get(binding.providerId),declarations=provider?.declaration.providedToolNames?.filter(item=>item.id===binding.toolId)||[];
      if(state!=='revision-observed'||declarations.length!==1||!declarations[0].nativeName) {
        mappingState='unverified';issues.push({code:'INSTALLED_NATIVE_TOOL_MAPPING_UNAVAILABLE',assetId:binding.consumerId,assetKind:value.assetKind,toolId:binding.toolId,providerId:binding.providerId});continue;
      }
      if(mappingState!=='unverified')mappingState='recorded';
      bindings.push({...binding,nativeName:declarations[0].nativeName,nativeId:provider.locator.nativeId||provider.assetId,providerRevisionDigest:provider.revisionDigest});
    }
    visiting.delete(value.revisionDigest);
    const result={state,issues:[...new Map(issues.map(item=>[JSON.stringify(item),item])).values()],bindings:[...new Map(bindings.map(item=>[JSON.stringify(item),item])).values()],mappingState};
    memo.set(value.revisionDigest,result);return result;
  }
  const result=inspect(receipt);
  return {dependencyState:result.state,bindingDeclarationsState:result.mappingState,dependencyIssues:result.issues,dependencyBindings:result.bindings};
}
