import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {loadClientDefinitions} from '../../lib/infrastructure/client-definition-loader.js';
import {selectClientSurface} from '../../lib/domain/client-definition.js';
import {observeClientBinary} from '../../lib/infrastructure/client-binary-observer.js';
import {observeNativeInventory} from '../../lib/infrastructure/native-inventory-observer.js';

// Experimental native format observation, not a support-policy override.
const {values}=parseArgs({options:{binary:{type:'string'}}});if(!values.binary||!path.isAbsolute(values.binary))throw new Error('Supply an absolute --binary');
const definition=loadClientDefinitions({definitionsDir:path.resolve(import.meta.dirname,'../../clients')}).get('codex'),profile=selectClientSurface(definition,'cli'),observed=observeClientBinary(profile,{pathValue:path.dirname(values.binary)});
assert.equal(observed?.binaryPath,fs.realpathSync(values.binary));const evidence=profile.runtimeEvidence.find(record=>record.capabilityId==='skills-global'&&record.binarySha256===observed.sha256&&record.platform===process.platform&&record.arch===process.arch);assert.ok(evidence);
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kit-native-interface-'))),results=[];
try {
  for(const [scope,strategy] of [['global','copy'],['project','copy'],['global','snapshot-link']]) {
  const base=path.join(root,`${scope}-${strategy}`),homeDir=path.join(base,'home'),cwd=path.join(base,'project'),target=path.join(scope==='global'?homeDir:cwd,'.agents/skills/native-interface-check');
  const skill=strategy==='copy'?target:path.join(homeDir,'.agents-kit/fixture-native-snapshot/tree');
  for(const directory of [path.join(homeDir,'.codex'),path.join(cwd,'.git'),path.join(skill,'agents'),path.join(skill,'assets'),path.dirname(target)])fs.mkdirSync(directory,{recursive:true});
  const config=path.join(homeDir,'.codex/config.toml'),before='# Isolated native metadata probe\nmodel="fixture-no-model-call"\n';fs.writeFileSync(config,before,{mode:0o640});
  fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: native-interface-check\ndescription: Native interface fixture\n---\nRead local instructions.\n');
  fs.writeFileSync(path.join(skill,'assets/icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#1256AB"/></svg>\n');
  fs.writeFileSync(path.join(skill,'agents/openai.yaml'),'interface:\n  display_name: Fixture Native Display\n  short_description: Native interface fixture\n  brand_color: "#1256AB"\n  default_prompt: Use $native-interface-check for this fixture.\n  icon_small: ./assets/icon.svg\n  icon_large: ./assets/icon.svg\n',{mode:0o600});
  if(strategy==='snapshot-link')fs.symlinkSync(skill,target);
  const response=await observeNativeInventory({binaryPath:observed.binaryPath,adapter:'codex-skills-list-v1',profile,homeDir,cwd});
  const selected=response.data.flatMap(frame=>frame.skills||[]).filter(item=>item.name==='native-interface-check');assert.equal(selected.length,1);
  assert.equal(selected[0].interface.displayName,'Fixture Native Display');assert.equal(selected[0].interface.shortDescription,'Native interface fixture');assert.equal(selected[0].interface.brandColor,'#1256AB');assert.equal(selected[0].interface.defaultPrompt,'Use $native-interface-check for this fixture.');
  for(const key of ['iconSmall','iconLarge'])assert.equal(fs.realpathSync(path.resolve(skill,selected[0].interface[key])),fs.realpathSync(path.join(skill,'assets/icon.svg')));
  if(strategy==='snapshot-link')fs.unlinkSync(target);else fs.rmSync(target,{recursive:true});
  const restored=await observeNativeInventory({binaryPath:observed.binaryPath,adapter:'codex-skills-list-v1',profile,homeDir,cwd});assert.equal(restored.data.flatMap(frame=>frame.skills||[]).some(item=>item.name==='native-interface-check'),false);
  assert.equal(fs.readFileSync(config,'utf8'),before);assert.equal(fs.statSync(config).mode&0o777,0o640);
  results.push({scope,strategy,capabilityId:`skills-${scope}`,allInterfaceFieldsObserved:true,localIconsObserved:true,removalObserved:true,settingsBytesAndModePreserved:true});
  }
  console.log(JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),phase:'native Skill interface discovery research',binarySha256:observed.sha256,version:evidence.version,isolatedHome:true,nativeCalls:6,modelCalls:0,toolCalls:0,providerDiscoveryRequests:0,results},null,2));
} finally {fs.rmSync(root,{recursive:true,force:true});}
