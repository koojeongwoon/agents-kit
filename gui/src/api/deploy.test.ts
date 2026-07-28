import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchClients, fetchLocalDiscovery} from './deploy';

describe('deployment API errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves stable server metadata for actionable error UI', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: '프로젝트 경로가 필요합니다.',
      code: 'PROJECT_PATH_REQUIRED',
      requestId: 'request-123',
      remediation: '프로젝트 폴더를 선택하세요.'
    }), {
      status: 400,
      headers: {'Content-Type': 'application/json'}
    }));

    const error = await fetchClients().catch(caught => caught);

    expect(error).toMatchObject({
      name: 'ApiRequestError',
      message: '프로젝트 경로가 필요합니다.',
      code: 'PROJECT_PATH_REQUIRED',
      requestId: 'request-123',
      remediation: '프로젝트 폴더를 선택하세요.',
      status: 400
    });
  });

  it('loads sanitized local discovery through the read-only endpoint', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      clients: [{
        id: 'codex',
        displayName: 'Codex',
        supported: true,
        installed: true,
        configured: true,
        signals: {commands: ['codex'], userRootExists: true},
        assets: [],
        issues: []
      }]
    }), {
      status: 200,
      headers: {'Content-Type': 'application/json'}
    }));

    const result = await fetchLocalDiscovery();

    expect(result.clients[0]).toMatchObject({
      id: 'codex',
      installed: true,
      configured: true
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/local-discovery', {});
  });
});
