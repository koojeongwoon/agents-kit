import {probeEvidence, probeExecution, discoveryEvidence} from './probe-evidence.js';
import {verificationStage, summarizeVerification, VERIFICATION_STAGES} from '../../domain/verification-evidence.js';
import {domainError} from '../../domain/errors.js';

// Replays public fact receipts only. Missing historical evidence stays missing.
export function replayVerificationReport(recorded) {
  if (recorded?.schemaVersion !== 1 || !Array.isArray(recorded.clients)) throw domainError('INVALID_VERIFICATION_EVIDENCE', 'Expected a version 1 public verification receipt');
  const requestedStages = recorded.stagesRequested === 'applied' ? ['applied'] : VERIFICATION_STAGES;
  const resources = recorded.resources || [recorded.resource];
  const clients = recorded.clients.map(client => {
    const stages = Object.fromEntries(VERIFICATION_STAGES.filter(stage => client.stages?.[stage]).map(stage => {
      const result = client.stages[stage], present = !['baseline', 'removed'].includes(stage);
      if (recorded.phase === 'CA04-1') {
        const verificationByResource = Object.fromEntries(['instructions', 'skills', 'agents', 'mcp'].map(resource =>
          [resource, discoveryEvidence(result, {resource, present})]));
        const statuses = Object.values(verificationByResource).map(value => value.nativeRecognition.status);
        return [stage, {verificationByResource, verification: verificationStage({nativeRecognition: {
          configurationListed: statuses.includes('failed') ? false : statuses.every(value => value === 'passed') ? true : 'not-observed'
        }})}];
      }
      const verification = recorded.proof === 'native-client-RPC-transport-and-environment'
        ? verificationStage({nativeRecognition: {configurationListed: result.mcpAdvertised === present,
          ...(present ? {toolResultMatched: result.markerMatched === true ? true : 'not-observed'} : {})}, ...probeExecution(result)})
        : probeEvidence(result, {clientId: client.clientId, resources, present});
      return [stage, {verification}];
    }));
    const cleanup = client.cleanup?.assetsAbsent === true || recorded.cleanup?.exactOriginalConfigAndModeRestored === true
      || recorded.cleanup?.originalBytesAndModeRestored === true;
    const rawBlocker = client.blocker || recorded.blocker;
    const blocker = rawBlocker && probeExecution({reason: rawBlocker === 'VERIFICATION_OBSERVER_FAILED' ? 'PROBE_OBSERVATION_FAILED' : rawBlocker}).executionReason;
    return {clientId: client.clientId, scope: client.scope, version: client.version, binarySha256: client.binarySha256,
      ...(blocker ? {blocker} : {}),
      recordedFullLifecycleConfirmed: client.fullLifecycleConfirmed === true, stages,
      verification: summarizeVerification(Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, value.verification])), {requestedStages, cleanup})};
  });
  return {schemaVersion: 1, replayOnly: true, productionEvidencePromoted: false,
    recordedComplete: recorded.complete === true, clients,
    complete: clients.length > 0 && clients.every(client => !client.blocker && client.verification.complete)};
}
