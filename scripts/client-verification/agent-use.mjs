import {createAgentObservation} from '../../lib/adapters/verification/agent-observation.js';
export {createAgentObservation} from '../../lib/adapters/verification/agent-observation.js';

export function agentUseConfirmed(result, present, clientId) {
  return result.success && result.finalMatches && !result.unexpectedTools && (present
    ? result.childMarkerReturned && (clientId === 'codex' ? result.completedChildMarker : result.spawned && result.roleObserved)
    : result.reportedAbsent && !result.spawned && !result.childMarkerReturned);
}

// Keep response-level evidence separate from directly observed child completion.
export function agentEvidence(result, present, clientId) {
  const markerConfirmed = result.success && result.finalMatches && !result.unexpectedTools;
  const invocationConfirmed = markerConfirmed && (present ? result.roleObserved && result.spawned : result.reportedAbsent && !result.spawned);
  const confirmed = agentUseConfirmed(result, present, clientId);
  return {markerConfirmed, invocationConfirmed, confirmed, verificationReason: confirmed ? 'CONFIRMED' : !result.success ? result.reason : result.unexpectedTools ? 'UNEXPECTED_TOOL' : !result.finalMatches ? 'MARKER_MISMATCH' : !result.childMarkerReturned ? 'CHILD_RESULT_NOT_EXPOSED' : 'INVOCATION_NOT_CONFIRMED'};
}
