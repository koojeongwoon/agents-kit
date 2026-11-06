import path from 'node:path';
import crypto from 'node:crypto';
import {stringify} from 'yaml';
import {domainError} from '../domain/errors.js';
import {variantSourceId} from '../domain/managed-skill-source.js';
import {createSkillSnapshotDescriptor} from '../domain/skill-snapshot.js';
import {inspectSkillDistributionSources} from '../infrastructure/skill-distribution-source.js';
import {readImportSource} from '../infrastructure/import-source-reader.js';
import {kitSourcePath,sourceHash} from '../infrastructure/kit-source-transaction.js';
import {assertSourceArtifacts,sameInventory} from '../infrastructure/kit-source-snapshot.js';
import {validateManifestDocument} from '../infrastructure/manifest-loader.js';

const fail=code=>{throw domainError(code,'The Skill variant source requires a new reviewed plan');};
const ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const descriptor=files=>createSkillSnapshotDescriptor(files.map(file=>({path:file.path,mode:file.mode,sha256:file.sha256,bytes:file.content.length})));
function subject(loaded,input) {
  if(typeof input.assetId!=='string'||!ID.test(input.assetId)||typeof input.variantId!=='string'||!ID.test(input.variantId))fail('INVALID_SKILL_VARIANT');
  const asset=loaded.manifest.assets.skills.find(asset=>asset.id===input.assetId),variant=asset?.definition?.schemaVersion===3&&asset.definition.distribution.variants.find(variant=>variant.id===input.variantId);
  if(!variant)fail('SKILL_VARIANT_NOT_FOUND');return {asset,variant};
}
function readOrdinary(root,relative) {
  const snapshot=readImportSource({source:kitSourcePath(root,relative),authorizedRoot:root,kind:'skills'});
  if(snapshot.linkText!==null)fail('SKILL_VARIANT_SOURCE_UNSAFE');descriptor(snapshot.files);return snapshot;
}

export function createSkillVariantSourceService({load,candidate,remember}) {
  return {
    access(loaded,input) {
      const {variant}=subject(loaded,input);if(typeof variant.source==='string')fail('SKILL_VARIANT_SOURCE_NOT_REGISTERED');
      const record=variant.source.record,storageId=variantSourceId(input.assetId,input.variantId);
      return {variantId:input.variantId,storageId,record,
        validateVariantFiles:descriptor,
        updateVariantRecord:(doc,next)=>{doc.assets.skills.find(asset=>asset.id===input.assetId).definition.distribution.variants.find(item=>item.id===input.variantId).source={schemaVersion:1,type:'managed',record:next};},
        ...(record.origin.type==='kit'?{localUpstream:()=>({snapshot:readOrdinary(loaded.scopeRoot,record.origin.path),binding:null})}:{})};
    },
    planVariantRegistration(input) {
      const loaded=load(input),{asset,variant}=subject(loaded,input);
      if(typeof variant.source!=='string') {
        if(input.candidateId!==undefined&&input.candidateId!==variant.source.record.origin.candidateId)fail('SOURCE_BINDING_CHANGED');
        assertSourceArtifacts(loaded.scopeRoot,variant.source.record);
        return remember({kind:'variant-register',...loaded,artifactRecord:variant.source.record,skip:true,operations:[{operation:'SKIP',assetId:input.assetId,variantId:input.variantId,reason:'SOURCE_ALREADY_REGISTERED'}]});
      }
      const selected=input.candidateId===undefined?null:candidate(input);
      if(selected&&(selected.item.kind!=='skills'||selected.capability.format!=='directory'))fail('IMPORT_KIND_UNSUPPORTED');
      const inspected=inspectSkillDistributionSources(asset,kitSourcePath(loaded.scopeRoot,asset.source),{variantIds:[variant.id],scopeRoot:loaded.scopeRoot}).get(variant.id);
      const original=path.posix.join(asset.source,variant.source),kit=readOrdinary(loaded.scopeRoot,original);
      if(descriptor(kit.files).treeDigest!==inspected.descriptor.treeDigest)fail('IMPORT_SOURCE_CHANGED');
      const base=selected?.snapshot||kit;descriptor(base.files);
      const storageId=variantSourceId(input.assetId,input.variantId),revisionId=crypto.randomUUID(),source=`assets/revisions/${storageId}/${revisionId}`,baseline=`.kit-sources/baselines/${storageId}/${base.fingerprint}`;
      const origin=selected?{type:'local',clientId:input.clientId,surface:selected.profile.id||'default',scope:selected.sourceScope,root:selected.sourceScope==='global'?'~':selected.root,
        path:path.relative(selected.root,selected.source).split(path.sep).join('/'),candidateId:input.candidateId,...(selected.snapshot.linkText?{linkHash:sourceHash(selected.snapshot.linkText)}:{})}:{type:'kit',path:original};
      const record={schemaVersion:2,status:'active',kind:'skills',format:'directory',nativeId:selected?.item.id||asset.id,origin,source,baseline,fingerprint:base.fingerprint,files:base.inventory,kitFiles:kit.inventory,revisionId,history:[]};
      const doc=loaded.doc,distribution=doc.assets.skills.find(item=>item.id===asset.id).definition.distribution;distribution.schemaVersion=2;
      distribution.variants.find(item=>item.id===variant.id).source={schemaVersion:1,type:'managed',record};validateManifestDocument(doc);
      const content=loaded.format==='json'?`${JSON.stringify(doc,null,2)}\n`:stringify(doc);
      const files=[...kit.files.map(file=>({...file,path:`${source}/${file.path}`})),...base.files.map(file=>({...file,path:`${baseline}/${file.path}`}))];
      return remember({kind:'variant-register',...loaded,content,files,manifestDiff:{before:loaded.before,after:content},
        revalidate:()=>{const now=readOrdinary(loaded.scopeRoot,original);if(!sameInventory(now.inventory,kit.inventory))fail('IMPORT_SOURCE_CHANGED');if(selected&&candidate(input).snapshot.fingerprint!==base.fingerprint)fail('IMPORT_SOURCE_CHANGED');},
        operations:[{operation:'REGISTER_VARIANT_SOURCE',assetId:asset.id,variantId:variant.id,originalPreserved:true},...files.map(file=>({operation:'CREATE_SOURCE',path:file.path,sha256:file.sha256,mode:file.mode}))]});
    }
  };
}
