import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ResourceWorkspace} from './ResourceWorkspace';
import type {ClientSummary, RegistryResource} from '../../api/deploy';

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
});
