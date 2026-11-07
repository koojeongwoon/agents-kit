import path from 'node:path';
import {resolveForAuthorization} from '../../lib/security-boundary.js';
import {domainError} from '../../lib/domain/errors.js';
import {isSharedSkillPath} from '../shared/observed-skill-policy.js';

// GUI policy decorates the same application services used by the CLI. No writes,
// ownership changes, new execution paths, or filtering of a reviewed transaction.
export function createObservedSkillsBoundary(service,{resolvePath=resolveForAuthorization}={}) {
  const reviews=new Map();
  const locations=plan=>[plan.target,...(plan.operations||[]).flatMap(op=>[op.target,...(op.previousTargets||[])]),...(plan.pathMigrations||[]).flatMap(item=>[item.previousTarget,item.target])].filter(value=>typeof value==='string'&&value);
  const forbidden=plan=>locations(plan).filter(value=>isSharedSkillPath(value)||isSharedSkillPath(resolvePath(path.resolve(value))));
  const assertAllowed=plan=>{
    if(forbidden(plan).length)throw domainError('SHARED_SKILLS_OBSERVATION_ONLY','.agents/skills는 관측 전용입니다. 기존 파일·링크·원장을 보존하며 이 계획은 적용하지 않습니다.');
  };
  const remember=plan=>{
    if(!plan?.planId)return plan;
    for(const [id,entry] of reviews)if(entry.expiresAt<Date.now())reviews.delete(id);
    reviews.set(plan.planId,{plan,expiresAt:Date.parse(plan.expiresAt)||Date.now()+300000});
    const blocked=forbidden(plan).map(target=>({target,operation:'BLOCK',reason:'SHARED_SKILLS_OBSERVATION_ONLY'}));
    return blocked.length?{...plan,automatic:false,blocked:[...(plan.blocked||[]),...blocked]}:plan;
  };
  const guarded={...service};
  for(const name of ['plan','planRemoval','planMigration','planRollback','planRecovery','planInstallation','planImport','planDetach','planSourceRecovery','planSourceEdit','planRefresh','planSourceRollback','planVariantRegistration','observeDeploymentPrerequisites']) {
    if(typeof service[name]!=='function')continue;
    guarded[name]=input=>{const result=service[name](input);return result?.then?result.then(remember):remember(result);};
  }
  for(const name of ['apply','rollback','recover','savePlan','applyInstallation','applyImport','applyDetach','recoverSources','applySourceEdit','applyRefresh','applySourceRollback','applyVariantRegistration']) {
    if(typeof service[name]!=='function')continue;
    guarded[name]=input=>{
      const entry=reviews.get(input?.planId);
      if(!entry)throw domainError('DEPLOYMENT_PLAN_NOT_FOUND','A current reviewed plan is required');
      assertAllowed(entry.plan);
      return service[name](input);
    };
  }
  if(typeof service.resumeSavedPlan==='function')guarded.resumeSavedPlan=input=>{
    const plan=service.savedPlans().find(item=>item.planId===input?.planId);
    if(!plan)throw domainError('DEPLOYMENT_PLAN_NOT_FOUND','A current saved plan is required');
    assertAllowed(plan);
    return service.resumeSavedPlan(input);
  };
  return Object.freeze(guarded);
}
