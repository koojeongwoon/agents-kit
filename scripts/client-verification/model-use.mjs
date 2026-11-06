import {spawn} from 'node:child_process';
import path from 'node:path';
import {observeClientBinary} from '../../lib/infrastructure/client-binary-observer.js';

import {createUseObservation} from '../../lib/adapters/verification/model-use-observation.js';
export {createUseObservation} from '../../lib/adapters/verification/model-use-observation.js';

export function authenticatedEnvironment(homeDir, scratch, inherited = process.env) {
  return {PATH: inherited.PATH || '', HOME: homeDir, CODEX_HOME: inherited.CODEX_HOME || `${homeDir}/.codex`, TMPDIR: scratch, LANG: 'en_US.UTF-8', NO_COLOR: '1'};
}

export function runModelUse(binary, args, {cwd, env, clientId, expected, timeoutMs = 90000, observation = createUseObservation(clientId, expected), streamInput, expectedBinarySha256}) {
  const fingerprint = () => path.isAbsolute(binary) ? observeClientBinary({id: 'cli', detection: {commands: [path.basename(binary)]}}, {pathValue: path.dirname(binary)})?.sha256 : null;
  const before = expectedBinarySha256 ? fingerprint() : undefined;
  if (expectedBinarySha256 && before !== expectedBinarySha256) return Promise.resolve({code: null, reason: 'CLIENT_BINARY_CHANGED', ...observation.facts, binaryUnchanged: false, success: false});
  return new Promise(resolve => {
    const child = spawn(binary, args, {cwd, env, detached: true, stdio: [streamInput ? 'pipe' : 'ignore', 'pipe', 'pipe']});
    let followupTimer, followups = 0;
    if (streamInput) {
      child.stdin.on('error', () => {}); // A CLI may reject the request before consuming stdin.
      child.stdin.write(`${JSON.stringify({event: 'user', message: {content: streamInput.initial}})}\n`);
    }
    let buffer = '', total = 0, reason = 'OK';
    const diagnostics = {projectConfigDisabled: false, mcpStartupFailed: false, permissionNotice: false, fixtureMcpPermissionNotice: false, mcpPermissionRequired: false};
    let diagnosticBuffer = '';
    child.stderr.on('data', data => {
      diagnosticBuffer = (diagnosticBuffer + data.toString()).slice(-8192);
      const text = diagnosticBuffer;
      if (/permission.*(?:required|denied|request)|approval.*(?:required|denied|request)/i.test(text)) {
        diagnostics.permissionNotice = true;
        if (/required the ["']mcp["'] permission/i.test(text) && /auto-denied|cannot prompt/i.test(text)) diagnostics.mcpPermissionRequired = true;
        if (/ca04[-_]marker/.test(text) && /read_marker/.test(text)) diagnostics.fixtureMcpPermissionNotice = true;
      }
      if (/project.*config.*disabled|config.*untrusted/i.test(text)) diagnostics.projectConfigDisabled = true;
      if (/mcp.*(?:failed|error)/i.test(text)) diagnostics.mcpStartupFailed = true;
    });
    const stop = () => {if (child.pid) {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}};
    const timer = setTimeout(() => {reason = 'PROBE_TIMEOUT'; stop();}, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      total += Buffer.byteLength(chunk);
      if (total > 4 * 1024 * 1024) {reason = 'PROBE_OUTPUT_LIMIT'; buffer = ''; stop(); return;}
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        try {observation.accept(line);} catch {reason='PROBE_OBSERVATION_FAILED';buffer='';stop();return;}
        buffer = buffer.slice(index + 1);
        if (streamInput && /^\s*\{\s*"event"\s*:\s*"result"/.test(line)) {
          clearTimeout(followupTimer);
          if (!observation.needsFollowup?.() || followups >= 2) child.stdin.end();
          else {
            followups++;
            followupTimer = setTimeout(() => {if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify({event: 'user', message: {content: streamInput.followup}})}\n`);}, 5000);
          }
        }
      }
    });
    child.once('error', () => {clearTimeout(timer); clearTimeout(followupTimer); resolve({code: null, reason: 'EXECUTABLE_UNAVAILABLE', ...observation.facts, success: false});});
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(followupTimer); stop(); buffer = '';
      const after = expectedBinarySha256 ? fingerprint() : undefined, stable = !expectedBinarySha256 || before === expectedBinarySha256 && after === expectedBinarySha256;
      resolve({code, reason: !stable ? 'CLIENT_BINARY_CHANGED' : reason !== 'OK' ? reason : code !== 0 ? 'CLI_REJECTED' : diagnostics.mcpPermissionRequired ? 'MCP_PERMISSION_REQUIRED' : 'OK', ...observation.facts, diagnostics,
        ...(expectedBinarySha256 ? {binaryUnchanged: stable, binarySha256Before: before, binarySha256After: after} : {}),
        success: stable && code === 0 && reason === 'OK' && !diagnostics.mcpPermissionRequired && observation.facts.terminalSuccess});
    });
  });
}
