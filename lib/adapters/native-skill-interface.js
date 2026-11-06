import {parseDocument} from 'yaml';
import {domainError} from '../domain/errors.js';
import {safeResourceRelativePath} from '../domain/resource-management.js';
const fail=code=>{throw domainError(code,'Native Skill contains fields outside the verified client format');};
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
function yaml(bytes) {
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('NATIVE_SKILL_METADATA_INVALID');}
  const doc=parseDocument(text,{uniqueKeys:true});if(doc.errors.length||doc.warnings.length)fail('NATIVE_SKILL_METADATA_INVALID');
  try{return doc.toJS({maxAliasCount:0});}catch{fail('NATIVE_SKILL_METADATA_INVALID');}
}
export function validateNativeSkillInterface({asset,selection,files}) {
  if(selection.native?.clientId!=='codex'||selection.native.profile!=='codex-skill-interface-v1')fail('NATIVE_SKILL_FORMAT_UNVERIFIED');
  const byPath=new Map(files.map(file=>[file.path,file])),primary=byPath.get('SKILL.md'),metadata=byPath.get('agents/openai.yaml');
  if(!primary||!metadata||metadata.content.length>32768)fail('NATIVE_SKILL_METADATA_REQUIRED');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(primary.content).replaceAll('\r\n','\n');}catch{fail('NATIVE_SKILL_METADATA_INVALID');}
  const match=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if(!match||!match[2].trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)||/<!--\s*agents-kit:/i.test(text))fail('NATIVE_SKILL_FRONTMATTER_UNSUPPORTED');
  const front=yaml(Buffer.from(match[1]));if(!fields(front,['name','description'])||front.name!==asset.id||typeof front.description!=='string'||!front.description.trim())fail('NATIVE_SKILL_FRONTMATTER_UNSUPPORTED');
  const value=yaml(metadata.content);if(value?.policy!==undefined)fail('NATIVE_SKILL_POLICY_UNVERIFIED');if(value?.dependencies!==undefined)fail('NATIVE_SKILL_TOOL_REQUIREMENTS_UNVERIFIED');
  if(!fields(value,['interface'])||!fields(value.interface,['display_name','short_description','brand_color','default_prompt','icon_small','icon_large'])||!Object.keys(value.interface).length)fail('NATIVE_SKILL_EXTENSION_UNSUPPORTED');
  const limits={display_name:128,short_description:1024,default_prompt:8192};
  for(const [key,max] of Object.entries(limits))if(value.interface[key]!==undefined&&(typeof value.interface[key]!=='string'||!value.interface[key].trim()||value.interface[key].length>max))fail('NATIVE_SKILL_METADATA_INVALID');
  if(value.interface.brand_color!==undefined&&(typeof value.interface.brand_color!=='string'||!/^#[0-9a-f]{6}$/i.test(value.interface.brand_color)))fail('NATIVE_SKILL_METADATA_INVALID');
  for(const key of ['icon_small','icon_large'])if(value.interface[key]!==undefined){const raw=value.interface[key],name=typeof raw==='string'&&raw.startsWith('./')?raw.slice(2):raw;if(!safeResourceRelativePath(name)||!byPath.has(name))fail('NATIVE_SKILL_ICON_OUTSIDE_BUNDLE');}
  if(files.some(file=>file.path.startsWith('agents/')&&file.path!=='agents/openai.yaml'))fail('NATIVE_SKILL_EXTENSION_UNSUPPORTED');
}
