import {afterEach, describe, expect, it, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ResourceWorkspace} from './ResourceWorkspace';
import type {ClientSummary, LocalClientDiscovery, RegistryResource, ResourceCatalog} from '../../api/deploy';

const clients: ClientSummary[] = [{
  id: 'codex',
  displayName: 'Codex',
  detection: {commands: ['codex'], userRoot: '~/.codex'},
  capabilities: [{assetKind: 'mcp', scope: 'global', status: 'stable'}]
}];

const resources: RegistryResource[] = [
  {
    id: 'github-mcp',
    kind: 'mcpServers',
    displayName: 'GitHub MCP',
    scope: {type: 'global'},
    providedTools: ['github.search-commits'],
    requiredTools: [],
    references: []
  },
  {
    id: 'logs-mcp',
    kind: 'mcpServers',
    displayName: 'Observability',
    scope: {type: 'global'},
    providedTools: ['logs.query'],
    requiredTools: [],
    references: []
  }
];

afterEach(() => vi.restoreAllMocks());

it('installation inspection remains an explicit read and shows owned revisions without claiming native fulfillment',async()=>{
  const user=userEvent.setup(),onInspectInstallations=vi.fn().mockResolvedValue(undefined);
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[],observations:[],scopes:[],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'DECLARATIONS_ONLY',runtimeState:'unverified'},
    dependencyGraph:{schemaVersion:1,readOnly:true,valid:true,deploymentReady:false,installationState:'unverified',issues:[],nodes:[],edges:[],toolBindings:[],localAssetKeys:[],globalPrerequisites:[]},
    installationPrerequisites:{schemaVersion:1,readOnly:true,target:{clientId:'codex',surface:'cli',configStore:'codex'},consistency:'observed',fulfilled:false,checks:[{nodeKey:'global-review',assetId:'review',assetKind:'skills',status:'ownership-observed',reason:'NATIVE_UNVERIFIED',revisionDigest:'a'.repeat(64),discoveryState:'unverified',bindingState:'unverified',fulfilled:false}]}};
  render(<ResourceWorkspace view="agents" clients={clients} localDiscovery={[]} resources={[]} catalog={catalog} targetReady loading={false} error="" nativeClientId="codex" onInspectInstallations={onInspectInstallations} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  expect(onInspectInstallations).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'Codex CLI 설치 소유 정보 확인'}));expect(onInspectInstallations).toHaveBeenCalledOnce();
  const region=screen.getByRole('region',{name:'전역 설치 소유 정보'});expect(within(region).getByText(/소유 영역 확인됨/)).toBeInTheDocument();
  expect(within(region).getByText(/클라이언트 발견·Tool binding: 미확인/)).toBeInTheDocument();expect(within(region).queryByRole('button')).not.toBeInTheDocument();
});

it('separates installed dependency revisions and recorded native Tool names from client discovery',()=>{
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[],observations:[],scopes:[],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'DECLARATIONS_ONLY',runtimeState:'unverified'},
    installationPrerequisites:{schemaVersion:1,readOnly:true,target:{clientId:'codex',surface:'cli'},consistency:'observed',fulfilled:false,checks:[
      {nodeKey:'review',assetId:'review',assetKind:'skills',status:'ownership-observed',reason:'NATIVE_UNVERIFIED',discoveryState:'unverified',bindingState:'unverified',fulfilled:false,
        dependencyState:'revision-observed',bindingDeclarationsState:'recorded',dependencyIssues:[],dependencyBindings:[{consumerId:'review',toolId:'repository.search',providerId:'docs-alias',capability:'',nativeId:'original-server',nativeName:'search_repository',providerRevisionDigest:'b'.repeat(64)}]},
      {nodeKey:'outer',assetId:'outer',assetKind:'skills',status:'ownership-observed',reason:'NATIVE_UNVERIFIED',discoveryState:'unverified',bindingState:'unverified',fulfilled:false,
        dependencyState:'drift',bindingDeclarationsState:'unverified',dependencyIssues:[{code:'INSTALLED_DEPENDENCY_REVISION_CHANGED',assetId:'docs-alias',assetKind:'mcpServers'}],dependencyBindings:[]}
    ]}};
  render(<ResourceWorkspace view="agents" clients={clients} localDiscovery={[]} resources={[]} catalog={catalog} targetReady loading={false} error="" onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  const region=screen.getByRole('region',{name:'전역 설치 소유 정보'});
  expect(within(region).getByText('설치 의존성 revision 일치')).toBeInTheDocument();expect(within(region).getByText('설치 의존성 변경 감지')).toBeInTheDocument();
  expect(within(region).getByText(/repository.search → original-server · search_repository/)).toBeInTheDocument();
  expect(within(region).getByText(/클라이언트 발견·Tool binding: 미확인/)).toBeInTheDocument();expect(within(region).queryByRole('button')).not.toBeInTheDocument();
});

it('reads registered dependents only on request and retains unavailable projects without offering removal',async()=>{
  const user=userEvent.setup(),onInspectDependents=vi.fn().mockResolvedValue(undefined);
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[],observations:[],scopes:[],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'DECLARATIONS_ONLY',runtimeState:'unverified'},
    dependencyDependents:{schemaVersion:1,readOnly:true,coverage:'registered-projects-only',status:'observed',fulfilled:false,issues:[],projects:[{registrationId:'dep-record',project:{kitId:'consumer-kit',projectName:'default',sourceRoot:'/kit/projects/default',targetRoot:'/work/missing-checkout'},status:'active',generation:1,verification:'unverified',consumers:[{assetId:'reviewer',assetKind:'agents'}],prerequisites:[{assetId:'review',assetKind:'skills',revisionState:'unverified'}],issues:[{code:'DEPENDENT_PROJECT_STATE_UNAVAILABLE'}]}]}};
  render(<ResourceWorkspace view="skills" clients={clients} localDiscovery={[]} resources={[]} catalog={catalog} targetReady loading={false} error="" onInspectDependents={onInspectDependents} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  expect(onInspectDependents).not.toHaveBeenCalled();const region=screen.getByRole('region',{name:'전역 의존 프로젝트'});
  expect(within(region).getByText(/missing-checkout/)).toBeInTheDocument();expect(within(region).getByText('프로젝트 원장을 찾을 수 없습니다. 등록을 보존합니다.')).toBeInTheDocument();
  expect(within(region).queryByText('등록된 의존 프로젝트가 없습니다.')).not.toBeInTheDocument();expect(within(region).queryByRole('button',{name:/제거|해제|적용/})).not.toBeInTheDocument();
  await user.click(within(region).getByRole('button',{name:'등록된 의존 프로젝트 확인'}));expect(onInspectDependents).toHaveBeenCalledOnce();
});

it('an inactive dependency index is not presented as proof that global resources have no users',()=>{
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[],observations:[],scopes:[],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'DECLARATIONS_ONLY',runtimeState:'unverified'},
    dependencyDependents:{schemaVersion:1,readOnly:true,coverage:'registered-projects-only',status:'not-enabled',fulfilled:false,projects:[],issues:[]}};
  render(<ResourceWorkspace view="skills" clients={clients} localDiscovery={[]} resources={[]} catalog={catalog} targetReady loading={false} error="" onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  const region=screen.getByRole('region',{name:'전역 의존 프로젝트'});expect(within(region).getByText('의존 프로젝트 등록이 아직 활성화되지 않았습니다.')).toBeInTheDocument();expect(within(region).queryByText('등록된 의존 프로젝트가 없습니다.')).not.toBeInTheDocument();
});

it('scoped dependency preview separates declaration success from installation and blocks mutations for preview resources',()=>{
  const resource:RegistryResource={id:'reviewer',kind:'agents',displayName:'Reviewer',scope:{type:'project'},providedTools:[],requiredTools:[],references:[],previewOnly:true};
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[resource],clients:[],observations:[],scopes:[{scope:'project',scopeRoot:'/kit/projects/default',targetRoot:'/work',status:'ready',issues:[],manifestSchemaVersion:3}],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'DECLARATIONS_ONLY',runtimeState:'unverified'},
    dependencyGraph:{schemaVersion:1,readOnly:true,valid:true,deploymentReady:false,installationState:'unverified',issues:[],nodes:[],edges:[],toolBindings:[],localAssetKeys:['project-reviewer'],globalPrerequisites:[{key:'global-review',contextId:'global',kitId:'shared-kit',scope:{type:'global'},kind:'skills',assetId:'review',installationState:'unverified'}]}};
  render(<ResourceWorkspace view="agents" clients={clients} localDiscovery={[]} resources={[resource]} catalog={catalog} scope="project" targetReady loading={false} error="" onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  const summary=screen.getByRole('region',{name:'범위 간 의존성'});
  expect(within(summary).getByText(/전역 설치 상태: 미확인/)).toBeInTheDocument();expect(within(summary).getByText('review')).toBeInTheDocument();
  expect(within(summary).queryByRole('button')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'편집'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/배포 검토/})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'리소스 추가'})).toBeDisabled();
});

it('an unresolved scoped graph is not displayed as absence of global dependencies',()=>{
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[],observations:[],scopes:[],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'UNREADABLE',runtimeState:'unverified'},
    dependencyGraph:{schemaVersion:1,readOnly:true,valid:false,deploymentReady:false,installationState:'unverified',issues:[{code:'SCOPED_CONTEXT_UNAVAILABLE'}],nodes:[],edges:[],toolBindings:[],localAssetKeys:[],globalPrerequisites:[]}};
  render(<ResourceWorkspace view="agents" clients={clients} localDiscovery={[]} resources={[]} catalog={catalog} targetReady loading={false} error="" onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  const summary=screen.getByRole('region',{name:'범위 간 의존성'});
  expect(within(summary).queryByText(/전역 자원이 없습니다/)).not.toBeInTheDocument();expect(within(summary).getByText(/선언 문제를 해결한 뒤/)).toBeInTheDocument();
});

it('v3 sources with editing support offer source actions while client installation still needs a deployment review',async()=>{
  const onOpenEditor=vi.fn(),onOpenDeploy=vi.fn(),resource:RegistryResource={id:'reviewer',kind:'agents',displayName:'Reviewer',scope:{type:'project'},manifestSchemaVersion:3,previewOnly:false,providedTools:[],requiredTools:[],references:[],origin:{scope:'project',scopeRoot:'/kit/projects/default',projectName:'default',targetRoot:'/work'}};
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[resource],clients:[],observations:[],scopes:[{scope:'project',scopeRoot:'/kit/projects/default',targetRoot:'/work',status:'ready',issues:[],manifestSchemaVersion:3,manifestEditingState:'supported'}],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'DECLARATIONS_ONLY',runtimeState:'unverified'}};
  render(<ResourceWorkspace view="agents" clients={clients} localDiscovery={[]} resources={[resource]} catalog={catalog} scope="project" targetReady loading={false} error="" onOpenEditor={onOpenEditor} onOpenDeploy={onOpenDeploy}/>);const user=userEvent.setup();
  expect(screen.getByRole('button',{name:'리소스 추가'})).toBeEnabled();await user.click(screen.getByRole('button',{name:'편집'}));expect(onOpenEditor).toHaveBeenCalledWith('reviewer',{scope:'project',projectName:'default',projectPath:'/work'});expect(onOpenDeploy).not.toHaveBeenCalled();
});

it('instruction candidates stay predictions and offer no mutation in their readonly summary',async()=>{
  const user=userEvent.setup(),onObserveNative=vi.fn().mockResolvedValue(undefined);
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[],observations:[],scopes:[],duplicates:[],effective:[],issues:[],coverage:{complete:false,reason:'PREDICTION_ONLY',runtimeState:'unverified'},
    nativeObservation:{status:'partial',kind:'instructions',clientId:'codex',surface:'cli',modelTurnsRequested:false,instructionPreview:{state:'documented-prediction',loadedSourcesState:'unverified',settingsVerified:true,byteBudget:2,budgetMayTruncate:true,customGuidancePresent:false,contextIncomplete:false,
      files:[{path:'/work/AGENTS.md',scope:'project',state:'shadowed',bytes:0,contentRead:false,manageable:false},{path:'/work/AGENTS.override.md',scope:'project',state:'candidate',bytes:20,contentRead:true,manageable:false}]}}};
  render(<ResourceWorkspace view="instructions" clients={clients} localDiscovery={[]} resources={[]} catalog={catalog} targetReady loading={false} error="" scope="project" nativeClientId="codex" onObserveNative={onObserveNative} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  await user.click(screen.getByRole('button',{name:'Codex CLI 상태 확인'}));expect(onObserveNative).toHaveBeenCalledWith('instructions');
  const summary=screen.getByRole('region',{name:'지침 선택 후보'});expect(within(summary).getByText(/실제 클라이언트 주입 상태: 미확인/)).toBeInTheDocument();
  expect(within(summary).getByText(/일부 내용이 잘릴 수 있음/)).toBeInTheDocument();expect(within(summary).getByText('같은 폴더의 우선 지침에 가려짐 · 프로젝트')).toBeInTheDocument();expect(within(summary).queryByRole('button')).not.toBeInTheDocument();
});

it('shows MCP effective fields separately from source shadowing and never offers actions on native registrations',async()=>{
  const user=userEvent.setup(),onObserveNative=vi.fn().mockResolvedValue(undefined);
  const entry={id:'shared',kind:'mcpServers' as const,clientId:'codex',surface:'cli',scope:'global' as const,sourcePath:'~/.codex/config.toml',catalogId:'global-shared',candidateId:'global-candidate',activation:'unknown' as const,nativeEvidence:{state:'shadowed'}};
  const local:LocalClientDiscovery={id:'codex',displayName:'Codex',supported:true,installed:true,configured:true,signals:{commands:[],userRootExists:true},observations:[entry],assets:[],issues:[]};
  const registration={kind:'mcpServers' as const,name:'shared',enabled:false,transportType:'stdio',composition:'single-source',connectionState:'unverified' as const,toolUseState:'unverified' as const,manageable:false as const,sourceCandidates:['global-shared'],origins:[{field:'command',type:'project',path:'/work/.codex/config.toml',verified:true}]};
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[local],observations:[{...entry,origin:{scope:'global',scopeRoot:'/kit/global',targetRoot:'/home'}}],scopes:[],duplicates:[],issues:[],coverage:{complete:false,reason:'OTHER_KINDS',runtimeState:'unverified'},
    effective:[{clientId:'codex',surface:'cli',kind:'mcpServers',name:'shared',status:'unverified',reason:'MODEL_USE_UNVERIFIED',entries:[{catalogId:'global-shared',selected:false,activation:'unknown',nativeState:'shadowed'}],nativeConfiguration:registration}],
    nativeObservation:{status:'observed',kind:'mcpServers',clientId:'codex',surface:'cli',modelTurnsRequested:false,registrations:[registration]}};
  render(<ResourceWorkspace view="mcp" clients={clients} localDiscovery={[local]} resources={[]} catalog={catalog} targetReady loading={false} error="" scope="global" nativeClientId="codex" onObserveNative={onObserveNative} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()}/>);
  await user.click(screen.getByRole('button',{name:'Codex CLI 상태 확인'}));expect(onObserveNative).toHaveBeenCalledWith('mcpServers');
  const summary=screen.getByRole('region',{name:'MCP 실효 설정'});expect(within(summary).getByText(/비활성 설정/)).toBeInTheDocument();expect(within(summary).getByText(/command ← \/work\/.codex\/config.toml/)).toBeInTheDocument();expect(within(summary).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText(/다른 원본에 가려짐/)).toBeInTheDocument();expect(within(summary).getByText('연결·Tool 사용 미확인')).toBeInTheDocument();
});

it('requests native inventory only on explicit action and shows disabled and additional native entries safely',async()=>{
  const user=userEvent.setup(),onObserveNative=vi.fn().mockResolvedValue(undefined);
  const observations=[true,false].map((enabled,index)=>({id:index?'project-review':'global-review',kind:'skills' as const,clientId:'codex',surface:'cli',scope:index?'project' as const:'global' as const,
    candidateId:`candidate-${index}`,catalogId:`entry-${index}`,sourcePath:index?'/work/.agents/skills':'~/.agents/skills',path:index?'/work/.agents/skills/project-review':'~/.agents/skills/global-review',activation:enabled?'enabled' as const:'disabled' as const,
    nativeEvidence:{state:'listed',enabled},nativeName:{status:'native-listed',value:'review'},origin:{scope:index?'project' as const:'global' as const,scopeRoot:'/kit',targetRoot:index?'/work':'/home'}}));
  const local:LocalClientDiscovery={id:'codex',displayName:'Codex',supported:true,installed:true,configured:true,signals:{commands:[],userRootExists:true},assets:[],observations,issues:[]};
  const catalog:ResourceCatalog={schemaVersion:1,readOnly:true,registry:[],clients:[local],observations,scopes:[],duplicates:[],issues:[],coverage:{complete:false,reason:'OTHER_KINDS',runtimeState:'unverified'},
    effective:[{clientId:'codex',surface:'cli',kind:'skills',name:'review',status:'native-observed',reason:'NATIVE_LIST_OBSERVED_MODEL_USE_UNVERIFIED',entries:observations.map(item=>({catalogId:item.catalogId,selected:false,activation:item.activation,nativeState:'listed'}))}],
    nativeObservation:{status:'observed',clientId:'codex',surface:'cli',modelTurnsRequested:false,additional:[{name:'parent-review',path:'/parent/.agents/skills/review/SKILL.md',enabled:true,nativeScope:'repo',manageable:false}]}};
  render(<ResourceWorkspace view="skills" clients={clients} localDiscovery={[local]} resources={[]} catalog={catalog}
    targetReady loading={false} error="" scope="project" projectName="default" projectPath="/work" nativeClientId="codex" onObserveNative={onObserveNative} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()} />);
  expect(onObserveNative).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Codex CLI 상태 확인'}));expect(onObserveNative).toHaveBeenCalledTimes(1);
  await user.selectOptions(screen.getByLabelText('클라이언트 활성 상태'),'disabled');
  expect(screen.getByText(/클라이언트 목록: 비활성/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('클라이언트 활성 상태'),'disabled');
  expect(within(screen.getByLabelText('Skill 라이브러리 목록')).getAllByRole('article')).toHaveLength(1);
  const extra=screen.getByRole('region',{name:'추가 탐색 경로'});expect(within(extra).getByText('parent-review')).toBeInTheDocument();expect(within(extra).queryByRole('button')).not.toBeInTheDocument();
});

it('routes global and project rows with the same ID to their own editor context', async () => {
  const user = userEvent.setup(), onOpenEditor = vi.fn();
  const global = {...resources[0], displayName: 'Global GitHub', catalogId: 'global', origin: {scope: 'global' as const, scopeRoot: '/kit/global', targetRoot: '/home'}};
  const project = {...resources[0], displayName: 'Project GitHub', scope: {type: 'project'}, catalogId: 'project',
    origin: {scope: 'project' as const, projectName: 'work', scopeRoot: '/kit/projects/work', targetRoot: '/work'}};
  render(<ResourceWorkspace view="mcp" clients={clients} localDiscovery={[]} resources={[global, project]}
    targetReady loading={false} error="" scope="project" projectName="other" projectPath="/other" onOpenEditor={onOpenEditor} onOpenDeploy={vi.fn()} />);
  await user.click(within(screen.getByRole('article', {name: 'Global GitHub 리소스'})).getByRole('button', {name: '편집'}));
  expect(onOpenEditor).toHaveBeenLastCalledWith('github-mcp', {scope: 'global', projectName: '', projectPath: ''});
  await user.click(within(screen.getByLabelText('자원 선택')).getByRole('button',{name:/Project GitHub/}));
  await user.click(within(screen.getByRole('article', {name: 'Project GitHub 리소스'})).getByRole('button', {name: '편집'}));
  expect(onOpenEditor).toHaveBeenLastCalledWith('github-mcp', {scope: 'project', projectName: 'work', projectPath: '/work'});
});

it('opens a global imported source installation against global even while viewing a project', async () => {
  const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({assetId: 'github-mcp', clientId: 'codex', surface: 'cli', target: '/home/.codex/config.toml', adopted: false, installedModified: false, kitPending: false, files: []})));
  const user = userEvent.setup();
  render(<ResourceWorkspace view="mcp" clients={clients} localDiscovery={[]} resources={[{...resources[0], managementMode: 'kit-source', catalogId: 'global', origin: {scope: 'global', scopeRoot: '/kit/global', targetRoot: '/home'}}]}
    targetReady loading={false} error="" scope="project" projectName="work" projectPath="/work" onChanged={vi.fn()} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()} />);
  await user.click(screen.getByRole('button', {name: '클라이언트 설치 반영'}));
  expect(await screen.findByText(/설치 관리 등록 전/)).toBeInTheDocument();
  const request = new URL(String(fetchSpy.mock.calls[0][0]), 'http://localhost');
  expect(request.searchParams.get('scope')).toBe('global'); expect(request.searchParams.get('projectPath')).toBe('');
});

describe('ResourceWorkspace', () => {
  it('filters resources by name, ID, and provided Tool', async () => {
    const user = userEvent.setup();
    render(
      <ResourceWorkspace
        view="mcp"
        clients={clients}
        localDiscovery={[]}
        resources={resources}
        targetReady
        loading={false}
        error=""
        onOpenEditor={vi.fn()}
        onOpenDeploy={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', {name: 'MCP 검색'}), 'github.search');

    expect(screen.getByRole('heading', {name: 'GitHub MCP'})).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Observability'})).not.toBeInTheDocument();
  });

  it('clears the previous search when the asset tab changes', async () => {
    const user = userEvent.setup();
    const localDiscovery: LocalClientDiscovery[] = [{
      id: 'claude',
      displayName: 'Claude Code',
      supported: true,
      installed: true,
      configured: true,
      signals: {commands: ['claude'], userRootExists: true},
      assets: [{
        id: 'sales-service',
        kind: 'skills',
        clientId: 'claude',
        sourcePath: '~/.claude/skills'
      }],
      issues: []
    }];
    const props = {
      clients,
      localDiscovery,
      resources,
      targetReady: true,
      loading: false,
      error: '',
      onOpenEditor: vi.fn(),
      onOpenDeploy: vi.fn()
    };
    const {rerender} = render(<ResourceWorkspace {...props} view="mcp" />);

    await user.type(screen.getByRole('searchbox', {name: 'MCP 검색'}), 'playwright');
    rerender(<ResourceWorkspace {...props} view="skills" />);

    expect(screen.getByRole('searchbox', {name: 'Skill 검색'})).toHaveValue('');
    expect(screen.getByRole('heading', {name: 'sales-service'})).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', {name: 'Skill 검색'}), 'sales');
    rerender(<ResourceWorkspace {...props} view="mcp" />);

    expect(screen.getByRole('searchbox', {name: 'MCP 검색'})).toHaveValue('');
    expect(screen.getByRole('heading', {name: 'GitHub MCP'})).toBeInTheDocument();
    expect(within(screen.getByLabelText('자원 선택')).getByRole('button',{name:/Observability/})).toBeInTheDocument();
  });

  it('shows a search-specific empty state when no resource matches', async () => {
    const user = userEvent.setup();
    render(
      <ResourceWorkspace
        view="mcp"
        clients={clients}
        localDiscovery={[]}
        resources={resources}
        targetReady
        loading={false}
        error=""
        onOpenEditor={vi.fn()}
        onOpenDeploy={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', {name: 'MCP 검색'}), 'no-match');

    expect(screen.getByRole('heading', {name: '검색 결과가 없습니다.'})).toBeInTheDocument();
    expect(screen.getByText('검색어를 바꾸거나 지워 보세요.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: '이 Kit에 등록된 MCP 서버가 없습니다.'})).not.toBeInTheDocument();
  });

  it('keeps the asset-specific empty state when the registry is actually empty', () => {
    render(
      <ResourceWorkspace
        view="mcp"
        clients={clients}
        localDiscovery={[]}
        resources={[]}
        targetReady
        loading={false}
        error=""
        onOpenEditor={vi.fn()}
        onOpenDeploy={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', {name: '이 Kit에 등록된 MCP 서버가 없습니다.'})).toBeInTheDocument();
    expect(screen.getByText('새 리소스를 추가하면 환경별 지원 상태와 의존성을 여기서 비교할 수 있습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: '검색 결과가 없습니다.'})).not.toBeInTheDocument();
  });

  it('keeps same-named PC discovery separate from Agent Kit resources without ownership evidence', async () => {
    const localDiscovery: LocalClientDiscovery[] = [{
      id: 'codex',
      displayName: 'Codex',
      supported: true,
      installed: true,
      configured: true,
      signals: {commands: ['codex'], userRootExists: true},
      assets: [
        {
          id: 'github-mcp',
          kind: 'mcpServers',
          clientId: 'codex',
          sourcePath: '~/.codex/config.toml'
        },
        {
          id: 'playwright',
          kind: 'mcpServers',
          clientId: 'codex',
          sourcePath: '~/.codex/config.toml'
        }
      ],
      issues: []
    }];

    render(
      <ResourceWorkspace
        view="mcp"
        clients={clients}
        localDiscovery={localDiscovery}
        resources={resources}
        targetReady
        loading={false}
        error=""
        onOpenEditor={vi.fn()}
        onOpenDeploy={vi.fn()}
      />
    );

    const registered = screen.getByRole('article', {name: 'GitHub MCP 리소스'});
    expect(within(registered).queryByText('PC에서 발견')).not.toBeInTheDocument();
    expect(within(registered).getByText('Agent Kit 등록됨')).toBeInTheDocument();
    await userEvent.setup().click(within(screen.getByLabelText('자원 선택')).getByRole('button',{name:/^github-mcp/}));
    const discovered = screen.getByRole('article', {name: 'github-mcp 리소스'});
    expect(within(discovered).getByText('PC에서 발견')).toBeInTheDocument();
    expect(within(discovered).queryByText('Agent Kit 등록됨')).not.toBeInTheDocument();

    await userEvent.setup().click(within(screen.getByLabelText('자원 선택')).getByRole('button',{name:/^playwright/}));
    const pcOnly = screen.getByRole('article', {name: 'playwright 리소스'});
    expect(within(pcOnly).getByText('PC에서 발견')).toBeInTheDocument();
    expect(within(pcOnly).getByText('읽기 전용')).toBeInTheDocument();
    expect(within(pcOnly).getAllByText('Codex')[0]).toBeInTheDocument();
    expect(within(pcOnly).queryByRole('button', {name: '편집'})).not.toBeInTheDocument();
    expect(within(pcOnly).queryByRole('button', {name: /배포 검토/})).not.toBeInTheDocument();
  });

  it('uses surface observations to show external links with no editing, deployment or update actions', () => {
    const asset = {id: 'ego-browser', kind: 'skills' as const, clientId: 'codex', candidateId: 'ego-observed',
      sourcePath: '~/.agents/skills', path: '~/.agents/skills/ego-browser', scope: 'global' as const, surface: 'cli',
      entryType: 'symlink' as const, managementMode: 'external' as const, linkState: 'resolved' as const,
      linkTarget: '~/.local/share/ego/ego-skills', externalManager: {id: 'ego', displayName: 'Ego Lite'}};
    const localDiscovery: LocalClientDiscovery[] = [{id: 'codex', displayName: 'Codex', supported: false, installed: true,
      configured: true, signals: {commands: ['codex'], userRootExists: true}, assets: [], issues: [],
      surfaces: [{id: 'cli', configStore: 'codex-local', installationState: 'detected', runtimeState: 'unverified',
        clientVersion: null, configured: true, assets: [], observations: [asset], issues: []}]}];
    render(<ResourceWorkspace view="skills" clients={clients} localDiscovery={localDiscovery} resources={[]}
      targetReady loading={false} error="" scope="global" onChanged={vi.fn()} onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()} />);
    const row = screen.getByRole('article', {name: 'ego-browser 리소스'});
    expect(within(row).getByText('외부 관리')).toBeInTheDocument();
    expect(within(row).getByText('기존 링크 · 연결됨')).toBeInTheDocument();
    expect(within(row).getByText(/연결 대상: ~\/.local\/share\/ego\/ego-skills/)).toBeInTheDocument();
    expect(within(row).getByText('관리 주체: Ego Lite')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

it('does not promote schema 2 file contracts to resource runtime support', () => {
  render(<ResourceWorkspace view="mcp" clients={[{...clients[0], schemaVersion: 2}]} localDiscovery={[]}
    resources={[resources[0]]} targetReady loading={false} error="" onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()} />);
  expect(screen.getByText('Codex · 파일 계약')).toBeInTheDocument();
  expect(screen.queryByText('Codex · 지원')).not.toBeInTheDocument();
  expect(screen.getByText(/실제 적용 가능 여부는 실행 화면·설치본·자원 옵션을 배포 계획에서 확인/)).toBeInTheDocument();
});

it('offers ordinary candidates import and connects a registered source only by candidate ID', async () => {
  const user = userEvent.setup();
  const asset = {id: 'review', kind: 'skills' as const, clientId: 'codex', candidateId: 'selected', sourcePath: '~/.claude/skills', path: '~/.claude/skills/review', managementMode: 'unmanaged' as const, scope: 'global' as const, surface: 'cli'};
  const local: LocalClientDiscovery = {id: 'codex', displayName: 'Codex', supported: true, installed: true, configured: true, signals: {commands: [], userRootExists: true}, assets: [asset], issues: []};
  const props = {view: 'skills' as const, clients, localDiscovery: [local], targetReady: true, loading: false, error: '', scope: 'global' as const, onChanged: vi.fn(), onOpenEditor: vi.fn(), onOpenDeploy: vi.fn()};
  const {rerender} = render(<ResourceWorkspace {...props} resources={[]} />);
  await user.click(screen.getByRole('button', {name: 'Kit에 가져오기'}));
  expect(screen.getByRole('region', {name: 'Kit에 가져오기'})).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: '닫기'}));
  rerender(<ResourceWorkspace {...props} resources={[{id: 'different-kit-id', displayName: 'Imported Review', kind: 'skills', scope: {type: 'global'}, providedTools: [], requiredTools: [], references: [], managementMode: 'kit-source', importedFrom: {candidateId: 'selected', clientId: 'codex', surface: 'cli', scope: 'global', path: '.claude/skills/review'}}]} />);
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('Kit 원본 등록')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: '등록 해제'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: '편집'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: /배포 검토/})).not.toBeInTheDocument();
});
