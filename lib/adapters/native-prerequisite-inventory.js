import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {parseNativeSkillInventory} from './native-skill-inventory.js';
import {parseNativeMcpInventory} from './native-mcp-inventory.js';
import {matchesInstallationOrigin} from '../domain/scoped-installation-declaration.js';

const TOOL=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>{throw domainError('NATIVE_PREREQUISITE_RESPONSE_INVALID','Native prerequisite metadata does not match the reviewed protocol');};
const sameOrigin=(a,b)=>['kitId','sourceRoot','clientId','surface','configStore'].every(key=>a[key]===b[key]);
const targetOf=dependency=>dependency.target||dependency;
const related=(receipt,pair,target)=>sameOrigin(pair.receipt,receipt)&&pair.receipt.assetKind===target.assetKind&&pair.receipt.assetId===target.assetId
  &&(!target.originId||matchesInstallationOrigin(pair.receipt,receipt.declaration.origins.find(origin=>origin.id===target.originId)));
const toolList=value=>value==null?null:Array.isArray(value)&&value.length<=4096&&new Set(value).size===value.length&&value.every(name=>typeof name==='string'&&TOOL.test(name))?value:fail();
const within=(child,parent)=>child===parent||child.startsWith(parent+path.sep);
function affectedSkillError(skills,paths) {
  const errors=skills.data[0].errors;if(errors.length>4096)fail();
  return errors.some(error=>{
    const file=error?.path;
    if(typeof file!=='string'||!path.isAbsolute(file)||file.length>4096||/[\u0000-\u001f\u007f]/.test(file))return true;
    return paths.some(skill=>within(skill,path.normalize(file))||within(path.normalize(file),path.dirname(skill)));
  });
}

// Return only native names and discovery state. Tool schemas, descriptions,
// resource contents, server info, errors and connection values never escape.
export function parseNativeProviderDiscovery({serverName,pages}) {
  if(typeof serverName!=='string'||!Array.isArray(pages)||!pages.length||pages.length>16)fail();
  const records=[];
  for(const page of pages) {
    if(!Array.isArray(page?.data)||page.data.length>16||page.data.some(record=>record?.name!==serverName))fail();records.push(...page.data);
  }
  if(records.length!==1)return {serverName,status:'unverified',reason:records.length?'NATIVE_PROVIDER_AMBIGUOUS':'NATIVE_PROVIDER_NOT_LISTED',nativeToolNames:[]};
  const record=records[0];if(!object(record.tools)||Object.keys(record.tools).length>4096||!['unknown','unsupported','notLoggedIn','bearerToken','oAuth'].includes(record.authStatus))fail();
  const names=[];
  for(const [name,tool] of Object.entries(record.tools)) {
    if(!TOOL.test(name)||!object(tool)||tool.name!==name)fail();names.push(name);
  }
  const initialized=object(record.serverCapabilities)&&object(record.serverCapabilities.tools);
  const runtime=record.runtimeStatus==null||record.runtimeStatus==='connected';
  const ready=initialized&&runtime&&record.toolsError==null&&!['unknown','notLoggedIn'].includes(record.authStatus)&&pages.at(-1).nextCursor==null;
  return {serverName,status:ready?'discovered':'unverified',reason:ready?'NATIVE_PROVIDER_TOOLS_DISCOVERED':'NATIVE_PROVIDER_DISCOVERY_UNVERIFIED',nativeToolNames:names.sort(),
    authStatus:record.authStatus,activeThreadState:'unverified',toolUseState:'unverified'};
}

export function prepareCodexNativePrerequisites({pairs,toolRequirements=[],configuration,skills,cwd,configFileName='config.toml'}) {
  if(!Array.isArray(pairs)||pairs.length>256||!Array.isArray(toolRequirements)||toolRequirements.length>1024)fail();
  const config=parseNativeMcpInventory(configuration,configFileName),nativeSkills=pairs.some(({receipt})=>receipt.assetKind==='skills')?parseNativeSkillInventory(skills,cwd):null;
  const requirements=[...toolRequirements];
  for(const {receipt} of pairs)for(const binding of receipt.declaration.toolBindings) {
    const target=binding.provider||{assetId:binding.providerId,assetKind:'mcpServers'},providers=pairs.filter(pair=>related(receipt,pair,target));
    if(providers.length===1)requirements.push({providerId:providers[0].pin.id,toolId:binding.toolId});
  }
  for(const requirement of requirements)if(!object(requirement)||Object.keys(requirement).some(key=>!['providerId','toolId'].includes(key))
    ||typeof requirement.toolId!=='string'||!TOOL.test(requirement.toolId)||!pairs.some(pair=>pair.pin.id===requirement.providerId&&pair.receipt.assetKind==='mcpServers'))fail();
  const servers=[],checks=pairs.map(({pin,receipt})=>{
    const base={prerequisiteId:pin.id,assetId:receipt.assetId,assetKind:receipt.assetKind,status:'unverified',toolUseState:'unverified'};
    const missing=receipt.declaration.dependencies.map(targetOf).filter(dependency=>['skills','mcpServers'].includes(dependency.assetKind)).some(dependency=>!pairs.some(pair=>related(receipt,pair,dependency)));
    if(missing)return {...base,reason:'NATIVE_PREREQUISITE_CLOSURE_INCOMPLETE'};
    if(receipt.assetKind==='skills') {
      const paths=[path.join(receipt.locator.targetBase,'SKILL.md'),...receipt.proofs.filter(proof=>proof.linkSource).map(proof=>path.join(proof.linkSource,'SKILL.md'))];
      const listed=nativeSkills.entries.filter(entry=>paths.includes(entry.path));
      if(affectedSkillError(skills,paths)||listed.length!==1||listed[0].ambiguous)return {...base,reason:'NATIVE_SKILL_DISCOVERY_UNVERIFIED'};
      const skill=listed[0];if(!skill.enabled||skill.nativeScope!=='user')return {...base,reason:skill.enabled?'NATIVE_SKILL_SCOPE_UNVERIFIED':'NATIVE_SKILL_DISABLED'};
      if(nativeSkills.entries.some(entry=>entry.enabled&&entry.name===skill.name&&!paths.includes(entry.path)))return {...base,reason:'NATIVE_SKILL_NAME_SHADOWED'};
      return {...base,status:'observed',reason:'NATIVE_SKILL_LISTED',nativeName:skill.name,nativePath:skill.path};
    }
    if(receipt.assetKind!=='mcpServers')return {...base,reason:'NATIVE_PREREQUISITE_KIND_UNSUPPORTED'};
    const nativeId=receipt.locator.nativeId||receipt.assetId,server=config.records.find(record=>record.name===nativeId),source=receipt.locator.targetBase;
    if(!server?.enabled||server.composition!=='single-source'||server.origins.some(origin=>origin.path!==source))return {...base,nativeId,reason:server?.enabled?'NATIVE_PROVIDER_ORIGIN_UNVERIFIED':'NATIVE_PROVIDER_DISABLED_OR_MISSING'};
    const settings=configuration.config.mcp_servers[nativeId],meaningful=value=>value!=null&&(Array.isArray(value)?value.length>0:object(value)?Object.keys(value).length>0:value!==false);
    const sourceFields=['command','args','url','env','env_vars','cwd','http_headers','env_http_headers','bearer_token_env_var','enabled_tools','disabled_tools'];
    if(sourceFields.some(field=>meaningful(settings[field])&&!server.origins.some(origin=>origin.field===field&&origin.path===source&&origin.verified)))return {...base,nativeId,reason:'NATIVE_PROVIDER_ORIGIN_UNVERIFIED'};
    const required=[...new Set(requirements.filter(requirement=>requirement.providerId===pin.id).map(requirement=>requirement.toolId))];
    if(!required.length)return {...base,nativeId,reason:'NATIVE_TOOL_REQUIREMENTS_UNAVAILABLE'};
    const names=[];
    for(const id of required) {
      const declared=receipt.declaration.providedToolNames?.filter(tool=>tool.id===id)||[];
      if(declared.length!==1||!declared[0].nativeName)return {...base,nativeId,reason:'NATIVE_TOOL_ALIAS_UNVERIFIED'};names.push({toolId:id,nativeName:declared[0].nativeName});
    }
    const enabled=toolList(settings.enabled_tools),disabled=toolList(settings.disabled_tools)||[];
    if(names.some(tool=>enabled&&!enabled.includes(tool.nativeName)||disabled.includes(tool.nativeName)))return {...base,nativeId,reason:'NATIVE_TOOL_POLICY_DENIED'};
    servers.push({prerequisiteId:pin.id,nativeId,tools:names});return {...base,nativeId,status:'ready',reason:'NATIVE_PROVIDER_DISCOVERY_REQUIRED'};
  });
  return {checks,servers,discoveryAllowed:checks.every(check=>['ready','observed'].includes(check.status))};
}
export function finishCodexNativePrerequisites(prepared,frames=[]) {
  if(!Array.isArray(frames)||frames.length>16)fail();
  return prepared.checks.map(check=>{
    if(check.status!=='ready')return check;
    const server=prepared.servers.find(server=>server.prerequisiteId===check.prerequisiteId),matching=frames.filter(frame=>frame.serverName===server.nativeId);
    if(matching.length!==1)return {...check,status:'unverified',reason:'NATIVE_PROVIDER_DISCOVERY_REQUIRED'};
    const result=parseNativeProviderDiscovery(matching[0]),tools=server.tools.map(tool=>({...tool,available:result.status==='discovered'&&result.nativeToolNames.includes(tool.nativeName)}));
    return {...check,status:tools.every(tool=>tool.available)?'observed':'unverified',reason:tools.every(tool=>tool.available)?'NATIVE_REQUIRED_TOOLS_DISCOVERED':'NATIVE_REQUIRED_TOOL_UNAVAILABLE',tools,activeThreadState:'unverified'};
  });
}

// Native config/layer decoding belongs to the Codex adapter.
export function assertCodexPrerequisiteLayers(configuration,context) {
  const fail=()=>{throw domainError('NATIVE_PREREQUISITE_CONTEXT_UNVERIFIED','Native configuration layers are outside the captured context');};
  const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&value.length<=4096&&!/[\\\u0000-\u001f\u007f]/.test(value);
  if(!configuration?.config||!Array.isArray(configuration.layers)||!configuration.layers.length||configuration.layers.length>256)fail();
  const markers=configuration.config.project_root_markers;
  if(markers!=null&&(!Array.isArray(markers)||markers.length!==1||markers[0]!=='.git'))fail();
  for(const layer of configuration.layers) {
    const source=layer?.name;let file;
    if(source?.type==='project'&&absolute(source.dotCodexFolder))file=path.join(source.dotCodexFolder,'config.toml');
    else if(['user','system'].includes(source?.type)&&absolute(source.file)&&source.profile==null)file=source.file;
    else fail();
    if(!context.configPaths.includes(file)||!/^sha256:[a-f0-9]{64}$/.test(layer.version||''))fail();
  }
}
