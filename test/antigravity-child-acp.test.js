import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import {createAcpChildObservation, combineAcpChildEvidence} from '../lib/adapters/verification/antigravity-child-acp.js';
import {inspectAntigravityChildAcp} from '../scripts/client-verification/antigravity-child-acp.mjs';
import {createAgentObservation} from '../lib/adapters/verification/agent-observation.js';

test('ACP child public replay is correlated by session and never substitutes for terminal proof', () => {
  const observer = createAcpChildObservation('child-private', 'private-marker');
  const emit = (sessionId, update) => observer.accept(JSON.stringify({jsonrpc: '2.0', method: 'session/update', params: {sessionId, update}}));
  observer.accept('{"method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","secret": INVALID JSON');
  emit('parent-private', {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'private-marker'}});
  observer.finishReplay(); assert.equal(observer.facts.publicChildMessageMatched, false);
  emit('child-private', {sessionUpdate: 'agent_message_chunk', messageId: 'message-private', content: {type: 'text', text: 'private-'}});
  emit('child-private', {sessionUpdate: 'agent_message_chunk', messageId: 'message-private', content: {type: 'text', text: 'marker'}});
  emit('child-private', {sessionUpdate: 'session_info_update', title: 'private title', _meta: {state: 'idle'}});
  observer.finishReplay();
  assert.equal(observer.facts.publicChildMessageMatched, true); assert.equal(observer.facts.historyReplayCompleted, true);
  assert.equal(observer.facts.completionEvidenceStatus, 'not-observed');
  assert.doesNotMatch(JSON.stringify(observer.facts), /private|secret|INVALID/);
});

test('ACP inspection loads only the observed child and requests no new prompt, filesystem or terminal work', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-child-acp-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const binary = path.join(root, 'agy'), methods = path.join(root, 'methods.jsonl');
  fs.writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});const emit=v=>console.log(JSON.stringify(v));
rl.on('line',line=>{const request=JSON.parse(line);fs.appendFileSync(${JSON.stringify(methods)},request.method+'\\n');
if(request.method==='initialize'){if(Object.keys(request.params.clientCapabilities).length)process.exit(7);emit({jsonrpc:'2.0',id:request.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{close:{}}}}});}
else if(request.method==='session/load'){if(request.params.sessionId!=='observed-child'||request.params.mcpServers.length)process.exit(8);emit({jsonrpc:'2.0',method:'session/update',params:{sessionId:'observed-child',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'opaque'}}}});emit({jsonrpc:'2.0',id:request.id,result:{}});}
else if(request.method==='session/close')emit({jsonrpc:'2.0',id:request.id,result:{}});else process.exit(9);});`, {mode: 0o700});
  const expectedBinarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  const result = await inspectAntigravityChildAcp(binary, {childId: 'observed-child', marker: 'opaque', cwd: root, env: process.env, expectedBinarySha256, timeoutMs: 1500});
  assert.equal(result.reason, 'OK'); assert.equal(result.publicChildMessageMatched, true);
  assert.equal(result.completionEvidenceStatus, 'not-observed'); assert.equal(result.modelTurnsRequested, 0);
  assert.equal(result.binaryUnchanged, true);
  assert.deepEqual(fs.readFileSync(methods, 'utf8').trim().split('\n'), ['initialize', 'session/load', 'session/close']);
  assert.doesNotMatch(JSON.stringify(result), /observed-child|opaque/);
});

test('ACP child inspection rejects a changed binary before starting it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-child-acp-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const binary = path.join(root, 'agy'), ran = path.join(root, 'ran'); fs.writeFileSync(binary, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(ran)},'ran');`, {mode: 0o700});
  const result = await inspectAntigravityChildAcp(binary, {childId: 'child', marker: 'opaque', cwd: root, env: process.env, expectedBinarySha256: '0'.repeat(64)});
  assert.equal(result.reason, 'CLIENT_BINARY_CHANGED'); assert.equal(fs.existsSync(ran), false);
});

test('an unadvertised session loader is fail-closed without requesting a child session', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-child-acp-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const binary = path.join(root, 'agy');
  fs.writeFileSync(binary, `#!${process.execPath}\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method!=='initialize')process.exit(8);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{}}}));});`, {mode: 0o700});
  const expectedBinarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  const result = await inspectAntigravityChildAcp(binary, {childId: 'child', marker: 'opaque', cwd: root, env: process.env, expectedBinarySha256, timeoutMs: 1000});
  assert.equal(result.reason, 'ACP_LOAD_UNSUPPORTED'); assert.equal(result.historyReplayCompleted, false);
  assert.equal(result.publicChildMessageMatched, false); assert.equal(result.modelTurnsRequested, 0);
});

test('read-only management can prove the exact child state without manufacturing its answer', () => {
  const make = () => {
    const observer = createAgentObservation('antigravity', 'fixture', 'opaque');
    observer.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'subagent', state: 'DONE', tool_name: 'invoke_subagent', subagent_info: {subagents: [{type_name: 'fixture', conversation_id: 'child'}]}}}));
    return observer;
  };
  const emit = (observer, Action, output) => observer.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'manage_subagents', parameters: {Action}, output}}}));
  for (const output of [JSON.stringify({subagents: [{conversation_id: 'child', status: 'idle'}]}), '| child | Status: completed |']) {
    const observer = make(); emit(observer, 'list', output);
    assert.equal(observer.facts.unexpectedTools, false); assert.equal(observer.facts.completedChildStateObserved, true);
    assert.equal(observer.facts.childMarkerReturned, false);
  }
  for (const output of [JSON.stringify({subagents: [{conversation_id: 'other', status: 'idle'}]}), JSON.stringify({subagents: [{conversation_id: 'child', status: 'running'}]}), 'All agents completed']) {
    const observer = make(); emit(observer, 'list', output); assert.equal(observer.facts.completedChildStateObserved, false);
  }
  for (const Action of ['kill', 'kill_all', 'unknown']) {
    const observer = make(); emit(observer, Action, JSON.stringify({subagents: [{conversation_id: 'child', status: 'idle'}]}));
    assert.equal(observer.facts.unexpectedTools, true); assert.equal(observer.facts.completedChildStateObserved, false);
  }
});

test('Agent completion joins native child state with its correlated public reply independently of parent formatting', () => {
  const parent = {roleObserved: true, spawned: true, completedChildStateObserved: true, finalMatches: false};
  const child = {binaryUnchanged: true, historyReplayCompleted: true, publicChildMessageMatched: true, loadSessionAdvertised: true, reason: 'OK'};
  const result = combineAcpChildEvidence(parent, child);
  assert.equal(result.completedChildMarker, true); assert.equal(result.childMarkerReturned, true);
  assert.equal(result.finalMatches, false); assert.equal(parent.childMarkerReturned, undefined);
  for (const patch of [{binaryUnchanged: false}, {historyReplayCompleted: false}, {publicChildMessageMatched: false}, {reason: 'ACP_REJECTED'}]) {
    assert.equal(combineAcpChildEvidence(parent, {...child, ...patch}).completedChildMarker, false);
  }
  assert.equal(combineAcpChildEvidence({...parent, completedChildStateObserved: false}, child).completedChildMarker, false);
  assert.equal(combineAcpChildEvidence({...parent, roleObserved: false}, child).completedChildMarker, false);
});

test('recorded native management envelope exposes only the matched child state', () => {
  // CLI 1.5.2 public manage_subagents output, with fixture identifiers substituted.
  const row = {role: 'Evidence Probe', type: 'fixture', conversationId: 'child',
    transcript: 'file:///NOT_READ', state: 'idle', lastStepTime: '2026-11-06T08:05:54Z'};
  const observe = output => {
    const observer = createAgentObservation('antigravity', 'fixture', 'opaque');
    observer.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'subagent', state: 'DONE', tool_name: 'invoke_subagent', subagent_info: {subagents: [{type_name: 'fixture', conversation_id: 'child'}]}}}));
    observer.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'manage_subagents', parameters: {Action: 'list'}, output}}}));
    return observer.facts;
  };
  const envelope = rows => `You have ${rows.length} active subagent(s):\n${JSON.stringify(rows)}`;
  const facts = observe(envelope([row]));
  assert.equal(facts.completedChildStateObserved, true);
  assert.deepEqual(facts.managementChildStates, ['idle']);
  assert.equal(facts.completedChildMarker, false);
  assert.doesNotMatch(JSON.stringify(facts), /NOT_READ|Evidence Probe|2026-11-06|"child"/);
  for (const output of [envelope([{...row, conversationId: 'another'}]), envelope([{...row, state: 'running'}]),
    envelope([{...row, state: 'failed'}]), envelope([{...row, error: 'failed'}]),
    envelope([{...row, thoughts: 'opaque'}]), envelope([row]).replace('1 active', '2 active'),
    `Unrelated text\n${JSON.stringify([row])}`]) {
    assert.equal(observe(output).completedChildStateObserved, false);
  }
});

test('a correct parent answer keeps the native stream open until child state is observed', () => {
  const observer = createAgentObservation('antigravity', 'fixture', 'opaque');
  observer.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'subagent', state: 'DONE', tool_name: 'invoke_subagent', subagent_info: {subagents: [{type_name: 'fixture', conversation_id: 'child'}]}}}));
  observer.accept(JSON.stringify({event: 'result', result: {status: 'SUCCESS', response: '{"agent":"opaque"}'}}));
  assert.equal(observer.needsFollowup(), true);
  observer.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'manage_subagents', parameters: {Action: 'list'}, output: JSON.stringify([{conversationId: 'child', state: 'idle'}])}}}));
  assert.equal(observer.needsFollowup(), false);
  assert.equal(observer.facts.completedChildMarker, false);
});
