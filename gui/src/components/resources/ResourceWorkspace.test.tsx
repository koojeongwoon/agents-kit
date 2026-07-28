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
