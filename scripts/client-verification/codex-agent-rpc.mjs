import {spawn} from 'node:child_process';
import path from 'node:path';
import {observeClientBinary} from '../../lib/infrastructure/client-binary-observer.js';

import {createRpcAgentObservation} from '../../lib/adapters/verification/codex-agent-observation.js';
export {createRpcAgentObservation} from '../../lib/adapters/verification/codex-agent-observation.js';

export async function runCodexAgentRpc(binary, {cwd, env, prompt, agentName, marker, timeoutMs = 120000, expectedBinarySha256}) {
  const observation = createRpcAgentObservation(agentName, marker);
  const fingerprint = () => path.isAbsolute(binary) ? observeClientBinary({id:'cli', detection:{commands:[path.basename(binary)]}}, {pathValue:path.dirname(binary)})?.sha256 : null;
  if (expectedBinarySha256 && fingerprint() !== expectedBinarySha256) return {...observation.facts, reason:'CLIENT_BINARY_CHANGED', binaryUnchanged:false, success:false};
  const child = spawn(binary, ['app-server', '-c', `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`, '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"'], {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe']});
  let nextId = 0, buffer = '', total = 0, reason = 'OK', end, childEnd;
  const childDone = new Promise(resolve => {childEnd = resolve;});
  const pending = new Map(), subscriptions = new Map();
  const done = new Promise(resolve => {end = resolve;});
  const stop = () => {if (child.pid) {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}};
  const fail = code => {reason = code; for (const {reject} of pending.values()) reject(Object.assign(new Error(code), {code})); pending.clear(); end(); childEnd();};
  const timer = setTimeout(() => {fail('PROBE_TIMEOUT'); stop();}, timeoutMs);
  child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
  child.on('error', () => fail('EXECUTABLE_UNAVAILABLE'));
  child.on('exit', () => {if (!observation.facts.terminalSuccess) fail('RPC_CLOSED'); else end();});
  const request = (method, params) => new Promise((resolve, reject) => {const id = ++nextId; pending.set(id, {resolve, reject, method}); child.stdin.write(`${JSON.stringify({id, method, params})}\n`);});
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
    total += Buffer.byteLength(chunk); if (total > 4 * 1024 * 1024) {fail('PROBE_OUTPUT_LIMIT'); stop(); return;}
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      // Only initialize/thread-start/turn-start replies have been requested; their turns are empty.
      if (!/"method"\s*:/.test(line)) {
        try {const message = JSON.parse(line), callback = pending.get(message.id); if (callback) {pending.delete(message.id); if (message.error) callback.reject(Object.assign(new Error('RPC rejected'), {code: 'RPC_REJECTED'})); else {if (callback.method === 'thread/resume') observation.accept(JSON.stringify({method: 'thread/started', params: {thread: message.result?.thread}})); callback.resolve(message.result);}}} catch {}
      } else {
        // Never approve server-initiated tool requests in this read-only fixture.
        const id = line.match(/^\s*\{\s*"id"\s*:\s*(\d+)/)?.[1];
        if (id) child.stdin.write(`${JSON.stringify({id: Number(id), error: {code: -32601, message: 'Fixture does not permit tool requests'}})}\n`);
        observation.accept(line);
        for (const id of observation.candidateIds()) if (!subscriptions.has(id)) {
          const subscription = request('thread/resume', {threadId: id, excludeTurns: true}).catch(async () => {
            const metadata = await request('thread/read', {threadId:id, includeTurns:false});
            observation.facts.childMetadataOnly = true;
            return metadata;
          }).then(resumed => {
            observation.accept(JSON.stringify({method: 'thread/started', params: {thread: resumed.thread}}));
            observation.facts.childMetadataRoleMatches = resumed.thread?.agentRole === agentName;
          }).catch(() => {observation.facts.subscriptionFailed = true;});
          subscriptions.set(id, subscription);
        }
        if (observation.facts.parentCompleted) end();
        if (observation.facts.childMarkerReturned) childEnd();
      }
    }
  });
  try {
    await request('initialize', {clientInfo: {name: 'agents_kit_verification', version: '1.0.0'}, capabilities: {experimentalApi: true}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const models = await request('model/list', {});
    const defaults = (models.data || []).filter(item => item.isDefault === true);
    if (defaults.length !== 1 || !defaults[0].model) throw Object.assign(new Error('Native default unavailable'), {code: 'DEFAULT_MODEL_UNAVAILABLE'});
    observation.facts.modelSelection = 'native-advertised-default';
    observation.facts.nativeDefaultModel = defaults[0].model;
    const started = await request('thread/start', {cwd, model: defaults[0].model, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only'});
    observation.setParent(started.thread.id);
    await request('turn/start', {threadId: started.thread.id, input: [{type: 'text', text: prompt}]});
    await done;
    await Promise.all(subscriptions.values());
    if (observation.facts.childMarkerReturned) childEnd();
    if (reason === 'OK' && observation.facts.terminalSuccess && marker !== 'ABSENT' && subscriptions.size === 1 && observation.facts.roleObserved && !observation.facts.childMetadataOnly) {
      await childDone;
    }

  } catch(error) {reason = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'RPC_REJECTED';}
  finally {clearTimeout(timer); stop(); buffer = '';}
  if (reason === 'OK' && observation.facts.parentCompleted && !observation.facts.terminalSuccess) reason = 'TURN_FAILED';
  const stable = !expectedBinarySha256 || fingerprint() === expectedBinarySha256;
  return {...observation.facts, reason: stable ? reason : 'CLIENT_BINARY_CHANGED', ...(expectedBinarySha256 ? {binaryUnchanged:stable} : {}), success: stable && reason === 'OK' && observation.facts.terminalSuccess};
}
