import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {validSkillDistribution} from '../domain/skill-distribution.js';
import {createSkillSnapshotDescriptor} from '../domain/skill-snapshot.js';
import {readImportSource} from './import-source-reader.js';
import {isWithinRoot} from '../security-boundary.js';
import {kitSourcePath} from './kit-source-transaction.js';
import {sameInventory} from './kit-source-snapshot.js';

const fail=()=>{throw domainError('SKILL_VARIANT_SOURCE_UNSAFE','Skill variants must remain ordinary bounded bundles inside their source origin');};
export function inspectSkillDistributionSources(asset,source,{variantIds,scopeRoot}={}) {
  if(!validSkillDistribution(asset.definition?.distribution,{assetId:asset.id}))fail();
  const variants=asset.definition.distribution.variants;
  if(variantIds!==undefined&&(!Array.isArray(variantIds)||!variantIds.length||new Set(variantIds).size!==variantIds.length||variantIds.some(id=>!variants.some(variant=>variant.id===id))))fail();
  let root;try{if(!fs.lstatSync(source).isDirectory())fail();root=fs.realpathSync(source);}catch(error){if(error.name==='DomainError')throw error;fail();}
  const result=new Map();
  for(const variant of variants.filter(variant=>!variantIds||variantIds.includes(variant.id))) {
    const managed=typeof variant.source!=='string',authorizedRoot=managed?scopeRoot:root;
    if(managed&&!scopeRoot)fail();
    const candidate=managed?kitSourcePath(scopeRoot,variant.source.record.source):path.resolve(root,variant.source);let cursor=root;
    try {
      if(!managed)for(const part of variant.source.split('/').filter(Boolean)){cursor=path.join(cursor,part);if(!fs.lstatSync(cursor).isDirectory())fail();}
      if(!isWithinRoot(candidate,authorizedRoot)||!isWithinRoot(fs.realpathSync(candidate),fs.realpathSync(authorizedRoot)))fail();
    }catch(error){if(error.name==='DomainError')throw error;fail();}
    const read=readImportSource({source:candidate,authorizedRoot,kind:'skills'});if(read.linkText!==null)fail();
    if(managed&&!sameInventory(read.inventory,variant.source.record.kitFiles))throw domainError('IMPORT_ARTIFACT_MODIFIED','Managed variant contents differ from their recorded revision');
    const descriptor=createSkillSnapshotDescriptor(read.files.map(file=>({path:file.path,sha256:file.sha256,mode:file.mode,bytes:file.content.length})));
    result.set(variant.id,{variant:structuredClone(variant),source:candidate,descriptor,files:read.files});
  }
  return result;
}
