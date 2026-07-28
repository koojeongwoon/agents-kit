import {describe, expect, it, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import {ControlCenterHome} from './ControlCenterHome';
import type {ClientSummary, LocalClientDiscovery} from '../../api/deploy';

const clients: ClientSummary[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    detection: {commands: ['codex'], userRoot: '~/.codex'},
    capabilities: [{assetKind: 'mcp', scope: 'global', status: 'stable'}]
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    detection: {commands: ['cursor'], userRoot: '~/.cursor'},
    capabilities: [{assetKind: 'mcp', scope: 'global', status: 'stable'}]
  }
];

const localDiscovery: LocalClientDiscovery[] = [
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
    id: 'cursor',
    displayName: 'Cursor',
    supported: true,
    installed: false,
    configured: false,
    signals: {commands: [], userRootExists: false},
    assets: [],
    issues: [{code: 'INVALID_JSON', sourcePath: '~/.cursor/mcp.json'}]
  }
];

describe('ControlCenterHome', () => {
  it('shows adapter support, installation, and configuration as independent states', () => {
    render(
      <ControlCenterHome
        clients={clients}
        localDiscovery={localDiscovery}
        resources={[]}
        targetReady
        scope="global"
        onOpenMcp={vi.fn()}
        onOpenDeploy={vi.fn()}
      />
    );

    const codex = screen.getByRole('article', {name: 'Codex 환경 상태'});
    expect(within(codex).getByText('지원 정의됨')).toBeInTheDocument();
    expect(within(codex).getByText('PC에 설치됨')).toBeInTheDocument();
    expect(within(codex).getByText('설정 발견')).toBeInTheDocument();

    const cursor = screen.getByRole('article', {name: 'Cursor 환경 상태'});
    expect(within(cursor).getByText('지원 정의됨')).toBeInTheDocument();
    expect(within(cursor).getByText('지원만 됨')).toBeInTheDocument();
  });

  it('summarizes unreadable settings without exposing an absolute home path', () => {
    render(
      <ControlCenterHome
        clients={clients}
        localDiscovery={localDiscovery}
        resources={[]}
        targetReady
        scope="global"
        onOpenMcp={vi.fn()}
        onOpenDeploy={vi.fn()}
      />
    );

    expect(screen.getByText('일부 설정을 읽지 못했습니다')).toBeInTheDocument();
    expect(screen.getByText('~/.cursor/mcp.json')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('/Users/');
  });
});
