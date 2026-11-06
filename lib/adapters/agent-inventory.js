import path from 'node:path';
import {parseDocument} from 'yaml';
import {readCatalogText} from '../infrastructure/catalog-text-reader.js';

function tomlHeaderName(text) {
  let name;
  for(const line of text.split(/\r?\n/)) {
    if(/^\s*\[/.test(line)||/=\s*(?:"""|''')/.test(line))break;
    const match=/^\s*name\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
    if(match){if(name!==undefined)return undefined;name=match[1].startsWith("'")?match[1].slice(1,-1):JSON.parse(match[1]);}
  }
  return name;
}
export function observeAgentName(entry,{homeDir,targetRoot}) {
  let contentRead=false;
  const unknown=code=>({nativeName:{status:'unverified',code},contentRead});
  if(entry.entryType!=='file'||entry.managementMode==='external')return unknown('AGENT_NAME_LINK_NOT_INSPECTED');
  const file=entry.path.startsWith('~/')?path.join(homeDir,entry.path.slice(2)):entry.path;
  try {
    const result=readCatalogText(file,{root:targetRoot});contentRead=true;
    let name,basis;
    if(file.endsWith('.toml')){name=tomlHeaderName(result.text);basis='agent-toml-name';}
    else if(file.endsWith('.md')) {
      const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(result.text);if(!match)return unknown('AGENT_METADATA_INVALID');
      const document=parseDocument(match[1],{uniqueKeys:true});if(document.errors.length||document.warnings.length)return unknown('AGENT_METADATA_INVALID');
      name=document.toJS({maxAliasCount:0})?.name;basis='agent-frontmatter';
    }
    if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name))return unknown('AGENT_METADATA_UNVERIFIED');
    return {nativeName:{status:'declared',value:name,basis},contentRead,metadataFingerprint:result.sha256};
  }catch(error){contentRead=contentRead||error.details?.contentRead===true;return unknown(error.code||'AGENT_METADATA_INVALID');}
}
