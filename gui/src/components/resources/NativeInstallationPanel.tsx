import {useEffect, useState} from 'react';
import {applyNativeInstallation, fetchNativeInstallation, planNativeInstallation} from '../../api/deploy';
import type {NativeInstallation, NativeInstallationPlan, SourceFileView} from '../../api/deploy';
const has = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);
const reasonText: Record<string, string> = {
  NATIVE_ADOPTION_REQUIRED: '현재 설치를 먼저 관리 등록하세요.',
  NATIVE_INITIAL_SNAPSHOT_CHANGED: '기준 사본과 현재 설치가 다릅니다. 설치 내용을 유지합니다.',
  NATIVE_INSTALLATION_MODIFIED_EXTERNALLY: '설치본에 외부 수정이 있습니다. Kit에 가져와 병합하거나 처리 방식을 선택하세요.',
  NATIVE_INSTALLATION_MERGE_CONFLICT: '설치본과 Kit 수정이 겹칩니다. 수용할 내용이나 직접 병합을 선택하세요.',
  NATIVE_DELETION_REVIEW_REQUIRED: 'Kit에서 삭제한 관리 파일의 제거 검토를 선택하세요.',
  NATIVE_DELETE_MODIFIED_FILE: '외부에서 수정한 파일은 자동 제거하지 않습니다.',
  NATIVE_PRIMARY_DELETION_PRESERVED: '필수 파일이 없어졌습니다. Kit 사본을 유지하세요.',
  NATIVE_CREDENTIAL_CHANGE_REQUIRES_EXTERNAL_REVIEW: '설치본의 인증 관련 변경은 자동 덮어쓰지 않습니다.',
  NATIVE_DEPENDENCY_NOT_INSTALLED: '이 자원에 필요한 provider를 같은 클라이언트에 먼저 설치하세요.',
  NATIVE_DEPENDENCY_TARGET_CHANGED: '설치된 provider에 외부 변경이 있습니다. 해당 설치 상태를 먼저 검토하세요.',
  CLIENT_VERSION_REQUIRED: '클라이언트 버전을 확인하세요.',
  CLIENT_PROFILE_UNVERIFIED: '이 설치본 버전의 자동 반영이 검증되지 않았습니다.',
  CLIENT_RESOURCE_PROFILE_UNVERIFIED: '이 자원에 포함된 옵션은 자동 반영 범위로 검증되지 않았습니다.',
  CLIENT_BINARY_UNVERIFIED: '실행 파일이 검증된 설치본과 다릅니다.'
};

function Snapshot({label, file}: {label: string; file: SourceFileView | null}) {
  return <div className="min-w-0"><p className="text-xs font-bold text-slate-500">{label}{file ? ` · ${file.mode.toString(8)}` : ' · 파일 없음'}</p>
    {file && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-950">{file.text ?? `내용 표시 제외 · ${file.bytes}바이트 · ${file.sha256}`}</pre>}
  </div>;
}
export function NativeInstallationPanel({assetId, scope, projectName = '', projectPath = '', onClose, onChanged, onHistory}: {
  assetId: string; scope: 'global' | 'project'; projectName?: string; projectPath?: string;
  onClose: () => void; onChanged: () => void; onHistory: (clientId?: string) => void;
}) {
  const [installation, setInstallation] = useState<NativeInstallation | null>(null), [mode, setMode] = useState<NativeInstallationPlan['mode']>('adopt');
  const [clientVersion, setClientVersion] = useState(''), [removeDeleted, setRemoveDeleted] = useState(false);
  const [choices, setChoices] = useState<Record<string, 'keep-installed' | 'use-kit' | 'manual'>>({}), [plan, setPlan] = useState<NativeInstallationPlan | null>(null);
  const [manualTexts, setManualTexts] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const input = {assetId, scope, projectName, projectPath};
  const load = async () => {
    setBusy(true); setError('');
    try {const data = await fetchNativeInstallation(input); setInstallation(data); setMode(data.adopted ? 'apply' : 'adopt'); setPlan(null); setChoices({}); setManualTexts({}); setReviewed(false);}
    catch (cause) {setError(cause instanceof Error ? cause.message : '설치 상태 조회 실패');}
    finally {setBusy(false);}
  };
  useEffect(() => {void load();}, [assetId, scope, projectName, projectPath]);
  const invalidate = () => {setReviewed(false); setMessage('');};
  const review = async () => {
    setBusy(true); setError(''); setMessage(''); setReviewed(false);
    try {setPlan(await planNativeInstallation({...input, mode, clientVersion: clientVersion || undefined, removeDeleted, choices, manualTexts,
      ...(plan?.reviewHash ? {reviewHash: plan.reviewHash} : {})})); setReviewed(true);}
    catch (cause) {setError(cause instanceof Error ? cause.message : '설치 계획 생성 실패'); setPlan(null); setChoices({});}
    finally {setBusy(false);}
  };
  const apply = async () => {
    if (!plan || !plan.automatic || !reviewed) return;
    setBusy(true); setError(''); setReviewed(false);
    try {const result = await applyNativeInstallation(plan.planId); await load(); onChanged(); setMessage(result.unchanged ? '설치 변경이 없습니다.' : mode === 'adopt' ? '설치 파일을 그대로 유지하고 관리 등록했습니다.' : mode === 'detach' ? '설치 내용은 유지하고 관리만 해제했습니다.' : mode === 'import-installed' ? '설치 변경을 Kit에 병합했습니다. 설치본은 유지됩니다. 다시 반영 계획을 검토하세요.' : result.metadataOnly ? '설치 파일은 유지하고 설치 소유 기록을 갱신했습니다.' : `클라이언트 설치에 반영했습니다. 복원 이력: ${result.transactionId}`);}
    catch (cause) {setError(cause instanceof Error ? cause.message : '설치 적용 실패'); setPlan(null);}
    finally {setBusy(false);}
  };
  return <section aria-label="클라이언트 설치 반영" className="space-y-4 rounded-3xl border border-blue-300 bg-white p-6 dark:border-blue-800 dark:bg-slate-900">
    <div className="flex justify-between gap-4"><div><h2 className="font-bold">클라이언트 설치 반영 · {assetId}</h2><p className="mt-2 text-sm text-slate-500">현재 설치를 먼저 관리 등록한 뒤 Kit 사본을 반영합니다. 기존 링크를 자동 교체하거나 따라가 쓰지 않습니다. 등록하지 않은 파일과 MCP 설정은 유지합니다.</p></div><button disabled={busy} onClick={onClose}>닫기</button></div>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{message && <p role="status" className="text-sm text-blue-500">{message}</p>}
    {installation && <>
      <p className="break-all font-mono text-xs">{installation.clientId} · {installation.surface} · {installation.target}</p>
      <p className="text-xs text-slate-500">{installation.adopted ? '설치 관리 중' : '설치 관리 등록 전'} · {installation.kitPending ? 'Kit 반영 대기' : 'Kit·설치 내용 일치'}{installation.installedModified ? ' · 설치본 외부 수정 감지' : ''}</p>
      <label className="block text-xs">설치 작업 <select aria-label="설치 작업" disabled={busy} value={mode} onChange={event => {setMode(event.target.value as typeof mode); setPlan(null); setChoices({}); setManualTexts({}); invalidate();}} className="ml-2 rounded border bg-transparent p-2"><option value="adopt">현재 설치 관리 등록 · 내용 유지</option><option value="apply">Kit 사본 반영</option><option value="import-installed">설치 변경을 Kit에 가져와 병합</option><option value="detach">설치 관리 해제 · 내용 유지</option></select></label>
      {mode === 'apply' && <div className="space-y-3"><label className="block text-xs">클라이언트 버전 <input aria-label="설치 클라이언트 버전" disabled={busy} value={clientVersion} onChange={event => {setClientVersion(event.target.value); invalidate();}} placeholder="검증된 설치본은 자동 확인" className="ml-2 rounded border bg-transparent p-2" /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={busy} checked={removeDeleted} onChange={event => {setRemoveDeleted(event.target.checked); invalidate();}} />Kit에서 삭제한 관리 파일의 설치 제거도 검토</label>
        <p className="text-xs text-slate-500">지원이 검증되지 않은 버전·옵션은 차단합니다. 설치 파일 쓰기 검증과 실제 클라이언트 사용 검증은 별개입니다.</p></div>}
      {plan && <div className="space-y-4">
        {plan.stateUpgrade && <p className="text-xs text-amber-600">설치 관리 기록을 v5로 전환합니다. 이전 Agent Kit에서는 이 원장을 읽지 못합니다.</p>}
        {plan.sourceOnly && <p className="text-xs text-blue-500">이 계획은 Kit 사본만 변경합니다. 현재 설치는 유지합니다.</p>}
        {plan.blocked.length > 0 && <ul className="text-xs text-rose-600">{plan.blocked.map((item, index) => <li key={index} className="break-all">{reasonText[item.reason] || item.reason}{item.target ? ` · ${item.target}` : ''}</li>)}</ul>}
        {plan.details.map(detail => <div key={detail.path} className="space-y-3 rounded-xl border p-3"><p className="font-mono text-xs font-bold">{detail.path}{detail.drift ? ' · 설치본 외부 수정' : ''}</p>
          <div className="grid gap-3 lg:grid-cols-3"><Snapshot label="마지막 적용본 L" file={detail.lastApplied} /><Snapshot label="현재 설치 D" file={detail.installed} /><Snapshot label="Kit 수정본 K" file={detail.kit} /></div>
          {detail.drift && <label className="block text-xs">{detail.path} 설치 변경 처리 <select aria-label={`${detail.path} 설치 변경 처리`} disabled={busy} value={has(choices, detail.path) ? choices[detail.path] : ''} onChange={event => {const next = {...choices}; if (event.target.value) Object.defineProperty(next, detail.path, {value: event.target.value, enumerable: true, configurable: true, writable: true}); else delete next[detail.path]; if (event.target.value === 'manual') setManualTexts({...manualTexts, [detail.path]: detail.kit?.text ?? detail.installed?.text ?? ''}); setChoices(next); invalidate();}} className="mt-2 rounded border bg-transparent p-2"><option value="">{plan.automatic && !detail.conflict ? mode === 'import-installed' ? '자동 병합' : '설치 수정이 Kit에 반영됨' : '선택 필요 · 적용 차단'}</option><option value="keep-installed">{mode === 'import-installed' ? '설치 변경 수용' : '현재 설치 유지'}</option><option value="use-kit">{mode === 'import-installed' ? 'Kit 사본 유지' : 'Kit으로 반영 · 현재 설치는 백업 보존'}</option>{mode === 'import-installed' && <option value="manual">직접 병합</option>}</select></label>}
          {mode === 'import-installed' && choices[detail.path] === 'manual' && <textarea aria-label={`${detail.path} 설치 직접 병합`} value={has(manualTexts, detail.path) ? manualTexts[detail.path] : detail.kit?.text ?? ''} disabled={busy} rows={8} onChange={event => {setManualTexts({...manualTexts, [detail.path]: event.target.value}); invalidate();}} className="w-full rounded border bg-transparent p-3 font-mono text-xs" />}
          {mode === 'import-installed' && detail.merged !== undefined && <Snapshot label="Kit 병합 후보" file={detail.merged} />}
        </div>)}
        {plan.installationEvidence&&<section aria-label="설치 소유 기록" className="space-y-2 rounded border p-3 text-xs text-slate-500">
          <p>설치 소유 기록 · {plan.installationEvidence.required?'갱신 필요':plan.installationEvidence.status==='observed'?'현재 기록과 일치':'확인 필요'}</p>
          {plan.installationEvidence.nativeId&&<p>기존 이름: {plan.installationEvidence.nativeId}</p>}
          {plan.installationEvidence.required&&plan.operations.every(item=>item.metadataOnly)&&<p>소유 기록만 갱신하며 설치 파일은 그대로 유지합니다.</p>}
          <p>클라이언트 인식·Tool 사용은 별도 검증입니다.</p>{plan.installationEvidence.status==='unverified'&&plan.installationEvidence.reason&&<p>{plan.installationEvidence.reason}</p>}
        </section>}
        <ul className="max-h-56 overflow-auto rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-950">{plan.operations.map((item, index) => <li key={index} className="break-all py-1">{item.operation} · {item.target}{item.metadataOnly ? ' · 내용 유지' : item.beforeMode === undefined && item.afterMode === undefined ? '' : ` · ${item.beforeMode?.toString(8) || '없음'} → ${item.afterMode?.toString(8) || '없음'}`}</li>)}</ul>
      </div>}
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void load()} className="rounded-xl border px-3 py-2 text-xs">설치 상태 다시 읽기</button><button disabled={busy} onClick={() => void review()} className="rounded-xl border px-3 py-2 text-xs">설치 변경 계획 확인</button>
        {plan && <button disabled={busy || !reviewed || !plan.automatic} onClick={() => void apply()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">검토한 설치 계획 적용</button>}
      </div>
    </>}
    <button disabled={busy} onClick={() => onHistory(installation?.clientId)} className="rounded-xl border px-3 py-2 text-xs">배포 이력·복원·중단 복구</button>
  </section>;
}
