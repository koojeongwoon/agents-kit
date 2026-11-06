import {domainError} from './errors.js';
import {ASSET_KINDS} from './manifest.js';

const ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT=/^[A-Za-z0-9_-]+$/;

// A stable reference carries logical identity only; physical origin is supplied
// by the authorized catalog, never by a path embedded in the reference.
export function normalizeAssetReference(value,expectedKind,{allowQualified=false}={}) {
  const invalid=()=>{throw domainError('INVALID_ASSET_REFERENCE','Asset reference requires a supported stable identity');};
  if(typeof value==='string'){if(!ID.test(value))invalid();return value;}
  if(!allowQualified||!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).some(key=>!['schemaVersion','kitId','scope','kind','assetId'].includes(key))
    ||value.schemaVersion!==1||typeof value.kitId!=='string'||typeof value.assetId!=='string'||!ID.test(value.kitId)||!ID.test(value.assetId)
    ||!ASSET_KINDS.includes(value.kind)||(expectedKind&&value.kind!==expectedKind))invalid();
  const scope=value.scope;
  if(!scope||typeof scope!=='object'||Array.isArray(scope)||!['global','project'].includes(scope.type)
    ||Object.keys(scope).some(key=>!['type','projectName'].includes(key))
    ||(scope.type==='global'&&scope.projectName!==undefined)
    ||(scope.type==='project'&&(typeof scope.projectName!=='string'||scope.projectName.length>128||!PROJECT.test(scope.projectName))))invalid();
  return Object.freeze({schemaVersion:1,kitId:value.kitId,scope:Object.freeze({...scope}),kind:value.kind,assetId:value.assetId});
}
