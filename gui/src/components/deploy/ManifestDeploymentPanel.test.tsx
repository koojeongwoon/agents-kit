import {beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as deployApi from '../../api/deploy';
import {ManifestDeploymentPanel} from './ManifestDeploymentPanel';

vi.mock('../../api/deploy', () => ({
  planManifestDeployment: vi.fn(),
  applyManifestDeployment: vi.fn(),
  applyManifestRollback: vi.fn(),
  fetchManifestDeploymentHistory: vi.fn(),
  planManifestRollback: vi.fn(),
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
