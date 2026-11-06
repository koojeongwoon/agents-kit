import {domainError} from './errors.js';

const scope=asset=>typeof asset.scope==='string'?asset.scope:asset.scope?.type||'global';
const key=asset=>JSON.stringify([asset.assetKind,asset.assetId]);
function globalAssets(manifest) {
  if(typeof manifest?.kit?.id!=='string'||!manifest.assets)throw domainError('INVALID_DEPENDENCY_SOURCE_DOCUMENT','Source identity requires validated before and after manifests');
  return Object.entries(manifest.assets).flatMap(([assetKind,assets])=>assets.filter(asset=>scope(asset)==='global').map(asset=>({assetKind,assetId:asset.id})));
}

// Moving scope, changing Kit identity and renaming an asset remove the original
// qualified identity just as deletion does. Body-only source edits do not.
export function removedGlobalSourceIdentities({beforeManifest,afterManifest}) {
  const before=globalAssets(beforeManifest),after=new Set(globalAssets(afterManifest).map(key));
  return before.filter(asset=>beforeManifest.kit.id!==afterManifest.kit.id||!after.has(key(asset)));
}
