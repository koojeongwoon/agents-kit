import crypto from 'node:crypto';
import {validSourceState,safeResourceRelativePath} from './resource-management.js';
import {domainError} from './errors.js';
import {isDeepStrictEqual} from 'node:util';

const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const HASH=/^[a-f0-9]{64}$/,REVISION=/^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
export const variantSourceId=(assetId,variantId)=>`variant-${crypto.createHash('sha256').update(JSON.stringify([assetId,variantId])).digest('hex').slice(0,56)}`;
export function assertManagedSkillSourcesPreserved(before,after) {
  const records=manifest=>new Map((manifest.assets.skills||[]).flatMap(asset=>asset.definition?.schemaVersion===3?asset.definition.distribution.variants.filter(variant=>typeof variant.source!=='string').map(variant=>[JSON.stringify([asset.id,variant.id]),variant.source]):[]));
  const old=records(before),next=records(after);
  if(old.size!==next.size||[...old].some(([id,value])=>!isDeepStrictEqual(next.get(id),value)))throw domainError('MANAGED_VARIANT_EDIT_UNSUPPORTED','Use the variant source workflow to preserve its revisions and origin');
}
export function validManagedSkillSource(value,assetId,variantId) {
  if(!fields(value,['schemaVersion','type','record'])||value.schemaVersion!==1||value.type!=='managed')return false;
  const record=value.record,id=variantSourceId(assetId,variantId);
  if(!fields(record,['schemaVersion','status','kind','format','nativeId','origin','source','baseline','fingerprint','files','kitFiles','revisionId','history','lastCheck','upstream'])
    ||![2,3].includes(record.schemaVersion)||record.status!=='active'||record.kind!=='skills'||record.format!=='directory'||typeof record.nativeId!=='string'||!record.nativeId||/[\\/\u0000-\u001f\u007f]/.test(record.nativeId)
    ||!validSourceState(record,id)||!record.source.startsWith(`assets/revisions/${id}/`)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.source.slice(`assets/revisions/${id}/`.length))||!Array.isArray(record.kitFiles)||!REVISION.test(record.revisionId||'')||!Array.isArray(record.history)||record.history.length>1024
    ||new Set(record.history.map(item=>item?.id)).size!==record.history.length||record.history.some(item=>!fields(item,['id','path','sha256','at','action'])||!REVISION.test(item.id||'')
      ||item.path!==`.kit-sources/revisions/${id}/${item.id}.json`||!HASH.test(item.sha256||'')||typeof item.at!=='string'||!Number.isFinite(Date.parse(item.at))||!['edit','refresh','rollback'].includes(item.action))
    ||record.schemaVersion===2&&record.upstream!==undefined)return false;
  const origin=record.origin;
  if(origin?.type==='kit')return fields(origin,['type','path'])&&safeResourceRelativePath(origin.path)&&record.nativeId===assetId;
  return fields(origin,['type','clientId','surface','scope','root','path','candidateId','linkHash'])&&origin.type==='local'
    &&typeof origin.clientId==='string'&&/^[a-z][a-z0-9._-]*$/.test(origin.clientId)&&typeof origin.surface==='string'&&/^[a-z][a-z0-9._-]*$/.test(origin.surface)
    &&['global','project'].includes(origin.scope)&&typeof origin.root==='string'&&(origin.scope==='global'?origin.root==='~':origin.root.startsWith('/'))
    &&safeResourceRelativePath(origin.path)&&HASH.test(origin.candidateId||'')&&(origin.linkHash===undefined||HASH.test(origin.linkHash));
}
