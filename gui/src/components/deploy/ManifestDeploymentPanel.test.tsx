import {beforeEach, describe, expect, it, vi} from 'vitest';
import {act,render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as deployApi from '../../api/deploy';
import {ManifestDeploymentPanel} from './ManifestDeploymentPanel';

vi.mock('../../api/deploy', () => ({
  saveManifestPlan: vi.fn(), fetchSavedManifestPlans: vi.fn(), resumeManifestPlan: vi.fn(),
  planManifestRecovery: vi.fn(), applyManifestRecovery: vi.fn(),
  planManifestDeployment: vi.fn(),
  observeManifestPrerequisites: vi.fn(),
  applyManifestDeployment: vi.fn(),
  applyManifestRollback: vi.fn(),
  fetchManifestDeploymentHistory: vi.fn(),
  planManifestRollback: vi.fn(),
  planManifestRemoval: vi.fn(),
  planManifestMigration: vi.fn(),
  validateManifest: vi.fn(),
  runDoctorDiagnostics: vi.fn()
}));

const clients = [{
  id: 'codex',
  displayName: 'Codex',
  detection: {commands: ['codex'], userRoot: '~/.codex'},
  capabilities: [{assetKind: 'mcp', scope: 'global' as const, status: 'stable' as const}]
}];

it('blocks a shared-skill write even if the returned plan incorrectly claims automatic approval',async()=>{
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[]});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId:'shared',kind:'apply',automatic:true,operations:[{target:'/home/.agents/skills/review',operation:'COPY',reason:''}],blocked:[],expiresAt:'2099-01-01'});
  renderPanel('global');await userEvent.setup().click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  expect(await screen.findByRole('button',{name:'적용 승인'})).toBeDisabled();expect(screen.getByRole('button',{name:'계획 저장 (24시간)'})).toBeDisabled();
});

it('does not accept an older plan response after a version selection changes',async()=>{
  let resolve!:(plan:deployApi.ManifestDeploymentPlan)=>void;const pending=new Promise<deployApi.ManifestDeploymentPlan>(done=>{resolve=done;});
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[]});vi.mocked(deployApi.planManifestDeployment).mockReturnValue(pending);
  const props={scope:'global' as const,clientId:'codex',clients,projectName:'default',projectPath:'',setClientVersion:vi.fn()};
  const {rerender}=render(<ManifestDeploymentPanel {...props} clientVersion="1"/>);await userEvent.setup().click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  rerender(<ManifestDeploymentPanel {...props} clientVersion="2"/>);
  await act(async()=>resolve({planId:'old-version',kind:'apply',automatic:true,operations:[],blocked:[],expiresAt:'2099-01-01'}));
  expect(screen.queryByRole('button',{name:'적용 승인'})).not.toBeInTheDocument();
});

it('uses every data-driven client for all-client planning and filters individual history by recorded client IDs',async()=>{
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[{id:'other-client-record',type:'apply',status:'committed',createdAt:'',clientIds:['other'],operations:[]} ]});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId:'all',kind:'apply',automatic:false,operations:[],blocked:[],expiresAt:'2099-01-01'});
  const targets=[...clients,{...clients[0],id:'other',displayName:'Other'},{...clients[0],id:'third',displayName:'Third'}];
  const props={scope:'global' as const,clientId:'codex',clients:targets,projectName:'default',projectPath:'',clientVersion:'',setClientVersion:vi.fn()};
  const {rerender}=render(<ManifestDeploymentPanel {...props} allClients/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  expect(vi.mocked(deployApi.planManifestDeployment).mock.lastCall?.[0].targets?.map(target=>target.clientId)).toEqual(['codex','other','third']);
  rerender(<ManifestDeploymentPanel {...props} allClients={false}/>);await user.click(screen.getByRole('button',{name:'적용 이력·복원'}));
  expect(screen.queryByText('other-client-record')).not.toBeInTheDocument();
});

it('requires private native observation and explicit provider discovery before approving scoped deployment',async()=>{
  vi.clearAllMocks();vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[]});
  const pending={planId:'scoped-project',kind:'scoped-apply' as const,automatic:true,operations:[],blocked:[],expiresAt:'2026-11-06T12:00:00Z',execution:{schemaVersion:1 as const,status:'requires-observation' as const,scope:'project' as const,nativePrerequisiteCount:2,providerDiscoveryRequired:true}};
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue(pending);vi.mocked(deployApi.observeManifestPrerequisites).mockResolvedValue({...pending,execution:{...pending.execution,status:'ready'},nativePrerequisitesState:'observed'});vi.mocked(deployApi.applyManifestDeployment).mockResolvedValue({transactionId:'tx-scoped-ui'});
  renderPanel('project','/project');const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  expect(await screen.findByRole('heading',{name:'범위 간 배포 계획'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'적용 승인'})).toBeDisabled();expect(screen.getByRole('button',{name:'계획 저장 (24시간)'})).toBeDisabled();
  const permission=screen.getByRole('checkbox',{name:'선택된 MCP의 Tool 목록도 확인'});expect(permission).not.toBeChecked();expect(deployApi.observeManifestPrerequisites).not.toHaveBeenCalled();
  await user.click(permission);await user.click(screen.getByRole('button',{name:'전역 설치 전제 확인'}));
  await waitFor(()=>expect(deployApi.observeManifestPrerequisites).toHaveBeenCalledWith({planId:'scoped-project',observeProviders:true}));expect(screen.getByRole('button',{name:'적용 승인'})).toBeEnabled();expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'적용 승인'}));await waitFor(()=>expect(deployApi.applyManifestDeployment).toHaveBeenCalledWith('scoped-project'));
});

it('keeps a scoped response without its execution verdict inapplicable even when automatic is true',async()=>{
  vi.clearAllMocks();vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[]});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId:'missing-verdict',kind:'scoped-apply',automatic:true,operations:[],blocked:[],expiresAt:'2026-11-06T12:00:00Z'});
  renderPanel('project','/project');await userEvent.setup().click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  expect(await screen.findByRole('button',{name:'적용 승인'})).toBeDisabled();expect(screen.getByRole('button',{name:'계획 저장 (24시간)'})).toBeDisabled();
});

it('shows dependency releases in the reviewed plan before applying a local declaration update',async()=>{
  vi.clearAllMocks();vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[]});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId:'release-declaration',kind:'scoped-apply',automatic:true,operations:[],blocked:[],expiresAt:'2099-01-01',
    execution:{schemaVersion:1,status:'ready',scope:'project',nativePrerequisiteCount:0,providerDiscoveryRequired:false},
    dependencyTransition:{schemaVersion:1,action:'apply',releasedConsumers:[{assetId:'reviewer',assetKind:'agents',clientId:'codex',surface:'cli',configStore:'codex-local'}],desiredConsumers:0,desiredPrerequisites:0}});
  renderPanel('project','/project');await userEvent.setup().click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  expect(await screen.findByText('변경 후 전역 의존성: 소비자 0개 · 설치 전제 0개')).toBeInTheDocument();expect(screen.getByRole('list',{name:'해제할 전역 의존성 참조'})).toHaveTextContent('reviewer · codex · cli');expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
});

it('observes a scoped rollback before approval and uses the rollback endpoint',async()=>{
  vi.clearAllMocks();vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[{id:'tx-update',type:'apply',status:'committed',createdAt:'2026-11-06',operations:[]}]});
  const pending={planId:'scoped-rollback',kind:'rollback' as const,automatic:false,operations:[],blocked:[],expiresAt:'2099-01-01',execution:{schemaVersion:1 as const,status:'requires-observation' as const,scope:'project' as const,nativePrerequisiteCount:1,providerDiscoveryRequired:false}};
  vi.mocked(deployApi.planManifestRollback).mockResolvedValue(pending);vi.mocked(deployApi.observeManifestPrerequisites).mockResolvedValue({...pending,automatic:true,execution:{...pending.execution,status:'ready'}});vi.mocked(deployApi.applyManifestRollback).mockResolvedValue({transactionId:'tx-rollback'});
  renderPanel('project','/project');const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'적용 이력·복원'}));await user.click(await screen.findByRole('button',{name:'Rollback 계획'}));expect(await screen.findByRole('button',{name:'Rollback 승인'})).toBeDisabled();
  await user.click(screen.getByRole('button',{name:'전역 설치 전제 확인'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Rollback 승인'})).toBeEnabled());expect(deployApi.applyManifestRollback).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Rollback 승인'}));await waitFor(()=>expect(deployApi.applyManifestRollback).toHaveBeenCalledWith('scoped-rollback'));expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
});

it('keeps rollback with dependency changes blocked when its execution verdict is missing',async()=>{
  vi.clearAllMocks();vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[{id:'tx-update',type:'apply',status:'committed',createdAt:'2026-11-06',operations:[]}]});
  vi.mocked(deployApi.planManifestRollback).mockResolvedValue({planId:'missing-rollback-verdict',kind:'rollback',automatic:true,operations:[],blocked:[],expiresAt:'2099-01-01',dependencyTransition:{schemaVersion:1,action:'rollback',releasedConsumers:[],desiredConsumers:1,desiredPrerequisites:1}});
  renderPanel('project','/project');await userEvent.setup().click(screen.getByRole('button',{name:'적용 이력·복원'}));await userEvent.setup().click(await screen.findByRole('button',{name:'Rollback 계획'}));
  expect(await screen.findByRole('button',{name:'Rollback 승인'})).toBeDisabled();expect(screen.getByRole('button',{name:'계획 저장 (24시간)'})).toBeDisabled();expect(deployApi.applyManifestRollback).not.toHaveBeenCalled();
});

it.each(['ready','blocked'] as const)('shows registered project protection and gates a %s review independently of automatic',async status=>{
  vi.clearAllMocks();vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions:[]});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId:'protected-global',kind:'apply',automatic:true,operations:[],blocked:[],expiresAt:'2026-11-06T12:00:00Z',
    dependencyProtection:{schemaVersion:1,scope:'global',status,registeredProjects:2,issues:status==='blocked'?[{code:'GLOBAL_REVISION_IN_USE'}]:[]}});
  renderPanel('global');await userEvent.setup().click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  expect(await screen.findByText('등록된 프로젝트 2곳의 기존 의존성을 함께 확인합니다.')).toBeInTheDocument();
  const apply=screen.getByRole('button',{name:'적용 승인'}),save=screen.getByRole('button',{name:'계획 저장 (24시간)'});
  if(status==='blocked'){expect(apply).toBeDisabled();expect(save).toBeDisabled();expect(screen.getByText('프로젝트 의존성 검토 필요')).toBeInTheDocument();}
  else{expect(apply).toBeEnabled();expect(save).toBeEnabled();}
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
});

it('shows snapshot file differences and prevents applying or saving a preview even if automatic was incorrectly true', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  const file = {path: 'SKILL.md', sha256: 'file-hash', mode: 0o644, bytes: 8};
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId: 'snapshot-preview', kind: 'apply', automatic: true, expiresAt: '2026-11-06T12:00:00Z', blocked: [],
    operations: [{assetId: 'review', target: '/project/.agents/skills/review', strategy: 'shared-snapshot', operation: 'LINK', reason: 'SHARED_SNAPSHOT_CONNECTION_PLANNED', previewOnly: true,
      consumers: ['shared:codex:cli', 'shared:antigravity:cli'], snapshotStatus: 'absent', connection: {schemaVersion: 1, strategy: 'snapshot-link', snapshot: {schemaVersion: 1, kind: 'skill-tree', treeDigest: 'snapshot-digest', files: [file]}},
      snapshotChanges: [{path: 'SKILL.md', operation: 'CREATE', before: null, after: file}]}]});
  renderPanel('global'); const user = userEvent.setup(); await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  expect(await screen.findByText('고정 사본 연결 · 계획만')).toBeInTheDocument();
  expect(screen.getByText('미리보기 · 적용 차단')).toBeInTheDocument();
  expect(screen.getByText('새 사본 생성 예정 · 1개 파일 · 8바이트')).toBeInTheDocument();
  expect(screen.getByRole('list', {name: '고정 사본 파일 변경'})).toHaveTextContent('CREATE · SKILL.md');
  expect(screen.getByRole('button', {name: '적용 승인'})).toBeDisabled();
  expect(screen.queryByRole('button', {name: '계획 저장 (24시간)'})).not.toBeInTheDocument();
});

function renderPanel(scope: 'global' | 'project', projectPath = '') {
  return render(
    <ManifestDeploymentPanel
      scope={scope}
      clientId="codex"
      clients={clients}
      projectName="default"
      projectPath={projectPath}
      clientVersion=""
      setClientVersion={vi.fn()}
    />
  );
}

it('shows global installation prerequisites and blocks scoped execution even if automatic is incorrectly true', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId:'scoped-preview',kind:'scoped-preview',automatic:true,expiresAt:'2026-11-06T12:00:00Z',operations:[],blocked:[],
    nativePrerequisitesState:'unverified',globalPrerequisites:[{assetId:'review',kind:'skills',status:'ownership-observed'},{assetId:'docs',kind:'mcpServers',status:'unverified'}]});
  renderPanel('project','/project');await userEvent.setup().click(screen.getByRole('button',{name:'배포 계획 만들기'}));
  expect(await screen.findByText('범위 간 의존성 미리보기')).toBeInTheDocument();
  const prerequisites=screen.getByRole('list',{name:'전역 설치 전제'});expect(prerequisites).toHaveTextContent('Skill · review · 설치 파일 확인');expect(prerequisites).toHaveTextContent('MCP · docs · 설치 확인 필요');
  expect(screen.getByText('클라이언트 인식: 추가 확인 필요')).toBeInTheDocument();expect(screen.getByRole('button',{name:'적용 승인'})).toBeDisabled();expect(screen.queryByRole('button',{name:'계획 저장 (24시간)'})).not.toBeInTheDocument();
});

it('shows both installation locations and keeps apply disabled when explicit path migration is required', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId: 'path-change', kind: 'apply', automatic: false, expiresAt: '2026-11-06T12:00:00Z', operations: [],
    blocked: [{operation: 'BLOCKED', assetId: 'review', target: '/project/new/review.toml', previousTargets: ['/project/old/review.toml'], reason: 'RESOURCE_PATH_MIGRATION_REQUIRED'}]});
  renderPanel('project', '/project'); await userEvent.setup().click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  expect(await screen.findByText('기존 설치 위치: /project/old/review.toml')).toBeInTheDocument();
  expect(screen.getByText('새 설치 위치: /project/new/review.toml')).toBeInTheDocument();
  expect(screen.getByText('설치 위치가 변경되어 별도 이관 계획이 필요합니다. 기존 설치는 보존됩니다.')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: '적용 승인'})).toBeDisabled();
  expect(screen.getByRole('button', {name: '계획 저장 (24시간)'})).toBeDisabled();
});

it('requests an explicit path migration and shows its old/new locations before approval without auto applying', async () => {
  vi.clearAllMocks(); vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestMigration).mockResolvedValue({planId: 'path-migration', kind: 'migration', migration: 'resource-path', automatic: true,
    expiresAt: '2026-11-06T12:00:00Z', blocked: [], operations: [{assetId: 'review', target: '/project/new/review', operation: 'CREATE_LOCATION', reason: 'RESOURCE_PATH_DESTINATION', strategy: 'resource-path'}],
    pathMigrations: [{assetId: 'review', assetKind: 'skills', clientId: 'codex', surface: 'cli', configStore: 'codex-local', previousTarget: '/project/old/review', target: '/project/new/review', previousDefinitionDigest: 'old', definitionDigest: 'new', remainingConsumers: ['kit:codex:desktop']}]});
  renderPanel('project', '/project'); const user = userEvent.setup();
  await user.click(screen.getByText('기존 관리 기록 이관')); await user.type(screen.getByLabelText('이관할 자원 ID'), 'review');
  await user.click(screen.getByRole('button', {name: '설치 경로 이관 계획'}));
  await waitFor(() => expect(deployApi.planManifestMigration).toHaveBeenCalledWith(expect.objectContaining({migration: 'resource-path', assetIds: ['review']})));
  expect(await screen.findByText('이전 위치: /project/old/review')).toBeInTheDocument();
  expect(screen.getByText('새 위치: /project/new/review')).toBeInTheDocument();
  expect(screen.getByText('이전 위치를 계속 사용하는 대상: kit:codex:desktop')).toBeInTheDocument();
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled(); expect(screen.getByRole('button', {name: '이관 승인'})).toBeEnabled();
});

describe('ManifestDeploymentPanel readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  });

  it('explains the missing project path instead of silently disabling plan creation', async () => {
    const user = userEvent.setup();
    renderPanel('project');

    const planButton = screen.getByRole('button', {name: '배포 계획 만들기'});
    expect(planButton).toBeEnabled();

    await user.click(planButton);

    expect(screen.getByRole('alert')).toHaveTextContent('프로젝트 경로');
    expect(deployApi.planManifestDeployment).not.toHaveBeenCalled();
    expect(deployApi.runDoctorDiagnostics).not.toHaveBeenCalled();
  });

  it('creates a global plan without running Doctor first', async () => {
    vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({
      planId: 'plan-1',
      kind: 'apply',
      automatic: true,
      expiresAt: '2026-07-28T10:00:00.000Z',
      operations: [],
      blocked: []
    });
    const user = userEvent.setup();
    renderPanel('global');

    await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));

    await waitFor(() => expect(deployApi.planManifestDeployment).toHaveBeenCalledTimes(1));
    expect(deployApi.runDoctorDiagnostics).not.toHaveBeenCalled();
  });

  it('shows the server request ID and remediation when planning fails', async () => {
    const failure = Object.assign(new Error('관리 중인 설정과 충돌했습니다.'), {
      code: 'OWNERSHIP_CONFLICT',
      requestId: 'request-ownership-1',
      remediation: '외부 변경을 검토한 뒤 다시 계획하세요.'
    });
    vi.mocked(deployApi.planManifestDeployment).mockRejectedValue(failure);
    const user = userEvent.setup();
    renderPanel('global');

    await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));

    expect(await screen.findByText('request-ownership-1')).toBeInTheDocument();
    expect(screen.getByText('외부 변경을 검토한 뒤 다시 계획하세요.')).toBeInTheDocument();
  });
});

it('selects a client surface for the shared plan and clears an earlier plan', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({
    planId: 'profile-plan', kind: 'apply', automatic: false,
    expiresAt: '2026-09-27T10:00:00Z', operations: [], blocked: []
  });
  const user = userEvent.setup();
  render(<ManifestDeploymentPanel scope="global" clientId="codex" clients={[{
    ...clients[0], defaultSurface: 'cli', surfaces: [
      {id: 'cli', displayName: 'Codex CLI', configStore: 'codex-local', runtimeState: 'unverified'},
      {id: 'desktop', displayName: 'Codex app', configStore: 'codex-local', runtimeState: 'unverified'}
    ]
  }]} projectName="default" projectPath="" clientVersion="1.2.3" setClientVersion={vi.fn()} />);
  await user.selectOptions(screen.getByRole('combobox', {name: '실행 화면'}), 'desktop');
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await waitFor(() => expect(deployApi.planManifestDeployment).toHaveBeenLastCalledWith(expect.objectContaining({surface: 'desktop', clientVersion: '1.2.3'})));
  expect(screen.getByRole('heading', {name: '배포 계획'})).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox', {name: '실행 화면'}), 'cli');
  await waitFor(() => expect(screen.queryByRole('heading', {name: '배포 계획'})).not.toBeInTheDocument());
});

it('shows generated MCP configuration while leaving an unverified plan inapplicable', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({
    planId: 'mcp-preview', kind: 'apply', automatic: false, expiresAt: '2026-09-27T10:00:00Z', operations: [],
    blocked: [{operation: 'BLOCKED', reason: 'CLIENT_PROFILE_UNVERIFIED', target: '.codex/config.toml'}],
    previews: [{assetId: 'docs', target: '.codex/config.toml', format: 'toml-section', desired: '[mcp_servers.docs]\nurl = "https://example.test/mcp"', previewOnly: true, supportReason: 'CLIENT_PROFILE_UNVERIFIED', operation: 'CREATE', changes: [], conflicts: []}]
  });
  const user = userEvent.setup();
  renderPanel('global');
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await user.click(await screen.findByText('docs · toml-section 변환 미리보기'));
  expect(screen.getByText(/url = "https:\/\/example.test\/mcp"/)).toBeInTheDocument();
  expect(screen.getByRole('button', {name: '적용 승인'})).toBeDisabled();
});

it('explains Agent defaults and provider scope without presenting them as mandatory policy', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({
    planId: 'agent-defaults', kind: 'apply', automatic: false, expiresAt: '2026-09-27T10:00:00Z', operations: [],
    blocked: [{operation: 'BLOCKED', reason: 'CLIENT_PROFILE_UNVERIFIED', target: '.codex/agents/reviewer.toml'}],
    previews: [{assetId: 'reviewer', target: '.codex/agents/reviewer.toml', format: 'toml', desired: 'sandbox_mode = "read-only"',
      previewOnly: true, supportReason: 'CLIENT_PROFILE_UNVERIFIED', operation: 'CREATE', changes: [], conflicts: [],
      notices: ['AGENT_SANDBOX_DEFAULT_OVERRIDABLE', 'AGENT_MCP_PROVIDER_SCOPE_ONLY']}]
  });
  const user = userEvent.setup();
  renderPanel('global');
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await user.click(await screen.findByText('reviewer · toml 변환 미리보기'));
  expect(screen.getByText(/강제 보안 정책을 보장하지 않습니다/)).toBeInTheDocument();
  expect(screen.getByText(/다른 서버와 기본 도구는 클라이언트 상속 규칙/)).toBeInTheDocument();
  expect(screen.getByRole('button', {name: '적용 승인'})).toBeDisabled();
});

it('creates an explicit removal plan and applies only after removal approval', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.applyManifestDeployment).mockClear();
  vi.mocked(deployApi.planManifestRemoval).mockResolvedValue({
    planId: 'release-plan', kind: 'remove', automatic: true, expiresAt: '2026-09-27T10:00:00Z', blocked: [],
    operations: [{assetId: 'review', target: '/project/.claude/skills/review/SKILL.md', operation: 'RELEASE', reason: 'SHARED_CONSUMER_REMOVAL', consumers: ['kit:antigravity:cli'], metadataOnly: true}]
  });
  vi.mocked(deployApi.applyManifestDeployment).mockResolvedValue({transactionId: 'tx-release'});
  const user = userEvent.setup(); renderPanel('project', '/project');
  await user.type(screen.getByRole('textbox', {name: '제거할 자원 ID'}), 'review');
  await user.click(screen.getByRole('button', {name: '제거 계획 만들기'}));
  expect(await screen.findByRole('heading', {name: '관리 자원 제거 계획'})).toBeInTheDocument();
  expect(deployApi.planManifestRemoval).toHaveBeenLastCalledWith(expect.objectContaining({clientId: 'codex', assetIds: ['review']}));
  expect(screen.getByText(/kit:antigravity:cli.*파일 내용 유지/)).toBeInTheDocument();
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', {name: '제거 승인'}));
  await waitFor(() => expect(deployApi.applyManifestDeployment).toHaveBeenCalledWith('release-plan'));
});

it('shows every recorded reader affected by removal of a physical setting before approval', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []}); vi.mocked(deployApi.applyManifestDeployment).mockClear();
  vi.mocked(deployApi.planManifestRemoval).mockResolvedValue({planId: 'physical-removal', kind: 'remove', automatic: true, expiresAt: '2099-01-01', blocked: [], operations: [
    {assetId: 'docs', target: '/project/.codex/config.toml', operation: 'REMOVE_UNITS', reason: 'OWNED_PHYSICAL_RESOURCE_REMOVAL', configStore: 'codex-local', storeEffect: 'configuration', affectedTargets: [{clientId: 'codex', surface: 'cli'}, {clientId: 'codex', surface: 'desktop'}]}
  ]});
  const user = userEvent.setup(); renderPanel('project', '/project'); await user.type(screen.getByRole('textbox', {name: '제거할 자원 ID'}), 'docs');
  await user.click(screen.getByRole('button', {name: '제거 계획 만들기'}));
  expect(await screen.findByText(/같은 설정에 함께 반영되는 화면: Codex · cli, Codex · desktop/)).toBeInTheDocument();
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
});

it('passes separate client versions when planning a shared update', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId: 'batch-plan', kind: 'apply', stateUpgrade: {from: 1, to: 2}, automatic: false, expiresAt: '2026-09-27T10:00:00Z', operations: [], blocked: []});
  const user = userEvent.setup();
  render(<ManifestDeploymentPanel scope="project" clientId="codex" clients={[clients[0], {...clients[0], id: 'antigravity', displayName: 'Antigravity', defaultSurface: 'cli'}]} projectName="default" projectPath="/project" clientVersion="codex-version" setClientVersion={vi.fn()} />);
  await user.selectOptions(screen.getByRole('combobox', {name: '함께 적용할 클라이언트'}), 'antigravity');
  await user.type(screen.getByRole('textbox', {name: '함께 적용할 클라이언트 버전'}), 'antigravity-version');
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await waitFor(() => expect(deployApi.planManifestDeployment).toHaveBeenLastCalledWith(expect.objectContaining({targets: [
    {clientId: 'codex', surface: undefined, clientVersion: 'codex-version'},
    {clientId: 'antigravity', surface: 'cli', clientVersion: 'antigravity-version'}
  ]})));
  expect(screen.getByText(/이전 버전의 Kit는 이 원장을 관리할 수 없습니다/)).toBeInTheDocument();
});

it('plans Skill strategy migration for all selected clients and applies only the reviewed migration ID', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []}); vi.mocked(deployApi.applyManifestDeployment).mockClear();
  vi.mocked(deployApi.planManifestMigration).mockResolvedValue({planId: 'skill-migration', kind: 'migration', migration: 'skill-strategy', automatic: true, expiresAt: '2026-11-06T12:00:00Z', operations: [], blocked: []});
  vi.mocked(deployApi.applyManifestDeployment).mockResolvedValue({transactionId: 'tx-strategy'});
  render(<ManifestDeploymentPanel scope="project" clientId="codex" clients={[clients[0], {...clients[0], id: 'antigravity', displayName: 'Antigravity', defaultSurface: 'cli'}]} projectName="default" projectPath="/project" clientVersion="codex-version" setClientVersion={vi.fn()} />);
  const user = userEvent.setup(); await user.selectOptions(screen.getByRole('combobox', {name: '함께 적용할 클라이언트'}), 'antigravity');
  await user.type(screen.getByRole('textbox', {name: '함께 적용할 클라이언트 버전'}), 'agy-version');
  await user.click(screen.getByText('기존 관리 기록 이관')); await user.type(screen.getByRole('textbox', {name: '이관할 자원 ID'}), 'review');
  await user.click(screen.getByRole('button', {name: 'Skill 복사·연결 이관 계획'}));
  expect(deployApi.planManifestMigration).toHaveBeenLastCalledWith(expect.objectContaining({migration: 'skill-strategy', assetIds: ['review'], targets: [
    {clientId: 'codex', surface: undefined, clientVersion: 'codex-version'}, {clientId: 'antigravity', surface: 'cli', clientVersion: 'agy-version'}]}));
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', {name: '이관 승인'}));
  expect(deployApi.applyManifestDeployment).toHaveBeenCalledWith('skill-migration');
});

it('previews global ledger migration and applies only after explicit approval', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.applyManifestDeployment).mockClear();
  vi.mocked(deployApi.planManifestMigration).mockResolvedValue({planId: 'global-migration', kind: 'migration', migration: 'global-ledger', automatic: true, expiresAt: '2026-09-27T10:00:00Z', operations: [], blocked: []});
  vi.mocked(deployApi.applyManifestDeployment).mockResolvedValue({transactionId: 'tx-migration'});
  const user = userEvent.setup(); renderPanel('global');
  await user.click(screen.getByText('기존 관리 기록 이관'));
  await user.click(screen.getByRole('button', {name: '전역 원장 이관 계획'}));
  expect(await screen.findByRole('heading', {name: '관리 기록 이관 계획'})).toBeInTheDocument();
  expect(screen.getByText(/원장 구조의 역이관은 자동으로 지원하지 않습니다/)).toBeInTheDocument();
  expect(deployApi.planManifestMigration).toHaveBeenLastCalledWith(expect.objectContaining({scope: 'global', migration: 'global-ledger'}));
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', {name: '이관 승인'}));
  await waitFor(() => expect(deployApi.applyManifestDeployment).toHaveBeenCalledWith('global-migration'));
});

it('uses explicit asset IDs for ownership migration and supports global removal', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestMigration).mockResolvedValue({planId: 'ownership-migration', kind: 'migration', migration: 'shared-ownership', automatic: false, expiresAt: '2026-09-27T10:00:00Z', operations: [], blocked: []});
  vi.mocked(deployApi.planManifestRemoval).mockResolvedValue({planId: 'global-removal', kind: 'remove', automatic: false, expiresAt: '2026-09-27T10:00:00Z', operations: [], blocked: []});
  const user = userEvent.setup(); renderPanel('global');
  await user.click(screen.getByText('기존 관리 기록 이관'));
  await user.type(screen.getByRole('textbox', {name: '이관할 자원 ID'}), 'rules, review');
  await user.click(screen.getByRole('button', {name: '공유 소유권 이관 계획'}));
  await waitFor(() => expect(deployApi.planManifestMigration).toHaveBeenLastCalledWith(expect.objectContaining({migration: 'shared-ownership', assetIds: ['rules', 'review']})));
  expect(screen.getByRole('button', {name: '이관 승인'})).toBeDisabled();
  await user.type(screen.getByRole('textbox', {name: '제거할 자원 ID'}), 'review');
  await user.click(screen.getByRole('button', {name: '제거 계획 만들기'}));
  await waitFor(() => expect(deployApi.planManifestRemoval).toHaveBeenLastCalledWith(expect.objectContaining({scope: 'global', assetIds: ['review']})));
});

it('allows global CLI and desktop of the same client to participate in one plan', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId: 'same-client', kind: 'apply', automatic: false, expiresAt: '2026-09-27T10:00:00Z', operations: [], blocked: []});
  const user = userEvent.setup();
  render(<ManifestDeploymentPanel scope="global" clientId="codex" clients={[{...clients[0], defaultSurface: 'cli', surfaces: [
    {id: 'cli', displayName: 'Codex CLI', configStore: 'codex-local', runtimeState: 'unverified'},
    {id: 'desktop', displayName: 'Codex app', configStore: 'codex-local', runtimeState: 'unverified'}
  ]}]} projectName="default" projectPath="" clientVersion="cli-version" setClientVersion={vi.fn()} />);
  await user.selectOptions(screen.getByRole('combobox', {name: '함께 적용할 클라이언트'}), 'codex');
  await user.selectOptions(screen.getByRole('combobox', {name: '함께 적용할 실행 화면'}), 'desktop');
  await user.type(screen.getByRole('textbox', {name: '함께 적용할 클라이언트 버전'}), 'app-version');
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await waitFor(() => expect(deployApi.planManifestDeployment).toHaveBeenLastCalledWith(expect.objectContaining({scope: 'global', targets: [
    {clientId: 'codex', surface: 'cli', clientVersion: 'cli-version'},
    {clientId: 'codex', surface: 'desktop', clientVersion: 'app-version'}
  ]})));
});

it('shows the owned MCP selectors and applies a mixed Agent/MCP removal after approval', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.applyManifestDeployment).mockClear();
  vi.mocked(deployApi.planManifestRemoval).mockResolvedValue({planId: 'typed-removal', kind: 'remove', automatic: true, expiresAt: '2026-09-27T10:00:00Z', blocked: [], operations: [
    {assetId: 'docs', target: '/project/.codex/config.toml', operation: 'REMOVE_UNITS', reason: 'OWNED_RESOURCE_REMOVAL', changes: [{assetId: 'docs', selectors: ['mcp_servers.docs']}]},
    {assetId: 'reviewer', target: '/project/.codex/agents/reviewer.toml', operation: 'REMOVE', reason: 'OWNED_RESOURCE_REMOVAL'}
  ]});
  vi.mocked(deployApi.applyManifestDeployment).mockResolvedValue({transactionId: 'tx-typed-removal'});
  const user = userEvent.setup(); renderPanel('project', '/project');
  await user.type(screen.getByRole('textbox', {name: '제거할 자원 ID'}), 'docs, reviewer');
  await user.click(screen.getByRole('button', {name: '제거 계획 만들기'}));
  expect(await screen.findByText(/제거 대상: docs.*mcp_servers.docs/)).toBeInTheDocument();
  expect(screen.getByText(/같은 설정을 읽는 실행 화면에도 반영됩니다/)).toBeInTheDocument();
  expect(deployApi.planManifestRemoval).toHaveBeenLastCalledWith(expect.objectContaining({assetIds: ['docs', 'reviewer']}));
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', {name: '제거 승인'}));
  await waitFor(() => expect(deployApi.applyManifestDeployment).toHaveBeenCalledWith('typed-removal'));
});

it('saves a reviewed plan and resumes only after an explicit saved-plan approval', async () => {
  vi.clearAllMocks();
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId: 'saved-1', kind: 'apply', automatic: true, expiresAt: '2099-01-01', operations: [], blocked: []});
  const saved = {planId: 'saved-1', digest: 'a'.repeat(64), kind: 'apply', status: 'ready', expiresAt: '2099-01-01', targetRoot: '/project', operations: [{target: '/project/.codex/config.toml', operation: 'UPDATE', storeEffect: 'configuration' as const, affectedTargets: [{clientId: 'codex', surface: 'cli'}, {clientId: 'codex', surface: 'desktop'}]}]};
  vi.mocked(deployApi.saveManifestPlan).mockResolvedValue(saved);
  vi.mocked(deployApi.fetchSavedManifestPlans).mockResolvedValue({plans: [{...saved, status: 'completed'}]});
  vi.mocked(deployApi.resumeManifestPlan).mockResolvedValue({transactionId: 'tx-saved-1'});
  const user = userEvent.setup(); renderPanel('global');
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await user.click(await screen.findByRole('button', {name: '계획 저장 (24시간)'}));
  expect(deployApi.saveManifestPlan).toHaveBeenCalledWith('saved-1');
  expect(deployApi.resumeManifestPlan).not.toHaveBeenCalled();
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'저장된 계획'}));
  await user.click(screen.getByText('저장 계획과 중단 작업 복구'));
  expect(screen.getByText(/검토 digest:/)).toHaveTextContent(saved.digest);
  expect(screen.getByText(/같은 설정에 함께 반영되는 화면: Codex · cli, Codex · desktop/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: '저장 계획 적용 승인'}));
  expect(deployApi.resumeManifestPlan).toHaveBeenCalledWith(saved.planId, saved.digest);
  await waitFor(() => expect(screen.getByRole('button', {name: '저장 계획 적용 승인'})).toBeDisabled());
});

it('loads saved plans without execution and requires separate recovery approval', async () => {
  vi.clearAllMocks();
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.fetchSavedManifestPlans).mockResolvedValue({plans: []});
  vi.mocked(deployApi.planManifestRecovery).mockResolvedValue({planId: 'recovery-1', kind: 'recovery', automatic: true, outcome: 'restore-original', expiresAt: '2099-01-01', operations: [{operation: 'RESTORE', target: '/project/AGENTS.md', reason: ''}], blocked: []});
  vi.mocked(deployApi.applyManifestRecovery).mockResolvedValue({transactionId: 'tx-interrupted'});
  const user = userEvent.setup(); renderPanel('project', '/project');
  await user.click(screen.getByRole('button',{name:'저장된 계획'}));
  await user.click(screen.getByText('저장 계획과 중단 작업 복구'));
  await user.click(screen.getByRole('button', {name: '저장 계획 불러오기'}));
  expect(deployApi.resumeManifestPlan).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', {name: '현재 대상의 복구 계획'}));
  expect(await screen.findByRole('heading', {name: '중단 작업 복구 계획'})).toBeInTheDocument();
  expect(deployApi.applyManifestRecovery).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', {name: '계획 저장 (24시간)'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: '복구 승인'}));
  expect(deployApi.applyManifestRecovery).toHaveBeenCalledWith('recovery-1');
});

it('allows a blank version for reviewed CLI binaries without claiming desktop verification', async () => {
  vi.mocked(deployApi.fetchManifestDeploymentHistory).mockResolvedValue({transactions: []});
  vi.mocked(deployApi.planManifestDeployment).mockResolvedValue({planId: 'observed', kind: 'apply', automatic: true, expiresAt: '2026-09-27T10:00:00Z', operations: [], blocked: []});
  const user = userEvent.setup();
  render(<ManifestDeploymentPanel scope="project" clientId="codex" clients={[{
    ...clients[0], defaultSurface: 'cli', surfaces: [
      {id: 'cli', displayName: 'Codex CLI', configStore: 'codex-local', runtimeState: 'partially-verified', runtimeEvidence: [
        {capabilityId: 'skills-project', version: '0.145.0', platform: 'darwin', arch: 'arm64', verifiedAt: '2026-09-27', source: 'fixture', binarySha256: 'a'.repeat(64)}
      ]},
      {id: 'desktop', displayName: 'Codex app', configStore: 'codex-local', runtimeState: 'unverified', runtimeEvidence: []}
    ]
  }]} projectName="default" projectPath="/tmp/project" clientVersion="" setClientVersion={vi.fn()} />);
  expect(screen.getByLabelText('클라이언트 버전 (검증 설치본은 자동 확인)')).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await waitFor(() => expect(deployApi.planManifestDeployment).toHaveBeenLastCalledWith(expect.objectContaining({surface: 'cli', clientVersion: undefined})));
  await user.selectOptions(screen.getByRole('combobox', {name: '실행 화면'}), 'desktop');
  expect(screen.getByLabelText('클라이언트 버전 (지원 판정에 필요)')).toBeInTheDocument();
});
