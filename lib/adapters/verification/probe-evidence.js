import {verificationStage} from '../../domain/verification-evidence.js';
import {domainError} from '../../domain/errors.js';

const RUN_REASONS = new Set(['OK', 'PROBE_TIMEOUT', 'PROBE_OUTPUT_LIMIT', 'PROBE_OBSERVATION_FAILED',
  'CLIENT_BINARY_CHANGED', 'CLI_REJECTED', 'MCP_PERMISSION_REQUIRED', 'EXECUTABLE_UNAVAILABLE', 'RPC_CLOSED',
  'RPC_REJECTED', 'TURN_FAILED', 'DEFAULT_MODEL_UNAVAILABLE']);
const observed = value => value === true ? true : 'not-observed';

export function probeExecution(result) {
  const executionReason = result.binaryUnchanged === false ? 'CLIENT_BINARY_CHANGED' : result.unexpectedTools === true ? 'UNEXPECTED_TOOL'
    : RUN_REASONS.has(result.reason) ? result.reason : 'PROBE_FAILED';
  return {execution: {processCompleted: result.success === true, binaryUnchanged: result.binaryUnchanged ?? 'not-tested', allowedToolsOnly: result.unexpectedTools !== true}, executionReason};
}

export function discoveryEvidence(observation, {resource, present, deployment, runResult} = {}) {
  if (!['instructions', 'skills', 'agents', 'mcp'].includes(resource) || typeof present !== 'boolean') {
    throw domainError('INVALID_VERIFICATION_EVIDENCE', 'Use a supported discovery resource');
  }
  const source = observation[resource] || {};
  // A primary-agent list can omit a working mainAgent:false custom subagent.
  const partialAgentList = resource === 'agents' && source.status === 'agent-list' && source.coversSubagents !== true && source.present === false;
  const actual = partialAgentList || source.coversRequestedScope === false ? undefined : resource === 'instructions' ? source.sourceListed : source.present;
  const nativeRecognition = {configurationListed: typeof actual === 'boolean' ? actual === present : 'not-observed'};
  if (present && typeof source.descriptionMatches === 'boolean') nativeRecognition.definitionMatched = source.descriptionMatches;
  if (present && typeof source.markerMatched === 'boolean') nativeRecognition.toolResultMatched = source.markerMatched;
  return verificationStage({deployment, nativeRecognition, ...(runResult ? probeExecution(runResult) : {})});
}

// Protocol collectors supply sanitized facts; they never decide deployment success.
export function probeEvidence(result, {clientId, resource, resources = [resource], present, deployment} = {}) {
  if (!resources.length || new Set(resources).size !== resources.length || typeof present !== 'boolean'
    || resources.some(value => !['instructions', 'skill', 'skills', 'mcp', 'agents'].includes(value))) {
    throw domainError('INVALID_VERIFICATION_EVIDENCE', 'Use a supported verification resource');
  }
  const nativeRecognition = {};
  if (!present) {
    nativeRecognition.noUnexpectedInvocation = result.terminalSuccess === true
      ? !result.mcpToolCalled && !result.skillFileRead && !result.spawned : 'not-observed';
  } else {
    if (resources.includes('skill') || resources.includes('skills')) nativeRecognition.supportingFileRead = observed(result.skillFileRead);
    if (resources.includes('mcp')) nativeRecognition.toolResultMatched = observed(result.mcpToolCalled);
    if (resources.includes('agents')) {
      nativeRecognition.roleInvoked = observed(result.spawned && result.roleObserved);
      nativeRecognition.childCompleted = observed(result.childMarkerReturned && (clientId === 'antigravity' || result.completedChildMarker === true));
    }
  }
  const keys = resources.map(value => value === 'skills' ? 'skill' : value === 'agents' ? 'agent' : value);
  const agent = resources.includes('agents');
  const matches = agent ? [result.finalMatches] : keys.map(key => result.final?.[key]);
  const parsed = result.finalParsed === true || matches.every(value => value === true);
  const nonempty = result.finalNonempty === true || result.answerFormat?.nonempty === true || parsed;
  const modelBehavior = {
    responseParsed: parsed ? true : nonempty ? false : 'not-observed',
    responseMatched: parsed ? matches.every(value => value === true) : nonempty ? false : 'not-observed',
    turnCompleted: result.terminalSuccess === true ? true : ['ERROR', 'CANCELED', 'INTERRUPTED', 'failed'].includes(result.terminalStatus) ? false : 'not-observed'
  };
  return verificationStage({deployment, nativeRecognition: Object.keys(nativeRecognition).length ? nativeRecognition : null, modelBehavior,
    ...probeExecution(result)});
}
