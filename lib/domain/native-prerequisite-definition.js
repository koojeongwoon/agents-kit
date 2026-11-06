import path from 'node:path';
import {domainError} from './errors.js';

const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const ID=/^[a-z][a-z0-9._-]{0,63}$/;
const invalid=()=>{throw domainError('NATIVE_PREREQUISITE_DEFINITION_UNVERIFIED','Native prerequisites require a reviewed protocol definition');};

export function createNativePrerequisiteDefinition(raw,{clientId,surface,configStore}) {
  if(![clientId,surface,configStore].every(value=>typeof value==='string'&&ID.test(value)))invalid();
  if(!fields(raw,['schemaVersion','clientId','surface','configStore','adapter','systemFiles','evidence'])||raw.schemaVersion!==1
    ||raw.clientId!==clientId||raw.surface!==surface||raw.configStore!==configStore||clientId!=='codex'||surface!=='cli'||raw.adapter!=='codex-prerequisites-v1'
    ||!Array.isArray(raw.systemFiles)||raw.systemFiles.length>8||new Set(raw.systemFiles).size!==raw.systemFiles.length
    ||raw.systemFiles.some(file=>typeof file!=='string'||!path.isAbsolute(file)||path.normalize(file)!==file||!file.endsWith('.toml')||/[\\\u0000-\u001f\u007f]/.test(file))
    ||!Array.isArray(raw.evidence)||!raw.evidence.length||raw.evidence.length>16)invalid();
  for(const record of raw.evidence)if(!fields(record,['binarySha256','version','platform','arch','verifiedAt','source'])
    ||!/^([a-f0-9]{64})$/.test(record.binarySha256||'')||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(record.version||'')
    ||!['darwin','linux','win32'].includes(record.platform)||!['arm64','x64'].includes(record.arch)||!/^\d{4}-\d{2}-\d{2}$/.test(record.verifiedAt||'')
    ||typeof record.source!=='string'||!record.source||record.source.length>4096)invalid();
  if(new Set(raw.evidence.map(record=>[record.binarySha256,record.platform,record.arch].join(':'))).size!==raw.evidence.length)invalid();
  return Object.freeze(structuredClone(raw));
}
