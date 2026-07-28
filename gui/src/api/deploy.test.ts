import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchClients} from './deploy';

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
});
