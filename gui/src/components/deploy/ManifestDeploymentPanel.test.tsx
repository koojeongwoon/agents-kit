import {beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as deployApi from '../../api/deploy';
import {ManifestDeploymentPanel} from './ManifestDeploymentPanel';

vi.mock('../../api/deploy', () => ({
  saveManifestPlan: vi.fn(), fetchSavedManifestPlans: vi.fn(), resumeManifestPlan: vi.fn(),
  planManifestRecovery: vi.fn(), applyManifestRecovery: vi.fn(),
  planManifestDeployment: vi.fn(),
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
    operations: [{assetId: 'review', target: '/project/.agents/skills/review/SKILL.md', operation: 'RELEASE', reason: 'SHARED_CONSUMER_REMOVAL', consumers: ['kit:antigravity:cli'], metadataOnly: true}]
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
  const saved = {planId: 'saved-1', digest: 'a'.repeat(64), kind: 'apply', status: 'ready', expiresAt: '2099-01-01', targetRoot: '/project', operations: [{target: '/project/AGENTS.md', operation: 'CREATE'}]};
  vi.mocked(deployApi.saveManifestPlan).mockResolvedValue(saved);
  vi.mocked(deployApi.fetchSavedManifestPlans).mockResolvedValue({plans: [{...saved, status: 'completed'}]});
  vi.mocked(deployApi.resumeManifestPlan).mockResolvedValue({transactionId: 'tx-saved-1'});
  const user = userEvent.setup(); renderPanel('global');
  await user.click(screen.getByRole('button', {name: '배포 계획 만들기'}));
  await user.click(await screen.findByRole('button', {name: '계획 저장 (24시간)'}));
  expect(deployApi.saveManifestPlan).toHaveBeenCalledWith('saved-1');
  expect(deployApi.resumeManifestPlan).not.toHaveBeenCalled();
  expect(deployApi.applyManifestDeployment).not.toHaveBeenCalled();
  await user.click(screen.getByText('저장 계획과 중단 작업 복구'));
  expect(screen.getByText(/검토 digest:/)).toHaveTextContent(saved.digest);
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
