import {describe, expect, it, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ResourceWorkspace} from './ResourceWorkspace';
import type {ClientSummary, LocalClientDiscovery, RegistryResource} from '../../api/deploy';

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
    expect(screen.getByRole('heading', {name: 'Observability'})).toBeInTheDocument();
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

  it('merges PC discovery with Agent Kit resources and keeps PC-only rows read-only', () => {
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
    expect(within(registered).getByText('PC에서 발견')).toBeInTheDocument();
    expect(within(registered).getByText('Agent Kit 등록됨')).toBeInTheDocument();
    expect(within(registered).getByText('Codex')).toBeInTheDocument();

    const pcOnly = screen.getByRole('article', {name: 'playwright 리소스'});
    expect(within(pcOnly).getByText('PC에서 발견')).toBeInTheDocument();
    expect(within(pcOnly).getByText('읽기 전용')).toBeInTheDocument();
    expect(within(pcOnly).getByText('Codex')).toBeInTheDocument();
    expect(within(pcOnly).queryByRole('button', {name: '편집'})).not.toBeInTheDocument();
    expect(within(pcOnly).queryByRole('button', {name: /배포 검토/})).not.toBeInTheDocument();
  });
});

it('does not promote schema 2 file contracts to resource runtime support', () => {
  render(<ResourceWorkspace view="mcp" clients={[{...clients[0], schemaVersion: 2}]} localDiscovery={[]}
    resources={[resources[0]]} targetReady loading={false} error="" onOpenEditor={vi.fn()} onOpenDeploy={vi.fn()} />);
  expect(screen.getByText('Codex · 파일 계약')).toBeInTheDocument();
  expect(screen.queryByText('Codex · 지원')).not.toBeInTheDocument();
  expect(screen.getByText(/실제 적용 가능 여부는 실행 화면·설치본·자원 옵션을 배포 계획에서 확인/)).toBeInTheDocument();
});
