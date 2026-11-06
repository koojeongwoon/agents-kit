import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {stringify} from 'yaml';
import {createNativePrerequisiteService} from '../../lib/application/native-prerequisite-service.js';
import {GlobalDeploymentStateStore} from '../../lib/infrastructure/global-deployment-state-store.js';
import {latestInstallationReceipts} from '../../lib/application/installation-receipt-service.js';
import {installationDigest} from '../../lib/domain/installation-receipt.js';
import {dependencyPrerequisiteId,installedBindingDigest} from '../../lib/domain/dependency-reverse-index.js';
import {resourcePathFixture} from './resource-path-fixture.js';
import {coordinationFixture} from './dependency-coordination-fixture.js';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const pinOf=receipt=>{const pin={...Object.fromEntries(['kitId','sourceRoot','assetId','assetKind','clientId','surface','configStore','revisionDigest'].map(key=>[key,receipt[key]])),locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)};return {...pin,id:dependencyPrerequisiteId(pin)};};
export function nativePrerequisiteServiceFixture(t,{bound=false,coordination=false,scoped=false,skillStrategy='copy'}={}) {
  const coordinated=coordination?coordinationFixture(t,{edit:true}):null,f=coordinated?.global||resourcePathFixture(t,{scope:'global',skillStrategy,...(scoped?{capabilityScopes:['global','project']}:{})});
  if(bound){f.raw.assets.skills[0].requires={tools:[{id:'repository.search',providerId:'docs',capability:'repository.read'}]};f.raw.assets.mcpServers[0].provides={tools:[{id:'repository.search',nativeName:'search_repository'}]};f.raw.targets={codex:{assetIds:['review']}};f.write();const plan=f.service.plan(f.input);assert.equal(plan.automatic,true);f.service.apply({planId:plan.planId});}
  const receipts=latestInstallationReceipts(f.state()),selected=receipts.filter(receipt=>receipt.assetId==='review'||bound&&receipt.assetId==='docs'),pins=selected.map(pinOf),binaryPath=path.join(f.root,'native-fixture');
  fs.writeFileSync(binaryPath,'Synthetic native binary fixture\n',{mode:0o755});let now=1000;
  const auxiliary={schemaVersion:1,clientId:'codex',surface:'cli',configStore:'codex-local',adapter:'codex-prerequisites-v1',systemFiles:[],
    evidence:[{binarySha256:sha(fs.readFileSync(binaryPath)),version:'0.0.1-test',platform:process.platform,arch:process.arch,verifiedAt:'2026-11-06',source:'test/native-prerequisite-service.test.js (synthetic)'}]};
  const prerequisiteDefinitionsDir=path.join(f.definitionsDir,'native-prerequisites');fs.mkdirSync(prerequisiteDefinitionsDir);const auxiliaryFile=path.join(prerequisiteDefinitionsDir,'codex-cli.yaml');fs.writeFileSync(auxiliaryFile,stringify(auxiliary));
  const project=coordinated?.registration.project||{kitId:'test',projectName:'default',sourceRoot:scoped?path.join(f.kitRoot,'projects/default'):path.join(f.root,'project-kit'),targetRoot:path.join(f.root,'project')};fs.mkdirSync(project.targetRoot,{recursive:true});
  if(scoped) {
    fs.mkdirSync(project.sourceRoot,{recursive:true});
    const reference={schemaVersion:1,kitId:f.raw.kit.id,scope:{type:'global'},kind:'skills',assetId:'review'},raw={schemaVersion:3,kit:{id:project.kitId},management:{schemaVersion:1,resources:{}},defaults:f.raw.defaults,targets:{codex:{assetIds:['reviewer','local-docs']}},assets:{
      agents:[{id:'reviewer',scope:'project',dependsOn:{skills:[reference]},definition:{schemaVersion:1,description:'Review',instructions:'Review with prerequisites.',permissions:'client-default'}}],
      mcpServers:[{id:'local-docs',scope:'project',definition:{schemaVersion:1,transport:'stdio',executableId:'node',args:['local-docs.js']}}]}};
    fs.writeFileSync(path.join(project.sourceRoot,'agent-kit.yaml'),stringify(raw));fs.mkdirSync(path.join(project.targetRoot,'.codex'));fs.writeFileSync(path.join(project.targetRoot,'.codex/config.toml'),'# User configuration\nmodel="keep"\n\n[mcp_servers.foreign]\ncommand="keep"\n',{mode:0o640});
    fs.mkdirSync(path.join(project.targetRoot,'.agents/skills'),{recursive:true});fs.symlinkSync('/external/ego-skills',path.join(project.targetRoot,'.agents/skills/ego-browser'));
  }
  const calls=[],response={configuration:{config:{mcp_servers:{}},origins:{},layers:[{name:{type:'user',file:f.mcp},version:'sha256:'+'a'.repeat(64)}]},
    skills:{data:[{cwd:project.targetRoot,skills:[{name:'review',path:path.join(selected.find(r=>r.assetKind==='skills').locator.targetBase,'SKILL.md'),scope:'user',enabled:true}],errors:[{path:'/external/ego-skills/SKILL.md',message:'SECRET_EXTERNAL_ERROR'}]}]},mcpServers:[]};
  if(bound){response.configuration.config.mcp_servers.docs={enabled:true,command:'SECRET_COMMAND'};response.configuration.origins['mcp_servers.docs.command']={name:{type:'user',file:f.mcp},version:'sha256:'+'a'.repeat(64)};response.mcpServers=[{serverName:'docs',pages:[{data:[{name:'docs',authStatus:'unsupported',runtimeStatus:null,serverCapabilities:{tools:{}},toolsError:null,tools:{search_repository:{name:'search_repository',description:'SECRET_DESCRIPTION',inputSchema:{secret:'SECRET_SCHEMA'}}}}],nextCursor:null}]}];}
  const nativeInventoryObserver=async input=>{calls.push({includeSkills:input.includeSkills,serverNames:input.serverNames});if(input.serverNames.length&&input.authorizeDiscovery(response)!==true)throw Object.assign(new Error('SECRET_FAILURE'),{code:'NATIVE_PREREQUISITE_DISCOVERY_DENIED'});return structuredClone({...response,mcpServers:input.serverNames.length?response.mcpServers:[]});};
  const service=createNativePrerequisiteService({homeDir:f.homeDir,definitionsDir:f.definitionsDir,nativeInventoryObserver,binaryObserver:()=>({binaryPath,sha256:sha(fs.readFileSync(binaryPath))}),clock:()=>now,observationTtlMs:10000});
  const request={globalStore:new GlobalDeploymentStateStore({homeDir:f.homeDir}),project,prerequisites:pins},verify=observation=>service.verifier({observationId:observation.observationId})({project,prerequisites:pins});
  return {f,coordinated,selected,pins,project,request,service,verify,calls,response,binaryPath,auxiliary,auxiliaryFile,options:{homeDir:f.homeDir,definitionsDir:f.definitionsDir,nativeInventoryObserver,binaryObserver:()=>({binaryPath,sha256:sha(fs.readFileSync(binaryPath))}),clock:()=>now},advance:()=>{now+=10001;}};
}
