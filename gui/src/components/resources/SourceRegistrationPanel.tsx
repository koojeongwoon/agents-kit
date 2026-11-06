import {useState} from 'react';
import {applySourceManagement, planSourceManagement} from '../../api/deploy';
import type {LocalDiscoveryAsset, SourceManagementAction, SourceManagementPlan} from '../../api/deploy';

export function SourceRegistrationPanel({action, candidate, resourceId, scope, projectName, projectPath, onChanged, onClose}: {
  action: SourceManagementAction; candidate?: LocalDiscoveryAsset; resourceId?: string;
  scope: 'global' | 'project'; projectName?: string; projectPath?: string;
  onChanged: () => void; onClose: () => void;
}) {
  const [assetId, setAssetId] = useState(resourceId || candidate?.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || '');
  const [plan, setPlan] = useState<SourceManagementPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = action === 'import' ? 'Kit에 가져오기' : action === 'detach' ? '등록 해제' : '중단된 편입 복구';
  const review = async () => {
    setBusy(true); setError(''); setPlan(null);
    try {
      setPlan(await planSourceManagement(action, {scope, projectName, projectPath, assetId,
        ...(candidate ? {candidateId: candidate.candidateId, clientId: candidate.clientId, surface: candidate.surface, sourceScope: candidate.scope} : {})}));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '계획 생성 실패'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true); setError('');
    try { await applySourceManagement(action, plan.planId); onChanged(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '적용 실패'); setPlan(null); }
    finally { setBusy(false); }
  };
  return <section aria-label={title} className="rounded-3xl border border-blue-300 bg-white p-6 dark:border-blue-800 dark:bg-slate-900">
    <h2 className="text-lg font-bold">{title}</h2>
    <p className="mt-2 break-all text-xs text-slate-500">관리 범위: {scope === 'global' ? '전역' : `프로젝트 · ${projectName || 'default'} · ${projectPath || ''}`}</p>
    <p className="mt-2 text-sm text-slate-500">기존 설치 파일과 링크는 그대로 유지합니다. {action === 'import' ? 'Kit에 원본 사본을 등록합니다. 클라이언트 배포와 원본 업데이트 반영은 이후 별도로 검토합니다.' : action === 'detach' ? 'Kit 원본과 기준 사본도 보존합니다.' : '검증된 미완료 사본만 정리하거나, 완료된 등록을 유지합니다.'}</p>
    {candidate && <p className="mt-2 break-all font-mono text-xs">{candidate.path || candidate.sourcePath}</p>}
    {action === 'import' && <label className="mt-4 block text-sm">Kit 자원 ID
      <input aria-label="Kit 자원 ID" value={assetId} disabled={busy} onChange={event => {setAssetId(event.target.value); setPlan(null);}}
        className="ml-3 rounded border border-slate-300 bg-transparent px-3 py-2" />
    </label>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
    {plan && <div className="mt-4 space-y-3 text-xs">
      {plan.source && <p>{plan.source.fileCount}개 파일 · {plan.source.byteCount}바이트 · 기준 해시 <span className="break-all font-mono">{plan.source.fingerprint}</span></p>}
      {plan.stateUpgrade && <p>Manifest {plan.stateUpgrade.from} → {plan.stateUpgrade.to} 변환이 포함됩니다. 이전 버전의 Agent Kit은 새 Manifest를 읽지 못합니다.</p>}
      <ul className="max-h-48 overflow-auto rounded bg-slate-100 p-3 dark:bg-slate-950">{plan.operations.map((operation, index) => <li key={index} className="break-all py-1 font-mono">{operation.operation} {operation.path || operation.assetId}{operation.sha256 ? ` · ${operation.sha256}` : ''}</li>)}</ul>
      {plan.manifestDiff && <details><summary className="cursor-pointer font-bold">Manifest 변경 전·후</summary>
        <p className="mt-2">변경 전</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-3 dark:bg-slate-950">{plan.manifestDiff.before}</pre>
        <p className="mt-2">변경 후</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-3 dark:bg-slate-950">{plan.manifestDiff.after}</pre>
      </details>}
    </div>}
    <div className="mt-5 flex gap-3">
      <button disabled={busy} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm">닫기</button>
      <button disabled={busy} onClick={() => void review()} className="rounded-xl border px-4 py-2 text-sm">변경 계획 확인</button>
      {plan && <button disabled={busy} onClick={() => void apply()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">{title} 적용</button>}
    </div>
  </section>;
}
