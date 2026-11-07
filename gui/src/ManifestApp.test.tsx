import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManifestApp from './ManifestApp';

function clientCatalogResponse() {
  return new Response(JSON.stringify({
    success: true,
    clients: [
      {
        id: 'codex',
        displayName: 'Codex',
        detection: {commands: ['codex'], userRoot: '~/.codex'},
        capabilities: [{assetKind: 'mcp', scope: 'global', status: 'stable'}]
      },
      {
        id: 'antigravity',
        displayName: 'Antigravity',
        detection: {commands: ['agy'], userRoot: '~/.gemini/antigravity-cli'},
        capabilities: [{assetKind: 'skills', scope: 'global', status: 'stable'}]
      }
    ]
  }), {
    status: 200,
    headers: {'Content-Type': 'application/json'}
  });
}

function localDiscoveryResponse() {
  return new Response(JSON.stringify({
    success: true,
    clients: [
      {
        id: 'codex',
        displayName: 'Codex',
        supported: true,
        installed: true,
        configured: true,
        signals: {commands: ['codex'], userRootExists: true},
        assets: [],
        issues: []
      },
      {
        id: 'antigravity',
        displayName: 'Antigravity',
        supported: true,
        installed: false,
        configured: false,
        signals: {commands: [], userRootExists: false},
        assets: [],
        issues: []
      }
    ]
  }), {
    status: 200,
    headers: {'Content-Type': 'application/json'}
  });
}

function mockControlCenterApis() {
  return vi.spyOn(window, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/api/local-discovery')) return localDiscoveryResponse();
    return clientCatalogResponse();
  });
}

describe('Agent Kit control center shell', () => {
  it('clears an entered version when changing deployment clients',async()=>{
    mockControlCenterApis();const user=userEvent.setup();render(<ManifestApp/>);
    await screen.findByText('Codex · 설치 흔적 있음');await user.click(screen.getByRole('button',{name:'클라이언트 배포'}));
    await user.type(screen.getByPlaceholderText('예: 1.0.0'),'1.2.3');
    await user.click(within(screen.getByLabelText('배포할 클라이언트')).getByRole('button',{name:/Antigravity/}));
    expect(screen.getByPlaceholderText('예: 1.0.0')).toHaveValue('');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('an older dependent inspection cannot replace a newer installation inspection',async()=>{
    let resolveDependents!:(value:Response)=>void,resolveInstallation!:(value:Response)=>void;
    const dependentReply=new Promise<Response>(resolve=>{resolveDependents=resolve;}),installationReply=new Promise<Response>(resolve=>{resolveInstallation=resolve;});
    const base={schemaVersion:1,readOnly:true,registry:[{id:'review',kind:'skills',displayName:'Initial Review',scope:{type:'global'},providedTools:[],requiredTools:[],references:[],catalogId:'global-review',origin:{scope:'global',scopeRoot:'/kit/global',targetRoot:'/home'}}],
      clients:[],observations:[],duplicates:[],effective:[],issues:[],scopes:[],coverage:{complete:false},dependencyGraph:{schemaVersion:1,readOnly:true,valid:true,deploymentReady:false,installationState:'unverified',issues:[],nodes:[],edges:[],toolBindings:[],localAssetKeys:[],globalPrerequisites:[]}};
    vi.spyOn(window,'fetch').mockImplementation(async(input)=>{
      const url=String(input);if(url.includes('/api/local-discovery'))return localDiscoveryResponse();if(url.includes('/api/session'))return new Response(JSON.stringify({token:'a'.repeat(64)}));
      if(url.includes('dependents=true'))return dependentReply;if(url.includes('installations=true'))return installationReply;
      if(url.includes('/api/manifest/registry'))return new Response(JSON.stringify(base));return clientCatalogResponse();
    });
    const user=userEvent.setup();render(<ManifestApp/>);await user.click(screen.getByRole('tab',{name:'Skill'}));await screen.findByRole('article',{name:'Initial Review 리소스'});
    await user.click(screen.getByRole('button',{name:'등록된 의존 프로젝트 확인'}));await user.click(screen.getByRole('button',{name:'Codex CLI 설치 소유 정보 확인'}));
    await act(async()=>resolveInstallation(new Response(JSON.stringify({...base,registry:[{...base.registry[0],displayName:'Latest Installation'}]}))));await screen.findByRole('article',{name:'Latest Installation 리소스'});
    await act(async()=>resolveDependents(new Response(JSON.stringify({...base,registry:[{...base.registry[0],displayName:'Stale Dependents'}]}))));expect(screen.queryByText('Stale Dependents')).not.toBeInTheDocument();expect(screen.getByRole('article',{name:'Latest Installation 리소스'})).toBeInTheDocument();
  });

  it('a slower installation inspection cannot overwrite a newer native observation for the same context',async()=>{
    let resolveInstallation!:(value:Response)=>void,resolveNative!:(value:Response)=>void;
    const installationReply=new Promise<Response>(resolve=>{resolveInstallation=resolve;}),nativeReply=new Promise<Response>(resolve=>{resolveNative=resolve;});
    const base={schemaVersion:1,readOnly:true,registry:[{id:'review',kind:'skills',displayName:'Initial Review',scope:{type:'global'},providedTools:[],requiredTools:[],references:[],catalogId:'global-review',origin:{scope:'global',scopeRoot:'/kit/global',targetRoot:'/home'}}],
      clients:[],observations:[],duplicates:[],effective:[],issues:[],scopes:[],coverage:{complete:false},dependencyGraph:{schemaVersion:1,readOnly:true,valid:true,deploymentReady:false,installationState:'unverified',issues:[],nodes:[],edges:[],toolBindings:[],localAssetKeys:[],globalPrerequisites:[]}};
    let installationUrl='';vi.spyOn(window,'fetch').mockImplementation(async(input)=>{
      const url=String(input);if(url.includes('/api/local-discovery'))return localDiscoveryResponse();
      if(url.includes('/api/session'))return new Response(JSON.stringify({token:'a'.repeat(64)}));
      if(url.includes('/api/manifest/registry')&&url.includes('installations=true')){installationUrl=url;return installationReply;}
      if(url.includes('/api/manifest/registry'))return new Response(JSON.stringify(base));
      if(url.includes('/api/manifest/inventory/observe'))return nativeReply;return clientCatalogResponse();
    });
    const user=userEvent.setup();render(<ManifestApp/>);await user.click(screen.getByRole('tab',{name:'Skill'}));await screen.findByRole('article',{name:'Initial Review 리소스'});
    await user.click(screen.getByRole('button',{name:'Codex CLI 설치 소유 정보 확인'}));expect(installationUrl).toContain('includeOtherClients=true');
    await user.click(screen.getByRole('button',{name:'Codex CLI 상태 확인'}));
    await act(async()=>resolveNative(new Response(JSON.stringify({...base,registry:[{...base.registry[0],displayName:'Latest Native'}]}))));
    await screen.findByRole('article',{name:'Latest Native 리소스'});
    await act(async()=>resolveInstallation(new Response(JSON.stringify({...base,registry:[{...base.registry[0],displayName:'Stale Installation'}]}))));
    expect(screen.getByRole('article',{name:'Latest Native 리소스'})).toBeInTheDocument();expect(screen.queryByText('Stale Installation')).not.toBeInTheDocument();
  });

  it('requests native inventory explicitly and discards a response for an older project selection',async()=>{
    let resolveNative!: (value:Response)=>void;
    const nativeReply=new Promise<Response>(resolve=>{resolveNative=resolve;});
    const base={schemaVersion:1,readOnly:true,registry:[{id:'review',kind:'skills',displayName:'Current Review',scope:{type:'global'},providedTools:[],requiredTools:[],references:[],catalogId:'global-review',origin:{scope:'global',scopeRoot:'/kit/global',targetRoot:'/home'}}],
      clients:[],observations:[],duplicates:[],effective:[],issues:[],scopes:[],coverage:{complete:false}};
    let body:Record<string,unknown>|undefined;
    vi.spyOn(window,'fetch').mockImplementation(async(input,init)=>{
      const url=String(input);
      if(url.includes('/api/local-discovery'))return localDiscoveryResponse();
      if(url.includes('/api/session'))return new Response(JSON.stringify({token:'a'.repeat(64)}));
      if(url.includes('/api/manifest/registry'))return new Response(JSON.stringify(base));
      if(url.includes('/api/manifest/inventory/observe')){body=JSON.parse(String(init?.body));return nativeReply;}
      return clientCatalogResponse();
    });
    const user=userEvent.setup();render(<ManifestApp/>);await user.click(screen.getByRole('tab',{name:'Skill'}));
    await screen.findByRole('article',{name:'Current Review 리소스'});expect(body).toBeUndefined();
    await user.click(screen.getByRole('button',{name:'Codex CLI 상태 확인'}));
    expect(body).toEqual({clientId:'codex',surface:'cli',projectName:'default',projectPath:'',includeOtherClients:true,kind:'skills'});
    await user.type(screen.getByPlaceholderText('관리할 프로젝트 경로를 입력하세요'),'/other-project');await user.click(screen.getByRole('button',{name:'프로젝트 선택'}));
    await act(async()=>{resolveNative(new Response(JSON.stringify({...base,registry:[{...base.registry[0],displayName:'STALE RESPONSE'}]})));});
    expect(await screen.findByRole('article',{name:'Current Review 리소스'})).toBeInTheDocument();expect(screen.queryByText('STALE RESPONSE')).not.toBeInTheDocument();
  });

  it('browses global resources before a project is selected and opens their own scope', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/api/local-discovery')) return localDiscoveryResponse();
      if (String(input).includes('/api/manifest/dependencies')) return new Response(JSON.stringify({nodes: [], links: []}));
      if (String(input).includes('/api/manifest/registry')) return new Response(JSON.stringify({schemaVersion: 1, readOnly: true,
        registry: [{id: 'review', kind: 'skills', displayName: 'Global Review', scope: {type: 'global'}, providedTools: [], requiredTools: [], references: [], catalogId: 'global-review', origin: {scope: 'global', scopeRoot: '/kit/global', targetRoot: '/home'}}],
        clients: [], observations: [], duplicates: [], effective: [], issues: [], coverage: {complete: false},
        scopes: [{scope: 'global', scopeRoot: '/kit/global', targetRoot: '/home', status: 'ready'}, {scope: 'project', scopeRoot: '/kit/projects/default', targetRoot: null, status: 'unselected'}]}));
      if (String(input).includes('/api/manifest/resources/')) return new Response(JSON.stringify({asset: {id: 'review', kind: 'skills', scope: {type: 'global'}}}));
      return clientCatalogResponse();
    });
    const user = userEvent.setup(); render(<ManifestApp />);
    await user.click(screen.getByRole('tab', {name: 'Skill'}));
    const row = await screen.findByRole('article', {name: 'Global Review 리소스'});
    expect(screen.getByText(/프로젝트 미선택/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', {name: '편집'}));
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('global');
  });

  it('uses semantic MCP, Skill, Agent, and Harness navigation', async () => {
    mockControlCenterApis();
    const user = userEvent.setup();

    render(<ManifestApp />);

    const navigation = screen.getByRole('navigation', {name: '주요 자산'});
    expect(within(navigation).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Skill',
      'MCP',
      'Agent',
      '지침',
      'Harness'
    ]);

    await user.click(within(navigation).getByRole('tab', {name: 'Skill'}));
    expect(screen.getByRole('heading', {name: 'Skill 라이브러리'})).toBeInTheDocument();
  });

  it('shows every data-driven client instead of a hard-coded client pair', async () => {
    mockControlCenterApis();

    render(<ManifestApp />);

    const environments = await screen.findByLabelText('지원 환경');
    expect(await within(environments).findByText('Codex · 설치 흔적 있음')).toBeInTheDocument();
    expect(await within(environments).findByText('Antigravity · 설치 흔적 미확인')).toBeInTheDocument();
  });

  it('distinguishes installed clients from clients that are only supported', async () => {
    const fetchSpy = mockControlCenterApis();

    render(<ManifestApp />);

    const environments = await screen.findByLabelText('지원 환경');
    expect(await within(environments).findByText('Codex · 설치 흔적 있음')).toBeInTheDocument();
    expect(await within(environments).findByText('Antigravity · 설치 흔적 미확인')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([input]) => (
      String(input).includes('/api/local-discovery')
    ))).toHaveLength(1);
  });

  it('keeps deployment target controls in the shared context instead of duplicating them', async () => {
    mockControlCenterApis();
    const user = userEvent.setup();
    render(<ManifestApp />);

    await user.click(screen.getByRole('button', {name: '클라이언트 배포'}));

    expect(within(screen.getByLabelText('배포할 클라이언트')).getByRole('button',{name:/Codex/})).toHaveAttribute('aria-pressed','true');
    expect(screen.queryByRole('combobox', {name: 'Client'})).not.toBeInTheDocument();
    expect(screen.getByText(/프로젝트 Kit · default/)).toBeInTheDocument();
  });

  it('shows existing external resources and explicit init guidance when no Kit exists', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/api/local-discovery')) return new Response(JSON.stringify({clients: [{
        id: 'codex', displayName: 'Codex', installed: true, configured: true, supported: false,
        signals: {commands: ['codex'], userRootExists: true}, issues: [], assets: [{
          id: 'ego-browser', kind: 'skills', clientId: 'codex', sourcePath: '~/.agents/skills',
          managementMode: 'external', entryType: 'symlink', linkTarget: '~/.local/share/ego/ego-skills',
          linkState: 'resolved', externalManager: {id: 'ego', displayName: 'Ego Lite'}
        }]
      }]}), {status: 200});
      if (String(input).includes('/api/manifest/registry')) return new Response(JSON.stringify({
        error: 'Manifest required', code: 'MANIFEST_REQUIRED'
      }), {status: 400});
      return clientCatalogResponse();
    });
    const user = userEvent.setup();
    render(<ManifestApp />);
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'global');
    await user.click(screen.getByRole('tab', {name: 'Skill'}));
    expect(await screen.findByRole('article', {name: 'ego-browser 리소스'})).toBeInTheDocument();
    expect(await screen.findByText(/Kit 관리는 agents-kit init/)).toBeInTheDocument();
    expect(screen.getByText('외부 관리')).toBeInTheDocument();
  });
});
