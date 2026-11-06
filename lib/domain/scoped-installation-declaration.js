import path from 'node:path';
import {domainError} from './errors.js';
import {ASSET_KINDS,directReferences,toolRequirements,providedTools} from './manifest.js';
import {resolveScopedManifestDependencies} from './scoped-manifest-dependencies.js';
import {installationDigest,INSTALLABLE_RECEIPT_KINDS} from './installation-receipt.js';
import {validateNativeToolNames} from './agent-tool-bindings.js';

const ID=/^[a-z0-9][a-z0-9-]{0,63}$/,TOOL=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,NATIVE=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/,HASH=/^[a-f0-9]{64}$/;
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&value!==path.parse(value).root&&value.length<=4096&&!/[\\\u0000-\u001f\u007f]/.test(value);
const unique=items=>[...new Map(items.map(item=>[installationDigest(item),item])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,item])=>item);
const same=(a,b)=>installationDigest(a)===installationDigest(b);
const fail=()=>{throw domainError('INVALID_SCOPED_INSTALLATION_DECLARATION','Scoped installation metadata requires stable bounded origins and a complete validated graph');};
export const scopedTargetKey=target=>JSON.stringify([target.originId,target.assetKind,target.assetId]);
export function createInstallationOrigin({kitId,sourceRoot,targetRoot,scope}) {
  if(typeof kitId!=='string'||!ID.test(kitId)||!absolute(sourceRoot)||!absolute(targetRoot)||!fields(scope,['type','projectName'])||!['global','project'].includes(scope.type)
    ||(scope.type==='global'?scope.projectName!==undefined:typeof scope.projectName!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(scope.projectName)))fail();
  const origin={kitId,sourceRoot,targetRoot,scope:structuredClone(scope)};return {id:`origin-${installationDigest(origin)}`,...origin};
}
export const scopedDeclarationDigest=({origins,dependencies,...header})=>installationDigest(header);
function normalizedHeader(header) {
  return {...header,references:unique(header.references),requirements:unique(header.requirements),toolBindings:unique(header.toolBindings),providedTools:[...new Set(header.providedTools)].sort(),
    providedToolNames:unique(header.providedToolNames),deniedCapabilities:[...new Set(header.deniedCapabilities)].sort()};
}
export function matchesInstallationOrigin(receipt,origin) {
  if(receipt.sourceRoot!==origin.sourceRoot||receipt.kitId!==origin.kitId||receipt.scope!==origin.scope.type)return false;
  if(receipt.schemaVersion===4)return receipt.declaration.subject.originId===origin.id;
  if(receipt.schemaVersion!==3||receipt.declaration.schemaVersion!==2)return false;
  if(origin.scope.type==='project'&&(path.basename(origin.sourceRoot)!==origin.scope.projectName||path.basename(path.dirname(origin.sourceRoot))!=='projects'))return false;
  const relative=receipt.locator.pathTemplate.replace(/^~\//,'').replaceAll('{assetId}',receipt.locator.nativeId||receipt.assetId);
  return path.resolve(origin.targetRoot,relative)===receipt.locator.targetBase;
}
// Compatibility is a projection, never a rewrite of historical receipts. The
// expected origin supplies context absent from old same-Manifest declarations.
export function declarationAtOrigin(receipt,origin) {
  if(!matchesInstallationOrigin(receipt,origin))return null;
  if(receipt.schemaVersion===4)return receipt.declaration;
  const target=(assetId,assetKind)=>({originId:origin.id,assetId,assetKind}),declaration=receipt.declaration;
  return normalizedHeader({schemaVersion:3,subject:target(receipt.assetId,receipt.assetKind),origins:[origin],
    references:declaration.references.map(reference=>({relation:reference.relation,target:target(reference.id,reference.expectedKind)})),
    requirements:declaration.requirements.map(requirement=>({id:requirement.id,capability:requirement.capability,optional:requirement.optional,provider:requirement.providerId?target(requirement.providerId,'mcpServers'):null})),
    providedTools:declaration.providedTools,providedToolNames:declaration.providedToolNames,deniedCapabilities:declaration.deniedCapabilities,
    toolBindings:declaration.toolBindings.map(binding=>({toolId:binding.toolId,capability:binding.capability,provider:target(binding.providerId,'mcpServers')})),
    dependencies:declaration.dependencies.map(dependency=>({target:target(dependency.assetId,dependency.assetKind),declarationDigest:dependency.declarationDigest,legacy:true}))});
}

export function buildScopedInstallationDeclarations({contexts,scopes,sourceContextId,assetIds}) {
  if(!Array.isArray(scopes)||scopes.length!==contexts?.length||!Array.isArray(assetIds)||assetIds.length>256)fail();
  const graph=resolveScopedManifestDependencies({contexts,sourceContextId,selectedAssetIds:assetIds});if(!graph.valid||graph.nodes.length>512)fail();
  const origins=new Map(contexts.flatMap((context,index)=>context.status!=='ready'||!scopes[index].targetRoot?[]:[[context.id,createInstallationOrigin({kitId:context.manifest.kit.id,
    sourceRoot:scopes[index].scopeRoot,targetRoot:scopes[index].targetRoot,scope:{type:context.scope,...(context.scope==='project'?{projectName:context.projectName}:{})}})]]));
  const nodes=new Map(graph.nodes.map(node=>[node.key,{...node,asset:contexts.find(context=>context.id===node.contextId).manifest.assets[node.kind].find(asset=>asset.id===node.assetId)}]));
  const identity=node=>({originId:origins.get(node.contextId).id,assetId:node.assetId,assetKind:node.kind});
  function referenceNode(node,reference,kind) {
    const matches=[...nodes.values()].filter(target=>target.kind===kind&&target.assetId===(typeof reference==='string'?reference:reference.assetId)
      &&(typeof reference==='string'?target.contextId===node.contextId:target.kitId===reference.kitId&&target.scope.type===reference.scope.type
        &&(reference.scope.type==='global'||target.contextId===node.contextId&&target.scope.projectName===reference.scope.projectName)));
    if(matches.length!==1)fail();return matches[0];
  }
  const outgoing=new Map(graph.nodes.map(node=>[node.key,[]]));for(const edge of graph.edges)outgoing.get(edge.source).push(edge.target);
  const headers=new Map([...nodes].map(([key,node])=>{
    const asset=node.asset;validateNativeToolNames(asset);
    const policies=(asset.policies||[]).map(reference=>referenceNode(node,reference,'policies').asset);
    return [key,normalizedHeader({schemaVersion:3,subject:identity(node),
      references:directReferences(asset).map(reference=>({relation:reference.relation,target:identity(referenceNode(node,reference.qualified||reference.id,reference.expectedKind))})),
      requirements:toolRequirements(asset).map(requirement=>({id:requirement.id,capability:requirement.capability,optional:requirement.optional,
        provider:requirement.providerId?identity(referenceNode(node,requirement.providerId,'mcpServers')):null})),
      providedTools:providedTools(asset),providedToolNames:(asset.provides?.tools||[]).map(tool=>typeof tool==='string'?{id:tool}:{id:tool.id,...(tool.nativeName?{nativeName:tool.nativeName}:{})}),
      deniedCapabilities:[...(asset.deny?.capabilities||[]),...(asset.policy?.deny?.capabilities||[]),...policies.flatMap(policy=>policy.deny?.capabilities||[])],
      toolBindings:graph.toolBindings.filter(binding=>binding.consumerKey===key).map(binding=>({toolId:binding.toolId,capability:binding.capability,provider:identity(nodes.get(binding.providerKey))}))})];
  }));
  const result=new Map();
  for(const assetId of assetIds) {
    const node=[...nodes.values()].find(node=>node.contextId===sourceContextId&&node.assetId===assetId);if(!node)fail();
    const reachable=new Set(),queue=[...(outgoing.get(node.key)||[])];for(let index=0;index<queue.length;index++){if(reachable.has(queue[index]))continue;reachable.add(queue[index]);queue.push(...outgoing.get(queue[index]));}
    const dependencies=unique([...reachable].map(key=>({target:identity(nodes.get(key)),declarationDigest:scopedDeclarationDigest(headers.get(key))})));
    const used=new Set([headers.get(node.key).subject.originId,...dependencies.map(dependency=>dependency.target.originId)]);
    const declaration={...headers.get(node.key),origins:[...origins.values()].filter(origin=>used.has(origin.id)).sort((a,b)=>a.id.localeCompare(b.id)),dependencies};
    if(!validScopedInstallationDeclaration(declaration))fail();result.set(assetId,declaration);
  }
  return result;
}

function validScopedDeclaration(value,descriptor) {
  if(!fields(value,['schemaVersion','subject','origins','references','requirements','providedTools','providedToolNames','deniedCapabilities','toolBindings','dependencies'])||value.schemaVersion!==3
    ||!Array.isArray(value.origins)||!value.origins.length||value.origins.length>2)return false;
  const origins=new Map();
  for(const origin of value.origins)try {
    if(!fields(origin,['id','kitId','sourceRoot','targetRoot','scope'])||!same(origin,createInstallationOrigin(origin))||origins.has(origin.id))return false;origins.set(origin.id,origin);
  }catch{return false;}
  const validTarget=target=>fields(target,['originId','assetId','assetKind'])&&origins.has(target.originId)&&typeof target.assetId==='string'&&ID.test(target.assetId)&&ASSET_KINDS.includes(target.assetKind);
  if(!validTarget(value.subject))return false;const own=origins.get(value.subject.originId);
  const allowed=target=>validTarget(target)&&(target.originId===own.id||own.scope.type==='project'&&origins.get(target.originId).scope.type==='global');
  if([...origins.values()].filter(origin=>origin.scope.type==='global').length>1||[...origins.values()].some(origin=>origin.scope.type==='project'&&origin.id!==own.id))return false;
  if(descriptor&&(['kitId','sourceRoot'].some(key=>descriptor[key]!==own[key])||descriptor.scope!==own.scope.type||descriptor.assetId!==value.subject.assetId||descriptor.assetKind!==value.subject.assetKind
    ||path.resolve(own.targetRoot,descriptor.locator.pathTemplate.replace(/^~\//,'').replaceAll('{assetId}',descriptor.locator.nativeId||descriptor.assetId))!==descriptor.locator.targetBase))return false;
  for(const key of ['references','requirements','toolBindings'])if(!Array.isArray(value[key])||value[key].length>256||unique(value[key]).length!==value[key].length)return false;
  for(const key of ['providedTools','deniedCapabilities'])if(!Array.isArray(value[key])||value[key].length>256||new Set(value[key]).size!==value[key].length||value[key].some(id=>typeof id!=='string'||!TOOL.test(id)))return false;
  if(!Array.isArray(value.providedToolNames)||value.providedToolNames.length!==value.providedTools.length||new Set(value.providedToolNames.map(tool=>tool?.id)).size!==value.providedToolNames.length
    ||value.providedToolNames.some(tool=>!fields(tool,['id','nativeName'])||!value.providedTools.includes(tool.id)||tool.nativeName!==undefined&&(typeof tool.nativeName!=='string'||!NATIVE.test(tool.nativeName)))
    ||new Set(value.providedToolNames.filter(tool=>tool.nativeName!==undefined).map(tool=>tool.nativeName)).size!==value.providedToolNames.filter(tool=>tool.nativeName!==undefined).length)return false;
  if(!Array.isArray(value.dependencies)||value.dependencies.length>511||new Set(value.dependencies.map(dependency=>scopedTargetKey(dependency?.target||{}))).size!==value.dependencies.length)return false;
  for(const dependency of value.dependencies)if(!fields(dependency,['target','declarationDigest'])||!allowed(dependency.target)||same(dependency.target,value.subject)||typeof dependency.declarationDigest!=='string'||!HASH.test(dependency.declarationDigest))return false;
  const dependency=target=>value.dependencies.some(item=>same(item.target,target));
  for(const reference of value.references)if(!fields(reference,['relation','target'])||typeof reference.relation!=='string'||!/^[A-Za-z.]{1,128}$/.test(reference.relation)||!allowed(reference.target)||!dependency(reference.target))return false;
  for(const requirement of value.requirements)if(!fields(requirement,['id','capability','optional','provider'])||typeof requirement.id!=='string'||!TOOL.test(requirement.id)||typeof requirement.capability!=='string'||requirement.capability!==''&&!TOOL.test(requirement.capability)
    ||typeof requirement.optional!=='boolean'||requirement.provider!==null&&(!allowed(requirement.provider)||requirement.provider.assetKind!=='mcpServers'||!dependency(requirement.provider)))return false;
  for(const binding of value.toolBindings)if(!fields(binding,['toolId','capability','provider'])||typeof binding.toolId!=='string'||!TOOL.test(binding.toolId)||typeof binding.capability!=='string'||binding.capability!==''&&!TOOL.test(binding.capability)||value.deniedCapabilities.includes(binding.capability)
    ||!allowed(binding.provider)||binding.provider.assetKind!=='mcpServers'||!dependency(binding.provider)||!value.requirements.some(requirement=>requirement.id===binding.toolId&&requirement.capability===binding.capability&&(!requirement.provider||same(requirement.provider,binding.provider))))return false;
  if(value.requirements.some(requirement=>!requirement.optional&&!value.toolBindings.some(binding=>binding.toolId===requirement.id&&binding.capability===requirement.capability&&(!requirement.provider||same(requirement.provider,binding.provider)))))return false;
  const used=new Set([value.subject.originId,...value.dependencies.map(dependency=>dependency.target.originId)]);return used.size===origins.size;
}
export function validScopedInstallationDeclaration(value,descriptor) {try{return validScopedDeclaration(value,descriptor);}catch{return false;}}
export function validScopedDependencySnapshot(value,declaration) {
  const expected=declaration.dependencies.filter(item=>INSTALLABLE_RECEIPT_KINDS.includes(item.target.assetKind));
  if(!fields(value,['schemaVersion','dependencies'])||value.schemaVersion!==2||!Array.isArray(value.dependencies)||value.dependencies.length!==expected.length
    ||new Set(value.dependencies.map(item=>scopedTargetKey(item?.target||{}))).size!==value.dependencies.length)return false;
  return value.dependencies.every(item=>fields(item,['target','declarationDigest','status','revisionDigest','locatorDigest','bindingDigest','reason'])
    &&expected.some(dependency=>same(dependency.target,item.target)&&dependency.declarationDigest===item.declarationDigest)
    &&(item.status==='pinned'?['revisionDigest','locatorDigest','bindingDigest'].every(key=>HASH.test(item[key]||''))&&item.reason===undefined
      :item.status==='unverified'&&typeof item.reason==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(item.reason)&&['revisionDigest','locatorDigest','bindingDigest'].every(key=>item[key]===undefined)));
}
