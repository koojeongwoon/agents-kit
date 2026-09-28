import {useEffect, useState} from 'react';
import {fetchDaemonStatus, type DaemonStatus} from '../../api/daemon';

const connections: Record<DaemonStatus['connection'], string> = {
  connected: '연결됨', not_configured: '연결 설정 없음', unavailable: '연결 불가',
  permission_denied: '조회 권한 거부', untrusted: '데몬 신원 확인 실패', timeout: '응답 시간 초과', incompatible: '지원하지 않는 버전'
};
const executions = {preflight_passed: '사전 검사 통과 · 호출 시 재검사', blocked: '실행 차단', unverified: '실행 가능 여부 미확인'};
const policies = {valid: '유효', expired: '만료', unverified: '미확인'};
const capabilities: Record<string, string> = {
  'status.read.v1': '상태 조회 v1', 'signed_policy.v3_v4': '서명 정책 v3/v4',
  'native_worker.experimental': '네이티브 MCP 실행 · 실험 단계'
};
const eventKinds = {intent: '실행 접수', completed: '완료', denied: '거부', failed: '실패', interrupted: '중단 · 결과 미확인'};
const date = (value: number | null) => value === null ? '미확인' : new Date(value).toLocaleString('ko-KR');

export function DaemonStatusPanel() {
  const [result, setResult] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      setLoading(true);
      try {
        const next = await fetchDaemonStatus();
        if (current) { setResult(next); setError(false); setNow(Date.now()); }
      } catch {
        if (current) { setResult(null); setError(true); }
      } finally {
        if (current) { setLoading(false); timer = setTimeout(read, 5000); }
      }
    };
    void read();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { current = false; clearTimeout(timer); clearInterval(clock); };
  }, [refresh]);

  const snapshot = result?.snapshot;
  const stale = !!result && now >= Math.min(result.checkedAt, snapshot?.observedAt ?? result.checkedAt) + result.staleAfterMs;
  const expired = snapshot?.policy.expiresAt !== null && snapshot?.policy.expiresAt !== undefined && now >= snapshot.policy.expiresAt;
  const connection = error ? '상태 조회 실패' : stale ? '상태 만료 · 다시 확인 중' : result ? connections[result.connection] : '조회 중';

  return (
    <section aria-label="로컬 데몬 상태" className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">로컬 데몬</h2>
          <p className="mt-1 text-xs text-slate-500">이 PC의 관리 실행 상태입니다. 데몬 연결 없이도 로컬 자원을 관리할 수 있습니다.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-50 dark:border-slate-700">
          {loading ? '조회 중…' : '데몬 상태 새로고침'}
        </button>
      </div>
      <p role="status" className="mt-4 font-bold">{connection}</p>
      {error && <p role="alert" className="mt-2 text-sm text-amber-600">상태를 확인하지 못했습니다. 잠시 후 다시 조회하세요.</p>}
      {result && result.connection !== 'connected' && <p className="mt-2 text-sm text-slate-500">{result.message} <code>{result.code}</code></p>}
      {snapshot && <>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">관리 도구 실행</dt><dd className="mt-1 font-semibold">{stale ? '실행 가능 여부 미확인' : expired ? '실행 차단' : executions[snapshot.execution.state]}</dd></div>
          <div><dt className="text-slate-500">데몬 버전</dt><dd className="mt-1">{snapshot.daemonVersion}</dd></div>
          <div><dt className="text-slate-500">정책</dt><dd className="mt-1">{stale ? '미확인' : expired ? '만료' : policies[snapshot.policy.state]} · 버전 {snapshot.policy.revision ?? '미확인'}</dd></div>
          <div><dt className="text-slate-500">정책 만료 시각</dt><dd className="mt-1">{date(snapshot.policy.expiresAt)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">{stale ? '이전 조회 결과입니다.' : '개별 도구 실행은 요청마다 다시 검증합니다.'} <code>{expired ? 'POLICY_EXPIRED' : snapshot.execution.reason}</code></p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="데몬 지원 기능">
          {snapshot.capabilities.map(id => <span key={id} className="rounded-full bg-slate-500/10 px-3 py-1 text-xs">{capabilities[id] || id}</span>)}
        </div>
        <h3 className="mt-5 text-sm font-bold">최근 관리 실행 이벤트</h3>
        {snapshot.recentEvents.length === 0 ? <p className="mt-2 text-xs text-slate-500">표시할 이벤트가 없습니다.</p>
          : <ul className="mt-2 space-y-2 text-xs text-slate-500">
            {[...snapshot.recentEvents].reverse().map(event => <li key={event.sequence}>
              {date(event.observedAt)} · {eventKinds[event.kind]} · 정책 {event.policyRevision ?? '미확인'}
            </li>)}
          </ul>}
      </>}
      {result && <p className="mt-4 text-xs text-slate-500">마지막 조회: {date(result.checkedAt)} · 5초마다 조회</p>}
    </section>
  );
}
