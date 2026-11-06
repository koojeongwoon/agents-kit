import fs from 'node:fs';
import {domainError} from '../domain/errors.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {resolveScopedManifestDependencies} from '../domain/scoped-manifest-dependencies.js';
import {loadScopedSourceContexts,scopedManifestLocation} from './resource-catalog-service.js';
import {resolveAssetSources} from '../infrastructure/manifest-loader.js';
import {sourceHash,withKitSourceLock} from '../infrastructure/kit-source-transaction.js';

const allIds=context=>Object.values(context.manifest?.assets||{}).flat().map(asset=>asset.id);
const graphFor=(catalog,context)=>resolveScopedManifestDependencies({contexts:catalog.contexts,sourceContextId:context.id,selectedAssetIds:allIds(context)});
function issuesFor(graph,catalog,selected) {
  return graph.issues.map(issue=>{
    const context=catalog.contexts.find(context=>context.id===graph.nodes.find(node=>node.key===issue.sourceKey)?.contextId)||selected;
    return {...issue,scope:context.scope,projectName:context.projectName||'',message:`Manifest dependency validation: ${issue.code}`};
  });
}

export function inspectScopedManifest({scopeRoot,homeDir,includeProjects=false,selectedManifest,validateSources=true}) {
  const catalog=loadScopedSourceContexts({scopeRoot,homeDir,includeProjects,selectedManifest}),selected=catalog.contexts.find(context=>context.id===catalog.sourceContextId);
  if(!selected)throw domainError('SCOPED_CONTEXT_UNAVAILABLE','Selected Kit source is unavailable');
  const graph=graphFor(catalog,selected),issues=issuesFor(graph,catalog,selected);
  if(validateSources&&graph.valid)for(const context of catalog.contexts) {
    const ids=graph.nodes.filter(node=>node.contextId===context.id).map(node=>node.assetId);if(!ids.length)continue;
    try{resolveAssetSources(context.manifest,catalog.scopes[catalog.contexts.indexOf(context)].scopeRoot,ids,{boundedAssetIds:ids});}
    catch(error){issues.push({code:error.code||'INVALID_SOURCE_PATH',severity:'error',scope:context.scope,projectName:context.projectName||'',sourceAssetId:error.details?.assetId||'',message:'A referenced Kit source is missing, unsafe or invalid'});}
  }
  return {catalog,graph,issues,selected};
}

export function validateScopedManifest(input) {
  const {graph,issues}=inspectScopedManifest(input);
  return {schemaVersion:1,readOnly:true,valid:!issues.length,issues,dependencyGraph:graph,deploymentReady:false,fulfilled:false};
}

function companionSnapshot(catalog) {
  return catalog.scopes.filter(scope=>scope.scopeRoot!==catalog.scopeRoot).map(scope=>{
    let manifest;
    if(scope.status==='ready') {
      const stat=fs.lstatSync(scope.manifestPath);if(!stat.isFile()||stat.nlink!==1)throw domainError('SOURCE_MANAGEMENT_TARGET_CONFLICT','Companion Manifest must be an ordinary file');
      manifest={path:scope.manifestPath,hash:sourceHash(fs.readFileSync(scope.manifestPath)),mode:stat.mode&0o777,dev:stat.dev,ino:stat.ino};
    }
    return {scopeRoot:scope.scopeRoot,scope:scope.scope,projectName:scope.projectName||'',status:scope.status,...(manifest?{manifest}:{})};
  });
}

function assertEditGraphs({catalog,afterManifest,mutations}) {
  const selected=catalog.contexts.find(context=>context.id===catalog.sourceContextId),next={...catalog,contexts:catalog.contexts.map(context=>context.id===selected.id?{...context,manifest:afterManifest}:context)},after=next.contexts.find(context=>context.id===selected.id),own=graphFor(next,after),issues=issuesFor(own,next,after);
  if(selected.manifest.schemaVersion===3&&issues.length)throw domainError(mutations.some(mutation=>mutation.type==='delete')?'DELETE_BLOCKED_BY_REFERENCES':'MANIFEST_DEPENDENCY_INVALID','The proposed Manifest has unresolved scoped dependencies',{issues});
  if(catalog.scope==='global')for(const context of catalog.contexts.filter(context=>context.id!==selected.id)) {
    if(context.status!=='ready')throw domainError('SCOPED_CONTEXT_UNAVAILABLE','A project source cannot be verified before changing the global declaration',{scope:context.scope,projectName:context.projectName});
    if(context.manifest.schemaVersion!==3)continue;
    const before=graphFor(catalog,context),old=new Set(before.issues.map(installationDigest)),updated=graphFor(next,next.contexts.find(value=>value.id===context.id));
    const added=issuesFor(updated,next,context).filter((issue,index)=>!old.has(installationDigest(updated.issues[index])));
    if(added.length)throw domainError(mutations.some(mutation=>mutation.type==='delete')?'DELETE_BLOCKED_BY_REFERENCES':'MANIFEST_DEPENDENCY_INVALID','The global edit would invalidate a project declaration',{issues:added});
  }
  return next;
}

export function assertScopedCompanionManifestEdit({scopeRoot,homeDir,beforeManifest,afterManifest,removed=false}) {
  let location;try{location=scopedManifestLocation(scopeRoot);}catch(error){if(error.code==='INVALID_SCOPED_KIT_LAYOUT')return;throw error;}
  if(location.scope!=='global')return;
  const catalog=loadScopedSourceContexts({scopeRoot,homeDir,includeProjects:true,selectedManifest:{manifest:beforeManifest}});
  assertEditGraphs({catalog,afterManifest,mutations:removed?[{type:'delete'}]:[]});
}

export function prepareScopedManifestEdit({scopeRoot,homeDir,manifestPath,beforeManifest,afterManifest,mutations}) {
  const input={scopeRoot,homeDir,includeProjects:true,selectedManifest:{manifestPath,manifest:beforeManifest}},catalog=loadScopedSourceContexts(input);
  assertEditGraphs({catalog,afterManifest,mutations});const snapshot=companionSnapshot(catalog),digest=installationDigest(snapshot);
  const review={schemaVersion:1,scope:catalog.scope,projectName:catalog.scope==='project'?catalog.projectName:'',companionContexts:snapshot.length,dependencyValidation:'valid',deploymentChanged:false,fulfilled:false};
  const revalidate=()=>{
    const current=loadScopedSourceContexts(input);
    if(installationDigest(companionSnapshot(current))!==digest)throw domainError('STALE_EDIT_CONTEXT','Companion Kit sources changed after edit review');
    assertEditGraphs({catalog:current,afterManifest,mutations});
  };
  return {review,run(action) {
    const roots=snapshot.filter(value=>value.status==='ready').sort((a,b)=>a.scope===b.scope?a.scopeRoot.localeCompare(b.scopeRoot):a.scope==='global'?-1:1).map(value=>value.scopeRoot),held=[];
    const verify=()=>{for(const assertHeld of held)assertHeld();revalidate();};
    const acquire=index=>index===roots.length?action(verify):withKitSourceLock(roots[index],(_owner,assertHeld)=>{held.push(assertHeld||(()=>{}));try{return acquire(index+1);}finally{held.pop();}});
    return acquire(0);
  }};
}

export function scopedDependencyProjection({scopeRoot,homeDir}) {
  const catalog=loadScopedSourceContexts({scopeRoot,homeDir,includeProjects:true}),nodes=new Map(),links=new Map(),graphs=[];
  for(const context of catalog.contexts.filter(context=>context.status==='ready'&&(catalog.scope==='global'||context.id===catalog.sourceContextId)))graphs.push(graphFor(catalog,context));
  const nodeId=node=>node.contextId===catalog.sourceContextId?node.assetId:node.key;
  for(const graph of graphs) {
    for(const node of graph.nodes){const context=catalog.contexts.find(context=>context.id===node.contextId),asset=context.manifest.assets[node.kind].find(asset=>asset.id===node.assetId);nodes.set(node.key,{id:nodeId(node),key:node.key,assetId:node.assetId,kind:node.kind,scope:node.scope,projectName:context.projectName||'',local:node.contextId===catalog.sourceContextId,displayName:asset.displayName||asset.name||asset.id});}
    for(const edge of graph.edges)links.set(installationDigest(edge),edge);
  }
  return {schemaVersion:1,readOnly:true,fulfilled:false,nodes:[...nodes.values()],links:[...links.values()].map(edge=>({source:nodes.get(edge.source).id,target:nodes.get(edge.target).id,relation:edge.relation})),issues:graphs.flatMap(graph=>graph.issues),deploymentReady:false};
}

export function scopedDiagnostics({validation,review,error}) {
  const checks=[{id:'manifest-load',status:validation.valid?'healthy':'error',code:validation.valid?'MANIFEST_OK':'MANIFEST_DEPENDENCY_INVALID',message:validation.valid?'Manifest source declarations and references are valid.':'Manifest source validation failed.',remediation:''},
    ...validation.issues.map(issue=>({id:'manifest-dependencies',status:'error',code:issue.code,message:issue.message,remediation:'Resolve the indicated Kit source or qualified reference.'}))];
  if(error)checks.push({id:'deployment-plan',status:'error',code:error.code||'DEPLOYMENT_DIAGNOSTIC_FAILED',message:'The selected client deployment could not be planned.',remediation:'Review the client, target and Kit source context.'});
  if(review)for(const block of review.blocked)checks.push({id:'deployment-plan',status:block.reason==='DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'?'warning':'error',code:block.reason,message:'The selected deployment requires additional verification.',remediation:block.reason==='DEPENDENCY_NATIVE_PREREQUISITES_UNVERIFIED'?'Create a deployment plan and explicitly observe its installed prerequisites.':'Resolve the blocked plan before deployment.'});
  if(!review&&!error)checks.push({id:'client-definition',status:'warning',code:'CLIENT_NOT_SELECTED',message:'No client was selected for deployment diagnostics.',remediation:'Select a client/surface to inspect its deployment plan.'});
  return {schemaVersion:1,readOnly:true,healthy:checks.every(check=>check.status!=='error'),checks,dependencyGraph:validation.dependencyGraph,fulfilled:false,deploymentReady:false,
    nativePrerequisitesState:review?.nativePrerequisitesState||'unverified',deploymentState:review?.execution?.status||'not-selected'};
}
