import {spawn} from 'node:child_process';
import path from 'node:path';
import {observeClientBinary} from '../../lib/infrastructure/client-binary-observer.js';
import {createAcpChildObservation} from '../../lib/adapters/verification/antigravity-child-acp.js';

// Loads only a child identified by the current fixture's public invocation metadata.
// Never sends session/prompt, reads native history files or approves server requests.
export async function inspectAntigravityChildAcp(binary, {childId, marker, cwd, env, expectedBinarySha256, timeoutMs = 20000}) {
  const observation = createAcpChildObservation(childId, marker);
  const fingerprint = () => observeClientBinary({id: 'cli', detection: {commands: [path.basename(binary)]}}, {pathValue: path.dirname(binary)})?.sha256;
  const before = fingerprint();
  if (!childId || !marker || !expectedBinarySha256 || before !== expectedBinarySha256) return {...observation.facts, reason: 'CLIENT_BINARY_CHANGED', binaryUnchanged: false, modelTurnsRequested: 0};
  const child = spawn(binary, ['acp', '--sandbox', '--include-default-customizations=false', '--log-file', '/dev/null', '--disable-telemetry'],
    {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe']});
  let nextId = 0, buffer = '', bytes = 0, reason = 'OK', closed = false, serverRequestsDeclined = 0;
  const pending = new Map();
  const stop = () => {if (child.pid) {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}};
  const fail = code => {reason = code; closed = true; for (const item of pending.values()) item.reject(Object.assign(new Error(code), {code})); pending.clear();};
  const timer = setTimeout(() => {fail('ACP_TIMEOUT'); stop();}, timeoutMs);
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) return reject(Object.assign(new Error('ACP_CLOSED'), {code: 'ACP_CLOSED'}));
    const id = ++nextId; pending.set(id, {resolve, reject}); child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  });
  child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
  child.on('error', () => fail('ACP_UNAVAILABLE')); child.on('close', () => fail('ACP_CLOSED'));
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
    bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) {fail('ACP_OUTPUT_LIMIT'); stop(); return;}
    buffer += chunk; let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (/"method"\s*:\s*"session\/update"/.test(line)) {observation.accept(line); continue;}
      if (!/"id"\s*:\s*\d+/.test(line)) continue;
      let message; try {message = JSON.parse(line);} catch {continue;}
      if (message.method) {
        serverRequestsDeclined++;
        child.stdin.write(JSON.stringify({jsonrpc: '2.0', id: message.id, ...(message.method === 'session/request_permission'
          ? {result: {outcome: {outcome: 'cancelled'}}} : {error: {code: -32601, message: 'Inspection permits no client operations'}})}) + '\n');
      } else {
        const callback = pending.get(message.id); if (!callback) continue; pending.delete(message.id);
        if (message.error) callback.reject(Object.assign(new Error('ACP rejected'), {code: message.error.code === -32000 ? 'ACP_AUTH_REQUIRED' : 'ACP_REJECTED'}));
        else callback.resolve(message.result);
      }
    }
  });
  let loadSessionAdvertised = false, loadedSessionClosed = false;
  try {
    const initialized = await request('initialize', {protocolVersion: 1, clientInfo: {name: 'agents-kit-child-inspection', version: '1.0.0'}, clientCapabilities: {}});
    loadSessionAdvertised = initialized.protocolVersion === 1 && initialized.agentCapabilities?.loadSession === true;
    if (!loadSessionAdvertised) reason = 'ACP_LOAD_UNSUPPORTED';
    else {
      await request('session/load', {sessionId: childId, cwd, mcpServers: []}); observation.finishReplay();
      if (initialized.agentCapabilities.sessionCapabilities?.close != null) {await request('session/close', {sessionId: childId}); loadedSessionClosed = true;}
    }
  } catch (error) {reason = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'ACP_REJECTED';}
  finally {clearTimeout(timer); stop(); buffer = '';}
  const stable = fingerprint() === before;
  return {...observation.facts, reason: stable ? reason : 'CLIENT_BINARY_CHANGED', binaryUnchanged: stable,
    loadSessionAdvertised, loadedSessionClosed, serverRequestsDeclined, modelTurnsRequested: 0, rawTranscriptsStored: false};
}
