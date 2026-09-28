import {selectClientSurface} from '../domain/client-definition.js';
import {observeClientBinary} from '../infrastructure/client-binary-observer.js';
import {planClientDeployment} from './plan-client-deployment.js';

export function planVerifiedClientDeployment({binaryObserver = observeClientBinary, ...input}) {
  const profile = selectClientSurface(input.definition, input.surface);
  const binaryRequired = profile.runtimeEvidence?.some(record => record.binarySha256);
  const observed = binaryRequired ? binaryObserver(profile) : null;
  const observedVersion = profile.runtimeEvidence?.find(record => record.binarySha256 && record.binarySha256 === observed?.sha256)?.version;
  let plan = planClientDeployment({...input, clientVersion: input.clientVersion || observedVersion});
  if (!binaryRequired) return {plan};
  const rejected = plan.operations.filter(item => item.runtimeEvidence?.binarySha256
    && item.runtimeEvidence.binarySha256 !== observed?.sha256);
  plan = {...plan,
    targetProfile: {...plan.targetProfile, versionSource: observedVersion && (!input.clientVersion || String(input.clientVersion).replace(/^v/, '') === observedVersion) ? 'binary-sha256' : 'reported'},
    operations: plan.operations.filter(item => !rejected.includes(item)),
    blocked: [...plan.blocked, ...rejected.map(item => ({...item, reason: 'CLIENT_BINARY_UNVERIFIED'}))]};
  plan.automatic = plan.blocked.length === 0;
  return {plan, ...(plan.operations.some(item => item.runtimeEvidence?.binarySha256) ? {runtimeCheck: {profile, observed}} : {})};
}
