import {selectClientSurface} from '../domain/client-definition.js';
import {observeClientBinary} from '../infrastructure/client-binary-observer.js';
import {planClientDeployment,planScopedClientDeployment} from './plan-client-deployment.js';

function verifiedClientPlan(planner,{binaryObserver = observeClientBinary, ...input}) {
  const profile = selectClientSurface(input.definition, input.surface);
  const binaryRequired = profile.runtimeEvidence?.some(record => record.binarySha256)||!!input.nativeSkillPolicy;
  const observed = binaryRequired ? binaryObserver(profile) : null;
  const observedVersion = profile.runtimeEvidence?.find(record => record.binarySha256 && record.binarySha256 === observed?.sha256)?.version;
  let plan = planner({...input, clientVersion: input.clientVersion || observedVersion,nativeBinarySha256:observed?.sha256});
  if (!binaryRequired) return {plan};
  const rejected = plan.operations.filter(item => item.runtimeEvidence?.binarySha256
    && item.runtimeEvidence.binarySha256 !== observed?.sha256);
  plan = {...plan,
    targetProfile: {...plan.targetProfile, versionSource: observedVersion && (!input.clientVersion || String(input.clientVersion).replace(/^v/, '') === observedVersion) ? 'binary-sha256' : 'reported'},
    operations: plan.operations.filter(item => !rejected.includes(item)),
    blocked: [...plan.blocked, ...rejected.map(item => ({...item, reason: 'CLIENT_BINARY_UNVERIFIED'}))]};
  plan.automatic = plan.blocked.length === 0;
  return {plan, ...(plan.operations.some(item => item.runtimeEvidence?.binarySha256||item.skillSelection?.format==='native') ? {runtimeCheck: {profile, observed}} : {})};
}

export const planVerifiedClientDeployment=input=>verifiedClientPlan(planClientDeployment,input);
export const planVerifiedScopedClientDeployment=input=>verifiedClientPlan(planScopedClientDeployment,input);
