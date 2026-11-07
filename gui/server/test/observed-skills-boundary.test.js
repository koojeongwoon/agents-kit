import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createObservedSkillsBoundary} from '../observed-skills-boundary.js';

test('GUI plans cannot mutate shared skills through apply, save, rollback, installation or saved replay',()=>{
  let writes=0;
  const plan={planId:'p',automatic:true,operations:[{target:'/home/.agents/skills/review',operation:'COPY'}],blocked:[]};
  const service={plan:()=>plan,apply:()=>writes++,savePlan:()=>writes++,planRollback:()=>plan,rollback:()=>writes++,
    planInstallation:()=>({...plan,target:'/home/.agents/skills/review'}),applyInstallation:()=>writes++,savedPlans:()=>[plan],resumeSavedPlan:()=>writes++};
  const guarded=createObservedSkillsBoundary(service,{resolvePath:value=>value});
  assert.equal(guarded.plan({}).automatic,false);
  for(const method of ['apply','savePlan','rollback','applyInstallation']){
    if(method==='rollback')guarded.planRollback({});if(method==='applyInstallation')guarded.planInstallation({});
    assert.throws(()=>guarded[method]({planId:'p'}),{code:'SHARED_SKILLS_OBSERVATION_ONLY'});
  }
  assert.throws(()=>guarded.resumeSavedPlan({planId:'p'}),{code:'SHARED_SKILLS_OBSERVATION_ONLY'});
  assert.equal(writes,0);
});

test('rechecks canonical paths at apply time and preserves the shared link, target and ledger',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kit-observation-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const shared=path.join(root,'.agents/skills/review'),privateDir=path.join(root,'.codex/skills'),ledger=path.join(root,'ledger.json');
  fs.mkdirSync(shared,{recursive:true});fs.mkdirSync(privateDir,{recursive:true});fs.writeFileSync(path.join(shared,'SKILL.md'),'original');fs.writeFileSync(ledger,'original-ledger');
  const target=path.join(privateDir,'review');
  const service={plan:()=>({planId:'p',automatic:true,operations:[{target,operation:'COPY'}],blocked:[]}),apply:()=>{fs.writeFileSync(path.join(target,'SKILL.md'),'changed');fs.writeFileSync(ledger,'changed');}};
  const guarded=createObservedSkillsBoundary(service);
  assert.equal(guarded.plan({}).automatic,true);fs.symlinkSync(shared,target,'dir');
  assert.throws(()=>guarded.apply({planId:'p'}),{code:'SHARED_SKILLS_OBSERVATION_ONLY'});
  assert.equal(fs.readlinkSync(target),shared);assert.equal(fs.readFileSync(path.join(shared,'SKILL.md'),'utf8'),'original');assert.equal(fs.readFileSync(ledger,'utf8'),'original-ledger');
});

test('private client plans retain the original service behavior and previous shared targets are protected',()=>{
  let calls=0;const service={plan:()=>({planId:'private',automatic:true,operations:[{target:'/home/.claude/skills/review',operation:'COPY'}],blocked:[]}),apply:()=>++calls};
  const guarded=createObservedSkillsBoundary(service,{resolvePath:value=>value});assert.equal(guarded.plan({}).automatic,true);assert.equal(guarded.apply({planId:'private'}),1);
  const previous=createObservedSkillsBoundary({plan:()=>({planId:'migrate',automatic:true,operations:[{target:'/home/.claude/skills/review',previousTargets:['/home/.agents/skills/review']}],blocked:[]}),apply:()=>++calls},{resolvePath:value=>value});
  assert.equal(previous.plan({}).automatic,false);assert.throws(()=>previous.apply({planId:'migrate'}),{code:'SHARED_SKILLS_OBSERVATION_ONLY'});assert.equal(calls,1);
});
