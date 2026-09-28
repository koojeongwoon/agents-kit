import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import test from 'node:test';
import {isolatedEnvironment, runCommand, withCodexRpc} from '../scripts/client-verification/process.mjs';
import {skillObservation, markerObservation, lifecycleRecognition} from '../scripts/client-verification/observations.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ca04-unit-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('CLI verification isolates credentials/config environment and bounds process lifetime', async t => {
  const root = fixture(t), env = isolatedEnvironment(path.join(root, 'home'), root, '/usr/bin:/bin');
  assert.deepEqual(Object.keys(env).sort(), ['CODEX_HOME', 'HOME', 'LANG', 'NO_COLOR', 'PATH', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'].sort());
  assert.equal(env.CODEX_HOME, path.join(root, 'home/.codex'));
  const options = {cwd: root, env, timeoutMs: 150};
  const timed = await runCommand(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], options);
  assert.equal(timed.reason, 'PROBE_TIMEOUT');
  const missing = await runCommand(path.join(root, 'missing'), [], options);
  assert.equal(missing.reason, 'EXECUTABLE_UNAVAILABLE');
  const overflow = await runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(2*1024*1024))'], {...options, timeoutMs: 5000});
  assert.equal(overflow.reason, 'PROBE_OUTPUT_LIMIT');
});

test('discovery requires exact skill path and enabled state; absence alone never passes lifecycle', () => {
  const named = {name: 'ca04-skill', path: '/fixture/SKILL.md', enabled: true, description: 'v1'};
  assert.deepEqual(skillObservation({data: [{skills: [named]}]}, 'ca04-skill', named.path, 'v1'), {present: true, descriptionMatches: true});
  for (const item of [{...named, path: '/other/SKILL.md'}, {...named, enabled: false}]) {
    assert.equal(skillObservation({data: [{skills: [item]}]}, 'ca04-skill', named.path, 'v1').present, false);
  }
  assert.equal(lifecycleRecognition({}, 'skills'), false);
  const stages = Object.fromEntries(['baseline', 'applied', 'updated', 'removed', 'rollback'].map(stage => [stage, {skills: {present: ['applied', 'updated', 'rollback'].includes(stage)}}]));
  assert.equal(lifecycleRecognition(stages, 'skills'), true);
  delete stages.removed.skills.present;
  assert.equal(lifecycleRecognition(stages, 'skills'), false);
  assert.equal(markerObservation({content: [{type: 'text', text: 'ca04-123-v1'}], isError: true}, 'ca04-123-v1'), false);
  assert.equal(markerObservation({content: [{type: 'text', text: 'ca04-123-v2'}]}, 'ca04-123-v1'), false);
});

test('fixed local MCP speaks initialize/list/call and rejects arbitrary operations', async t => {
  const root = fixture(t), marker = 'ca04-abcdef-v1';
  const child = spawn(process.execPath, [path.resolve('scripts/client-verification/marker-mcp.mjs'), marker], {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
  const lines = readline.createInterface({input: child.stdout});
  t.after(() => {child.kill(); lines.close();});
  const call = (id, method, params) => new Promise(resolve => {
    lines.once('line', line => resolve(JSON.parse(line)));
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
  });
  const initialized = await call(1, 'initialize', {protocolVersion: '2024-11-05'});
  assert.equal(initialized.result.serverInfo.name, 'agents-kit-ca04');
  const tool = (await call(2, 'tools/list')).result.tools[0];
  assert.equal(tool.name, 'read_marker');
  assert.deepEqual(tool.annotations, {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false});
  assert.equal(markerObservation((await call(3, 'tools/call', {name: 'read_marker', arguments: {}})).result, marker), true);
  assert.equal((await call(4, 'tools/call', {name: 'execute_shell'})).error.code, -32601);
});

test('RPC failures are bounded and reported without echoing server error contents', async t => {
  const root = fixture(t), binary = path.join(root, 'fake-codex');
  fs.writeFileSync(binary, `#!${process.execPath}\nprocess.stdin.on('data', bytes => {const message = JSON.parse(bytes.toString()); console.log(JSON.stringify({id: message.id, error: {message: 'sensitive server details'}}));});\n`, {mode: 0o700});
  await assert.rejects(withCodexRpc(binary, {cwd: root, env: isolatedEnvironment(root, root), timeoutMs: 1000}, () => {}), error => error.code === 'RPC_REJECTED' && !error.message.includes('sensitive'));
});

const {createUseObservation, authenticatedEnvironment, runModelUse} = await import('../scripts/client-verification/model-use.mjs');
const expectedUse = {instructions: 'ca04-aaa-v1', skill: 'ca04-bbb-v1', mcp: 'ca04-ccc-v1'};

test('model evidence distinguishes final answers from successful supporting-file and MCP calls', () => {
  const observation = createUseObservation('codex', expectedUse);
  const send = event => observation.accept(JSON.stringify(event));
  send({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify(expectedUse)}});
  assert.deepEqual(observation.facts.final, {instructions: true, skill: true, mcp: true});
  assert.equal(observation.facts.skillFileRead, false);
  assert.equal(observation.facts.mcpToolCalled, false);
  const read = {type: 'command_execution', command: 'cat .agents/skills/ca04-skill/references/marker.txt', aggregated_output: expectedUse.skill, exit_code: 1, status: 'completed'};
  send({type: 'item.completed', item: read}); assert.equal(observation.facts.skillFileRead, false);
  send({type: 'item.completed', item: {...read, exit_code: 0}}); assert.equal(observation.facts.skillFileRead, true);
  const call = {type: 'mcp_tool_call', server: 'ca04-marker', tool: 'read_marker', result: {content: [{text: expectedUse.mcp}], isError: true}, status: 'completed'};
  send({type: 'item.completed', item: call}); assert.equal(observation.facts.mcpToolCalled, false);
  send({type: 'item.completed', item: {...call, result: {...call.result, isError: false}}}); assert.equal(observation.facts.mcpToolCalled, true);
  assert.equal(observation.facts.terminalSuccess, false);
  send({type: 'turn.completed'}); assert.equal(observation.facts.terminalSuccess, true);
  assert.equal(JSON.stringify(observation.facts).includes(expectedUse.skill), false);
  const summaryOnly = createUseObservation('codex', expectedUse);
  summaryOnly.accept(JSON.stringify({type: 'item.completed', item: {...read, exit_code: 0, aggregated_output: 'File contents omitted'}}));
  assert.equal(summaryOnly.facts.skillFileRead, true);
  assert.deepEqual(summaryOnly.facts.final, {}); // A read alone cannot satisfy the runner's final-marker gate.
  assert.equal(summaryOnly.facts.toolEvidence[0].skillMarkerReturned, false);
});

test('model collector ignores reasoning, incomplete/failed Antigravity tools and stale markers', () => {
  const observation = createUseObservation('antigravity', expectedUse);
  observation.accept('{"event":"step_update","step_update":{"step_type":"reasoning","secret": INVALID JSON');
  observation.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'ACTIVE', tool_info: {name: 'view_file', parameters: {path: 'references/marker.txt'}, output: expectedUse.skill}}}));
  assert.equal(observation.facts.completedTools, 0);
  const step = {step_type: 'tool', state: 'DONE', tool_info: {name: 'view_file', parameters: {path: 'references/marker.txt'}, output: expectedUse.skill, error: {message: 'private'}}};
  observation.accept(JSON.stringify({event: 'step_update', step_update: step})); assert.equal(observation.facts.skillFileRead, false);
  delete step.tool_info.error;
  observation.accept(JSON.stringify({event: 'step_update', step_update: step})); assert.equal(observation.facts.skillFileRead, true);
  observation.accept(JSON.stringify({event: 'result', result: {status: 'ERROR', response: JSON.stringify({...expectedUse, mcp: 'stale'})}}));
  assert.equal(observation.facts.terminalSuccess, false); assert.equal(observation.facts.final.mcp, false);
  assert.equal(JSON.stringify(observation.facts).includes('private'), false);
});

test('authenticated probe preserves native home but strips credential variables; truncation and timeout cannot pass', async t => {
  const root = fixture(t), env = authenticatedEnvironment(root, root, {PATH: process.env.PATH, CODEX_HOME: '/native-codex', OPENAI_API_KEY: 'never-forward'});
  assert.equal(env.HOME, root); assert.equal(env.CODEX_HOME, '/native-codex'); assert.equal(env.OPENAI_API_KEY, undefined);
  const options = {cwd: root, env, clientId: 'codex', expected: expectedUse, timeoutMs: 150};
  const result = await runModelUse(process.execPath, ['-e', 'console.log(JSON.stringify({type:"turn.completed"})); setInterval(()=>{}, 1000)'], options);
  assert.equal(result.success, false); assert.equal(result.reason, 'PROBE_TIMEOUT');
  const partial = await runModelUse(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({type:"turn.completed"}))'], {...options, timeoutMs: 2000});
  assert.equal(partial.success, false);
  const overflow = await runModelUse(process.execPath, ['-e', 'process.stdout.write("x".repeat(5*1024*1024))'], {...options, timeoutMs: 2000});
  assert.equal(overflow.reason, 'PROBE_OUTPUT_LIMIT'); assert.equal(overflow.success, false);
});

test('fenced final responses are supported but another MCP server cannot satisfy fixture evidence', () => {
  const observation = createUseObservation('antigravity', expectedUse);
  observation.accept(JSON.stringify({event: 'result', result: {status: 'SUCCESS', response: `Result:\n\n\`\`\`json\n${JSON.stringify(expectedUse)}\n\`\`\``}}));
  assert.deepEqual(observation.facts.final, {instructions: true, skill: true, mcp: true});
  observation.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'other-ca04-marker/read_marker', output: expectedUse.mcp}}}));
  assert.equal(observation.facts.mcpToolCalled, false);
  observation.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'mcp_ca04_marker_read_marker', output: expectedUse.mcp}}}));
  assert.equal(observation.facts.mcpToolCalled, true);
});


test('Antigravity public response deltas supplement an empty terminal response without reading reasoning', () => {
  const observation = createUseObservation('antigravity', expectedUse);
  const send = event => observation.accept(JSON.stringify(event));
  send({event: 'step_update', step_update: {step_type: 'reasoning', state: 'DONE', text_delta: JSON.stringify(expectedUse)}});
  send({event: 'result', result: {status: 'SUCCESS', response: ''}});
  assert.equal(observation.facts.finalParsed, false);
  send({event: 'step_update', step_update: {step_type: 'agent_response', state: 'DONE', text_delta: JSON.stringify(expectedUse)}});
  send({event: 'result', result: {status: 'SUCCESS', response: ''}});
  assert.deepEqual(observation.facts.final, {instructions: true, skill: true, mcp: true});
  send({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: {name: 'view_file', parameters: {AbsolutePath: '/fixture/references/marker.txt'}, output: 'Viewed file'}}});
  assert.equal(observation.facts.skillFileRead, true);
  assert.equal(observation.facts.toolEvidence[0].skillMarkerReturned, false);
});

test('Antigravity MCP soft-denial is a permission blocker even with exit 0 and SUCCESS', async t => {
  const root = fixture(t);
  const terminal = JSON.stringify({event: 'result', result: {status: 'SUCCESS', response: JSON.stringify(expectedUse)}});
  const code = `process.stderr.write('jetski: no output produced — a tool required the "mcp" '); setTimeout(() => {process.stderr.write('permission that headless mode cannot prompt for, so it was auto-denied.\\n'); console.log(${JSON.stringify(terminal)});}, 30);`;
  const result = await runModelUse(process.execPath, ['-e', code], {cwd: root, env: isolatedEnvironment(root, root), clientId: 'antigravity', expected: expectedUse, timeoutMs: 2000});
  assert.equal(result.code, 0); assert.equal(result.terminalSuccess, true);
  assert.equal(result.reason, 'MCP_PERMISSION_REQUIRED'); assert.equal(result.success, false);
  assert.equal(result.diagnostics.mcpPermissionRequired, true);
  assert.equal(JSON.stringify(result).includes('jetski'), false);
});

test('Antigravity distinguishes advertised MCP, permission requests, and terminal waiting from use', () => {
  const observation = createUseObservation('antigravity', expectedUse);
  const send = event => observation.accept(JSON.stringify(event));
  send({event: 'init', init: {tools: ['mcp_ca04_marker_read_marker']}});
  assert.equal(observation.facts.mcpAdvertised, true); assert.equal(observation.facts.mcpToolCalled, false);
  send({event: 'step_update', step_update: {step_type: 'tool', state: 'ACTIVE', tool_name: 'ask_permission'}});
  assert.equal(observation.facts.permissionRequested, true); assert.equal(observation.facts.completedTools, 0);
  send({event: 'result', result: {status: 'WAITING', response: ''}});
  assert.equal(observation.facts.terminalStatus, 'WAITING'); assert.equal(observation.facts.terminalSuccess, false);
});

const {withFixturePermission, fixturePermission} = await import('../scripts/client-verification/scoped-permission.mjs');

test('explicit fixture grant restores exact bytes and mode on success and failure', async t => {
  const root = fixture(t), file = path.join(root, 'settings.json');
  const original = '{"model":"keep", "permissions":{"allow":["read_file(src)"]}}';
  fs.writeFileSync(file, original, {mode: 0o600});
  const result = await withFixturePermission(file, async () => {
    assert.deepEqual(JSON.parse(fs.readFileSync(file)).permissions.allow, ['read_file(src)', fixturePermission]); return 42;
  });
  assert.equal(result.result, 42); assert.equal(result.permission.originalBytesRestored, true);
  assert.equal(fs.readFileSync(file, 'utf8'), original); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await assert.rejects(withFixturePermission(file, async () => {throw new Error('fixture failure');}), /fixture failure/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('fixture grant preserves concurrent edits and refuses explicit policy or symlink targets', async t => {
  const root = fixture(t), file = path.join(root, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({permissions: {allow: []}}));
  const result = await withFixturePermission(file, async () => {
    const current = JSON.parse(fs.readFileSync(file)); current.model = 'changed-concurrently'; current.permissions.allow.push('command(git)');
    fs.writeFileSync(file, JSON.stringify(current));
  });
  assert.equal(result.permission.concurrentChangesPreserved, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), {model: 'changed-concurrently', permissions: {allow: ['command(git)']}});
  for (const key of ['ask', 'deny']) {
    fs.writeFileSync(file, JSON.stringify({permissions: {[key]: ['mcp(*)']}}));
    await assert.rejects(withFixturePermission(file, () => assert.fail('must not run')), {code: 'EXPLICIT_PERMISSION_POLICY'});
  }
  const link = path.join(root, 'link.json'); fs.symlinkSync(file, link);
  await assert.rejects(withFixturePermission(link, () => assert.fail('must not run')), {code: 'UNSAFE_SETTINGS_FILE'});
});

test('Antigravity call_mcp_tool requires exact ServerName/ToolName and a successful marker result', () => {
  function observe(overrides = {}) {
    const observation = createUseObservation('antigravity', expectedUse);
    const info = {name: 'call_mcp_tool', parameters: {ServerName: 'ca04-marker', ToolName: 'read_marker', Arguments: {}}, output: JSON.stringify({content: [{type: 'text', text: expectedUse.mcp}], isError: false}), ...overrides};
    observation.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'tool', state: 'DONE', tool_info: info}}));
    return observation.facts;
  }
  assert.equal(observe().mcpToolCalled, true);
  for (const parameters of [{ServerName: 'other', ToolName: 'read_marker'}, {ServerName: 'ca04-marker', ToolName: 'write_marker'}, {note: 'ca04-marker', label: 'read_marker'}]) assert.equal(observe({parameters}).mcpToolCalled, false);
  assert.equal(observe({error: {message: 'failed'}}).mcpToolCalled, false);
  assert.equal(observe({output: JSON.stringify({isError: true, content: [{text: expectedUse.mcp}]})}).mcpToolCalled, false);
});

import {createAgentObservation, agentUseConfirmed} from '../scripts/client-verification/agent-use.mjs';

test('Agent proof requires successful child result, current private marker and clean parent tools', () => {
  const marker = 'ca04-private-v1', name = 'ca04-agent';
  const observation = createAgentObservation('codex', name, marker);
  const emit = item => observation.accept(JSON.stringify({type: 'item.completed', item}));
  emit({type: 'agent_message', text: JSON.stringify({agent: marker})});
  observation.accept('{"type":"turn.completed"}');
  assert.equal(agentUseConfirmed({...observation.facts, success: true}, true, 'codex'), false);
  emit({type: 'collab_tool_call', tool: 'spawn_agent', status: 'completed', receiver_thread_ids: ['child'], agents_states: {}});
  for (const [id, status, message] of [['other', 'completed', marker], ['child', 'errored', marker], ['child', 'completed', 'ca04-private-v0']]) {
    emit({type: 'collab_tool_call', tool: 'wait', status: 'completed', receiver_thread_ids: ['child'], agents_states: {[id]: {status, message}}});
    assert.equal(observation.facts.childMarkerReturned, false);
  }
  emit({type: 'collab_tool_call', tool: 'wait', status: 'completed', receiver_thread_ids: ['child'], agents_states: {child: {status: 'completed', message: marker}}});
  assert.equal(agentUseConfirmed({...observation.facts, success: true}, true, 'codex'), true);
  emit({type: 'command_execution', command: 'cat agent.toml', status: 'completed'});
  assert.equal(agentUseConfirmed({...observation.facts, success: true}, true, 'codex'), false);
  const serialized = JSON.stringify(observation.facts);
  assert.equal(serialized.includes(marker), false);
  assert.equal(serialized.includes('cat agent.toml'), false);
});

test('Agent negative control cannot pass with a spawn or with parent marker alone', () => {
  const absent = createAgentObservation('codex', 'fixture', 'ABSENT');
  absent.accept('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"agent\\":\\"ABSENT\\"}"}}');
  assert.equal(agentUseConfirmed({...absent.facts, success: true}, false, 'codex'), true);
  absent.accept('{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","receiver_thread_ids":["private-native-id"]}}');
  assert.equal(agentUseConfirmed({...absent.facts, success: true}, false, 'codex'), false);
  assert.equal(JSON.stringify(absent.facts).includes('private-native-id'), false);
});

test('Antigravity Agent requires the configured subagent role and delivered result, not just a parent claim', () => {
  const marker = 'ca04-private-v2';
  const make = () => createAgentObservation('antigravity', 'fixture-agent', marker);
  const emit = (o, step_update) => o.accept(JSON.stringify({event: 'step_update', step_update}));
  const finish = o => o.accept(JSON.stringify({event: 'result', result: {status: 'SUCCESS', response: JSON.stringify({agent: marker})}}));
  const o = make();
  emit(o, {step_type: 'subagent', state: 'DONE', tool_name: 'invoke_subagent', subagent_info: {subagents: [{type_name: 'fixture-agent', conversation_id: 'private-id'}]}});
  finish(o);
  assert.equal(agentUseConfirmed({...o.facts, success: true}, true, 'antigravity'), false);
  emit(o, {step_type: 'system_message', text_delta: marker});
  assert.equal(agentUseConfirmed({...o.facts, success: true}, true, 'antigravity'), true);
  assert.equal(agentUseConfirmed({...o.facts, success: false}, true, 'antigravity'), false);
  for (const state of ['ACTIVE', 'DONE']) {
    const wrong = make();
    emit(wrong, {step_type: 'subagent', state, tool_name: 'invoke_subagent', subagent_info: {subagents: [{type_name: 'other-agent', conversation_id: 'private-id'}]}});
    emit(wrong, {step_type: 'system_message', text_delta: marker}); finish(wrong);
    assert.equal(agentUseConfirmed({...wrong.facts, success: true}, true, 'antigravity'), false);
  }
  assert.equal(JSON.stringify(o.facts).includes('private-id'), false);
  assert.equal(JSON.stringify(o.facts).includes(marker), false);
});

test('streamed model verification closes stdin on a final result and bounds pending followups', async t => {
  const root = fixture(t);
  const binary = path.join(root, 'stream.cjs');
  fs.writeFileSync(binary, `process.stdin.once('data', () => {process.stdout.write('{"event":"result","result":{"status":"SUCCESS","response":"done"}}\\n');}); process.stdin.on('end', () => process.exit(0));`);
  const observation = {facts: {terminalSuccess: false}, accept() {this.facts.terminalSuccess = true;}, needsFollowup: () => false};
  const options = {cwd: root, env: process.env, observation, streamInput: {initial: 'fixture', followup: 'await'}, timeoutMs: 1000};
  const result = await runModelUse(process.execPath, [binary], options);
  assert.equal(result.success, true);
  const waiting = {...observation, facts: {terminalSuccess: false}, needsFollowup: () => true};
  const timed = await runModelUse(process.execPath, [binary], {...options, observation: waiting, timeoutMs: 150});
  assert.equal(timed.success, false); assert.equal(timed.reason, 'PROBE_TIMEOUT');
});

import {agentEvidence} from '../scripts/client-verification/agent-use.mjs';

test('Agent evidence levels never promote final-marker or invocation proof to child completion', () => {
  const parentOnly = {success: true, reason: 'OK', finalMatches: true, unexpectedTools: false, spawned: false, childMarkerReturned: false, roleObserved: false};
  assert.deepEqual(agentEvidence(parentOnly, true, 'codex'), {markerConfirmed: true, invocationConfirmed: false, confirmed: false, verificationReason: 'CHILD_RESULT_NOT_EXPOSED'});
  assert.deepEqual(agentEvidence({...parentOnly, spawned: true, roleObserved: true}, true, 'antigravity'), {markerConfirmed: true, invocationConfirmed: true, confirmed: false, verificationReason: 'CHILD_RESULT_NOT_EXPOSED'});
  const denied = createAgentObservation('antigravity', 'fixture', 'ABSENT');
  denied.accept(JSON.stringify({event: 'step_update', step_update: {step_type: 'subagent', state: 'DONE', tool_name: 'invoke_subagent', subagent_info: {subagents: [{type_name: 'fixture', role: 'test'}]}}}));
  assert.equal(denied.facts.roleRequested, true);
  assert.equal(denied.facts.roleObserved, false);
  assert.equal(denied.facts.spawned, false);
});

import {createRpcAgentObservation} from '../scripts/client-verification/codex-agent-rpc.mjs';
import {withGlobalFixture} from '../scripts/client-verification/global-fixture.mjs';

test('RPC Agent evidence correlates exact role, parent, child final message and completed turn', () => {
  const o = createRpcAgentObservation('fixture', 'opaque-marker'); o.setParent('parent');
  const emit = (method, params) => o.accept(JSON.stringify({method, params}));
  for (const thread of [{id: 'other', parentThreadId: 'other-parent', agentRole: 'fixture'}, {id: 'wrong-role', parentThreadId: 'parent', agentRole: 'other'}]) emit('thread/started', {thread});
  assert.equal(o.facts.spawned, false);
  emit('thread/started', {thread: {id: 'child', parentThreadId: 'parent', agentRole: 'fixture'}});
  emit('item/completed', {threadId: 'child', item: {type: 'agentMessage', text: 'opaque-marker'}});
  assert.equal(o.facts.childMarkerReturned, false);
  emit('turn/completed', {threadId: 'other', turn: {status: 'completed'}});
  assert.equal(o.facts.childMarkerReturned, false);
  emit('turn/completed', {threadId: 'child', turn: {status: 'completed'}});
  assert.equal(o.facts.childMarkerReturned, true);
  emit('item/completed', {threadId: 'parent', item: {type: 'agentMessage', text: '{"agent":"opaque-marker"}'}});
  emit('turn/completed', {threadId: 'parent', turn: {status: 'completed'}});
  assert.equal(o.facts.terminalSuccess, true);
  assert.equal(o.facts.finalMatches, true);
  o.accept('{"method":"item/completed","params":{"item":{"type":"reasoning","text":"never decode"}}}');
  const serialized = JSON.stringify(o.facts);
  for (const value of ['opaque-marker', 'other-parent', 'never decode']) assert.equal(serialized.includes(value), false);
});

test('global fixture refuses occupied targets and cleans owned files on action failure', async t => {
  const root = fixture(t), target = path.join(root, 'skill');
  const input = {scope: 'global'}, operation = {assetId: 'fixture', target, operation: 'CREATE'};
  const service = {plan: () => ({automatic: true, planId: 'create', operations: [operation]}), apply: ({planId}) => {if (planId === 'create') fs.mkdirSync(target); else fs.rmdirSync(target); return {};}, planRemoval: () => ({automatic: true, planId: 'remove', operations: [{...operation, operation: 'REMOVE'}]})};
  await assert.rejects(withGlobalFixture({service, input, assetIds: ['fixture']}, async ({initialPlan, apply}) => {apply(initialPlan); throw new Error('probe failed');}), /probe failed/);
  assert.equal(fs.existsSync(target), false);
  operation.operation = 'UPDATE';
  await assert.rejects(withGlobalFixture({service, input, assetIds: ['fixture']}, async () => assert.fail('must not start')), {code: 'GLOBAL_FIXTURE_NOT_FRESH'});
  operation.operation = 'CREATE';
  const success = await withGlobalFixture({service, input, assetIds: ['fixture']}, async ({initialPlan, apply}) => apply(initialPlan));
  assert.equal(success.cleanup.assetsAbsent, true);
});

import {runCodexAgentRpc} from '../scripts/client-verification/codex-agent-rpc.mjs';

test('RPC subscribes to only the observed child without history and handles a failed root promptly', async t => {
  const root = fixture(t), executable = path.join(root, 'fake-codex.cjs');
  fs.writeFileSync(executable, `#!/usr/bin/env node
const readline=require('node:readline');const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;
if(m.method==='initialize')send({id:m.id,result:{}});
if(m.method==='model/list')send({id:m.id,result:{data:[{model:'native-default',isDefault:true}]}});
if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'root'}}});
if(m.method==='turn/start') {send({id:m.id,result:{turn:{}}});
if(process.env.FAIL_ROOT){send({method:'turn/completed',params:{threadId:'root',turn:{status:'failed',error:{message:'model unavailable'}}}});return;}
send({method:'item/completed',params:{threadId:'root',item:{type:'subAgentActivity',kind:'started',agentThreadId:'child',agentPath:'/root/fixture'}}});
send({method:'item/completed',params:{threadId:'root',item:{type:'agentMessage',text:'{"agent":"opaque"}'}}});
send({method:'turn/completed',params:{threadId:'root',turn:{status:'completed'}}});}
if(m.method==='thread/resume'){if(m.params.threadId!=='child'||m.params.excludeTurns!==true)process.exit(3);
send({id:m.id,result:{thread:{id:'child',parentThreadId:'root',agentRole:'fixture',turns:[]}}});
send({method:'item/completed',params:{threadId:'child',item:{type:'agentMessage',text:'opaque'}}});
send({method:'turn/completed',params:{threadId:'child',turn:{status:'completed'}}});}
});`, {mode: 0o700});
  const options = {cwd: root, env: process.env, prompt: 'Fixture', agentName: 'fixture', marker: 'opaque', timeoutMs: 3000};
  const success = await runCodexAgentRpc(executable, options);
  assert.equal(success.success, true); assert.equal(success.childMarkerReturned, true); assert.equal(success.roleObserved, true);
  const failed = await runCodexAgentRpc(executable, {...options, env: {...process.env, FAIL_ROOT: '1'}});
  assert.equal(failed.reason, 'TURN_FAILED'); assert.equal(failed.success, false);
});

test('global multi-file fixture prunes only directories it created, preserving concurrent files', async t => {
  const root = fixture(t), bundle = path.join(root, 'fresh-skill'), ref = path.join(bundle, 'references/marker.txt');
  const operations = [path.join(bundle, 'SKILL.md'), ref].map(target => ({target, assetId: 'skill', operation: 'CREATE'}));
  const service = {plan: () => ({automatic: true, planId: 'create', operations}), planRemoval: () => ({automatic: true, planId: 'remove', operations}), apply: ({planId}) => {for (const op of operations) if (planId === 'create') {fs.mkdirSync(path.dirname(op.target), {recursive: true}); fs.writeFileSync(op.target, 'fixture');} else fs.unlinkSync(op.target);}};
  const run = action => withGlobalFixture({service, input: {}, assetIds: ['skill']}, async ({initialPlan, apply}) => {apply(initialPlan); action?.();});
  await run(); assert.equal(fs.existsSync(bundle), false);
  await run(() => fs.writeFileSync(path.join(bundle, 'user-note.txt'), 'keep'));
  assert.equal(fs.readFileSync(path.join(bundle, 'user-note.txt'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(ref), false);
});
