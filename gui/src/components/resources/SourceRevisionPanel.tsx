import {useEffect, useState} from 'react';
import {ApiRequestError, applySourceManagement, checkSourceUpstream, fetchSourceRevision, planSourceManagement} from '../../api/deploy';
import type {SourceManagementPlan, SourceResolution, SourceRevision, SourceFileView} from '../../api/deploy';
import {emptyUpstreamDraft, upstreamInput, UpstreamSourceFields} from './UpstreamSourceFields';
import type {UpstreamChoice, UpstreamDraft} from './UpstreamSourceFields';

type Tab = 'source-edit' | 'refresh' | 'source-rollback';
type Draft = {text?: string; mode?: number; delete?: boolean};
const tabs: Array<[Tab, string]> = [['source-edit', 'Kit 사본 편집'], ['refresh', '업데이트 가져오기'], ['source-rollback', '이력·복원']];
function Content({label, file}: {label: string; file?: SourceFileView | null}) {
  return <div className="min-w-0"><p className="text-xs font-bold text-slate-500">{label}{file ? ` · ${file.mode.toString(8)}` : ' · 파일 없음'}</p>
    {file && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-950">{file.text === null ? `바이너리 · ${file.bytes}바이트 · ${file.sha256}` : file.text}</pre>}
  </div>;
}

export function SourceRevisionPanel({assetId,variantId, initialTab, scope, projectName = '', projectPath = '', onChanged, onClose}: {
  assetId: string;variantId?:string; initialTab: Tab; scope: 'global' | 'project'; projectName?: string; projectPath?: string;
  onChanged: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab), [source, setSource] = useState<SourceRevision | null>(null);
  const [selected, setSelected] = useState(''), [newPath, setNewPath] = useState(''), [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [plan, setPlan] = useState<SourceManagementPlan | null>(null), [reviewed, setReviewed] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, SourceResolution>>({}), [checkpointId, setCheckpointId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [unregistered,setUnregistered]=useState(false);
  const [upstreamChoice, setUpstreamChoice] = useState<UpstreamChoice>('bound'), [upstreamDraft, setUpstreamDraft] = useState<UpstreamDraft>(emptyUpstreamDraft);
  const input = {assetId,...(variantId?{variantId}:{}), scope, projectName, projectPath};
  const load = async () => {
    setBusy(true); setError('');setUnregistered(false);setSource(null);
    try {
      const data = await fetchSourceRevision(input); setSource(data); setSelected(data.files[0]?.path || '');
      setDrafts({}); setResolutions({}); setPlan(null); setReviewed(false); setCheckpointId('');
      setUpstreamChoice('bound'); setUpstreamDraft(emptyUpstreamDraft);
    } catch (cause) {if(variantId&&cause instanceof ApiRequestError&&cause.code==='SKILL_VARIANT_SOURCE_NOT_REGISTERED'){setUnregistered(true);setPlan(null);setReviewed(false);}else setError(cause instanceof Error ? cause.message : 'Kit 사본 조회 실패');}
    finally {setBusy(false);}
  };
  useEffect(() => {void load();}, [assetId,variantId, scope, projectName, projectPath]);
  const invalidate = () => {setReviewed(false); setMessage('');};
  const draft = (change: Draft) => {setDrafts({...drafts, [selected]: {...drafts[selected], ...change}}); invalidate();};
  const review = async () => {
    if (!source) return;
    setBusy(true); setError(''); setMessage(''); setReviewed(false);
    try {
      const result = await planSourceManagement(tab, {...input, ...(tab === 'source-edit'
        ? {revision: source.revision, changes: Object.entries(drafts).map(([path, value]) => ({path, ...value}))}
        : tab === 'refresh' ? {resolutions, ...upstreamInput(upstreamChoice, upstreamDraft), ...(plan?.reviewHash ? {reviewHash: plan.reviewHash} : {})}
        : {revision: source.revision, checkpointId})});
      setPlan(result); setReviewed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계획 생성 실패');
      if (cause instanceof ApiRequestError && cause.code === 'STALE_SOURCE_REVIEW') {setPlan(null); setResolutions({});}
    } finally {setBusy(false);}
  };
  const apply = async () => {
    if (!plan || !reviewed || plan.automatic === false) return;
    setBusy(true); setError(''); setReviewed(false);
    try {
      await applySourceManagement(plan.kind==='variant-register'?'variant-register':tab, plan.planId); onChanged(); await load();
      setMessage('Kit 사본에 적용했습니다. 기존 설치 파일과 링크는 유지됩니다.');
    } catch (cause) {setError(cause instanceof Error ? cause.message : '적용 실패'); setPlan(null);}
    finally {setBusy(false);}
  };
  const check = async () => {
    setBusy(true); setError('');
    try {const result = await checkSourceUpstream({...input, ...upstreamInput(upstreamChoice, upstreamDraft)}); setMessage((result.status === 'changed' ? '수용하지 않은 원본 변경이 있습니다.' : result.status === 'unchanged' ? '새 원본 변경이 없습니다.' : '원본을 읽을 수 없습니다. Kit 사본을 유지합니다.') + (result.bindingChanged ? ' 출처 연결을 저장하려면 변경 계획을 확인하세요.' : ''));}
    catch (cause) {setError(cause instanceof Error ? cause.message : '원본 확인 실패');}
    finally {setBusy(false);}
  };
  const paths = [...new Set([...(source?.files.map(file => file.path) || []), ...Object.keys(drafts)])];
  const current = source?.files.find(file => file.path === selected);
  return <section aria-label="Kit 사본 관리" className="space-y-4 rounded-3xl border border-blue-300 bg-white p-6 dark:border-blue-800 dark:bg-slate-900">
    <div className="flex items-start justify-between gap-4"><div><h2 className="font-bold">Kit 사본 관리 · {assetId}{variantId?` / ${variantId}`:''}</h2><p className="mt-2 text-sm text-slate-500">변경은 Kit 사본에 적용합니다. 원래 설치·링크는 유지되며 클라이언트 배포는 별도 단계입니다.</p></div><button disabled={busy} onClick={onClose}>닫기</button></div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Kit 사본 작업">{tabs.map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} disabled={busy || Object.keys(drafts).length > 0 && tab !== value} onClick={() => {setTab(value); setPlan(null); setReviewed(false); setResolutions({}); setError(''); setMessage('');}} className={`rounded-xl border px-3 py-2 text-xs ${tab === value ? 'border-blue-500 text-blue-500' : ''}`}>{label}</button>)}</div>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{message && <p role="status" className="text-sm text-blue-500">{message}</p>}
    {unregistered&&<div className="space-y-3 text-sm"><p>이 variant의 현재 Kit 사본을 별도 기준 사본과 이력으로 관리합니다. 다른 variant와 기존 설치는 유지됩니다.</p>
      <button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setPlan(await planSourceManagement('variant-register',input));setReviewed(true);}catch(cause){setError(cause instanceof Error?cause.message:'관리 계획 생성 실패');}finally{setBusy(false);}}} className="rounded-xl border px-3 py-2 text-xs">variant 관리 계획 확인</button>
      {plan?.kind==='variant-register'&&<><p>{plan.operations.length}개 작업 · 현재 원본 보존</p>{plan.manifestDiff&&<details><summary>Manifest 변경 전·후</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{plan.manifestDiff.before}</pre><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{plan.manifestDiff.after}</pre></details>}
        <button disabled={busy||!reviewed||plan.automatic===false} onClick={()=>void apply()} className="rounded-xl border px-3 py-2 text-xs">variant 관리 시작</button></>}
    </div>}
    {source && <>
      {Object.keys(drafts).length > 0 && <p className="text-xs text-amber-600">작성 중인 변경을 적용하거나 취소하면 다른 작업으로 이동할 수 있습니다.</p>}
      {tab === 'source-edit' && <div className="space-y-3">
        <label className="block text-xs">편집 파일 <select aria-label="편집 파일" disabled={busy} value={selected} onChange={event => setSelected(event.target.value)} className="ml-2 rounded border bg-transparent p-2">{paths.map(name => <option key={name}>{name}</option>)}</select></label>
        {source.kind === 'skills' && <div className="flex gap-2"><input aria-label="새 파일 경로" value={newPath} disabled={busy} onChange={event => setNewPath(event.target.value)} placeholder="references/notes.md" className="min-w-0 rounded border bg-transparent p-2 text-xs" /><button disabled={busy || !newPath || paths.includes(newPath)} onClick={() => {setDrafts({...drafts, [newPath]: {text: '', mode: 0o644}}); setSelected(newPath); setNewPath(''); invalidate();}} className="rounded border px-3 text-xs">파일 추가</button></div>}
        {current?.text === null ? <p className="text-xs text-slate-500">바이너리 파일의 내용은 유지됩니다.</p> : <textarea aria-label="Kit 파일 내용" disabled={busy || drafts[selected]?.delete} rows={12} value={drafts[selected]?.text ?? current?.text ?? ''} onChange={event => draft({text: event.target.value})} className="w-full rounded-xl border bg-transparent p-3 font-mono text-xs" />}
        <div className="flex flex-wrap gap-4 text-xs"><label>권한 <input aria-label="파일 권한" disabled={busy || drafts[selected]?.delete} value={(drafts[selected]?.mode ?? current?.mode ?? 0o644).toString(8)} onChange={event => {if (/^[0-7]{1,3}$/.test(event.target.value)) draft({mode: parseInt(event.target.value, 8)});}} className="ml-2 w-16 rounded border bg-transparent p-2" /></label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={drafts[selected]?.delete || false} onChange={event => {if (event.target.checked && current) setDrafts({...drafts, [selected]: {delete: true}}); else if (event.target.checked) {const next = {...drafts}; delete next[selected]; setDrafts(next); setSelected(source.files[0]?.path || '');} else {const next = {...drafts}; delete next[selected]; setDrafts(next);} invalidate();}} />사본에서 삭제</label></div>
      </div>}
      {tab === 'refresh' && <div className="space-y-3"><UpstreamSourceFields choice={upstreamChoice} draft={upstreamDraft} current={source.upstream} busy={busy}
        localLabel={source.origin?.type==='kit'?'등록 당시 Kit 원본':'원래 로컬 설치본'}
        onChoice={value => {setUpstreamChoice(value); setPlan(null); setResolutions({}); invalidate();}}
        onDraft={value => {setUpstreamDraft(value); setPlan(null); setResolutions({}); invalidate();}} />
        <button disabled={busy} onClick={() => void check()} className="rounded-xl border px-3 py-2 text-xs">원본 변경 확인</button><p className="mt-2 text-xs text-slate-500">기준 사본·Kit 수정본·새 원본을 비교합니다. 내 사본 유지·보류를 선택한 파일은 기준 사본도 유지합니다.</p></div>}
      {tab === 'source-rollback' && <label className="block text-xs">복원할 이전 상태 <select aria-label="복원할 이전 상태" disabled={busy} value={checkpointId} onChange={event => {setCheckpointId(event.target.value); invalidate();}} className="mt-2 w-full rounded border bg-transparent p-2"><option value="">선택하세요</option>{source.history.map(item => <option key={item.id} value={item.id}>{item.at} · {item.action} 이전 · {item.id}</option>)}</select></label>}
      {plan && <div className="space-y-4">
        {plan.source?.upstream !== undefined && <p className="text-xs text-blue-500">출처 연결을 {plan.source.upstream ? `${plan.source.upstream.type} 고정 버전` : source.origin?.type==='kit'?'등록 당시 Kit 원본':'원래 로컬 설치본'}으로 변경합니다.</p>}
        {plan.managementUpgrade && <p className="text-xs text-amber-600">원본 관리 기록을 v{plan.managementUpgrade.to}로 변환합니다. 원본 등록만 지원하던 이전 Agent Kit에서는 읽을 수 없습니다.</p>}
        {plan.automatic === false && <p className="text-sm text-amber-600">충돌을 해결하거나 보류한 뒤 변경 계획을 다시 확인하세요.</p>}
        {(plan.details || []).map((detail, index) => <div key={detail.path || index} className="space-y-3 rounded-xl border p-3">
          <p className="break-all font-mono text-xs font-bold">{detail.path || detail.checkpointId}{detail.conflict ? ' · 충돌' : ''}</p>
          {tab === 'refresh' ? <><div className="grid gap-3 lg:grid-cols-3"><Content label="기준 사본 B" file={detail.base} /><Content label="Kit 수정본 K" file={detail.kit} /><Content label="새 원본 U" file={detail.upstream} /></div>
            <label className="block text-xs">{detail.path} 처리 <select aria-label={`${detail.path} 처리`} value={detail.path ? resolutions[detail.path]?.choice || '' : ''} disabled={busy} onChange={event => {if (!detail.path) return; const next = Object.assign(Object.create(null), resolutions); if (!event.target.value) delete next[detail.path]; else next[detail.path] = {choice: event.target.value as SourceResolution['choice'], ...(event.target.value === 'manual' ? {text: detail.after?.text ?? detail.kit?.text ?? detail.upstream?.text ?? ''} : {})}; setResolutions(next); invalidate();}} className="ml-2 rounded border bg-transparent p-2"><option value="">{detail.conflict ? '선택 필요' : '자동 병합'}</option><option value="keep">내 사본 유지</option><option value="defer">이번 변경 보류</option><option value="upstream">새 원본 수용</option><option value="manual">직접 병합</option></select></label>
            {detail.path && resolutions[detail.path]?.choice === 'manual' && <textarea aria-label={`${detail.path} 직접 병합`} rows={8} disabled={busy} value={resolutions[detail.path].text || ''} onChange={event => {setResolutions({...resolutions, [detail.path!]: {...resolutions[detail.path!], text: event.target.value}}); invalidate();}} className="w-full rounded border bg-transparent p-3 font-mono text-xs" />}
          </> : <Content label="변경 전" file={detail.before} />}
          <Content label="적용 후보" file={detail.after} />
        </div>)}
        {plan.manifestDiff && <details><summary className="cursor-pointer text-xs font-bold">Manifest 변경 전·후</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{plan.manifestDiff.before}</pre><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{plan.manifestDiff.after}</pre></details>}
        <p className="text-xs text-slate-500">{plan.operations.length}개 작업 · 이전 revision과 기준 사본은 보존됩니다.</p>
      </div>}
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void load()} className="rounded-xl border px-3 py-2 text-xs">변경 취소·다시 읽기</button>
        <button disabled={busy || tab === 'source-edit' && !Object.keys(drafts).length || tab === 'source-rollback' && !checkpointId} onClick={() => void review()} className="rounded-xl border px-3 py-2 text-xs">변경 계획 확인</button>
        {plan && <button disabled={busy || !reviewed || plan.automatic === false} onClick={() => void apply()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Kit에 적용</button>}
      </div>
    </>}
  </section>;
}
