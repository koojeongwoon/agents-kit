import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentKitManifest} from '../lib/domain/manifest.js';
import {selectManifestDeployment} from '../lib/domain/manifest-targets.js';
import {selectScopedManifestDeployment} from '../lib/domain/scoped-deployment-selection.js';

function raw(schemaVersion=1) {
  return {schemaVersion,kit:{id:'distribution'},...(schemaVersion>=2?{management:{schemaVersion:1,resources:{}}}:{}),assets:{
    instructions:[{id:'rules',scope:'global',source:'rules.md',definition:{schemaVersion:1,format:'markdown'}}],
    skills:[{id:'review',scope:'global',source:'review',definition:{schemaVersion:3,format:'agent-skills',deployment:{schemaVersion:1,strategy:'copy'},
      distribution:{schemaVersion:1,exposure:'shared',selection:[{clientId:'codex',surface:'cli',variantId:'common'}],variants:[{id:'common',source:'',format:'common',compatibility:[]}]}}}]}};
}
function select(value,input) {
  const manifest=createAgentKitManifest(value);
  return value.schemaVersion===3?selectScopedManifestDeployment({contexts:[{id:'global',catalogId:'fixture',status:'ready',scope:'global',manifest}],sourceContextId:'global',...input}):selectManifestDeployment(manifest,{scope:'global',...input});
}

test('implicit roots honor Skill client and surface selection in every Manifest reader',()=>{
  for(const version of [1,2,3]) {
    assert.deepEqual(select(raw(version),{clientId:'codex',surface:'cli'}).rootAssetIds,['rules','review']);
    for(const input of [{clientId:'claude-code',surface:'cli'},{clientId:'codex',surface:'desktop'}])assert.deepEqual(select(raw(version),input).rootAssetIds,['rules']);
  }
});

test('explicit target selections and required dependencies remain visible for compatibility diagnostics',()=>{
  for(const version of [1,2,3]) {
    const value=raw(version);value.targets={'claude-code':{assetIds:['review']}};
    assert.deepEqual(select(value,{clientId:'claude-code',surface:'cli'}).selectedAssetIds,['review']);
    delete value.targets;value.assets.instructions[0].dependsOn={skills:['review']};
    assert.ok(select(value,{clientId:'claude-code',surface:'cli'}).selectedAssetIds.includes('review'));
  }
});

test('an explicit scoped asset selection remains available even if its distribution target is unselected',()=>{
  assert.deepEqual(select(raw(3),{clientId:'claude-code',surface:'cli',selectedAssetIds:['review']}).selectedAssetIds,['review']);
});

test('old common definitions preserve implicit target behavior without inferred compatibility',()=>{
  for(const version of [1,2,3])for(const definitionVersion of [1,2]) {
    const value=raw(version);value.assets.skills[0].definition={schemaVersion:definitionVersion,format:'agent-skills',...(definitionVersion===2?{deployment:{schemaVersion:1,strategy:'copy'}}:{})};
    assert.ok(select(value,{clientId:'claude-code',surface:'cli'}).rootAssetIds.includes('review'));
  }
});
