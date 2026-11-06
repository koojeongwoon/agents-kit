import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from './errors.js';
import {validDeploymentLocator} from './deployment-locator.js';
import {normalizeAssetReference} from './scoped-resource-reference.js';
import {ASSET_KINDS} from './manifest.js';
import {validNativeInstallationLocator} from './native-installation-locator.js';
import {validScopedInstallationDeclaration,validScopedDependencySnapshot} from './scoped-installation-declaration.js';

const HASH=/^[a-f0-9]{64}$/;
const TOOL=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NATIVE_TOOL=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
export const INSTALLABLE_RECEIPT_KINDS=Object.freeze(['instructions','skills','agents','mcpServers']);
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,canonical(value[key])])):value;
export const installationDigest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const installationPhysicalKey=value=>JSON.stringify([value.locator.targetBase,value.kitId,value.assetKind,value.assetId,value.clientId,value.surface,value.scope,value.configStore]);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&!/[\\\u0000-\u001f\u007f]/.test(value);
const mode=value=>Number.isInteger(value)&&value>=0&&value<=0o777;
const stableIds=value=>Array.isArray(value)&&value.length<=256&&value.every(id=>typeof id==='string'&&TOOL.test(id))&&new Set(value).size===value.length;

function validDeclaration(value) {
  const versioned=value?.schemaVersion===2;
  if(!fields(value,['references','requirements','providedTools','deniedCapabilities','toolBindings',...(versioned?['schemaVersion','providedToolNames','dependencies']:[])])||!stableIds(value.providedTools)||!stableIds(value.deniedCapabilities)
    ||!['references','requirements','toolBindings'].every(key=>Array.isArray(value[key])&&value[key].length<=256))return false;
  if(versioned) {
    if(!Array.isArray(value.providedToolNames)||value.providedToolNames.length!==value.providedTools.length
      ||new Set(value.providedToolNames.map(item=>item?.id)).size!==value.providedToolNames.length
      ||new Set(value.providedToolNames.filter(item=>item?.nativeName!==undefined).map(item=>item.nativeName)).size!==value.providedToolNames.filter(item=>item?.nativeName!==undefined).length
      ||value.providedToolNames.some(item=>!fields(item,['id','nativeName'])||!value.providedTools.includes(item.id)||item.nativeName!==undefined&&(typeof item.nativeName!=='string'||!NATIVE_TOOL.test(item.nativeName)))
      ||!Array.isArray(value.dependencies)||value.dependencies.length>256||new Set(value.dependencies.map(item=>item?.assetId)).size!==value.dependencies.length)return false;
    for(const dependency of value.dependencies) {
      if(!fields(dependency,['assetId','assetKind','declarationDigest'])||!ASSET_KINDS.includes(dependency.assetKind)||!HASH.test(dependency.declarationDigest))return false;
      try{normalizeAssetReference(dependency.assetId,dependency.assetKind);}catch{return false;}
    }
  }
  try {
    for(const reference of value.references) {
      if(!fields(reference,['id','relation','expectedKind','qualified'])||!ASSET_KINDS.includes(reference.expectedKind)||typeof reference.relation!=='string'||!/^[A-Za-z.]{1,128}$/.test(reference.relation))return false;
      normalizeAssetReference(reference.qualified||reference.id,reference.expectedKind,{allowQualified:true});
    }
    for(const requirement of value.requirements) {
      if(!fields(requirement,['id','capability','optional','providerId'])||typeof requirement.id!=='string'||!TOOL.test(requirement.id)||typeof requirement.optional!=='boolean'
        ||typeof requirement.capability!=='string'||requirement.capability!==''&&!TOOL.test(requirement.capability))return false;
      if(requirement.providerId)normalizeAssetReference(requirement.providerId,'mcpServers',{allowQualified:true});
      else if(requirement.providerId!=='')return false;
    }
    for(const binding of value.toolBindings)if(!fields(binding,['consumerId','toolId','providerId','capability'])||typeof binding.toolId!=='string'||!TOOL.test(binding.toolId)||typeof binding.capability!=='string'
      ||binding.capability!==''&&!TOOL.test(binding.capability))return false;else{normalizeAssetReference(binding.consumerId);normalizeAssetReference(binding.providerId,'mcpServers');}
  }catch{return false;}
  return true;
}
function validDependencySnapshot(value,declaration,assetId) {
  if(!fields(value,['schemaVersion','dependencies'])||value.schemaVersion!==1||!Array.isArray(value.dependencies)||value.dependencies.length>256)return false;
  const expected=declaration.dependencies.filter(item=>INSTALLABLE_RECEIPT_KINDS.includes(item.assetKind));
  if(value.dependencies.length!==expected.length||new Set(value.dependencies.map(item=>item?.assetId)).size!==value.dependencies.length)return false;
  return value.dependencies.every(item=>{
    if(!fields(item,['assetId','assetKind','declarationDigest','status','revisionDigest','locatorDigest','reason'])||item.assetId===assetId
      ||!expected.some(dependency=>dependency.assetId===item.assetId&&dependency.assetKind===item.assetKind&&dependency.declarationDigest===item.declarationDigest))return false;
    if(item.status==='pinned')return HASH.test(item.revisionDigest)&&HASH.test(item.locatorDigest)&&item.reason===undefined;
    return item.status==='unverified'&&typeof item.reason==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(item.reason)&&item.revisionDigest===undefined&&item.locatorDigest===undefined;
  });
}
function validVersionedDeclaration(declaration,assetId) {
  const dependency=(id,kind)=>declaration.dependencies.some(item=>item.assetId===id&&item.assetKind===kind);
  // Receipts v3 describe a single applied Manifest. Qualified Manifest v3
  // remains gated until cross-scope ownership and locking are implemented.
  if(declaration.dependencies.some(item=>item.assetId===assetId)||declaration.references.some(reference=>reference.qualified||!dependency(reference.id,reference.expectedKind))
    ||declaration.requirements.some(requirement=>typeof requirement.providerId!=='string'))return false;
  if(declaration.toolBindings.some(binding=>binding.consumerId!==assetId||!dependency(binding.providerId,'mcpServers')
    ||!declaration.requirements.some(requirement=>requirement.id===binding.toolId&&requirement.capability===binding.capability&&(!requirement.providerId||requirement.providerId===binding.providerId))))return false;
  return declaration.requirements.every(requirement=>requirement.optional||declaration.toolBindings.some(binding=>binding.toolId===requirement.id&&binding.capability===requirement.capability));
}
function revisionBody(value) {
  const {revisionDigest,proofs,...body}=value;
  return {...body,proofs:proofs.map(({managedTransactionId,...proof})=>proof)};
}
export function validInstallationReceipt(value) {
  const scoped=value?.schemaVersion===4,versioned=value?.schemaVersion===3||scoped,native=value?.schemaVersion===2||versioned&&value?.locator?.type==='native-installation';
  if(!fields(value,['schemaVersion','sourceRoot','kitId','assetId','assetKind','clientId','surface','scope','configStore','locator','declaration','proofs','directories','revisionDigest',...(versioned?['dependencySnapshot']:[])])
    ||![1,2,3,4].includes(value.schemaVersion)||!absolute(value.sourceRoot)
    ||!(native?validNativeInstallationLocator(value.locator):validDeploymentLocator(value.locator))
    ||['kitId','assetId','assetKind','clientId','surface','scope','configStore'].some(key=>value[key]!==value.locator[key])
    ||!(scoped?validScopedInstallationDeclaration(value.declaration,value):validDeclaration(value.declaration))||!Array.isArray(value.proofs)||!value.proofs.length||value.proofs.length>256
    ||new Set(value.proofs.map(proof=>proof?.target)).size!==value.proofs.length||!Array.isArray(value.directories)||value.directories.length>512)return false;
  if(scoped?!validScopedDependencySnapshot(value.dependencySnapshot,value.declaration):versioned?(value.declaration.schemaVersion!==2||!validVersionedDeclaration(value.declaration,value.assetId)||!validDependencySnapshot(value.dependencySnapshot,value.declaration,value.assetId)):value.declaration.schemaVersion!==undefined)return false;
  for(const proof of value.proofs) {
    if(!fields(proof,['target','managedTransactionId','mode','contentHash','units','linkSource',...(native?['nativeOwnerDigest']:[])])||!absolute(proof.target)
      ||typeof proof.managedTransactionId!=='string'||!/^tx-[A-Za-z0-9-]{1,180}$/.test(proof.managedTransactionId)||!HASH.test(proof.contentHash))return false;
    const relative=path.relative(value.locator.targetBase,proof.target);
    if(value.assetKind==='skills'&&(value.locator.strategy==='copy'||native)?!relative||relative.startsWith(`..${path.sep}`)||relative==='..'||path.isAbsolute(relative):proof.target!==value.locator.targetBase)return false;
    if(native&&(!HASH.test(proof.nativeOwnerDigest)||proof.units!==undefined||proof.linkSource!==undefined))return false;
    if(proof.linkSource!==undefined){if(value.locator.strategy!=='snapshot-link'||!absolute(proof.linkSource)||proof.mode!==null||proof.units!==undefined)return false;}
    else if(!mode(proof.mode))return false;
    if(proof.units!==undefined&&(!fields(proof.units,Object.keys(proof.units||{}))||!Object.keys(proof.units).length||Object.entries(proof.units).some(([key,hash])=>!key||key.length>1024||!HASH.test(hash))||proof.contentHash!==installationDigest(proof.units)))return false;
  }
  if(value.directories.some(item=>!fields(item,['path','mode'])||typeof item.path!=='string'||item.path!==''&&(!/^[^\\\u0000-\u001f\u007f]+$/.test(item.path)||item.path.split('/').some(part=>!part||['.','..'].includes(part)))||!mode(item.mode)))return false;
  return HASH.test(value.revisionDigest)&&value.revisionDigest===installationDigest(revisionBody(value));
}
export function createInstallationReceipt(descriptor,{proofs,directories=[],dependencySnapshot}) {
  const scoped=descriptor.declaration?.schemaVersion===3,versioned=descriptor.declaration?.schemaVersion===2||scoped;
  const receipt={schemaVersion:scoped?4:versioned?3:descriptor.locator?.type==='native-installation'?2:1,...structuredClone(descriptor),proofs:structuredClone(proofs),directories:structuredClone(directories)};
  if(versioned)receipt.dependencySnapshot=structuredClone(dependencySnapshot||descriptor.dependencySnapshot||{schemaVersion:scoped?2:1,dependencies:descriptor.declaration.dependencies.filter(item=>INSTALLABLE_RECEIPT_KINDS.includes(scoped?item.target.assetKind:item.assetKind)).map(item=>({...item,status:'unverified',reason:'INSTALLED_DEPENDENCY_RECEIPT_UNAVAILABLE'}))});
  receipt.revisionDigest=installationDigest(revisionBody(receipt));
  if(!validInstallationReceipt(receipt))throw domainError('INVALID_INSTALLATION_RECEIPT','Installation receipt requires bounded verified ownership metadata');
  return receipt;
}
