import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {replayVerificationReport} from '../lib/adapters/verification/recorded-report.js';
import {createAgentObservation} from '../lib/adapters/verification/agent-observation.js';
import {createRpcAgentObservation} from '../lib/adapters/verification/codex-agent-observation.js';

const record = name => JSON.parse(fs.readFileSync(new URL(`../docs/reconstruction/${name}`, import.meta.url)));
test('replay separates the recorded MCP failure without manufacturing missing deployment evidence', () => {
  const original = record('native-global-antigravity-mcp-runtime-recheck-20261105.json'), before = JSON.stringify(original);
  const report = replayVerificationReport(original);
  const applied = report.clients[0].stages.applied.verification;
  assert.equal(applied.deployment.status, 'not-tested');
  assert.equal(applied.nativeRecognition.status, 'passed');
  assert.equal(applied.modelBehavior.status, 'failed');
  assert.equal(report.clients[0].verification.layers.deployment.status, 'not-tested');
  assert.equal(report.productionEvidencePromoted, false); assert.equal(report.replayOnly, true);
  assert.equal(JSON.stringify(original), before);
});

test('replay keeps partial Agent and single-stage MCP evidence incomplete', () => {
  const agent = replayVerificationReport(record('native-global-antigravity-agent-runtime-20261105.json'));
  assert.equal(agent.clients[0].stages.updated.verification.nativeRecognition.status, 'not-observed');
  assert.equal(agent.clients[0].stages.updated.verification.modelBehavior.status, 'passed');
  assert.equal(agent.complete, false);
  const single = replayVerificationReport(record('native-global-antigravity-mcp-response-pattern-20261105.json'));
  assert.equal(single.clients[0].stages.applied.verification.modelBehavior.status, 'passed');
  assert.deepEqual(single.clients[0].verification.missingStages, ['baseline', 'updated', 'removed', 'rollback']);
  assert.equal(single.clients[0].verification.fullLifecycleConfirmed, false);
});

test('native RPC replay reports model behavior as untested rather than failed', () => {
  const report = replayVerificationReport(record('native-global-codex-mcp-runtime-20261105.json'));
  assert.equal(report.clients[0].stages.applied.verification.nativeRecognition.status, 'passed');
  assert.equal(report.clients[0].stages.applied.verification.modelBehavior.status, 'not-tested');
  assert.equal(report.complete, false);
});

test('discovery replay retains resource-specific unknowns and never claims a model turn', () => {
  const report = replayVerificationReport(record('ca04-1-cli-recognition-evidence.json'));
  const codex = report.clients.find(client => client.clientId === 'codex');
  assert.equal(codex.stages.applied.verificationByResource.mcp.nativeRecognition.status, 'passed');
  assert.equal(codex.stages.applied.verificationByResource.agents.nativeRecognition.status, 'not-observed');
  assert.equal(codex.stages.applied.verification.modelBehavior.status, 'not-tested');
  assert.equal(report.complete, false);
});

test('recorded observer failure keeps its normalized blocker when no stage finished', () => {
  const report = replayVerificationReport(record('native-global-antigravity-mcp-response-probe-20261105.json'));
  assert.equal(report.clients[0].blocker, 'PROBE_OBSERVATION_FAILED');
  assert.equal(report.complete, false);
  assert.equal(report.clients[0].verification.layers.modelBehavior.status, 'not-tested');
});

test('agent protocol adapters distinguish parse failures from wrong values and missing output', () => {
  const agent = createAgentObservation('antigravity', 'fixture', 'opaque');
  assert.equal(agent.facts.finalParsed, false);
  const finish = response => agent.accept(JSON.stringify({event: 'result', result: {status: 'SUCCESS', response}}));
  finish('not JSON'); assert.equal(agent.facts.finalParsed, false); assert.equal(agent.facts.finalNonempty, true);
  finish('{"agent":"wrong"}'); assert.equal(agent.facts.finalParsed, true); assert.equal(agent.facts.finalMatches, false);
  finish('null'); assert.equal(agent.facts.finalParsed, true); assert.equal(agent.facts.finalMatches, false);
  const rpc = createRpcAgentObservation('fixture', 'opaque'); rpc.setParent('parent');
  rpc.accept(JSON.stringify({method: 'item/completed', params: {threadId: 'parent', item: {type: 'agentMessage', text: '{"agent":"wrong"}'}}}));
  assert.equal(rpc.facts.finalParsed, true); assert.equal(rpc.facts.finalNonempty, true); assert.equal(rpc.facts.finalMatches, false);
  rpc.accept(JSON.stringify({method: 'item/completed', params: {threadId: 'parent', item: {type: 'agentMessage', text: 'null'}}}));
  assert.equal(rpc.facts.finalParsed, true); assert.equal(rpc.facts.finalMatches, false);
});

test('offline replay CLI preserves the source receipt and writes only a new sanitized report', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-replay-cli-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.resolve('docs/reconstruction/native-global-antigravity-mcp-runtime-recheck-20261105.json');
  const before = fs.readFileSync(source), output = path.join(root, 'report.json');
  const result = spawnSync(process.execPath, ['scripts/replay-client-verification.mjs', '--input', source, '--output', output], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output)); assert.equal(report.replayOnly, true); assert.equal(report.complete, false);
  assert.deepEqual(fs.readFileSync(source), before); assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  const overwrite = spawnSync(process.execPath, ['scripts/replay-client-verification.mjs', '--input', source, '--output', source], {encoding: 'utf8'});
  assert.notEqual(overwrite.status, 0); assert.deepEqual(fs.readFileSync(source), before);
});
