import {act, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DaemonStatusPanel} from './DaemonStatusPanel';
import {fetchDaemonStatus, type DaemonStatus} from '../../api/daemon';
vi.mock('../../api/daemon', () => ({fetchDaemonStatus: vi.fn()}));
const read = vi.mocked(fetchDaemonStatus);
const epoch = 1800000000000;
const connected = (): DaemonStatus => ({schemaVersion: 1, checkedAt: Date.now(), staleAfterMs: 10000,
  connection: 'connected', code: 'DAEMON_CONNECTED', message: '', snapshot: {
    schemaVersion: 1, daemonVersion: '0.1.0', scope: 'native_mcp_worker', observedAt: Date.now(),
    capabilities: ['status.read.v1', 'native_worker.experimental'],
    policy: {state: 'valid', revision: 4, expiresAt: Date.now() + 60000},
    execution: {state: 'preflight_passed', reason: 'CALL_RECHECK_REQUIRED'},
    recentEvents: [{sequence: 1, kind: 'denied', observedAt: Date.now(), policyRevision: null}]
  }});
async function mount() { await act(async () => { render(<DaemonStatusPanel />); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe('local daemon status', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(epoch); read.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders version, capabilities, expiry and allowed event metadata with separate readiness', async () => {
    read.mockResolvedValue(connected()); await mount();
    expect(screen.getByRole('status')).toHaveTextContent('연결됨');
    expect(screen.getByText('사전 검사 통과 · 호출 시 재검사')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('네이티브 MCP 실행 · 실험 단계')).toBeInTheDocument();
    expect(screen.getByText(/거부 · 정책 미확인/)).toBeInTheDocument();
  });

  it('keeps standalone use clear when no daemon is configured', async () => {
    read.mockResolvedValue({...connected(), connection: 'not_configured', code: 'DAEMON_NOT_CONFIGURED',
      snapshot: null, message: '로컬 자원 관리는 그대로 사용할 수 있습니다.'}); await mount();
    expect(screen.getByRole('status')).toHaveTextContent('연결 설정 없음');
    expect(screen.getByText(/로컬 자원 관리는 그대로/)).toBeInTheDocument();
  });

  it('clears success on stop and on permission failure, then recovers after restart', async () => {
    read.mockResolvedValueOnce(connected())
      .mockResolvedValueOnce({...connected(), connection: 'permission_denied', code: 'DAEMON_PERMISSION_DENIED', snapshot: null})
      .mockRejectedValueOnce(new Error('private error must not render'))
      .mockImplementation(async () => connected());
    await mount(); await advance(5000);
    expect(screen.getByRole('status')).toHaveTextContent('조회 권한 거부');
    expect(screen.queryByText('사전 검사 통과 · 호출 시 재검사')).not.toBeInTheDocument();
    await advance(5000);
    expect(screen.getByRole('status')).toHaveTextContent('상태 조회 실패');
    expect(screen.queryByText(/private error/)).not.toBeInTheDocument();
    await advance(5000);
    expect(screen.getByRole('status')).toHaveTextContent('연결됨');
  });

  it('ages a previous success while a later request is pending and expires policy locally', async () => {
    const value = connected(); value.snapshot!.policy.expiresAt = epoch + 2000;
    read.mockResolvedValueOnce(value).mockImplementation(() => new Promise(() => {}));
    await mount(); await advance(2000);
    expect(screen.getByText('실행 차단')).toBeInTheDocument();
    expect(screen.getByText('POLICY_EXPIRED')).toBeInTheDocument();
    await advance(9000);
    expect(screen.getByRole('status')).toHaveTextContent('상태 만료');
    expect(screen.getByText('실행 가능 여부 미확인')).toBeInTheDocument();
  });

  it('shows incompatible daemon distinctly and permits an explicit refresh', async () => {
    read.mockResolvedValueOnce({...connected(), connection: 'incompatible', code: 'DAEMON_INCOMPATIBLE', snapshot: null})
      .mockResolvedValueOnce(connected());
    await mount();
    expect(screen.getByRole('status')).toHaveTextContent('지원하지 않는 버전');
    await act(async () => screen.getByRole('button', {name: '데몬 상태 새로고침'}).click());
    expect(screen.getByRole('status')).toHaveTextContent('연결됨');
  });
});
