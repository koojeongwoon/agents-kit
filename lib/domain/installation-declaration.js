import {directReferences,toolRequirements,providedTools,resolveManifestDependencies} from './manifest.js';
import {domainError} from './errors.js';
import {installationDigest} from './installation-receipt.js';
import {validateNativeToolNames} from './agent-tool-bindings.js';

export const installationDeclarationDigest=({dependencies,...declaration})=>installationDigest(declaration);

// Public logical metadata only. Native/source instruction text and MCP
// connection values cannot enter the installed declaration snapshot.
export function installationDeclaration(asset,manifest) {
  const dependencies=resolveManifestDependencies(manifest,{selectedAssetIds:[asset.id],targetScope:asset.scope});
  if(!dependencies.valid)throw domainError('MANIFEST_DEPENDENCY_INVALID','Installation declarations require a valid dependency graph');
  const index=new Map(Object.values(manifest.assets).flat().map(item=>[item.id,item]));
  const declaration=item=>{
    validateNativeToolNames(item);
    const policies=(item.policies||[]).map(id=>index.get(id));
    return {schemaVersion:2,references:directReferences(item),requirements:toolRequirements(item),providedTools:providedTools(item),
      providedToolNames:(item.provides?.tools||[]).map(tool=>typeof tool==='string'?{id:tool}:{id:tool.id,...(tool.nativeName?{nativeName:tool.nativeName}:{})}),
      deniedCapabilities:[...new Set([...(item.deny?.capabilities||[]),...(item.policy?.deny?.capabilities||[]),...policies.flatMap(policy=>policy?.deny?.capabilities||[])])].sort(),
      toolBindings:dependencies.toolBindings.filter(binding=>binding.consumerId===item.id)};
  };
  return {...declaration(asset),dependencies:dependencies.assetIds.filter(id=>id!==asset.id).map(id=>{
    const dependency=index.get(id);return {assetId:id,assetKind:dependency.kind,declarationDigest:installationDeclarationDigest(declaration(dependency))};
  })};
}
