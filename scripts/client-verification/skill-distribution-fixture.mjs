import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {parse,stringify} from 'yaml';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';
import {createAgentKitManifest} from '../../lib/domain/manifest.js';
import {selectClientSurface} from '../../lib/domain/client-definition.js';
import {skillCompatibilityDeclarationDigest} from '../../lib/domain/skill-distribution.js';
import {loadClientDefinitions} from '../../lib/infrastructure/client-definition-loader.js';
import {observeClientBinary} from '../../lib/infrastructure/client-binary-observer.js';
import {observeNativeInventory} from '../../lib/infrastructure/native-inventory-observer.js';
import {inspectSkillDistributionSources} from '../../lib/infrastructure/skill-distribution-source.js';

// Opt-in actual native metadata probe. All client/state/config/cache writes are
// confined to a new temporary HOME. No model, thread or provider is requested.
const {values}=parseArgs({options:{binary:{type:'string'},managed:{type:'boolean',default:false},native:{type:'boolean',default:false}}});
if(!values.binary||!path.isAbsolute(values.binary))throw new Error('Supply an explicit absolute --binary');
const repository=path.resolve(import.meta.dirname,'../..'),definitionsDir=path.join(repository,'clients'),definition=loadClientDefinitions({definitionsDir}).get('codex'),profile=selectClientSurface(definition,'cli');
const observed=observeClientBinary(profile,{pathValue:path.dirname(values.binary)});
assert.equal(observed?.binaryPath,fs.realpathSync(values.binary));
const evidence=profile.runtimeEvidence.find(record=>record.capabilityId==='skills-global'&&record.binarySha256===observed.sha256&&record.platform===process.platform&&record.arch===process.arch);
assert.ok(evidence,'The selected binary must match reviewed Skill runtime evidence');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-c07-native-'))),results=[];let nativeReads=0;
try {
  const cases=values.native?[['global','copy'],['project','copy'],['global','snapshot-link']]:[['global','copy'],['global','snapshot-link']];
  for(const [scope,strategy] of cases) {
    const base=path.join(root,`${scope}-${strategy}`),homeDir=path.join(base,'home'),cwd=path.join(base,'project'),kitRoot=path.join(base,'kit'),scopeRoot=path.join(kitRoot,scope==='global'?'global':'projects/default'),source=path.join(scopeRoot,'bundle');
    for(const directory of [path.join(homeDir,'.codex'),path.join(homeDir,'.agents/skills'),path.join(cwd,'.git'),path.join(source,'selected'),path.join(source,'other'),path.join(base,'external/ego')])fs.mkdirSync(directory,{recursive:true});
    const description=`Selected ${strategy} bundle`,skill=(description,body)=>`---\nname: variant-check\ndescription: ${description}\n---\n${body}\n`;
    fs.writeFileSync(path.join(source,'selected/SKILL.md'),skill(description,'Selected variant instructions.'));
    fs.writeFileSync(path.join(source,'other/SKILL.md'),skill('Unselected bundle','Unselected variant instructions.'));
    if(values.native){
      fs.mkdirSync(path.join(source,'selected/agents'));fs.mkdirSync(path.join(source,'selected/assets'));
      fs.writeFileSync(path.join(source,'selected/assets/icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#1256AB"/></svg>\n');
      fs.writeFileSync(path.join(source,'selected/agents/openai.yaml'),'interface:\n  display_name: Variant Native Display\n  short_description: Selected native interface\n  brand_color: "#1256AB"\n  default_prompt: Use $variant-check for this fixture.\n  icon_small: ./assets/icon.svg\n  icon_large: ./assets/icon.svg\n',{mode:0o600});
    }
    const config=path.join(homeDir,'.codex/config.toml'),initial='# Existing isolated settings\nmodel = "fixture-no-model-call"\n';fs.writeFileSync(config,initial,{mode:0o640});
    const ego=path.join(homeDir,'.agents/skills/ego-browser'),external=path.join(base,'external/ego');fs.writeFileSync(path.join(external,'SKILL.md'),'---\nname: ego-browser\ndescription: Externally managed fixture\n---\nExternal owner.\n');fs.symlinkSync(external,ego);const link=fs.lstatSync(ego);
    const raw={schemaVersion:3,kit:{id:'distribution-native-fixture'},management:{schemaVersion:1,resources:{}},targets:{codex:{assetIds:['variant-check']}},assets:{skills:[{id:'variant-check',scope,source:'bundle',definition:{schemaVersion:3,format:'agent-skills',deployment:{schemaVersion:1,strategy},distribution:{schemaVersion:1,exposure:'shared',selection:[{clientId:'codex',surface:'cli',variantId:'selected'}],variants:[{id:'selected',source:'selected',format:values.native?'native':'common',...(values.native?{native:{schemaVersion:1,clientId:'codex',profile:'codex-skill-interface-v1'}}:{}),compatibility:[]},{id:'other',source:'other',format:'common',compatibility:[]}]}}}]}};
    const normalized=createAgentKitManifest(raw).assets.skills[0],tree=inspectSkillDistributionSources(normalized,source).get('selected').descriptor;
    raw.assets.skills[0].definition.distribution.variants[0].compatibility=[{clientId:'codex',surface:'cli',versions:[evidence.version],status:'compatible',review:{schemaVersion:1,basis:'author-review',treeDigest:tree.treeDigest,declarationDigest:skillCompatibilityDeclarationDigest(normalized)}}];
    fs.writeFileSync(path.join(scopeRoot,'agent-kit.yaml'),stringify(raw));
    if(scope==='project'){fs.mkdirSync(path.join(kitRoot,'global'));fs.writeFileSync(path.join(kitRoot,'global/agent-kit.yaml'),stringify({schemaVersion:3,kit:{id:'fixture-empty-global'},management:{schemaVersion:1,resources:{}},assets:{}}));}
    const service=createManifestDeploymentService({homeDir,definitionsDir,kitRoot}),input={scopeRoot,targetRoot:scope==='global'?homeDir:cwd,scope,clientId:'codex',surface:'cli',clientVersion:evidence.version};
    if(values.managed) {
      const managedInput={...input,assetId:'variant-check',variantId:'selected'};
      service.applyVariantRegistration({planId:service.planVariantRegistration(managedInput).planId});
      service.applySourceEdit({planId:service.planSourceEdit({...managedInput,revision:service.source(managedInput).revision,changes:[{path:'notes.md',text:'Retained Kit edit.\n'}]}).planId});
      fs.writeFileSync(path.join(source,'selected/remote.md'),'Reimported upstream addition.\n');service.applyRefresh({planId:service.planRefresh(managedInput).planId});
      const manifestPath=path.join(scopeRoot,'agent-kit.yaml'),doc=parse(fs.readFileSync(manifestPath,'utf8')),asset=createAgentKitManifest(doc).assets.skills[0];
      const selected=inspectSkillDistributionSources(asset,source,{scopeRoot,variantIds:['selected']}).get('selected');
      doc.assets.skills[0].definition.distribution.variants[0].compatibility[0].review.treeDigest=selected.descriptor.treeDigest;fs.writeFileSync(manifestPath,stringify(doc));
    }
    const plan=service.plan(input);assert.equal(plan.automatic,true,JSON.stringify(plan.blocked));assert.equal(plan.skillDistributions[0].selection.variantId,'selected');
    const result=await service.apply({planId:plan.planId}),installed=path.join(input.targetRoot,'.agents/skills/variant-check');assert.equal(fs.existsSync(path.join(installed,'other')),false);
    if(values.managed){assert.equal(fs.readFileSync(path.join(installed,'notes.md'),'utf8'),'Retained Kit edit.\n');assert.equal(fs.readFileSync(path.join(installed,'remote.md'),'utf8'),'Reimported upstream addition.\n');}
    const observe=async()=>{nativeReads++;const response=await observeNativeInventory({binaryPath:observed.binaryPath,adapter:'codex-skills-list-v1',profile,homeDir,cwd});return response.data.flatMap(item=>item.skills||[]);};
    const listed=(await observe()).filter(item=>item.name==='variant-check');assert.equal(listed.length,1);assert.equal(listed[0].description,description);
    if(values.native){
      assert.equal(listed[0].interface.displayName,'Variant Native Display');assert.equal(listed[0].interface.shortDescription,'Selected native interface');assert.equal(listed[0].interface.brandColor,'#1256AB');assert.equal(listed[0].interface.defaultPrompt,'Use $variant-check for this fixture.');
      for(const key of ['iconSmall','iconLarge'])assert.equal(fs.realpathSync(path.resolve(installed,listed[0].interface[key])),fs.realpathSync(path.join(installed,'assets/icon.svg')));
      assert.deepEqual(fs.readFileSync(path.join(installed,'agents/openai.yaml')),fs.readFileSync(path.join(source,'selected/agents/openai.yaml')));
      if(strategy==='copy')assert.equal(fs.statSync(path.join(installed,'agents/openai.yaml')).mode&0o777,0o600);
    }
    const logicalPath=path.join(installed,'SKILL.md'),physicalPath=fs.realpathSync(logicalPath);assert.ok([logicalPath,physicalPath].includes(listed[0].path),'Native path must identify the installed file or its owned snapshot');
    const transaction=service.history(input).find(transaction=>transaction.id===result.transactionId);assert.equal(transaction.skillSelections[0].selection.variantId,'selected');
    if(values.native)assert.equal(transaction.skillSelections[0].selection.schemaVersion,3);else if(values.managed)assert.equal(transaction.skillSelections[0].selection.schemaVersion,2);
    const rollback=service.planRollback({...input,transactionId:result.transactionId});assert.equal(rollback.automatic,true,JSON.stringify(rollback.blocked));await service.rollback({planId:rollback.planId});assert.equal((await observe()).some(item=>item.name==='variant-check'),false);
    assert.equal(fs.readFileSync(config,'utf8'),initial);assert.equal(fs.statSync(config).mode&0o777,0o640);assert.equal(fs.lstatSync(ego).ino,link.ino);assert.equal(fs.lstatSync(ego).mtimeMs,link.mtimeMs);assert.equal(fs.readlinkSync(ego),external);
    results.push({strategy,scope,manifestVersion:3,selectedVariant:'selected',format:values.native?'native':'common',...(values.native?{nativeProfile:'codex-skill-interface-v1',allInterfaceFieldsObserved:true,localIconsObserved:true,originalMetadataBytesPreserved:true}:{}),managedVariantSource:values.managed,sourceEditAndRefreshMerged:values.managed,selectionVersion:transaction.skillSelections[0].selection.schemaVersion,nativeSelectedMetadataObserved:true,nativePathForm:listed[0].path===logicalPath?'logical':'canonical-owned-snapshot',unselectedVariantInstalled:false,selectionReceiptRecorded:true,rollbackNativeAbsent:true,settingsBytesAndModePreserved:true,externalLinkIdentityPreserved:true,fulfilled:false});
  }
  console.log(JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),phase:values.native?'C07 selected Codex-native Skill application-service roundtrip':'C07 selected common Skill native discovery roundtrip',binarySha256:observed.sha256,version:evidence.version,isolatedHome:true,actualUserConfigWrites:0,actualUserStateWrites:0,nativeObservationCalls:nativeReads,providerDiscoveryRequests:0,modelCalls:0,toolCalls:0,modelUseState:'unverified',results},null,2));
} finally {
  const allowRemoval=file=>{const stat=fs.lstatSync(file);if(stat.isDirectory()){fs.chmodSync(file,0o700);for(const name of fs.readdirSync(file))allowRemoval(path.join(file,name));}};
  allowRemoval(root);fs.rmSync(root,{recursive:true,force:true});
}
