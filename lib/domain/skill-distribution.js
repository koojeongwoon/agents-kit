import crypto from 'node:crypto';
import {domainError} from './errors.js';
import {safeResourceRelativePath} from './resource-management.js';
import {validManagedSkillSource,variantSourceId} from './managed-skill-source.js';

const ID=/^[a-z0-9][a-z0-9-]{0,63}$/,CLIENT=/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/,HASH=/^[a-f0-9]{64}$/;
const VERSION=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-((?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const exactVersion=value=>typeof value==='string'&&value.length<=128&&VERSION.test(value)&&!(value.match(VERSION)[1]||'').split('.').some(part=>/^0\d+$/.test(part));
const clientId=value=>typeof value==='string'&&value.length<=64&&CLIENT.test(value);
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,canonical(value[key])])):value;
export const skillDistributionDigest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const validNativeSkillDeclaration=value=>fields(value,['schemaVersion','clientId','profile'])&&value.schemaVersion===1&&clientId(value.clientId)&&typeof value.profile==='string'&&CLIENT.test(value.profile)&&value.profile.length<=64;

export function skillCompatibilityDeclarationDigest(asset) {
  return skillDistributionDigest({schemaVersion:1,assetId:asset.id,scope:asset.scope,dependsOn:asset.dependsOn||{},requires:asset.requires||{},uses:asset.uses||{},policies:asset.policies||[]});
}

// One client's installed choice is independent of other variants' drafts and
// provenance. Its own source state and exact compatibility rule remain bound.
export function skillSelectionDefinitionDigest(asset,selection) {
  const definition=asset.definition,distribution=definition.distribution,variant=distribution.variants.find(variant=>variant.id===selection.variantId);
  const target=distribution.selection.find(target=>target.clientId===selection.clientId&&target.surface===selection.surface);
  const rule=variant?.compatibility.find(rule=>rule.clientId===selection.clientId&&rule.surface===selection.surface&&rule.versions.includes(selection.clientVersion));
  if(!variant||!target||!rule)throw domainError('INVALID_SKILL_SELECTION','Selected variant policy is missing');
  return skillDistributionDigest({schemaVersion:1,assetId:asset.id,scope:asset.scope,definitionVersion:definition.schemaVersion,format:definition.format,deployment:definition.deployment,
    exposure:distribution.exposure,selection:target,sourceRoot:typeof variant.source==='string'?asset.source:null,variant:{id:variant.id,source:variant.source,format:variant.format,compatibility:rule,...(variant.native?{native:variant.native}:{})}});
}

export function validSkillDistribution(value,{assetId}={}) {
  if(!fields(value,['schemaVersion','exposure','selection','variants'])||![1,2].includes(value.schemaVersion)||!['shared','exclusive-client'].includes(value.exposure)
    ||!Array.isArray(value.variants)||!value.variants.length||value.variants.length>8||!Array.isArray(value.selection)||value.selection.length>16)return false;
  const variants=new Set(),paths=[],selected=new Set(),aliases=new Map();
  for(const variant of value.variants) {
    if(!fields(variant,['id','source','format','compatibility','native'])||typeof variant.id!=='string'||!ID.test(variant.id)||variants.has(variant.id)
      ||!['common','native'].includes(variant.format)||!Array.isArray(variant.compatibility)||variant.compatibility.length>32)return false;
    if(variant.native!==undefined&&(variant.format!=='native'||!validNativeSkillDeclaration(variant.native)))return false;
    const managed=typeof variant.source!=='string';
    if(managed?!value.schemaVersion||value.schemaVersion!==2||!validManagedSkillSource(variant.source,assetId||variant.source?.record?.nativeId,variant.id):variant.source!==''&&!safeResourceRelativePath(variant.source))return false;
    const source=managed?null:variant.source;
    const parts=(source||'').split('/'),folded=source?.toLowerCase();
    if(!managed) {
    if(source!==source.normalize('NFC')||parts.length>16||parts.some(part=>['.git','.kit-sources','.agent-kit','.agents-kit'].includes(part.toLowerCase())))return false;
    for(let index=1;index<=parts.length;index++){const prefix=parts.slice(0,index).join('/'),key=prefix.toLowerCase();if(aliases.has(key)&&aliases.get(key)!==prefix)return false;aliases.set(key,prefix);}
    if(paths.some(source=>source===''||folded===''||source===folded||source.startsWith(folded+'/')||folded.startsWith(source+'/')))return false;
    paths.push(folded);
    }
    variants.add(variant.id);const rules=new Set();
    for(const rule of variant.compatibility) {
      if(!fields(rule,['clientId','surface','versions','status','review'])||!clientId(rule.clientId)||!clientId(rule.surface)||!['compatible','incompatible','unknown'].includes(rule.status)
        ||!Array.isArray(rule.versions)||!rule.versions.length||rule.versions.length>16||rule.versions.some(version=>!exactVersion(version)))return false;
      for(const version of rule.versions){const key=JSON.stringify([rule.clientId,rule.surface,version]);if(rules.has(key))return false;rules.add(key);}
      if(rule.status==='compatible'?!fields(rule.review,['schemaVersion','basis','treeDigest','declarationDigest'])||rule.review.schemaVersion!==1||rule.review.basis!=='author-review'||!HASH.test(rule.review.treeDigest||'')||!HASH.test(rule.review.declarationDigest||''):rule.review!==undefined)return false;
    }
  }
  for(const selection of value.selection) {
    if(!fields(selection,['clientId','surface','variantId'])||!clientId(selection.clientId)||!clientId(selection.surface)||!variants.has(selection.variantId))return false;
    const key=JSON.stringify([selection.clientId,selection.surface]);if(selected.has(key))return false;selected.add(key);
  }
  return true;
}

export function skillHasSelectedTarget(asset,{clientId,surface}={}) {
  if(asset.kind!=='skills'||asset.definition?.schemaVersion!==3)return true;
  return asset.definition.distribution.selection.some(selection=>selection.clientId===clientId&&(surface===undefined||selection.surface===surface));
}

// Author review is source-bound declared compatibility, never native discovery
// or proof that arbitrary Markdown instructions will be followed by a model.
export function selectSkillDistribution(asset,{clientId,surface,clientVersion,nativePolicyDigest}={}) {
  if(asset.kind!=='skills'||asset.definition?.schemaVersion!==3)return null;
  const distribution=asset.definition.distribution;if(!validSkillDistribution(distribution,{assetId:asset.id}))throw domainError('INVALID_COMMON_SOURCE_DEFINITION','Skill distribution requires bounded versioned variants and explicit targets');
  const selection=distribution.selection.find(selection=>selection.clientId===clientId&&selection.surface===surface),variant=distribution.variants.find(variant=>variant.id===selection?.variantId),version=typeof clientVersion==='string'?clientVersion.replace(/^v/,''):'';
  const managed=variant&&typeof variant.source!=='string',native=variant?.native;
  const base={schemaVersion:native?3:managed?2:1,clientId,surface,clientVersion:version||null,exposure:distribution.exposure,nativeUseState:'unverified',fulfilled:false,...(variant?{variantId:variant.id,source:managed?variant.source.record.source:variant.source,format:variant.format}:{}),
    ...(native?{native:structuredClone(native),nativePolicyDigest:HASH.test(nativePolicyDigest||'')?nativePolicyDigest:null,sourceBase:managed?'kit':'asset'}:{}),
    ...(managed?{sourceBase:'kit',sourceRevision:{id:variantSourceId(asset.id,variant.id),revisionId:variant.source.record.revisionId}}:{})};
  const blocked=reason=>({...base,status:'blocked',reason});
  if(!selection)return blocked('SKILL_TARGET_NOT_SELECTED');if(!exactVersion(version))return blocked('SKILL_COMPATIBILITY_VERSION_REQUIRED');
  const rule=variant.compatibility.find(rule=>rule.clientId===clientId&&rule.surface===surface&&rule.versions.includes(version));
  if(!rule||rule.status==='unknown')return blocked('SKILL_COMPATIBILITY_UNVERIFIED');if(rule.status==='incompatible')return blocked('SKILL_CLIENT_INCOMPATIBLE');
  if(rule.review.declarationDigest!==skillCompatibilityDeclarationDigest(asset))return blocked('SKILL_COMPATIBILITY_DECLARATION_CHANGED');
  const result={...base,review:structuredClone(rule.review),reviewDigest:skillDistributionDigest({variantId:variant.id,clientId,surface,version,review:rule.review,...(managed?{sourceBase:base.sourceBase,sourceRevision:base.sourceRevision,source:base.source}:{}),...(native?{native,nativePolicyDigest:base.nativePolicyDigest,sourceBase:base.sourceBase,source:base.source}:{})}),compatibilityState:'author-reviewed'};
  if(native&&native.clientId!==clientId)return {...result,status:'blocked',reason:'SKILL_NATIVE_CLIENT_MISMATCH'};
  if(variant.format==='native'&&(!native||!base.nativePolicyDigest))return {...result,status:'blocked',reason:'SKILL_NATIVE_VARIANT_UNVERIFIED'};
  return {...result,status:'selected'};
}
