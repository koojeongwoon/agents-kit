import {domainError} from './errors.js';

export const VERIFICATION_STAGES = Object.freeze(['baseline', 'applied', 'updated', 'removed', 'rollback']);
const LAYERS = Object.freeze({
  deployment: ['transactionCommitted', 'recoveryClear', 'bytesMatch', 'modesMatch', 'ownershipMatch', 'restorationMatch'],
  nativeRecognition: ['configurationListed', 'definitionMatched', 'supportingFileRead', 'toolResultMatched', 'roleInvoked', 'childCompleted', 'noUnexpectedInvocation'],
  modelBehavior: ['responseParsed', 'responseMatched', 'turnCompleted'],
  execution: ['processCompleted', 'binaryUnchanged', 'allowedToolsOnly']
});
const REASONS = new Set(['OK', 'PROBE_FAILED', 'PROBE_TIMEOUT', 'PROBE_OUTPUT_LIMIT', 'PROBE_OBSERVATION_FAILED',
  'CLIENT_BINARY_CHANGED', 'CLI_REJECTED', 'MCP_PERMISSION_REQUIRED', 'EXECUTABLE_UNAVAILABLE', 'RPC_CLOSED',
  'RPC_REJECTED', 'TURN_FAILED', 'DEFAULT_MODEL_UNAVAILABLE', 'UNEXPECTED_TOOL']);
const fail = () => {throw domainError('INVALID_VERIFICATION_EVIDENCE', 'Use the versioned verification evidence contract');};
const status = value => value === true ? 'passed' : value === false ? 'failed'
  : ['not-observed', 'not-tested', 'not-applicable'].includes(value) ? value : fail();
const aggregate = values => values.includes('failed') ? 'failed' : values.includes('not-observed') ? 'not-observed'
  : values.includes('not-tested') || !values.length ? 'not-tested' : values.every(value => value === 'not-applicable') ? 'not-applicable' : 'passed';
const satisfied = value => ['passed', 'not-applicable'].includes(value.status);

// Pure grading of allowlisted, public facts. No client protocol, file or process access.
export function verificationLayer(name, checks = {}) {
  if (!Object.hasOwn(LAYERS, name)) fail();
  if (checks === null) {
    if (name !== 'nativeRecognition') fail();
    return Object.freeze({status: 'not-applicable', checks: Object.freeze({})});
  }
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) fail();
  const entries = Object.entries(checks).map(([key, value]) => {
    if (!LAYERS[name].includes(key)) fail();
    return [key, status(value)];
  });
  return Object.freeze({status: aggregate(entries.map(([, value]) => value)), checks: Object.freeze(Object.fromEntries(entries))});
}

export function verificationStage({deployment, nativeRecognition, modelBehavior, execution, executionReason = 'OK'} = {}) {
  if (!REASONS.has(executionReason)) fail();
  const layers = Object.fromEntries(Object.keys(LAYERS).map(name => [name, verificationLayer(name, {deployment, nativeRecognition, modelBehavior, execution}[name])]));
  return Object.freeze({schemaVersion: 1, ...layers, execution: Object.freeze({...layers.execution, reason: executionReason}),
    confirmed: Object.values(layers).every(satisfied)});
}

export function summarizeVerification(stages, {requestedStages = VERIFICATION_STAGES, cleanup} = {}) {
  if (!Array.isArray(requestedStages) || !requestedStages.length || new Set(requestedStages).size !== requestedStages.length
    || requestedStages.some(stage => !VERIFICATION_STAGES.includes(stage))) fail();
  const missingStages = requestedStages.filter(stage => !Object.hasOwn(stages, stage));
  for (const stage of requestedStages.filter(stage => Object.hasOwn(stages, stage))) {
    const evidence = stages[stage];
    if (evidence?.schemaVersion !== 1 || Object.keys(LAYERS).some(name => !['passed', 'failed', 'not-observed', 'not-tested', 'not-applicable'].includes(evidence[name]?.status))) fail();
  }
  const layers = Object.fromEntries(Object.keys(LAYERS).map(name => {
    const byStage = Object.fromEntries(requestedStages.map(stage => [stage, stages[stage]?.[name]?.status || 'not-tested']));
    return [name, {status: aggregate(Object.values(byStage)), stages: byStage}];
  }));
  const complete = !missingStages.length && cleanup === true && Object.values(layers).every(satisfied);
  return Object.freeze({schemaVersion: 1, requestedStages: [...requestedStages], missingStages, layers,
    cleanup: status(cleanup ?? 'not-tested'), complete,
    fullLifecycleConfirmed: complete && VERIFICATION_STAGES.every(stage => requestedStages.includes(stage))});
}
