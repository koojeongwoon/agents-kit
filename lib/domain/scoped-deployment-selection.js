import {domainError} from './errors.js';
import {resolveScopedManifestDependencies} from './scoped-manifest-dependencies.js';
import {skillHasSelectedTarget} from './skill-distribution.js';

const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const fail=(code,details)=>{throw domainError(code,'Scoped deployment requires an enabled local selection and a valid origin-aware dependency graph',details);};

// Selection is pure and grants no installation or filesystem authority. Local
// dependency IDs serve existing client records; external keys remain qualified.
export function selectScopedManifestDeployment({contexts,sourceContextId,clientId,surface,selectedAssetIds}) {
  if(!Array.isArray(contexts))fail('INVALID_SCOPED_CATALOG');
  const source=contexts.find(context=>context?.id===sourceContextId);
  if(source?.status!=='ready'||source.manifest?.schemaVersion!==3)fail('SCOPED_MANIFEST_REQUIRED');
  const manifest=source.manifest,target=Object.hasOwn(manifest.targets||{},clientId)?manifest.targets[clientId]:undefined,assets=Object.values(manifest.assets).flat();
  if(Object.keys(manifest.targets||{}).length&&(!target||target.enabled===false))fail('MANIFEST_TARGET_DISABLED');
  if(source.scope==='project'&&target?.projectName&&target.projectName!==source.projectName)fail('SCOPED_DEPLOYMENT_TARGET_MISMATCH');
  const inScope=asset=>asset.scope.type===source.scope&&(source.scope==='global'||asset.scope.projectName===source.projectName);
  const eligible=assets.filter(asset=>inScope(asset)&&(target?.assetIds?target.assetIds.includes(asset.id):manifest.management?.resources[asset.id]?.status!=='active')).map(asset=>asset.id);
  const roots=selectedAssetIds===undefined?eligible.filter(id=>target?.assetIds||skillHasSelectedTarget(assets.find(asset=>asset.id===id),{clientId,surface})):selectedAssetIds;
  if(!Array.isArray(roots)||roots.length>256||new Set(roots).size!==roots.length||roots.some(id=>typeof id!=='string'||!eligible.includes(id)))fail('INVALID_SCOPED_DEPLOYMENT_SELECTION');
  if(!roots.length)fail('NO_ASSETS_FOR_SCOPE');
  const graph=resolveScopedManifestDependencies({contexts,sourceContextId,selectedAssetIds:roots});
  if(!graph.valid)fail('MANIFEST_DEPENDENCY_INVALID',{issues:graph.issues});
  const local=graph.nodes.filter(node=>node.contextId===sourceContextId),globalPrerequisites=graph.globalPrerequisites;
  if(local.length>256||globalPrerequisites.length>256)fail('SCOPED_DEPLOYMENT_LIMIT_EXCEEDED');
  const outgoing=new Map(graph.nodes.map(node=>[node.key,[]]));for(const edge of graph.edges)outgoing.get(edge.source)?.push(edge.target);
  const dependenciesByAsset={},prerequisitesByAsset={};
  for(const node of local) {
    const reachable=new Set(),queue=[...(outgoing.get(node.key)||[])];
    for(let index=0;index<queue.length;index++) {const key=queue[index];if(reachable.has(key))continue;reachable.add(key);queue.push(...(outgoing.get(key)||[]));}
    dependenciesByAsset[node.assetId]=local.filter(other=>reachable.has(other.key)).map(other=>other.assetId).sort();
    prerequisitesByAsset[node.assetId]=globalPrerequisites.filter(other=>reachable.has(other.key)).map(other=>other.key).sort();
  }
  return freeze({schemaVersion:1,rootAssetIds:[...roots],selectedAssetIds:local.map(node=>node.assetId).sort(),dependencyAssetIds:local.filter(node=>!roots.includes(node.assetId)).map(node=>node.assetId).sort(),
    graph,globalPrerequisites,dependenciesByAsset,prerequisitesByAsset});
}
