import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchClients, fetchLocalDiscovery,fetchCatalogDependents,observeManifestPrerequisites} from './deploy';

describe('deployment API errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests dependent inspection explicitly and preserves a selected installation inspection',async()=>{
    const fetch=vi.spyOn(window,'fetch').mockResolvedValue(new Response(JSON.stringify({success:true})));
    await fetchCatalogDependents({clientId:'codex',surface:'cli',projectPath:'/work/current',includeInstallations:true});
    const url=String(fetch.mock.calls[0][0]),query=new URL(url,'http://localhost').searchParams;
    expect(query.get('dependents')).toBe('true');expect(query.get('installations')).toBe('true');expect(query.get('includeOtherClients')).toBe('true');expect(query.get('clientId')).toBe('codex');expect(query.get('projectPath')).toBe('/work/current');
  });

  it('requests selected prerequisite discovery only with the explicit provider choice',async()=>{
    const fetch=vi.spyOn(window,'fetch').mockImplementation(async()=>new Response(JSON.stringify({success:true,planId:'reviewed',token:'fixture-session'})));
    await observeManifestPrerequisites({planId:'reviewed',observeProviders:true});
    const call=fetch.mock.calls.find(([url])=>url==='/api/deployment/prerequisites/observe');expect(call).toBeDefined();expect(JSON.parse(String(call?.[1]?.body))).toEqual({planId:'reviewed',observeProviders:true});
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
