import {useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle2, Clock3, History, Play, RotateCcw, ShieldCheck, Activity} from 'lucide-react';
import {
  applyManifestDeployment,
  applyManifestRollback,
  fetchManifestDeploymentHistory,
  ManifestDeploymentPlan,
  planManifestDeployment,
  planManifestRollback,
  validateManifest,
  runDoctorDiagnostics,
  type ClientSummary
} from '../../api/deploy';

import { ActionableErrorResolution } from '../common/ActionableErrorResolution';

interface Transaction {
  id: string;
  type: 'apply' | 'rollback';
  status: string;
  createdAt: string;
  clientIds?: string[];
  operations?: {target: string}[];
}

interface ManifestDeploymentPanelProps {
  scope: 'global' | 'project';
  clientId: string;
  clients: ClientSummary[];
  projectName: string;
  projectPath: string;
  clientVersion: string;
  setClientVersion: (clientVersion: string) => void;
  onNavigateToAsset?: (assetId: string) => void;
}

export function ManifestDeploymentPanel({
  scope,
  clientId,
  clients,
  projectName,
  projectPath,
  clientVersion,
  setClientVersion,
  onNavigateToAsset
}: ManifestDeploymentPanelProps) {
  const [plan, setPlan] = useState<ManifestDeploymentPlan | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastErrorCode, setLastErrorCode] = useState('');
  const [lastRequestId, setLastRequestId] = useState('');
  const [lastRemediation, setLastRemediation] = useState('');
  const [message, setMessage] = useState('');
  const [doctorResult, setDoctorResult] = useState<any>(null);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const request = {
    clientId,
    scope,
    projectName,
    projectPath: scope === 'project' ? projectPath.trim() : '',
    clientVersion: clientVersion.trim() || undefined
  };
  const targetReady = scope === 'global' || projectPath.trim().length > 0;
  const currentClientName = clients.find(client => client.id === clientId)?.displayName || clientId;

  const refreshHistory = async () => {
    if (!targetReady) {
      setTransactions([]);
      return;
    }
    try {
      const data = await fetchManifestDeploymentHistory(request);
      setTransactions(data.transactions || []);
    } catch {
      setTransactions([]);
    }
  };

  useEffect(() => {
    setPlan(null);
    setError('');
    setLastErrorCode('');
    setLastRequestId('');
    setLastRemediation('');
    setMessage('');
    setDoctorResult(null);
    setValidationResult(null);
    refreshHistory().catch(console.error);
  }, [scope, clientId, projectName, projectPath, clientVersion]);

  const runDiagnostics = async () => {
    if (!targetReady) {
      setError('프로젝트 경로를 입력해야 시스템 진단을 실행할 수 있습니다.');
      setLastErrorCode('PROJECT_PATH_REQUIRED');
      setLastRequestId('');
      setLastRemediation('');
      return;
    }
    setDiagnosticsLoading(true);
    setError('');
    setMessage('');
    try {
      const doc = await runDoctorDiagnostics({ ...request, clientVersion });
      setDoctorResult(doc);

      const val = await validateManifest(request);
      setValidationResult(val);

      setMessage('진단 및 유효성 검사가 완료되었습니다.');
    } catch (cause: any) {
      setError(cause.message || '진단에 실패했습니다.');
      setLastErrorCode(cause.code || 'DIAGNOSTICS_ERROR');
      setLastRequestId(cause.requestId || '');
      setLastRemediation(cause.remediation || '');
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const createPlan = async () => {
    if (!targetReady) {
      setError('프로젝트 경로를 입력해야 배포 계획을 만들 수 있습니다.');
      setLastErrorCode('PROJECT_PATH_REQUIRED');
      setLastRequestId('');
      setLastRemediation('');
      return;
    }
    setLoading(true);
    setError('');
    setLastErrorCode('');
    setLastRequestId('');
    setLastRemediation('');
    setMessage('');
    try {
      setPlan(await planManifestDeployment(request));
    } catch (cause: any) {
      setError(cause.message || '계획을 만들지 못했습니다.');
      setLastErrorCode(cause.code || 'PLAN_ERROR');
      setLastRequestId(cause.requestId || '');
      setLastRemediation(cause.remediation || '');
    } finally {
      setLoading(false);
    }
  };

  const applyPlan = async () => {
    if (!plan) return;
    setLoading(true);
    setError('');
    setLastErrorCode('');
    setLastRequestId('');
    setLastRemediation('');
    try {
      const result = plan.kind === 'rollback'
        ? await applyManifestRollback(plan.planId)
        : await applyManifestDeployment(plan.planId);
      setMessage(plan.kind === 'rollback'
        ? `Rollback 완료: ${result.transactionId}`
        : `배포 완료: ${result.transactionId}`);
      setPlan(null);
      await refreshHistory();
    } catch (cause: any) {
      setError(cause.message || '적용하지 못했습니다.');
      setLastErrorCode(cause.code || 'APPLY_ERROR');
      setLastRequestId(cause.requestId || '');
      setLastRemediation(cause.remediation || '');
    } finally {
      setLoading(false);
    }
  };

  const createRollbackPlan = async (transactionId: string) => {
    setLoading(true);
    setError('');
    setLastErrorCode('');
    setLastRequestId('');
    setLastRemediation('');
    setMessage('');
    try {
      setPlan(await planManifestRollback({...request, transactionId}));
    } catch (cause: any) {
      setError(cause.message || 'Rollback 계획을 만들지 못했습니다.');
      setLastErrorCode(cause.code || 'ROLLBACK_PLAN_ERROR');
      setLastRequestId(cause.requestId || '');
      setLastRemediation(cause.remediation || '');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-[0.2em]">Manifest Control Plane</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">계획을 확인한 뒤 안전하게 적용하세요</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              Manifest와 클라이언트 capability를 검증하고, 소유권 충돌과 변경 내용을 먼저 보여줍니다.
              계획 승인 전에는 대상 파일을 변경하지 않습니다.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Transactional apply</div>
            <p className="mt-1 text-emerald-700/70 dark:text-emerald-300/70">백업 · 검증 · rollback 기록</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_1fr_240px]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">관리 대상</p>
            <p className="mt-2 text-sm font-bold">
              {scope === 'global' ? '내 PC 전역' : `프로젝트 Kit · ${projectName}`}
            </p>
            <p className={`mt-1 truncate font-mono text-[11px] ${targetReady ? 'text-slate-500' : 'text-amber-600'}`}>
              {scope === 'global' ? '사용자 전역 설정' : projectPath.trim() || '프로젝트 경로가 필요합니다'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">배포 환경</p>
            <p className="mt-2 text-sm font-bold">{currentClientName}</p>
            <p className="mt-1 text-[11px] text-slate-500">상단 공통 컨텍스트에서 변경</p>
          </div>
          <label htmlFor="deployment-client-version" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:border-slate-800 dark:bg-slate-950/60">
            클라이언트 버전 (선택)
            <input
              id="deployment-client-version"
              value={clientVersion}
              onChange={event => setClientVersion(event.target.value)}
              placeholder="예: 1.0.0"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-normal normal-case tracking-normal text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-200 pt-5 dark:border-slate-800">
          <div>
            <p className={`text-xs font-semibold ${targetReady ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
              {targetReady
                ? '배포 계획을 만들 수 있습니다. 시스템 진단은 선택 사항입니다.'
                : '프로젝트 경로를 입력하면 배포 계획과 선택 진단을 실행할 수 있습니다.'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">계획은 5분 동안 한 번만 적용할 수 있습니다.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={runDiagnostics} disabled={diagnosticsLoading} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-300 dark:hover:bg-slate-800">
              <Activity className="h-4 w-4" /> {diagnosticsLoading ? '진단 중…' : '선택 진단 (Doctor)'}
            </button>
            <button onClick={createPlan} disabled={loading} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">
              <Play className="h-4 w-4" /> {loading ? '검증 중…' : '배포 계획 만들기'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        lastErrorCode ? (
          <ActionableErrorResolution
            errorCode={lastErrorCode}
            message={error}
            requestId={lastRequestId}
            remediation={lastRemediation}
            onCancelPlan={() => {
              setPlan(null);
              setError('');
              setLastErrorCode('');
              setLastRequestId('');
              setLastRemediation('');
            }}
            onRePlan={createPlan}
          />
        ) : (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )
      )}
      {message && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{message}</div>}

      {(doctorResult || validationResult) && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-500" /> 시스템 진단 및 검증 (Doctor & Validate)
          </h3>

          <div className="mt-4 space-y-4">
            {/* Manifest Validation Result */}
            {validationResult && (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                <h4 className="text-sm font-bold flex items-center gap-2">
                  Manifest 유효성 검사:
                  {validationResult.valid ? (
                    <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> 유효함</span>
                  ) : (
                    <span className="text-xs text-rose-500 font-semibold flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> 오류 발견</span>
                  )}
                </h4>
                {validationResult.issues.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {validationResult.issues.map((issue: any, index: number) => (
                      <ActionableErrorResolution
                        key={index}
                        errorCode={issue.code}
                        message={issue.message}
                        sourceAssetId={issue.sourceAssetId}
                        onNavigate={onNavigateToAsset}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">Manifest 구조 및 관계 정의가 완벽합니다.</p>
                )}
              </div>
            )}

            {/* Doctor Checks */}
            {doctorResult && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold">로컬 배포 진단 (Doctor Checks)</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {doctorResult.checks.map((check: any) => {
                    const isHealthy = check.status === 'healthy';
                    const isWarning = check.status === 'warning';
                    return (
                      <div key={check.id} className={`rounded-2xl border p-4 flex flex-col justify-between ${
                        isHealthy ? 'border-emerald-500/20 bg-emerald-500/5' :
                        isWarning ? 'border-amber-500/25 bg-amber-500/5' : 'border-rose-500/25 bg-rose-500/5'
                      }`}>
                        <div>
                          <div className="flex items-center gap-2">
                            {isHealthy ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> :
                             isWarning ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" /> :
                             <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />}
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{check.id}</span>
                          </div>
                          <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">{check.message}</p>
                          {check.remediation && (
                            <p className="mt-1 text-[11px] text-slate-500 border-t border-slate-200/50 dark:border-slate-800/50 pt-1 mt-2">
                              💡 {check.remediation}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {plan && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Clock3 className="h-4 w-4" /> {new Date(plan.expiresAt).toLocaleTimeString()}까지 유효</div>
              <h3 className="mt-1 text-lg font-bold">{plan.kind === 'rollback' ? 'Rollback 계획' : '배포 계획'}</h3>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${plan.automatic ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300'}`}>
              {plan.automatic ? '적용 가능' : `${plan.blocked.length}개 차단`}
            </span>
          </div>
          <div className="mt-5 max-h-80 space-y-2 overflow-y-auto pr-1">
            {[...plan.operations, ...plan.blocked].map((operation, index) => {
              const blocked = index >= plan.operations.length;
              return (
                <div key={`${operation.target}-${index}`} className={`rounded-2xl border p-4 ${blocked ? 'border-rose-500/25 bg-rose-500/5' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold uppercase tracking-wide">{blocked ? 'BLOCKED' : operation.operation}</span>
                    <span className="text-[11px] text-slate-500">{operation.strategy || operation.ownership}</span>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{operation.target || operation.assetId}</p>
                  <p className={`mt-1 text-xs ${blocked ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500'}`}>{operation.reason}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
            <button onClick={() => setPlan(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">취소</button>
            <button onClick={applyPlan} disabled={loading || !plan.automatic} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
              {plan.kind === 'rollback' ? 'Rollback 승인' : '적용 승인'}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><History className="h-5 w-5 text-violet-500" /><h3 className="text-lg font-bold">트랜잭션 이력</h3></div>
          <button onClick={() => refreshHistory().catch(console.error)} disabled={!targetReady} className="text-xs font-semibold text-blue-600 disabled:opacity-40 dark:text-blue-400">새로고침</button>
        </div>
        <div className="mt-4 space-y-2">
          {transactions.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">아직 기록된 트랜잭션이 없습니다.</p>}
          {[...transactions].reverse().map(transaction => (
            <div key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2"><span className="text-xs font-bold uppercase">{transaction.type}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">{transaction.status}</span></div>
                <p className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400">{transaction.id}</p>
                <p className="mt-1 text-[11px] text-slate-500">{transaction.createdAt} · {transaction.operations?.length || 0} targets</p>
              </div>
              {transaction.type === 'apply' && transaction.status === 'committed' && (
                <button onClick={() => createRollbackPlan(transaction.id)} disabled={loading} className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                  <RotateCcw className="h-3.5 w-3.5" /> Rollback 계획
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
