import {createDaemonStatusReader} from '../infrastructure/daemon-status-reader.js';

const failures = {
  DAEMON_NOT_CONFIGURED: ['not_configured', '로컬 자원 관리는 그대로 사용할 수 있습니다. 데몬 설치 후 조회 연결을 구성하세요.'],
  DAEMON_CONFIGURATION_INVALID: ['unavailable', '데몬 실행 파일·소켓의 절대 경로와 UID 설정을 확인하세요.'],
  DAEMON_BINARY_UNAVAILABLE: ['unavailable', '설정된 데몬 실행 파일을 확인하세요.'],
  DAEMON_UNAVAILABLE: ['unavailable', '데몬 실행 상태와 소켓 설정을 확인한 뒤 다시 조회하세요.'],
  DAEMON_PERMISSION_DENIED: ['permission_denied', '설치된 데몬의 조회 권한을 확인하세요.'],
  DAEMON_PEER_REJECTED: ['untrusted', '기대 UID와 데몬·조회 어댑터의 빌드가 일치하는지 확인하세요.'],
  DAEMON_TIMEOUT: ['timeout', '데몬이 작업 중이거나 응답하지 않습니다. 잠시 후 다시 조회하세요.'],
  DAEMON_INCOMPATIBLE: ['incompatible', '상태 조회 v1을 지원하는 데몬과 어댑터로 함께 업데이트하세요.'],
  DAEMON_ADAPTER_FAILED: ['unavailable', '데몬 어댑터 버전과 실행 설정을 확인하세요.'],
  DAEMON_INVALID_RESPONSE: ['unavailable', '유효한 상태를 받지 못했습니다. 데몬 버전과 연결을 확인하세요.']
};
const capabilities = new Set(['status.read.v1', 'signed_policy.v3_v4', 'native_worker.experimental']);
const reasons = new Set(['CALL_RECHECK_REQUIRED', 'POLICY_EXPIRED', 'POLICY_NOT_YET_VALID',
  'TOOLS_NOT_APPROVED', 'POLICY_ACCEPTANCE_REQUIRED', 'POLICY_UNAVAILABLE', 'PREFLIGHT_REJECTED']);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const revision = value => value === null || (integer(value) && value > 0);

function projectStatus(status, now) {
  if (!status || status.schemaVersion !== 1 || status.scope !== 'native_mcp_worker'
    || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(status.daemonVersion)
    || status.daemonVersion.length > 64 || !integer(status.observedAt)
    || status.observedAt > now + 5000 || now - status.observedAt > 10000
    || !Array.isArray(status.capabilities) || status.capabilities.length > 16
    || !status.capabilities.includes('status.read.v1')
    || status.capabilities.some(item => !capabilities.has(item))) throw new Error('invalid status');
  const {policy, execution} = status;
  if (!policy || !['valid', 'expired', 'unverified'].includes(policy.state)
    || !revision(policy.revision) || !(policy.expiresAt === null || integer(policy.expiresAt))
    || !execution || !['preflight_passed', 'blocked', 'unverified'].includes(execution.state)
    || !reasons.has(execution.reason)
    || (execution.state === 'preflight_passed' && (policy.state !== 'valid'
      || policy.revision === null || policy.expiresAt === null || execution.reason !== 'CALL_RECHECK_REQUIRED'))
    || !Array.isArray(status.recentEvents) || status.recentEvents.length > 20) throw new Error('invalid status');
  const recentEvents = status.recentEvents.map(event => {
    if (!event || !integer(event.sequence) || event.sequence === 0 || !integer(event.observedAt)
      || !revision(event.policyRevision)
      || !['denied', 'intent', 'completed', 'failed', 'interrupted'].includes(event.kind)) throw new Error('invalid event');
    return {sequence: event.sequence, kind: event.kind, observedAt: event.observedAt, policyRevision: event.policyRevision};
  });
  const expired = policy.expiresAt !== null && policy.expiresAt <= now;
  // Explicit allowlist: no policy text, paths, arbitrary error strings, arguments or output.
  return {
    schemaVersion: 1, daemonVersion: status.daemonVersion, scope: status.scope,
    observedAt: status.observedAt, capabilities: [...status.capabilities],
    policy: {state: expired ? 'expired' : policy.state, revision: policy.revision, expiresAt: policy.expiresAt},
    execution: expired ? {state: 'blocked', reason: 'POLICY_EXPIRED'} : {state: execution.state, reason: execution.reason},
    recentEvents
  };
}

export function createLocalDaemonStatusService({read = createDaemonStatusReader(), now = Date.now} = {}) {
  let pending;
  return {
    // Coalesce simultaneous GUI requests, but never reuse the last successful snapshot.
    status() {
      if (pending) return pending;
      pending = (async () => {
        let result;
        try { result = await read(); } catch { result = {code: 'DAEMON_ADAPTER_FAILED'}; }
        const checkedAt = now();
        const base = {schemaVersion: 1, checkedAt, staleAfterMs: 10000};
        if (result?.connection === 'connected') {
          if (result.schemaVersion !== 1 || result.status?.schemaVersion !== 1) {
            result = {code: 'DAEMON_INCOMPATIBLE'};
          } else {
            try {
              return {...base, connection: 'connected', code: 'DAEMON_CONNECTED', message: '', snapshot: projectStatus(result.status, checkedAt)};
            } catch { result = {code: 'DAEMON_INVALID_RESPONSE'}; }
          }
        }
        const code = Object.hasOwn(failures, result?.code || '') ? result.code : 'DAEMON_INVALID_RESPONSE';
        const [connection, message] = failures[code];
        return {...base, connection, code, message, snapshot: null};
      })().finally(() => { pending = null; });
      return pending;
    }
  };
}
