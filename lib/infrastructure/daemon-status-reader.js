import {execFile} from 'node:child_process';
import path from 'node:path';

// Only operator-owned process configuration selects the native peer-verifying adapter.
// Never accept a command, socket, UID or environment from an HTTP request or Manifest.
export function createDaemonStatusReader({
  binary = process.env.AGENTS_KIT_DAEMON_BINARY,
  socket = process.env.AGENTS_KIT_DAEMON_SOCKET,
  uid = process.env.AGENTS_KIT_DAEMON_UID,
  run = execFile
} = {}) {
  return () => new Promise(resolve => {
    const fail = code => resolve({code});
    if (!binary && !socket && !uid) return fail('DAEMON_NOT_CONFIGURED');
    if (!binary || !socket || !path.isAbsolute(binary) || !path.isAbsolute(socket)
      || (uid !== undefined && (!/^[1-9][0-9]*$/.test(String(uid)) || Number(uid) >= 4294967295))) {
      return fail('DAEMON_CONFIGURATION_INVALID');
    }
    const args = ['worker-status', socket];
    if (uid !== undefined) args.push('--daemon-uid', String(uid));
    run(binary, args, {timeout: 4000, killSignal: 'SIGKILL', maxBuffer: 65536, encoding: 'utf8', shell: false}, (error, stdout) => {
      if (error) {
        return fail(error.killed ? 'DAEMON_TIMEOUT'
          : error.code === 'ENOENT' ? 'DAEMON_BINARY_UNAVAILABLE'
            : error.code === 'EACCES' || error.code === 'EPERM' ? 'DAEMON_PERMISSION_DENIED'
              : 'DAEMON_ADAPTER_FAILED');
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        fail('DAEMON_INVALID_RESPONSE');
      }
    });
  });
}
