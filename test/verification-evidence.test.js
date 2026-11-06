import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {verificationLayer, verificationStage, summarizeVerification} from '../lib/domain/verification-evidence.js';
import {probeEvidence, discoveryEvidence} from '../lib/adapters/verification/probe-evidence.js';

const passedDeployment = {transactionCommitted: true, bytesMatch: true, ownershipMatch: true};
const successfulRun = {success: true, reason: 'OK', binaryUnchanged: true, terminalSuccess: true};
const receipt = file => JSON.parse(fs.readFileSync(new URL(`../docs/reconstruction/${file}`, import.meta.url)));

test('recorded Antigravity MCP transport success survives the final response mismatch', () => {
  const recorded = receipt('native-global-antigravity-mcp-runtime-recheck-20261105.json');
  const result = recorded.clients[0].stages.applied;
  assert.equal(result.confirmed, false);
  const separated = probeEvidence(result, {resource: 'mcp', present: true});
  assert.equal(separated.deployment.status, 'not-tested');
  assert.equal(separated.nativeRecognition.status, 'passed');
  assert.equal(separated.modelBehavior.status, 'failed');
  assert.equal(separated.modelBehavior.checks.responseMatched, 'failed');
  assert.equal(separated.confirmed, false);
  assert.equal(recorded.productionEvidencePromoted, false);
});

test('recorded Agent parent response and invocation do not prove child completion', () => {
  const result = receipt('native-global-antigravity-agent-runtime-20261105.json').clients[0].stages.updated;
  const separated = probeEvidence(result, {clientId: 'antigravity', resource: 'agents', present: true});
  assert.equal(separated.nativeRecognition.checks.roleInvoked, 'passed');
  assert.equal(separated.nativeRecognition.checks.childCompleted, 'not-observed');
  assert.equal(separated.nativeRecognition.status, 'not-observed');
  assert.equal(separated.modelBehavior.status, 'passed');
  assert.equal(separated.confirmed, false);
});

test('recorded observer failure and timeout retain deployment proof without claiming model failure', () => {
  const recorded = receipt('native-global-antigravity-mcp-response-probe-20261105.json');
  assert.equal(recorded.blocker, 'VERIFICATION_OBSERVER_FAILED');
  for (const reason of ['PROBE_OBSERVATION_FAILED', 'PROBE_TIMEOUT']) {
    const separated = probeEvidence({success: false, reason, binaryUnchanged: true},
      {resource: 'mcp', present: true, deployment: passedDeployment});
    assert.equal(separated.deployment.status, 'passed');
    assert.equal(separated.nativeRecognition.status, 'not-observed');
    assert.equal(separated.modelBehavior.status, 'not-observed');
    assert.equal(separated.execution.status, 'failed');
    assert.equal(separated.execution.reason, reason);
  }
});

test('a native invocation remains observed if the later process or model fails', () => {
  const result = {...successfulRun, success: false, reason: 'CLI_REJECTED', mcpToolCalled: true};
  const separated = probeEvidence(result, {resource: 'mcp', present: true, deployment: passedDeployment});
  assert.equal(separated.nativeRecognition.status, 'passed');
  assert.equal(separated.execution.status, 'failed');
  assert.equal(separated.confirmed, false);
});

test('binary replacement and unexpected tools block confirmation without erasing acquired facts', () => {
  for (const override of [{binaryUnchanged: false}, {unexpectedTools: true}]) {
    const result = {...successfulRun, finalParsed: true, final: {mcp: true}, mcpToolCalled: true, ...override};
    const separated = probeEvidence(result, {resource: 'mcp', present: true, deployment: passedDeployment});
    assert.equal(separated.nativeRecognition.status, 'passed');
    assert.equal(separated.modelBehavior.status, 'passed');
    assert.equal(separated.execution.status, 'failed');
    assert.equal(separated.confirmed, false);
  }
});

test('negative controls describe no invocation without inferring native configuration absence', () => {
  const separated = probeEvidence({...successfulRun, finalParsed: true, final: {mcp: true}, mcpToolCalled: false},
    {resource: 'mcp', present: false, deployment: passedDeployment});
  assert.equal(separated.nativeRecognition.checks.noUnexpectedInvocation, 'passed');
  assert.equal(Object.hasOwn(separated.nativeRecognition.checks, 'configurationListed'), false);
  assert.equal(separated.confirmed, true);
  const spawned = probeEvidence({...successfulRun, finalParsed: true, final: {mcp: true}, mcpToolCalled: true},
    {resource: 'mcp', present: false, deployment: passedDeployment});
  assert.equal(spawned.nativeRecognition.status, 'failed');
});

test('instruction behavior and native-only transport keep untested layers explicit', () => {
  const instructions = probeEvidence({...successfulRun, finalParsed: true, final: {instructions: true}},
    {resource: 'instructions', present: true, deployment: passedDeployment});
  assert.equal(instructions.nativeRecognition.status, 'not-applicable');
  assert.equal(instructions.modelBehavior.status, 'passed');
  const nativeOnly = verificationStage({deployment: passedDeployment, nativeRecognition: {configurationListed: true, toolResultMatched: true}});
  assert.equal(nativeOnly.nativeRecognition.status, 'passed');
  assert.equal(nativeOnly.modelBehavior.status, 'not-tested');
  assert.equal(nativeOnly.confirmed, false);
});

test('missing, malformed and incorrect final answers are different from unobserved answers', () => {
  const grade = result => probeEvidence({...successfulRun, ...result}, {resource: 'mcp', present: true});
  assert.equal(grade({}).modelBehavior.status, 'not-observed');
  assert.equal(grade({answerFormat: {nonempty: true}, finalParsed: false}).modelBehavior.status, 'failed');
  assert.equal(grade({finalParsed: true, final: {mcp: false}}).modelBehavior.status, 'failed');
  assert.equal(grade({finalParsed: true, final: {mcp: true}}).modelBehavior.status, 'passed');
});

test('lifecycle summaries require exact requested stages and cleanup, while applied-only cannot prove a lifecycle', () => {
  const stage = probeEvidence({...successfulRun, mcpToolCalled: true, finalParsed: true, final: {mcp: true}},
    {resource: 'mcp', present: true, deployment: passedDeployment});
  const stages = Object.fromEntries(['baseline', 'applied', 'updated', 'removed', 'rollback'].map(key => [key, stage]));
  const complete = summarizeVerification(stages, {cleanup: true});
  assert.equal(complete.complete, true); assert.equal(complete.fullLifecycleConfirmed, true);
  assert.equal(complete.layers.deployment.status, 'passed');
  assert.equal(summarizeVerification(stages, {cleanup: false}).complete, false);
  delete stages.updated;
  const missing = summarizeVerification(stages, {cleanup: true});
  assert.equal(missing.complete, false); assert.deepEqual(missing.missingStages, ['updated']);
  assert.equal(missing.layers.deployment.status, 'not-tested');
  const single = summarizeVerification({applied: stage}, {requestedStages: ['applied'], cleanup: true});
  assert.equal(single.complete, true); assert.equal(single.fullLifecycleConfirmed, false);
});

test('layer checks are allowlisted and cannot accept truthy strings, empty or arbitrary evidence', () => {
  assert.equal(verificationLayer('deployment', {}).status, 'not-tested');
  assert.throws(() => verificationLayer('deployment', {bytesMatch: 'true'}), {code: 'INVALID_VERIFICATION_EVIDENCE'});
  assert.throws(() => verificationLayer('deployment', {password: true}), {code: 'INVALID_VERIFICATION_EVIDENCE'});
  assert.throws(() => verificationLayer('deployment', null), {code: 'INVALID_VERIFICATION_EVIDENCE'});
  assert.throws(() => summarizeVerification({applied: {deployment: {status: 'invented'}}}, {requestedStages: ['applied'], cleanup: true}), {code: 'INVALID_VERIFICATION_EVIDENCE'});
  assert.throws(() => probeEvidence(successfulRun, {resource: 'unknown', present: true}), {code: 'INVALID_VERIFICATION_EVIDENCE'});
  assert.throws(() => summarizeVerification({}, {requestedStages: ['unknown']}), {code: 'INVALID_VERIFICATION_EVIDENCE'});
  assert.throws(() => summarizeVerification({}, {requestedStages: ['applied', 'applied']}), {code: 'INVALID_VERIFICATION_EVIDENCE'});
});

test('new classification never contains native IDs, markers, transcripts or error text', () => {
  const result = {...successfulRun, mcpToolCalled: true, finalParsed: true, final: {mcp: false},
    rawResponse: 'private marker', childId: 'private child', toolEvidence: [{output: 'private tool output'}]};
  assert.doesNotMatch(JSON.stringify(probeEvidence(result, {resource: 'mcp', present: true})), /private/);
});

test('recorded discovery lists never become model behavior or Agent execution proof', () => {
  const clients = receipt('ca04-1-cli-recognition-evidence.json').clients;
  const codex = clients.find(client => client.clientId === 'codex').stages.applied;
  const mcp = discoveryEvidence(codex, {resource: 'mcp', present: true});
  assert.equal(mcp.nativeRecognition.status, 'passed'); assert.equal(mcp.modelBehavior.status, 'not-tested');
  assert.equal(discoveryEvidence(codex, {resource: 'agents', present: true}).nativeRecognition.status, 'not-observed');
  const agy = clients.find(client => client.clientId === 'antigravity' && client.scope === 'project').stages.applied;
  const agent = discoveryEvidence(agy, {resource: 'agents', present: true});
  assert.equal(agent.nativeRecognition.status, 'not-observed');
  assert.equal(Object.hasOwn(agent.nativeRecognition.checks, 'roleInvoked'), false);
  assert.equal(discoveryEvidence({agents: {...agy.agents, coversSubagents: true}}, {resource: 'agents', present: true}).nativeRecognition.status, 'failed');
});
