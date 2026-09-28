import {useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle2, Clock3, History, Play, RotateCcw, ShieldCheck, Activity} from 'lucide-react';
import {
  saveManifestPlan, fetchSavedManifestPlans, resumeManifestPlan, planManifestRecovery, applyManifestRecovery,
  type SavedDeploymentPlan,
  applyManifestDeployment,
  applyManifestRollback,
  fetchManifestDeploymentHistory,
  ManifestDeploymentPlan,
  planManifestDeployment,
  planManifestRollback,
  planManifestRemoval,
  planManifestMigration,
  validateManifest,
  runDoctorDiagnostics,
  type ClientSummary
} from '../../api/deploy';

import { ActionableErrorResolution } from '../common/ActionableErrorResolution';

interface Transaction {
  id: string;
  type: 'apply' | 'rollback' | 'ledger-migration';
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
  const [otherClientId, setOtherClientId] = useState('');
  const [otherSurface, setOtherSurface] = useState('');
  const [migrationAssets, setMigrationAssets] = useState('');
  const [otherVersion, setOtherVersion] = useState('');
  const [removalAssets, setRemovalAssets] = useState('');
  const [plan, setPlan] = useState<ManifestDeploymentPlan | null>(null);
  const [savedPlans, setSavedPlans] = useState<SavedDeploymentPlan[]>([]);
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

  const currentClient = clients.find(client => client.id === clientId);
  const [surfaceSelection, setSurfaceSelection] = useState({clientId, id: ''});
  const surface = currentClient?.surfaces
    ? (surfaceSelection.clientId === clientId && surfaceSelection.id
      ? surfaceSelection.id : currentClient.defaultSurface)
    : undefined;

  const request = {
    clientId,
    surface,
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
  }, [scope, clientId, projectName, projectPath, clientVersion, surface, otherClientId, otherVersion, otherSurface, removalAssets, migrationAssets]);

  const refreshSavedPlans = async () => {
    const data = await fetchSavedManifestPlans();
    setSavedPlans(data.plans);
  };

  const persistentAction = async (action: () => Promise<void>) => {
    setLoading(true); setError(''); setMessage('');
    setLastErrorCode(''); setLastRequestId(''); setLastRemediation('');
    try { await action(); }
    catch (cause: any) {
      setError(cause.message || '저장 계획 또는 복구를 처리하지 못했습니다.');
      setLastErrorCode(cause.code || 'PERSISTENT_PLAN_ERROR');
      setLastRequestId(cause.requestId || '');
    } finally { setLoading(false); }
  };

  const savePlan = () => persistentAction(async () => {
    if (!plan) return;
    const saved = await saveManifestPlan(plan.planId);
    setPlan(null); setSavedPlans(current => [...current.filter(item => item.planId !== saved.planId), saved]);
    setMessage('계획을 저장했습니다. 저장 계획에서 내용을 확인한 뒤 재개할 수 있습니다.');
  });

  const resumePlan = (saved: SavedDeploymentPlan) => persistentAction(async () => {
    const result = await resumeManifestPlan(saved.planId, saved.digest);
    setPlan(null); setMessage(`저장 계획 완료: ${result.transactionId}`);
    await refreshSavedPlans(); await refreshHistory();
  });

  const createRecoveryPlan = () => persistentAction(async () => {
    setPlan(null); setPlan(await planManifestRecovery(request));
  });

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
      setPlan(await planManifestDeployment(otherClientId
        ? {scope, projectName, projectPath: request.projectPath, targets: [
            {clientId, surface, clientVersion: request.clientVersion},
            {clientId: otherClientId, surface: otherSurface || clients.find(item => item.id === otherClientId)?.defaultSurface, clientVersion: otherVersion.trim() || undefined}
          ]}
        : request));
    } catch (cause: any) {
      setError(cause.message || '계획을 만들지 못했습니다.');
      setLastErrorCode(cause.code || 'PLAN_ERROR');
      setLastRequestId(cause.requestId || '');
      setLastRemediation(cause.remediation || '');
    } finally {
      setLoading(false);
    }
  };

  const createRemovalPlan = async () => {
    if (!targetReady) {
      setError('프로젝트 경로를 입력해야 자원 제거를 계획할 수 있습니다.');
      return;
    }
    setLoading(true); setError(''); setPlan(null); setMessage('');
    setLastErrorCode(''); setLastRequestId(''); setLastRemediation('');
    try {
      setPlan(await planManifestRemoval({...request, assetIds: removalAssets.split(',').map(id => id.trim()).filter(Boolean)}));
    } catch (cause: any) {
      setError(cause.message || '제거 계획을 만들지 못했습니다.');
      setLastErrorCode(cause.code || 'PLAN_ERROR');
    } finally { setLoading(false); }
  };

  const createMigrationPlan = async (migration: 'global-ledger' | 'shared-ownership') => {
    if (!targetReady) { setError('프로젝트 경로를 입력해야 이관을 계획할 수 있습니다.'); return; }
    setLoading(true); setPlan(null); setError(''); setMessage('');
    setLastErrorCode(''); setLastRequestId(''); setLastRemediation('');
    try {
      setPlan(await planManifestMigration({...request, migration,
        ...(migration === 'shared-ownership' ? {assetIds: migrationAssets.split(',').map(id => id.trim()).filter(Boolean)} : {})}));
    } catch (cause: any) {
      setError(cause.message || '이관 계획을 만들지 못했습니다.');
      setLastErrorCode(cause.code || 'PLAN_ERROR');
      setLastRequestId(cause.requestId || ''); setLastRemediation(cause.remediation || '');
    } finally { setLoading(false); }
  };

  const applyPlan = async () => {
    if (!plan) return;
    setLoading(true);
    setError('');
    setLastErrorCode('');
    setLastRequestId('');
    setLastRemediation('');
    try {
      const result = plan.kind === 'recovery'
        ? await applyManifestRecovery(plan.planId)
        : plan.kind === 'rollback'
        ? await applyManifestRollback(plan.planId)
        : await applyManifestDeployment(plan.planId);
      setMessage(plan.kind === 'recovery'
        ? `복구 완료: ${result.transactionId}`
        : plan.kind === 'rollback'
        ? `Rollback 완료: ${result.transactionId}`
        : `${plan.kind === 'remove' ? '제거' : plan.kind === 'migration' ? '이관' : '배포'} 완료: ${result.transactionId}`);
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
            {currentClient?.surfaces && (
              <label className="mt-3 block text-xs">
                실행 화면
                <select aria-label="실행 화면" value={surface} onChange={event => setSurfaceSelection({clientId, id: event.target.value})}
                  className="mt-1 w-full rounded border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
                  {currentClient.surfaces.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select>
                <span className="mt-1 block text-slate-500">파일 경로와 실제 사용 검증은 별도로 확인합니다.</span>
              </label>
            )}
          </div>
          <label htmlFor="deployment-client-version" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:border-slate-800 dark:bg-slate-950/60">
            클라이언트 버전 {currentClient?.surfaces?.find(item => item.id === surface)?.runtimeEvidence?.some(record => record.binarySha256)
              ? '(검증 설치본은 자동 확인)' : currentClient?.surfaces ? '(지원 판정에 필요)' : '(선택)'}
            <input
              id="deployment-client-version"
              value={clientVersion}
              onChange={event => setClientVersion(event.target.value)}
              placeholder="예: 1.0.0"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-normal normal-case tracking-normal text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>

        {(<div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <label className="block text-xs">함께 적용할 클라이언트
                <select aria-label="함께 적용할 클라이언트" value={otherClientId} onChange={event => {setOtherClientId(event.target.value); setOtherVersion(''); setOtherSurface('');}} className="mt-2 w-full rounded border bg-transparent p-2">
                  <option value="">현재 클라이언트만</option>
                  {clients.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select>
              </label>
              {otherClientId && clients.find(item => item.id === otherClientId)?.surfaces && <select aria-label="함께 적용할 실행 화면" value={otherSurface || clients.find(item => item.id === otherClientId)?.defaultSurface} onChange={event => setOtherSurface(event.target.value)} className="mt-2 w-full rounded border bg-transparent p-2">
                {clients.find(item => item.id === otherClientId)?.surfaces?.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>}
              {otherClientId && <input aria-label="함께 적용할 클라이언트 버전" value={otherVersion} onChange={event => setOtherVersion(event.target.value)} placeholder="대상 버전" className="mt-2 w-full rounded border bg-transparent p-2 text-xs" />}
            </div>
            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <label className="block text-xs">현재 클라이언트에서 제거할 자원 ID
                <input aria-label="제거할 자원 ID" value={removalAssets} onChange={event => setRemovalAssets(event.target.value)} placeholder="shared-rules, source-review" className="mt-2 w-full rounded border bg-transparent p-2" />
              </label>
              <p className="mt-2 text-xs text-slate-500">공유 지침·Skill은 다른 소비자가 있으면 유지합니다. Agent·MCP는 소유 파일·설정 항목을 제거하므로 같은 설정을 읽는 실행 화면에도 반영됩니다. Manifest는 변경하지 않습니다.</p>
              <button onClick={createRemovalPlan} disabled={loading || !removalAssets.trim()} className="mt-2 rounded border px-3 py-2 text-xs disabled:opacity-40">제거 계획 만들기</button>
            </div>
          </div>
        )}

        <details className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <summary className="cursor-pointer text-sm font-semibold">기존 관리 기록 이관</summary>
          <p className="mt-2 text-xs text-slate-500">실행 중인 다른 Kit를 종료하고 이관 계획을 검토하세요. 클라이언트 파일 내용은 유지하며, 이전 버전 Kit는 이관한 원장을 사용할 수 없습니다.</p>
          {scope === 'global' && <button onClick={() => createMigrationPlan('global-ledger')} disabled={loading} className="mt-3 rounded border px-3 py-2 text-xs">전역 원장 이관 계획</button>}
          <label className="mt-3 block text-xs">공유 소유권으로 이관할 자원 ID
            <input aria-label="이관할 자원 ID" value={migrationAssets} onChange={event => setMigrationAssets(event.target.value)} placeholder="shared-rules, source-review" className="mt-2 w-full rounded border bg-transparent p-2" />
          </label>
          <button onClick={() => createMigrationPlan('shared-ownership')} disabled={loading || !migrationAssets.trim()} className="mt-2 rounded border px-3 py-2 text-xs disabled:opacity-40">공유 소유권 이관 계획</button>
        </details>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-200 pt-5 dark:border-slate-800">
          <div>
            <p className={`text-xs font-semibold ${targetReady ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
              {targetReady
                ? '배포 계획을 만들 수 있습니다. 시스템 진단은 선택 사항입니다.'
                : '프로젝트 경로를 입력하면 배포 계획과 선택 진단을 실행할 수 있습니다.'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">계획은 5분간 유효합니다. 적용 가능한 파일 계획을 저장하면 24시간 안에 재개할 수 있습니다.</p>
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
              <h3 className="mt-1 text-lg font-bold">{plan.kind === 'recovery' ? '중단 작업 복구 계획' : plan.kind === 'rollback' ? 'Rollback 계획' : plan.kind === 'remove' ? '관리 자원 제거 계획' : plan.kind === 'migration' ? '관리 기록 이관 계획' : '배포 계획'}</h3>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${plan.automatic ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300'}`}>
              {plan.automatic ? '적용 가능' : `${plan.blocked.length}개 차단`}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500">소비자 목록은 Kit에 등록된 사용 대상입니다. 같은 경로를 읽는 다른 클라이언트에도 파일이 보일 수 있습니다.</p>
          {plan.kind === 'recovery' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{plan.outcome === 'keep-committed' ? '원장에 완료된 변경을 보존하고 중단 기록을 정리합니다.' : '중단 전 파일 상태로 복원합니다. 외부 변경이 있으면 복구를 차단합니다.'}</p>}
          {plan.migration === 'global-ledger' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">기존 이력과 백업을 통합하고 클라이언트별 원장을 사용 중지합니다. 원장 구조의 역이관은 자동으로 지원하지 않습니다.</p>}
          {plan.stateUpgrade && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">소유권 원장을 버전 {plan.stateUpgrade.to}로 전환합니다. 이전 버전의 Kit는 이 원장을 관리할 수 없습니다.</p>}
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
                  {plan.kind === 'remove' && operation.changes?.map(change => <p key={change.assetId} className="mt-1 text-xs text-slate-500">제거 대상: {change.assetId}{change.selectors?.length ? ` · ${change.selectors.join(", ")}` : ""}</p>)}
                  {operation.consumers && <p className="mt-1 text-xs text-slate-500">남는 소비자: {operation.consumers.join(', ') || '없음'}{operation.metadataOnly ? ' · 파일 내용 유지' : ''}</p>}
                  <p className={`mt-1 text-xs ${blocked ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500'}`}>{operation.reason}</p>
                </div>
              );
            })}
          </div>
          {plan.previews?.map(preview => (
            <details key={`${preview.clientId || ''}:${preview.assetId}`} className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <summary className="cursor-pointer text-sm font-semibold">{preview.clientId ? `${preview.clientId} · ` : ''}{preview.assetId} · {preview.format} 변환 미리보기</summary>
              <p className="mt-2 break-all text-xs text-slate-500">{preview.target}</p>
              <p className="mt-1 text-xs text-slate-500">생성할 설정 조각입니다. 사용자 설정 원문은 표시하지 않습니다. 실제 적용 가능 여부는 위 판정을 따릅니다.</p>
              <p className="mt-1 text-xs">변경: {preview.operation} · {preview.supportReason}</p>
              {preview.notices?.map(notice => <p key={notice} className="mt-1 text-xs text-amber-700 dark:text-amber-300">{
                notice === 'AGENT_SANDBOX_DEFAULT_OVERRIDABLE'
                  ? '읽기 전용 기본 설정입니다. 부모 세션의 실행 설정으로 바뀔 수 있으며 강제 보안 정책을 보장하지 않습니다.'
                  : notice === 'AGENT_MCP_PROVIDER_SCOPE_ONLY'
                    ? '지정한 MCP 서버의 도구 목록만 설정합니다. 다른 서버와 기본 도구는 클라이언트 상속 규칙을 따릅니다.'
                    : notice
              }</p>)}
              {preview.conflicts.map((conflict, index) => <p key={index} className="text-xs text-rose-600">{conflict.reason}</p>)}
              <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-950">{preview.desired}</pre>
            </details>
          ))}
          <div className="mt-5 flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
            <button onClick={() => setPlan(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">취소</button>
            {plan.kind !== 'recovery' && plan.migration !== 'global-ledger' && !plan.operations.some(item => item.strategy === 'link' || item.operation === 'RESTORE_LINK') && <button onClick={savePlan} disabled={loading || !plan.automatic} className="rounded-xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">계획 저장 (24시간)</button>}
            <button onClick={applyPlan} disabled={loading || !plan.automatic} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
              {plan.kind === 'recovery' ? '복구 승인' : plan.kind === 'rollback' ? 'Rollback 승인' : plan.kind === 'remove' ? '제거 승인' : plan.kind === 'migration' ? '이관 승인' : '적용 승인'}
            </button>
          </div>
        </section>
      )}

      <details className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/50">
        <summary className="cursor-pointer text-lg font-bold">저장 계획과 중단 작업 복구</summary>
        <p className="mt-3 text-xs text-slate-500">현재 Kit의 저장 계획입니다. 대상과 변경 목록을 확인하세요. 재개 시 원본·설정·소유권이 달라졌으면 새 계획이 필요합니다.</p>
        <div className="mt-3 flex gap-3">
          <button onClick={() => persistentAction(refreshSavedPlans)} disabled={loading} className="rounded border px-3 py-2 text-xs">저장 계획 불러오기</button>
          <button onClick={createRecoveryPlan} disabled={loading || !targetReady} className="rounded border px-3 py-2 text-xs disabled:opacity-40">현재 대상의 복구 계획</button>
        </div>
        {savedPlans.map(saved => <div key={saved.planId} className="mt-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm font-semibold">{saved.kind} · {saved.status}</p>
          <p className="mt-1 break-all text-xs">대상: {saved.targetRoot}</p>
          <p className="mt-1 text-xs">만료: {new Date(saved.expiresAt).toLocaleString()}</p>
          <p className="mt-1 break-all font-mono text-xs">검토 digest: {saved.digest}</p>
          <ul className="mt-2 text-xs">{saved.operations.map((operation, index) => <li key={index} className="break-all">{operation.operation} · {operation.assetId || operation.clientId} · {operation.target}</li>)}</ul>
          <button onClick={() => resumePlan(saved)} disabled={loading || saved.status !== 'ready' || Date.parse(saved.expiresAt) <= Date.now()} className="mt-3 rounded border px-3 py-2 text-xs disabled:opacity-40">저장 계획 적용 승인</button>
        </div>)}
      </details>

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
