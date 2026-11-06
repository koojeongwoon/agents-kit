import fs from 'node:fs';
import path from 'node:path';
import {parseDocument} from 'yaml';
import {boundedRead} from './import-source-reader.js';
import {authorizeImagePath} from './path-image.js';
import {skillDistributionDigest} from '../domain/skill-distribution.js';
import {domainError} from '../domain/errors.js';
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const HASH=/^[a-f0-9]{64}$/;
export function loadNativeSkillPolicy({definitionsDir,clientId,surface,configStore}) {
  if(!definitionsDir||![clientId,surface,configStore].every(value=>typeof value==='string'&&/^[a-z][a-z0-9._-]{0,63}$/.test(value)))return null;
  try {
    const root=path.resolve(definitionsDir,'native-skills'),file=path.join(root,`${clientId}-${surface}.yaml`);authorizeImagePath(file,root);
    const document=parseDocument(boundedRead(file).bytes.toString('utf8'),{uniqueKeys:true});if(document.errors.length||document.warnings.length)return null;
    const policy=document.toJS({maxAliasCount:0});
    if(!fields(policy,['schemaVersion','clientId','surface','configStore','profile','evidence'])||policy.schemaVersion!==1||policy.clientId!==clientId||policy.surface!==surface||policy.configStore!==configStore
      ||clientId!=='codex'||policy.profile!=='codex-skill-interface-v1'||!Array.isArray(policy.evidence)||!policy.evidence.length||policy.evidence.length>32)return null;
    if(policy.evidence.some(record=>!fields(record,['capabilityId','strategy','version','binarySha256','platform','arch','verifiedAt','source'])
      ||!['skills-global','skills-project'].includes(record.capabilityId)||!['copy','snapshot-link'].includes(record.strategy)||typeof record.version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(record.version)
      ||!HASH.test(record.binarySha256||'')||!['darwin','linux','win32'].includes(record.platform)||!['arm64','x64'].includes(record.arch)||!Number.isFinite(Date.parse(record.verifiedAt))||typeof record.source!=='string'||!record.source||record.source.length>1024))return null;
    return {policy,digest:skillDistributionDigest(policy)};
  }catch{return null;}
}
export function nativeSkillPolicyContext(definitionsDir) {
  const root=path.resolve(definitionsDir,'native-skills');let names;
  try{names=fs.readdirSync(root);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  if(names.length>32)throw domainError('INVALID_NATIVE_SKILL_POLICY','Too many native Skill policies');
  return names.filter(name=>/^[a-z][a-z0-9._-]{0,127}\.yaml$/.test(name)).sort().map(name=>{const file=path.join(root,name);authorizeImagePath(file,root);return [name,skillDistributionDigest(boundedRead(file).bytes.toString('utf8'))];});
}
