import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCommonSourceDefinition,commonSourceStrategy} from '../lib/domain/common-source-definition.js';
import {selectSkillDistribution,skillCompatibilityDeclarationDigest} from '../lib/domain/skill-distribution.js';

const asset=()=>({id:'review',kind:'skills',scope:{type:'global',key:'global'},source:'review',definition:{schemaVersion:3,format:'agent-skills',deployment:{schemaVersion:1,strategy:'copy'},
  distribution:{schemaVersion:1,exposure:'shared',selection:[{clientId:'codex',surface:'cli',variantId:'common'}],variants:[{id:'common',source:'',format:'common',compatibility:[{clientId:'codex',surface:'cli',versions:['0.0.1-test'],status:'compatible',review:{schemaVersion:1,basis:'author-review',treeDigest:'a'.repeat(64),declarationDigest:'b'.repeat(64)}}]}]}}});

test('versioned Skill source accepts explicit client/surface selection and separately reviewed compatibility',()=>{
  assert.doesNotThrow(()=>validateCommonSourceDefinition(asset()));assert.equal(commonSourceStrategy(asset(),{clientId:'codex',surface:'cli'}),'copy');
});

test('Skill distribution rejects ambiguous, escaping and overlapping variant sources',()=>{
  for(const mutate of [value=>value.definition.distribution.selection.push({...value.definition.distribution.selection[0]}),value=>value.definition.distribution.variants[0].source='../outside',value=>value.definition.distribution.variants.push({id:'native',source:'codex',format:'native',compatibility:[]})]) {
    const value=asset();mutate(value);assert.throws(()=>validateCommonSourceDefinition(value),{code:'INVALID_COMMON_SOURCE_DEFINITION'});
  }
});

test('existing common Skill definitions retain their original strategy without acquiring a compatibility claim',()=>{
  for(const version of [1,2]){const value=asset();value.definition={schemaVersion:version,format:'agent-skills',...(version===2?{deployment:{schemaVersion:1,strategy:'snapshot-link'}}:{})};assert.doesNotThrow(()=>validateCommonSourceDefinition(value));assert.equal(commonSourceStrategy(value),version===1?'copy':'snapshot-link');}
});

test('target selection does not imply compatible instructions and review cannot survive a changed logical Tool declaration',()=>{
  const value=asset(),rule=value.definition.distribution.variants[0].compatibility[0];rule.review.declarationDigest=skillCompatibilityDeclarationDigest(value);
  const input={clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'},selected=selectSkillDistribution(value,input);assert.equal(selected.status,'selected');assert.equal(selected.nativeUseState,'unverified');assert.equal(selected.fulfilled,false);
  assert.equal(selectSkillDistribution(value,{...input,clientId:'claude-code'}).reason,'SKILL_TARGET_NOT_SELECTED');assert.equal(selectSkillDistribution(value,{...input,clientVersion:'0.0.2'}).reason,'SKILL_COMPATIBILITY_UNVERIFIED');
  value.requires={tools:['repository.search']};assert.equal(selectSkillDistribution(value,input).reason,'SKILL_COMPATIBILITY_DECLARATION_CHANGED');
});

test('native variants and incompatible client rules remain fail-closed rather than losing their original metadata',()=>{
  const value=asset(),variant=value.definition.distribution.variants[0],input={clientId:'codex',surface:'cli',clientVersion:'0.0.1-test'};variant.compatibility[0].review.declarationDigest=skillCompatibilityDeclarationDigest(value);variant.format='native';
  assert.equal(selectSkillDistribution(value,input).reason,'SKILL_NATIVE_VARIANT_UNVERIFIED');variant.format='common';variant.compatibility[0]={clientId:'codex',surface:'cli',versions:['0.0.1-test'],status:'incompatible'};assert.equal(selectSkillDistribution(value,input).reason,'SKILL_CLIENT_INCOMPATIBLE');
});

test('variant paths reject filesystem aliases and reserved source-management directories',()=>{
  for(const sources of [['Common','common'],['Café','Cafe\u0301'],['Common/one','common/two'],['.kit-sources/private']]) {
    const value=asset();value.definition.distribution.variants=sources.map((source,index)=>({id:index?'other':'common',source,format:'common',compatibility:[]}));
    assert.throws(()=>validateCommonSourceDefinition(value),{code:'INVALID_COMMON_SOURCE_DEFINITION'});
  }
});

test('compatibility rules require string identifiers and exact normalized versions',()=>{
  for(const mutate of [value=>value.definition.distribution.variants[0].id=123,value=>value.definition.distribution.variants[0].compatibility[0].versions=['01.2.3'],value=>value.definition.distribution.variants[0].compatibility[0].versions=['1.2.3-test..1'],value=>value.definition.distribution.variants[0].compatibility[0].versions=['1.2.3-01']]) {
    const value=asset();mutate(value);assert.throws(()=>validateCommonSourceDefinition(value),{code:'INVALID_COMMON_SOURCE_DEFINITION'});
  }
});
