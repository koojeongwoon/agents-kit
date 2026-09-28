import {apiFetch} from './client';
import {ApiRequestError} from './deploy';

export interface DaemonStatus {
  schemaVersion: 1;
  checkedAt: number;
  staleAfterMs: number;
  connection: 'connected' | 'not_configured' | 'unavailable' | 'permission_denied' | 'untrusted' | 'timeout' | 'incompatible';
  code: string;
  message: string;
  snapshot: null | {
    schemaVersion: 1;
    daemonVersion: string;
    scope: string;
    observedAt: number;
    capabilities: string[];
    policy: {state: 'valid' | 'expired' | 'unverified'; revision: number | null; expiresAt: number | null};
    execution: {state: 'preflight_passed' | 'blocked' | 'unverified'; reason: string};
    recentEvents: Array<{sequence: number; kind: 'intent' | 'completed' | 'denied' | 'failed' | 'interrupted'; observedAt: number; policyRevision: number | null}>;
  };
}

export async function fetchDaemonStatus(): Promise<DaemonStatus> {
  const response = await apiFetch('/api/daemon/status', {method: 'POST', signal: AbortSignal.timeout(8000)});
  const data = await response.json();
  if (!response.ok) throw new ApiRequestError(response, data);
  if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.checkedAt)
    || data.staleAfterMs !== 10000 || typeof data.connection !== 'string'
    || (data.connection === 'connected' && !data.snapshot)) throw new Error('DAEMON_INVALID_RESPONSE');
  return data;
}
