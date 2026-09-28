import {spawn} from 'node:child_process';
import readline from 'node:readline';

export function isolatedEnvironment(homeDir, scratch, pathValue = process.env.PATH) {
  return {PATH: pathValue || '', HOME: homeDir, CODEX_HOME: `${homeDir}/.codex`,
    XDG_CONFIG_HOME: `${homeDir}/.config`, XDG_CACHE_HOME: `${homeDir}/.cache`,
    TMPDIR: scratch, LANG: 'en_US.UTF-8', NO_COLOR: '1'};
}

function stop(child) {
  if (!child.pid) return;
  // Each probe owns a fresh process group, including any local helper it starts.
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
}

export function runCommand(binary, args, {cwd, env, timeoutMs = 15000}) {
  return new Promise(resolve => {
    const child = spawn(binary, args, {cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', timedOut = false, overflow = false;
    const timer = setTimeout(() => {timedOut = true; stop(child);}, timeoutMs);
    const capture = (key, data) => {
      if (stdout.length + stderr.length + data.length > 1024 * 1024) {overflow = true; stop(child); return;}
      if (key === 'stdout') stdout += data; else stderr += data;
    };
    child.stdout.on('data', data => capture('stdout', data)); child.stderr.on('data', data => capture('stderr', data));
    child.once('error', () => {clearTimeout(timer); resolve({code: null, reason: 'EXECUTABLE_UNAVAILABLE', stdout: '', stderr: ''});});
    child.once('close', code => {clearTimeout(timer); stop(child); resolve({code, reason: timedOut ? 'PROBE_TIMEOUT' : overflow ? 'PROBE_OUTPUT_LIMIT' : code ? 'CLI_REJECTED' : 'OK', stdout, stderr});});
  });
}

export async function withCodexRpc(binary, options, action) {
  const child = spawn(binary, ['app-server'], {...options, detached: true, stdio: ['pipe', 'pipe', 'pipe']});
  const pending = new Map(); let nextId = 0;
  child.stderr.on('data', () => {}); // Never persist startup logs or event streams.
  child.stdin.on('error', () => {});
  const failAll = () => {for (const callback of pending.values()) callback({error: {code: 'RPC_CLOSED'}}); pending.clear();};
  child.on('error', failAll); child.on('exit', failAll);
  const lines = readline.createInterface({input: child.stdout});
  lines.on('line', line => {
    if (line.length > 1024 * 1024) {stop(child); failAll(); return;}
    try { const message = JSON.parse(line); const callback = pending.get(message.id); if (callback) {pending.delete(message.id); callback(message);} }
    catch { /* Non-protocol output is never treated as evidence. */ }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {pending.delete(id); reject(Object.assign(new Error('RPC timeout'), {code: 'PROBE_TIMEOUT'}));}, options.timeoutMs || 15000);
    pending.set(id, message => {clearTimeout(timer); if (message.error) reject(Object.assign(new Error('RPC rejected'), {code: 'RPC_REJECTED'})); else resolve(message.result);});
    child.stdin.write(`${JSON.stringify({id, method, params})}\n`);
  });
  try {
    await request('initialize', {clientInfo: {name: 'agents_kit_verification', version: '1.0.0'}, capabilities: {experimentalApi: true}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    return await action(request);
  } finally {stop(child); lines.close(); failAll();}
}
