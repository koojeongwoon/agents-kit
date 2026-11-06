import {domainError} from './errors.js';
import {validateManifestAssetContracts,directReferences,toolRequirements,providedTools} from './manifest.js';
import {normalizeAssetReference} from './scoped-resource-reference.js';

const freeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
const scopeMatches=(context,scope)=>context.scope===scope.type&&(scope.type==='global'||context.projectName===scope.projectName);
const canReference=(source,target)=>source.type==='global'?target.type==='global':target.type==='global'||source.projectName===target.projectName;
const keyFor=(context,asset)=>JSON.stringify([context.id,asset.kind,asset.id]);

// A declaration graph only. It has no filesystem, deployment ledger, native
// process or ownership port and cannot establish installation prerequisites.
export function resolveScopedManifestDependencies({contexts,sourceContextId,selectedAssetIds=[]}) {
  if(!Array.isArray(contexts)||contexts.length>64||!Array.isArray(selectedAssetIds)||selectedAssetIds.length>10000
    ||selectedAssetIds.some(id=>typeof id!=='string'))throw domainError('INVALID_SCOPED_CATALOG','Scoped dependency catalog is malformed');
  const frames=new Map(),index=new Map();let assetCount=0;
  for(const context of contexts) {
    if(!context||typeof context.id!=='string'||!context.id||context.id.length>512||frames.has(context.id)
      ||typeof context.catalogId!=='string'||!context.catalogId||context.catalogId.length>512
      ||!['global','project'].includes(context.scope)||!['ready','missing','invalid','unreadable','recovery-required','unselected'].includes(context.status)
      ||(context.scope==='project'&&(typeof context.projectName!=='string'||!/^[A-Za-z0-9_-]+$/.test(context.projectName)))) {
      throw domainError('INVALID_SCOPED_CATALOG','Scoped context requires a unique authorized origin');
    }
    const assets=new Map();
    if(context.status==='ready') {
      if(!context.manifest?.kit?.id||!context.manifest.assets)throw domainError('INVALID_SCOPED_CATALOG','Ready context requires a Manifest');
      validateManifestAssetContracts(context.manifest);
      for(const asset of Object.values(context.manifest.assets).flat()) {
        if(++assetCount>10000||assets.has(asset.id))throw domainError('INVALID_SCOPED_CATALOG','Scoped catalog exceeds its unique asset limit');
        const node={context,asset,key:keyFor(context,asset)};assets.set(asset.id,node);index.set(node.key,node);
      }
    }
    frames.set(context.id,{...context,assets});
  }
  const source=frames.get(sourceContextId);if(!source)throw domainError('INVALID_SCOPED_CATALOG','Selected source context is absent');
  const issues=[],seenIssues=new Set(),closure=new Set(),edges=[],bindings=[],visiting=[],visited=new Set(),harnessDenied=new Map();
  const report=(code,node,details={})=>{
    const value={code,severity:'error',sourceKey:node?.key||null,sourceAssetId:node?.asset.id||'',...details},key=JSON.stringify(value);
    if(!seenIssues.has(key)){seenIssues.add(key);issues.push(value);}
  };
  const targetFor=(node,reference,expectedKind,relation,{quiet=false}={})=>{
    const fail=(code,details={})=>{if(!quiet)report(code,node,{relation,...details});return null;};
    const parsed=normalizeAssetReference(reference,expectedKind,{allowQualified:node.context.manifest.schemaVersion===3});
    let frame=frames.get(node.context.id),target;
    if(typeof parsed==='string')target=frame.assets.get(parsed);
    else {
      if(!canReference(node.asset.scope,parsed.scope))return fail('SCOPE_VIOLATION',{targetReference:parsed});
      const eligible=[...frames.values()].filter(context=>context.catalogId===node.context.catalogId&&scopeMatches(context,parsed.scope)
        &&(parsed.scope.type==='global'||context.id===node.context.id));
      if(eligible.some(context=>context.status!=='ready'))return fail('SCOPED_CONTEXT_UNAVAILABLE',{targetReference:parsed});
      const matching=eligible.filter(context=>context.manifest.kit.id===parsed.kitId);
      if(matching.length>1)return fail('SCOPED_REFERENCE_AMBIGUOUS',{targetReference:parsed,contextIds:matching.map(context=>context.id).sort()});
      frame=matching[0];target=frame?.assets.get(parsed.assetId);
    }
    if(!target)return fail('MISSING_REFERENCE',{targetId:typeof parsed==='string'?parsed:parsed.assetId,...(typeof parsed==='object'?{targetReference:parsed}:{})});
    if(target.asset.kind!==expectedKind)return fail('REFERENCE_KIND_MISMATCH',{targetKey:target.key,expectedKind,actualKind:target.asset.kind});
    if(!canReference(node.asset.scope,target.asset.scope))return fail('SCOPE_VIOLATION',{targetKey:target.key});
    if(!scopeMatches(frame,target.asset.scope))return fail('SCOPED_ASSET_ORIGIN_MISMATCH',{targetKey:target.key});
    return target;
  };
  const policyDenied=(node,capability)=>{
    if(node.asset.deny?.capabilities?.includes(capability)||node.asset.policy?.deny?.capabilities?.includes(capability))return node;
    for(const reference of node.asset.policies||[]) {
      const policy=targetFor(node,reference,'policies','policies',{quiet:true});
      if(policy?.asset.deny?.capabilities?.includes(capability))return policy;
    }
    return harnessDenied.get(capability);
  };
  function visit(node) {
    if(visiting.includes(node.key)){report('CYCLIC_DEPENDENCY',node,{path:[...visiting.slice(visiting.indexOf(node.key)),node.key]});return;}
    if(visited.has(node.key))return;
    if(visiting.length>=128){report('DEPENDENCY_DEPTH_LIMIT',node);return;}
    if(!scopeMatches(node.context,node.asset.scope)){report('SCOPED_ASSET_ORIGIN_MISMATCH',node);return;}
    visiting.push(node.key);closure.add(node.key);
    for(const reference of directReferences(node.asset)) {
      const target=targetFor(node,reference.qualified||reference.id,reference.expectedKind,reference.relation);
      if(target){edges.push({source:node.key,target:target.key,relation:reference.relation});visit(target);}
    }
    for(const requirement of toolRequirements(node.asset)) {
      let candidates;
      if(requirement.providerId) {
        const target=targetFor(node,requirement.providerId,'mcpServers','tool.providerId');
        if(!target)continue;
        candidates=providedTools(target.asset).includes(requirement.id)?[target]:[];
      }else candidates=[...frames.get(node.context.id).assets.values()].filter(target=>target.asset.kind==='mcpServers'
        &&canReference(node.asset.scope,target.asset.scope)&&scopeMatches(target.context,target.asset.scope)&&providedTools(target.asset).includes(requirement.id));
      if(candidates.length===0){if(!requirement.optional||requirement.providerId)report('MISSING_TOOL_PROVIDER',node,{toolId:requirement.id});continue;}
      if(candidates.length>1){report('AMBIGUOUS_TOOL_PROVIDER',node,{toolId:requirement.id,providerKeys:candidates.map(target=>target.key).sort()});continue;}
      const denied=requirement.capability?policyDenied(node,requirement.capability):null;
      if(denied){report('POLICY_DENIED',node,{toolId:requirement.id,capability:requirement.capability,policyKey:denied.key});continue;}
      const provider=candidates[0];edges.push({source:node.key,target:provider.key,relation:'tool.provider',toolId:requirement.id});visit(provider);
      bindings.push({consumerKey:node.key,providerKey:provider.key,providerContextId:provider.context.id,toolId:requirement.id,capability:requirement.capability});
    }
    visiting.pop();visited.add(node.key);
  }
  if(source.status!=='ready')report('SCOPED_CONTEXT_UNAVAILABLE',null,{contextId:source.id});
  else {
    for(const id of selectedAssetIds) {
      const node=source.assets.get(id);if(node?.asset.kind!=='harness')continue;
      for(const capability of node.asset.policy?.deny?.capabilities||[])harnessDenied.set(capability,node);
      for(const reference of node.asset.policies||[]) {
        const policy=targetFor(node,reference,'policies','policies',{quiet:true});
        for(const capability of policy?.asset.deny?.capabilities||[])harnessDenied.set(capability,policy);
      }
    }
    for(const id of selectedAssetIds) {
      const node=source.assets.get(id);if(node)visit(node);else report('MISSING_REFERENCE',null,{targetId:id,contextId:source.id});
    }
  }
  // Join policy denials along every dependency path, including paths to a node
  // visited earlier through a different root. DFS visit order cannot grant a
  // shared Skill permission that one of its consumers denies.
  const effectiveDenials=new Map(),outgoing=new Map(),queue=[...closure];
  for(const key of closure) {
    const node=index.get(key),denials=new Map(harnessDenied);
    for(const capability of [...(node.asset.deny?.capabilities||[]),...(node.asset.policy?.deny?.capabilities||[])])denials.set(capability,node);
    for(const reference of node.asset.policies||[]) {
      const policy=targetFor(node,reference,'policies','policies',{quiet:true});
      for(const capability of policy?.asset.deny?.capabilities||[])denials.set(capability,policy);
    }
    effectiveDenials.set(key,denials);outgoing.set(key,[]);
  }
  for(const edge of edges)if(outgoing.has(edge.source)&&effectiveDenials.has(edge.target))outgoing.get(edge.source).push(edge.target);
  let updates=0;
  for(let cursor=0;cursor<queue.length;cursor++) {
    const key=queue[cursor];
    for(const target of outgoing.get(key)||[]) {
      let changed=false;
      for(const [capability,policy] of effectiveDenials.get(key))if(!effectiveDenials.get(target).has(capability)) {
        effectiveDenials.get(target).set(capability,policy);changed=true;updates++;
      }
      if(changed)queue.push(target);
    }
    if(updates>200000){report('DEPENDENCY_POLICY_LIMIT',index.get(key));break;}
  }
  for(const binding of bindings) {
    const denied=effectiveDenials.get(binding.consumerKey)?.get(binding.capability);
    if(denied)report('POLICY_DENIED',index.get(binding.consumerKey),{toolId:binding.toolId,capability:binding.capability,policyKey:denied.key});
  }
  const nodes=[...closure].sort().map(key=>{const node=index.get(key);return {key,contextId:node.context.id,kitId:node.context.manifest.kit.id,
    scope:{type:node.asset.scope.type,...(node.asset.scope.type==='project'?{projectName:node.asset.scope.projectName}:{})},kind:node.asset.kind,assetId:node.asset.id};});
  return freeze({schemaVersion:1,readOnly:true,valid:issues.length===0,deploymentReady:false,installationState:'unverified',issues,nodes,
    edges:edges.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),toolBindings:bindings.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
    localAssetKeys:nodes.filter(node=>node.contextId===source.id).map(node=>node.key),
    globalPrerequisites:nodes.filter(node=>node.contextId!==source.id&&node.scope.type==='global').map(node=>({...node,installationState:'unverified'}))});
}
