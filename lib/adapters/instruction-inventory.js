import fs from 'node:fs';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {readCatalogText} from '../infrastructure/catalog-text-reader.js';

export function instructionSettings(response) {
  const settings=response?.config,limit=settings?.project_doc_max_bytes,fallbacks=settings?.project_doc_fallback_filenames;
  if(!Number.isSafeInteger(limit)||limit<0||limit>8*1024*1024||!Array.isArray(fallbacks)||fallbacks.length>32
    ||fallbacks.some(value=>typeof value!=='string'||!value||value.length>128||/[\u0000-\u001f\\/]/.test(value)||['.','..'].includes(value))) {
    throw domainError('NATIVE_INVENTORY_RESPONSE_INVALID','Instruction settings metadata is outside the reviewed shape');
  }
  return {byteBudget:limit,fallbacks,customGuidancePresent:['instructions','developer_instructions','model_instructions_file'].some(key=>settings[key]!=null),
    customBoundaryPresent:settings.project_root_markers!=null&&JSON.stringify(settings.project_root_markers)!=='[".git"]'};
}

export function previewInstructions(settings,discovery,{homeDir,cwd,projectSelected}) {
  const files=[],directories=[];
  const globalFiles=discovery.globalFiles.map(value=>path.join(homeDir,value.slice(2)));
  directories.push({scope:'global',root:homeDir,files:globalFiles});
  if(projectSelected) {
    let root=cwd;const parents=[];let found=false;
    if(!settings.customBoundaryPresent)for(let depth=0;depth<64;depth++) {
      parents.push(root);
      try{fs.lstatSync(path.join(root,discovery.ancestorBoundary));found=true;break;}catch(error){if(error.code!=='ENOENT')break;}
      const parent=path.dirname(root);if(parent===root)break;root=parent;
    }
    const roots=found?parents:[cwd];
    for(const directory of roots.sort((a,b)=>a.length-b.length))directories.push({scope:directory===cwd?'project':'context',root:directory,
      files:[...new Set([...discovery.projectFiles,...settings.fallbacks])].map(name=>path.join(directory,name))});
  }
  let candidateBytes=0;
  for(const directory of directories) {
    let selected=false,blocked=false;
    for(const file of directory.files) {
      let state,bytes=0,contentRead=false,code;
      if(selected||blocked)try {
        const stat=fs.lstatSync(file);
        if(!stat.isFile()&&!stat.isSymbolicLink()){state='unverified';code='CATALOG_FILE_TYPE_UNSUPPORTED';}
        else{state=selected?'shadowed':'selection-unverified';if(stat.isFile())bytes=stat.size;}
      }catch(error){code=error.code;state=error.code==='ENOENT'?'missing':'unverified';}
      else try {
        const read=readCatalogText(file,{root:directory.root});contentRead=true;bytes=read.bytes;
        if(!read.text.trim())state='empty';else{state='candidate';selected=true;candidateBytes+=bytes;}
      }catch(error){code=error.code;contentRead=error.details?.contentRead===true;if(error.code==='ENOENT')state='missing';else{state='unverified';blocked=true;}}
      files.push({path:file,scope:directory.scope,state,bytes,contentRead,manageable:false,...(code?{code}:{})});
    }
  }
  return {state:'documented-prediction',loadedSourcesState:'unverified',settingsVerified:true,byteBudget:settings.byteBudget,
    budgetMayTruncate:candidateBytes>settings.byteBudget,customGuidancePresent:settings.customGuidancePresent,
    contextIncomplete:settings.customBoundaryPresent,files};
}
