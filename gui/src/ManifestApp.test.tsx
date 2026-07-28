import {afterEach, describe, expect, it, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
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

describe('Agent Kit control center shell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('uses semantic MCP, Skill, Agent, and Harness navigation', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(clientCatalogResponse());
    const user = userEvent.setup();

    render(<ManifestApp />);

    const navigation = screen.getByRole('navigation', {name: '주요 자산'});
    expect(within(navigation).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'MCP',
      'Skill',
      'Agent',
      'Harness'
    ]);

    await user.click(within(navigation).getByRole('tab', {name: 'Skill'}));
    expect(screen.getByRole('heading', {name: 'Skill 라이브러리'})).toBeInTheDocument();
  });

  it('shows every data-driven client instead of a hard-coded client pair', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(clientCatalogResponse());

    render(<ManifestApp />);

    const environments = await screen.findByLabelText('지원 환경');
    expect(within(environments).getByText('Codex')).toBeInTheDocument();
    expect(within(environments).getByText('Antigravity')).toBeInTheDocument();
  });

  it('keeps deployment target controls in the shared context instead of duplicating them', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(clientCatalogResponse());
    const user = userEvent.setup();
    render(<ManifestApp />);

    await user.click(screen.getByRole('button', {name: '배포 센터'}));

    expect(screen.getAllByRole('combobox', {name: '현재 배포 환경'})).toHaveLength(1);
    expect(screen.queryByRole('combobox', {name: 'Client'})).not.toBeInTheDocument();
    expect(screen.getByText('프로젝트 Kit · default')).toBeInTheDocument();
  });
});
