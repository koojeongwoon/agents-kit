import {afterEach, expect, it, vi} from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it('authenticates the read-only query and never submits a socket or executable', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).endsWith('/api/session') ? {token: 'local-test-token'}
      : {schemaVersion: 1, checkedAt: Date.now(), staleAfterMs: 10000, connection: 'not_configured',
        code: 'DAEMON_NOT_CONFIGURED', message: '', snapshot: null}
  ), {headers: {'Content-Type': 'application/json'}}));
  const {fetchDaemonStatus} = await import('./daemon');
  const result = await fetchDaemonStatus();
  expect(result.connection).toBe('not_configured');
  const request = fetch.mock.calls.find(([input]) => String(input).endsWith('/api/daemon/status'))!;
  expect(request[1]?.method).toBe('POST');
  expect(request[1]?.body).toBeUndefined();
  expect(new Headers(request[1]?.headers).get('X-Agents-Kit-Token')).toBe('local-test-token');
  expect(request[1]?.signal).toBeDefined();
});

it('rejects an incompatible response instead of rendering a connected badge', async () => {
  vi.spyOn(window, 'fetch').mockImplementation(async input => new Response(JSON.stringify(
    String(input).endsWith('/api/session') ? {token: 'local-test-token'} : {schemaVersion: 0, connection: 'connected'}
  )));
  const {fetchDaemonStatus} = await import('./daemon');
  await expect(fetchDaemonStatus()).rejects.toThrow('DAEMON_INVALID_RESPONSE');
});
