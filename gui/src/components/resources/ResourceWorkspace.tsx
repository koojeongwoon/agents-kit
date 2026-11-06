import {useLayoutEffect, useState} from 'react';
import {AlertCircle, ArrowUpRight, Bot, Boxes, Network, Plus, Search, Sparkles, Wrench} from 'lucide-react';
import type {ClientSummary, LocalClientDiscovery, LocalDiscoveryAsset, RegistryResource, ResourceCatalog, ResourceActionContext, NativeResourceKind} from '../../api/deploy';
import type {ResourceView} from '../shell/ControlCenterShell';
import {SourceRegistrationPanel} from './SourceRegistrationPanel';
import {SourceRevisionPanel} from './SourceRevisionPanel';
import {NativeInstallationPanel} from './NativeInstallationPanel';
import {ResourceStatusTable} from './ResourceStatusTable';
import {externalObservationTargets,isObservationOnly,isObservedResource,isSharedSkillPath} from '../../domain/resource-presentation';

interface ResourceWorkspaceProps {
  view: ResourceView;
  clients: ClientSummary[];
  localDiscovery: LocalClientDiscovery[];
  resources: RegistryResource[];
  targetReady: boolean;
  loading: boolean;
  error: string;
  onOpenEditor: (assetId?: string, context?: ResourceActionContext) => void;
  onOpenDeploy: (context?: ResourceActionContext) => void;
  catalog?: ResourceCatalog;
  nativeClientId?: string;
  onObserveNative?: (kind?: NativeResourceKind) => Promise<void>;
  onInspectInstallations?:()=>Promise<void>;
  onInspectDependents?:()=>Promise<void>;
  scope?: 'global' | 'project';
  projectName?: string;
  projectPath?: string;
  recoveryRequired?: boolean;
  onChanged?: () => void;
  onNativeHistory?: (clientId?: string, context?: ResourceActionContext) => void;
}

const workspaceConfig: Record<ResourceView, {
  kind: string;
  capabilityKind: string;
  title: string;
  description: string;
  empty: string;
  icon: typeof Wrench;
}> = {
  mcp: {
    kind: 'mcpServers',
    capabilityKind: 'mcp',
    title: 'MCP 서버',
    description: 'MCP가 제공하는 Tool과 클라이언트별 지원 상태를 함께 확인합니다.',
    empty: '이 Kit에 등록된 MCP 서버가 없습니다.',
    icon: Wrench
  },
  skills: {
    kind: 'skills',
    capabilityKind: 'skills',
    title: 'Skill 라이브러리',
    description: 'Skill이 요구하는 Tool과 MCP 제공자를 확인하고 여러 환경에 배포합니다.',
    empty: '이 Kit에 등록된 Skill이 없습니다.',
    icon: Sparkles
  },
  agents: {
    kind: 'agents',
    capabilityKind: 'agents',
    title: 'Agent 라이브러리',
    description: '역할, Skill, Tool, 정책을 조합하고 환경별 지원 범위를 확인합니다.',
    empty: '이 Kit에 등록된 Agent가 없습니다.',
    icon: Bot
  },
  instructions: {
    kind: 'instructions', capabilityKind: 'instructions', title: '공통 지침',
    description: '기존 지침과 Kit에서 관리하는 지침의 위치와 범위를 확인합니다.',
    empty: '이 Kit에 등록된 지침이 없습니다.', icon: Boxes
  },
  harness: {
    kind: 'harness',
    capabilityKind: 'harness',
    title: 'Harness 프로필',
    description: 'Agent와 정책을 묶어 여러 환경에서 재사용할 프로필을 구성합니다.',
    empty: '이 Kit에 등록된 Harness가 없습니다.',
    icon: Boxes
  }
};

function capabilityLabel(client: ClientSummary, assetKind: string) {
  const matching = client.capabilities.filter(capability => capability.assetKind === assetKind);
  if (matching.some(capability => capability.status === 'stable')) {
    if (client.schemaVersion === 2) return {label: '파일 계약', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-300'};
    return {label: '파일 계약', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'};
  }
  if (matching.length > 0) {
    return {label: '제한', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-300'};
  }
  return {label: '미확인', className: 'bg-slate-500/10 text-slate-500'};
}

export function ResourceWorkspace({
  view,
  clients,
  localDiscovery,
  resources,
  targetReady,
  loading,
  error,
  onOpenEditor,
  onOpenDeploy,
  scope, projectName, projectPath, recoveryRequired = false, onChanged, onNativeHistory, catalog, nativeClientId, onObserveNative,onInspectInstallations,onInspectDependents
}: ResourceWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [selectedKey,setSelectedKey]=useState('');

  useLayoutEffect(() => {
    setQuery('');
  }, [view]);

  const [scopeFilter, setScopeFilter] = useState('all');
  const [managementFilter, setManagementFilter] = useState('all');
  const [activationFilter,setActivationFilter]=useState('all');
  const [observingNative,setObservingNative]=useState(false);
  const [nativeError,setNativeError]=useState('');
  const [inspectingInstallations,setInspectingInstallations]=useState(false);
  const [installationInspectionError,setInstallationInspectionError]=useState('');
  const [inspectingDependents,setInspectingDependents]=useState(false);
  const [dependentInspectionError,setDependentInspectionError]=useState('');
  const inspectDependents=async()=>{if(!onInspectDependents)return;setInspectingDependents(true);setDependentInspectionError('');try{await onInspectDependents();}catch(cause){setDependentInspectionError(cause instanceof Error?cause.message:'의존 프로젝트 확인 실패');}finally{setInspectingDependents(false);}};
  const inspectInstallations=async()=>{if(!onInspectInstallations)return;setInspectingInstallations(true);setInstallationInspectionError('');try{await onInspectInstallations();}catch(cause){setInstallationInspectionError(cause instanceof Error?cause.message:'설치 정보 확인 실패');}finally{setInspectingInstallations(false);}};
  const observeNative=async()=>{if(!onObserveNative)return;setObservingNative(true);setNativeError('');try{await onObserveNative(view==='mcp'?'mcpServers':view==='instructions'?'instructions':'skills');}catch(cause){setNativeError(cause instanceof Error?cause.message:'클라이언트 조회 실패');}finally{setObservingNative(false);}};
  const [registration, setRegistration] = useState<{action: 'import' | 'detach' | 'source-recovery'; candidate?: LocalDiscoveryAsset; resourceId?: string; context?: ResourceActionContext} | null>(null);
  const [sourceTask, setSourceTask] = useState<{assetId: string;variantId?:string; tab: 'source-edit' | 'refresh' | 'source-rollback'; context: ResourceActionContext} | null>(null);
  const [installation, setInstallation] = useState<{assetId: string; context: ResourceActionContext} | null>(null);
  const canBrowse = !!catalog || targetReady;
  const previewScope=(value?:string)=>catalog?.scopes.some(item=>item.scope===value&&item.manifestSchemaVersion===3)===true;
  const contextFor = (resource?: RegistryResource, observation?: LocalDiscoveryAsset): ResourceActionContext => {
    const observed = observation && catalog?.observations.find(item => item.candidateId === observation.candidateId && item.clientId === observation.clientId && item.surface === observation.surface);
    const origin = resource?.origin || observed?.origin;
    const selectedScope = origin?.scope || resource?.scope?.type || observation?.scope || scope || 'global';
    return {scope: selectedScope, projectName: selectedScope === 'project' ? origin?.projectName || projectName || '' : '',
      projectPath: selectedScope === 'project' ? origin?.targetRoot || projectPath || '' : ''};
  };
  const config = workspaceConfig[view];
  const normalizedQuery = query.trim().toLowerCase();
  const emptyTitle = normalizedQuery ? '검색 결과가 없습니다.' : config.empty;
  const emptyDescription = normalizedQuery
    ? '검색어를 바꾸거나 지워 보세요.'
    : '새 리소스를 추가하면 환경별 지원 상태와 의존성을 여기서 비교할 수 있습니다.';
  const clientNames = new Map([
    ...clients.map(client => [client.id, client.displayName] as const),
    ...localDiscovery.map(client => [client.id, client.displayName] as const)
  ]);
  const rows = new Map<string, {
    key: string;
    id: string;
    displayName: string;
    registered?: RegistryResource;
    discoveredClientIds: string[];
    sourcePaths: string[];
    observations: LocalDiscoveryAsset[];
    surfaces: string[];
  }>();

  const externalTargets=externalObservationTargets(localDiscovery.flatMap(client=>client.surfaces?.length?client.surfaces.flatMap(surface=>surface.observations||surface.assets):client.observations||client.assets));
  resources
    .filter(resource => resource.kind === config.kind)
    .forEach(resource => {
      const key = resource.catalogId || `managed:${resource.scope?.type}:${resource.scope?.projectName || ''}:${resource.id}`;
      rows.set(key, {
        key,
        id: resource.id,
        displayName: resource.displayName || resource.id,
        registered: resource,
        discoveredClientIds: [],
        sourcePaths: [], observations: [], surfaces: []
      });
    });

  localDiscovery.forEach(client => {
    const inventory = client.surfaces?.length
      ? client.surfaces.flatMap(surface => surface.observations || surface.assets)
      : client.observations || client.assets;
    inventory
      .filter(asset => asset.kind === config.kind)
      .forEach(asset => {
        const registered = !isObservationOnly(asset,externalTargets) && asset.candidateId ? [...rows.values()].find(row => row.registered?.importedFrom?.candidateId === asset.candidateId
          && (!row.registered?.origin || row.registered.origin.scope === asset.scope)
          && (!row.registered?.origin || asset.scope !== 'project' || row.registered.origin.targetRoot === projectPath)) : undefined;
        const key = registered?.key || (isObservationOnly(asset,externalTargets)&&asset.resolvedTarget
          ? `observed-link:${asset.kind}:${asset.scope||'unknown'}:${asset.resolvedTarget}`
          : `observed:${asset.candidateId || `${client.id}:${asset.kind}:${asset.sourcePath}:${asset.id}`}`);
        const row = rows.get(key) || {
          key,
          id: asset.id,
          displayName: asset.nativeName?.value || asset.id,
          discoveredClientIds: [],
          sourcePaths: [], observations: [], surfaces: []
        };
        if (!row.discoveredClientIds.includes(client.id)) row.discoveredClientIds.push(client.id);
        if (!row.sourcePaths.includes(asset.path || asset.sourcePath)) row.sourcePaths.push(asset.path || asset.sourcePath);
        if (!row.observations.some(item => item.candidateId === asset.candidateId && item.clientId === asset.clientId && item.surface === asset.surface)) row.observations.push(asset);
        if (asset.surface && !row.surfaces.includes(asset.surface)) row.surfaces.push(asset.surface);
        rows.set(key, row);
      });
  });

  const filtered = [...rows.values()]
    .filter(row => {
      if(activationFilter!=='all'&&!row.observations.some(item=>(item.activation||'unknown')===activationFilter)) {
        if(activationFilter!=='unknown'||row.observations.length)return false;
      }
      if (scopeFilter !== 'all' && contextFor(row.registered, row.observations[0]).scope !== scopeFilter) return false;
      if (managementFilter === 'kit' && !row.registered) return false;
      if (managementFilter === 'unmanaged' && (row.registered || row.observations.some(item => item.managementMode === 'external'))) return false;
      if (managementFilter === 'external' && !row.observations.some(item => item.managementMode === 'external')) return false;
      if (managementFilter === 'unavailable' && (!row.registered?.source || ['available', 'inline'].includes(row.registered.source.status))) return false;
      if (!normalizedQuery) return true;
      return [
        row.id,
        row.displayName,
        ...(row.registered?.providedTools || []),
        ...(row.registered?.requiredTools || []),
        ...row.discoveredClientIds.map(clientId => clientNames.get(clientId) || clientId),
        ...row.sourcePaths
      ].some(value => String(value || '').toLowerCase().includes(normalizedQuery));
    });

  const selected=filtered.find(row=>row.key===selectedKey)||filtered[0];
  const readonlyRow=(row:typeof filtered[number])=>isObservedResource(row.registered,row.observations,externalTargets);
  return (
    <div className="resource-workspace">
      {!canBrowse&&<h1 className="p-6 text-lg font-semibold">{config.title}</h1>}


      {!canBrowse && (
        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-amber-500" />
          <h2 className="mt-3 font-bold">프로젝트 경로가 필요합니다</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            상단에서 프로젝트 경로를 입력하면 {config.title}를 불러옵니다.
          </p>
        </section>
      )}

      {canBrowse && loading && (
        <p role="status" className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-800">
          리소스를 불러오는 중…
        </p>
      )}

      {canBrowse && error && (
        <p role="alert" className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600">
          {error}
        </p>
      )}
      {recoveryRequired && scope && <button className="rounded-xl border px-4 py-2 text-sm" onClick={() => setRegistration({action: 'source-recovery'})}>중단된 편입 복구 검토</button>}
      {catalog?.scopes.filter(item => item.status === 'recovery-required').map(item => <button key={item.scope} className="rounded-xl border px-4 py-2 text-sm" onClick={() => setRegistration({action: 'source-recovery', context: {scope: item.scope, projectName: item.projectName || '', projectPath: item.scope === 'project' ? item.targetRoot || '' : ''}})}>{item.scope === 'global' ? '전역' : '프로젝트'} 중단된 편입 복구 검토</button>)}
      {registration && scope && <SourceRegistrationPanel key={`${registration.action}:${registration.candidate?.candidateId || registration.resourceId || ''}`}
        {...registration} {...(registration.context || {scope, projectName, projectPath})} onClose={() => setRegistration(null)} onChanged={() => onChanged?.()} />}
      {sourceTask && scope && <SourceRevisionPanel key={`${sourceTask.assetId}:${sourceTask.variantId||''}:${sourceTask.tab}`} assetId={sourceTask.assetId} variantId={sourceTask.variantId} initialTab={sourceTask.tab}
        {...sourceTask.context} onChanged={() => onChanged?.()} onClose={() => setSourceTask(null)} />}
      {installation && scope && <NativeInstallationPanel key={`${installation.context.scope}:${installation.assetId}`} assetId={installation.assetId}
        {...installation.context} onClose={() => setInstallation(null)} onChanged={() => onChanged?.()} onHistory={clientId => onNativeHistory ? onNativeHistory(clientId, installation.context) : onOpenDeploy(installation.context)} />}

      {canBrowse && !loading && (
        <section className="resource-master-detail" aria-label={`${config.title} 목록`}>
          <aside className="resource-list" aria-label="자원 선택">
            <header className="resource-list-heading"><h1>{config.title}</h1>        <button
          type="button"
          disabled={previewScope(scope)&&!catalog?.scopes.some(item=>item.scope===scope&&item.manifestEditingState==='supported')}
          onClick={() => onOpenEditor()}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          리소스 추가
        </button></header>
      {catalog && <div className="flex flex-wrap gap-3 text-xs"><label>범위 <select aria-label="자원 범위" value={scopeFilter} onChange={event => setScopeFilter(event.target.value)} className="rounded border bg-transparent p-2"><option value="all">전역 + 프로젝트</option><option value="global">전역</option><option value="project">프로젝트</option></select></label>
        <label>관리 상태 <select aria-label="자원 관리 상태" value={managementFilter} onChange={event => setManagementFilter(event.target.value)} className="rounded border bg-transparent p-2"><option value="all">전체</option><option value="kit">Kit 등록</option><option value="unmanaged">미등록</option><option value="external">외부 관리</option><option value="unavailable">원본 확인 필요</option></select></label>
        <label>클라이언트 활성 상태 <select aria-label="클라이언트 활성 상태" value={activationFilter} onChange={event=>setActivationFilter(event.target.value)} className="rounded border bg-transparent p-2"><option value="all">전체</option><option value="enabled">활성 확인</option><option value="disabled">비활성 확인</option><option value="unknown">미확인</option></select></label></div>}
      {canBrowse && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label={`${view === 'mcp' ? 'MCP' : config.title.split(' ')[0]} 검색`}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="이름, ID 또는 Tool로 검색"
            className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
      )}


            {([false,true] as const).filter(observed=>filtered.some(row=>readonlyRow(row)===observed)).map(observed=><div key={String(observed)}>
              <h2 className={observed?'resource-observation-label':''}>{observed?(view==='skills'?'공용 스킬·외부 링크 · 관측 전용':'외부 자원 · 관측 전용'):'관리 자원'}</h2>
              {filtered.filter(row=>readonlyRow(row)===observed).map(row=><button key={row.key} type="button" aria-pressed={selected?.key===row.key} onClick={()=>{setSelectedKey(row.key);setRegistration(null);setSourceTask(null);setInstallation(null);}}>
                <strong>{row.displayName}</strong><small>{row.discoveredClientIds.map(id=>clientNames.get(id)||id).join(" · ")}{row.surfaces.length?` / ${row.surfaces.join(", ")}`:""}</small><span>{readonlyRow(row)?'관측 전용':row.registered?'Kit 관리':'미등록'} · {contextFor(row.registered,row.observations[0]).scope==='global'?'클라이언트 전역':'프로젝트'}</span>
              </button>)}
            </div>)}
          </aside>
      {canBrowse && !loading && !error && filtered.length === 0 && (
        <section className="rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <Network className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 font-bold">{emptyTitle}</h2>
          <p className="mt-2 text-sm text-slate-500">{emptyDescription}</p>
        </section>
      )}

          {filtered.filter(row=>row.key===selected?.key).map(row => (
            <article
              key={row.key}
              aria-label={`${row.displayName} 리소스`}
              className="resource-detail"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-bold text-slate-950 dark:text-white">{row.displayName}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.discoveredClientIds.length > 0 && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
                        PC에서 발견
                      </span>
                    )}
                    {row.registered && (
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-300">
                        {row.registered.managementMode === 'kit-source' ? 'Kit 원본 등록' : 'Agent Kit 등록됨'}
                      </span>
                    )}
                    {!row.registered && (
                      <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                        읽기 전용
                      </span>
                    )}
                    {row.observations.some(item => item.managementMode === 'external') && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">외부 관리</span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-slate-500">{row.id}</p>
                </div>
                {row.registered && (
                  <span className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-500 dark:border-slate-700">
                    {(row.registered.origin?.scope || row.registered.scope?.type) === 'global' ? '전역' : '프로젝트'}
                  </span>
                )}
              </div>

              {readonlyRow(row)&&<section className="resource-observation-boundary" aria-label="공용 스킬 관측 전용"><h3>{view==='skills'?'.agents/skills · 관측 전용':'외부 관리 자원 · 관측 전용'}</h3><p>기존 파일·링크 보존 · 추가·수정·삭제·배포·복원 대상 제외</p></section>}
              <ResourceStatusTable clients={clients} observations={row.observations} kind={config.capabilityKind} scope={contextFor(row.registered,row.observations[0]).scope} observationOnly={readonlyRow(row)}/>
              {row.registered?.origin && <div className="mt-3 break-all text-xs text-slate-500"><p>Kit 원본: {row.registered.origin.scopeRoot}</p>{row.registered.origin.targetRoot && <p>적용 범위: {row.registered.origin.targetRoot}</p>}
                {row.registered.source && !['available', 'inline'].includes(row.registered.source.status) && <p>원본 확인 필요 · {row.registered.source.code || row.registered.source.status}</p>}
                {catalog?.duplicates.some(item => item.entries.includes(row.registered!.catalogId || '')) && <p>같은 ID가 다른 범위에도 있습니다. 원본을 구분해 관리합니다.</p>}
              </div>}
              {catalog?.effective.filter(item => item.kind === config.kind && item.entries.some(entry => row.observations.some(observation => observation.catalogId === entry.catalogId))).map(item => <div key={`${item.clientId}:${item.surface}:${item.name}`} className="mt-3 text-xs text-slate-500">
                <p>{clientNames.get(item.clientId) || item.clientId} · {item.surface || ''} · {item.entries.filter(entry=>row.observations.some(observation=>observation.catalogId===entry.catalogId)).map(entry=>entry.nativeState==='listed'?`클라이언트 목록: ${entry.activation==='enabled'?'활성':'비활성'}`:entry.nativeState==='shadowed'?'다른 원본에 가려짐':entry.nativeState==='contributing'?'실효 설정의 일부 필드 제공':entry.nativeState==='ignored'?'클라이언트가 이 설정 원본을 제외함':entry.nativeState==='not-listed'?'클라이언트 목록에 없음':'실제 로딩·비활성 상태 미확인').join(', ')} · 모델 사용 여부 미확인</p>
                {item.documentedComposition && <p>문서상 {item.documentedComposition.mode === 'coexist' ? '동명 자원 공존' : item.documentedComposition.mode === 'accumulate' ? '지침 누적' : '위치별 우선순위'}{item.documentedComposition.status === 'ambiguous' ? ' · 선택 후보 불명확' : ''} · <a href={item.documentedComposition.evidence.source} target="_blank" rel="noreferrer" className="underline">공식 규칙</a></p>}
              </div>)}

              {row.observations.filter((item, index, items) => items.findIndex(other => other.path === item.path) === index).map(item => (
                <div key={item.path || item.sourcePath} className="mt-3 text-xs text-slate-500">
                  {item.entryType === 'symlink' && <p>기존 링크 · {item.linkState === 'resolved' ? '연결됨' : item.linkState === 'broken' ? '대상 없음' : item.linkState === 'loop' ? '순환 연결' : '연결 확인 불가'}</p>}
                  {item.linkTarget && <p className="mt-1 break-all font-mono">연결 대상: {item.linkTarget}</p>}
                  {item.externalManager && <p className="mt-1">관리 주체: {item.externalManager.displayName}</p>}
                  {item.nativeName?.status === 'unverified' && <p className="mt-1">클라이언트 이름 확인 필요 · 파일 또는 폴더 ID로 표시 중</p>}
                  {item.entryType === 'symlink' && !item.externalManager && <p className="mt-1">관리 주체 미확인</p>}
                  {item.scope && <p className="mt-1">{item.scope === 'global' ? '전역' : '프로젝트'}{row.surfaces.length ? ` · ${row.surfaces.join(', ')}` : ''}</p>}
                </div>
              ))}

              <div className="mt-4 flex flex-wrap gap-2">
                {(row.registered?.providedTools || []).map(tool => (
                  <span key={tool} className="rounded-lg bg-violet-500/10 px-2 py-1 font-mono text-[10px] text-violet-600 dark:text-violet-300">
                    {tool}
                  </span>
                ))}
                {(row.registered?.requiredTools || []).map(tool => (
                  <span key={tool} className="rounded-lg bg-cyan-500/10 px-2 py-1 font-mono text-[10px] text-cyan-600 dark:text-cyan-300">
                    필요: {tool}
                  </span>
                ))}
                {row.sourcePaths.map(sourcePath => (
                  <span key={sourcePath} className="rounded-lg bg-slate-500/10 px-2 py-1 font-mono text-[10px] text-slate-500">
                    {sourcePath}
                  </span>
                ))}
                {(row.registered?.providedTools.length || 0) === 0
                  && (row.registered?.requiredTools.length || 0) === 0
                  && row.sourcePaths.length === 0 && (
                  <span className="text-xs text-slate-500">직접 연결된 Tool 없음</span>
                )}
              </div>

              {row.discoveredClientIds.length > 0 && (
                <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PC에서 발견한 환경</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.discoveredClientIds.map(clientId => (
                      <span
                        key={clientId}
                        className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-300"
                      >
                        {clientNames.get(clientId) || clientId}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {row.registered && row.registered.managementMode !== 'kit-source' && (
              <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">환경 호환성</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {clients.map(client => {
                    const support = capabilityLabel(client, config.capabilityKind);
                    return (
                      <span key={client.id} className={`rounded-full px-2 py-1 text-[10px] font-bold ${support.className}`}>
                        {client.displayName} · {support.label}
                      </span>
                    );
                  })}
                </div>
                {clients.some(client => client.schemaVersion === 2) && (
                  <p className="mt-2 text-xs text-slate-500">실제 적용 가능 여부는 실행 화면·설치본·자원 옵션을 배포 계획에서 확인합니다.</p>
                )}
              </div>
              )}

              {row.registered?.previewOnly&&<p className="mt-5 text-xs text-slate-500">의존성 검토 전용 원본 · 편집·배포 차단</p>}
              {!!row.registered?.skillVariants?.length&&!readonlyRow(row)&&!row.registered.previewOnly&&scope&&onChanged&&<div className="mt-4 space-y-2 text-xs"><p>variant별 사본과 업데이트 이력</p><div className="flex flex-wrap gap-2">
                {row.registered.skillVariants.map(variant=><button key={variant.id} className="rounded-xl border px-3 py-2" onClick={()=>{setInstallation(null);setRegistration(null);setSourceTask({assetId:row.id,variantId:variant.id,tab:'source-edit',context:contextFor(row.registered)});}}>{variant.id} 사본 관리{variant.managed?'':' 시작'}</button>)}
              </div></div>}
              {row.registered?.managementMode === 'kit-source' && !readonlyRow(row) && !row.registered.previewOnly && <div className="mt-5 text-xs text-slate-500">
                <p>원본 사본을 Kit에 보관 중입니다. 기존 설치는 유지됩니다.</p>
                {scope && onChanged && !isSharedSkillPath(row.registered.importedFrom?.path) && <button className="mt-3 rounded-xl border px-3 py-2 font-bold" onClick={() => {setSourceTask(null); setRegistration(null); setInstallation({assetId: row.id, context: contextFor(row.registered)});}}>클라이언트 설치 반영</button>}
                {scope && onChanged && <div className="mt-3 flex flex-wrap gap-2">{([['source-edit', 'Kit 사본 편집'], ['refresh', '업데이트 가져오기'], ['source-rollback', '이력·복원']] as const).map(([tab, label]) => <button key={tab} className="rounded-xl border px-3 py-2 font-bold" onClick={() => {setInstallation(null); setRegistration(null); setSourceTask({assetId: row.id, tab, context: contextFor(row.registered)});}}>{label}</button>)}</div>}
                {scope && onChanged && <button className="mt-3 rounded-xl border px-3 py-2 font-bold" onClick={() => {setInstallation(null); setSourceTask(null); setRegistration({action: 'detach', resourceId: row.id, context: contextFor(row.registered)});}}>등록 해제</button>}
              </div>}
              {!row.registered && scope && onChanged && !error && !readonlyRow(row) && (() => {
                const candidate = row.observations.find(item => item.candidateId && item.managementMode === 'unmanaged' && (!item.linkState || item.linkState === 'resolved'));
                return candidate && !previewScope(contextFor(undefined,candidate).scope) && <button className="mt-5 rounded-xl border px-3 py-2 text-xs font-bold" onClick={() => setRegistration({action: 'import', candidate, context: contextFor(undefined, candidate)})}>Kit에 가져오기</button>;
              })()}
              {row.registered && !readonlyRow(row) && row.registered.managementMode !== 'kit-source' && !row.registered.previewOnly && (
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenEditor(row.id, contextFor(row.registered))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold hover:border-blue-400 hover:text-blue-600 dark:border-slate-700"
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenDeploy(contextFor(row.registered))}
                    className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold hover:border-blue-400 hover:text-blue-600 dark:border-slate-700"
                  >
                    배포 검토 <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      <details className="resource-advanced"><summary>상태 조회·출처·소유권·의존성</summary>
      {catalog && <section aria-label="통합 조회 범위" className="space-y-2 rounded-2xl border p-4 text-xs text-slate-500">
        <p>전역과 선택 프로젝트를 함께 조회합니다. 실제 클라이언트 로딩·비활성 상태는 별도로 확인합니다.</p>
        {catalog.scopes.map(item => <p key={item.scope}>{item.scope === 'global' ? '전역' : `프로젝트 · ${item.projectName || ''}`} · {({ready: '조회됨', missing: '원본 없음', unselected: '프로젝트 미선택', unreadable: '접근 불가', invalid: '확인 필요', 'recovery-required': '복구 필요'} as Record<string, string>)[item.status] || item.status}{item.targetRoot ? ` · ${item.targetRoot}` : ''}</p>)}
        {catalog.issues.map((item, index) => <p key={index}>{item.scope === 'global' ? '전역' : item.scope === 'project' ? '프로젝트' : '탐색'} · {item.code}{item.sourcePath ? ` · ${item.sourcePath}` : ''}</p>)}
      </section>}
      {catalog && view==='agents'&&<p className="rounded-2xl border p-4 text-xs text-slate-500">Agent 선언 이름과 원본 위치를 표시합니다. 실제 역할 선택·자식 완료 상태: 미확인</p>}
      {catalog&&<section aria-label="전역 의존 프로젝트" className="space-y-3 rounded-2xl border p-4 text-xs text-slate-500">
        <h2 className="font-bold">전역 의존 프로젝트 · 읽기 전용</h2><p>전역 원장에 등록된 Kit 프로젝트만 조회합니다. 미등록 native 사용자는 포함하지 않습니다.</p>
        {onInspectDependents&&<button disabled={inspectingDependents} className="rounded-xl border px-3 py-2 font-bold disabled:opacity-50" onClick={()=>void inspectDependents()}>등록된 의존 프로젝트 확인</button>}
        {inspectingDependents&&<p role="status">등록된 의존 프로젝트를 확인하는 중…</p>}{dependentInspectionError&&<p role="alert">{dependentInspectionError}</p>}
        {catalog.dependencyDependents?.status==='not-enabled'&&<p>의존 프로젝트 등록이 아직 활성화되지 않았습니다.</p>}
        {catalog.dependencyDependents?.status==='unverified'&&<p>전역 의존성 원장 확인이 필요합니다. 기존 등록을 해제하지 않습니다.</p>}
        {catalog.dependencyDependents?.status==='observed'&&catalog.dependencyDependents.projects.length===0&&<p>등록된 의존 프로젝트가 없습니다.</p>}
        {catalog.dependencyDependents?.projects.map(project=><div key={project.registrationId}>
          <p>{project.project.projectName} · {project.project.targetRoot} · {project.verification==='consistent'?'양쪽 기록 일치':'확인 필요'}</p>
          <p>사용 자원 · {project.consumers.map(item=>item.assetId).join(', ')}</p><p>전역 전제 · {project.prerequisites.map(item=>`${item.assetId}${item.revisionDigest?` (${item.revisionDigest.slice(0,12)})`:''}`).join(', ')}</p>
          {project.issues.map((issue,index)=><p key={index}>{({DEPENDENT_PROJECT_STATE_UNAVAILABLE:'프로젝트 원장을 찾을 수 없습니다. 등록을 보존합니다.',DEPENDENT_PROJECT_RECOVERY_OR_LOCK_PENDING:'프로젝트 복구 또는 잠금 확인이 필요합니다.',DEPENDENT_PROJECT_TRANSACTION_PENDING:'프로젝트 적용 또는 해제가 진행 중입니다.',DEPENDENT_PROJECT_CONSUMER_UNVERIFIED:'프로젝트의 설치 자원 확인이 필요합니다.',DEPENDENT_PROJECT_REGISTRATION_MISMATCH:'전역과 프로젝트의 등록 기록이 다릅니다.'} as Record<string,string>)[issue.code]||issue.code}</p>)}
        </div>)}
        {catalog.dependencyDependents?.issues.map((issue,index)=><p key={index}>{issue.code}</p>)}
      </section>}
      {catalog?.dependencyGraph&&['agents','skills','mcp'].includes(view)&&<section aria-label="범위 간 의존성" className="space-y-3 rounded-2xl border p-4 text-xs text-slate-500">
        <h2 className="font-bold">범위 간 의존성 · 읽기 전용</h2>
        <p>{catalog.dependencyGraph.valid?'선언 참조 확인됨':'선언 참조 확인 필요'} · 전역 설치 상태: 미확인 · 자동 적용 차단</p>
        {nativeClientId&&onInspectInstallations&&<button disabled={inspectingInstallations} className="rounded-xl border px-3 py-2 font-bold disabled:opacity-50" onClick={()=>void inspectInstallations()}>{clientNames.get(nativeClientId)||nativeClientId} CLI 설치 소유 정보 확인</button>}
        {inspectingInstallations&&<p role="status">전역 설치 소유 정보를 확인하는 중…</p>}{installationInspectionError&&<p role="alert">{installationInspectionError}</p>}
        {catalog.dependencyGraph.globalPrerequisites.length>0?<table className="w-full text-left"><thead><tr><th>필요한 전역 자원</th><th>종류</th><th>Kit</th><th>설치 상태</th></tr></thead><tbody>{catalog.dependencyGraph.globalPrerequisites.map(item=><tr key={item.key}><td>{item.assetId}</td><td>{item.kind}</td><td>{item.kitId}</td><td>미확인</td></tr>)}</tbody></table>:<p>{catalog.dependencyGraph.valid?'현재 선언에서 참조한 다른 범위의 전역 자원이 없습니다.':'선언 문제를 해결한 뒤 전역 의존성을 다시 확인하세요.'}</p>}
        {catalog.dependencyGraph.issues.map((item,index)=><p key={index}>{item.sourceAssetId?`${item.sourceAssetId} · `:''}{item.code}</p>)}
      </section>}
      {catalog?.installationPrerequisites&&['agents','skills','mcp'].includes(view)&&<section aria-label="전역 설치 소유 정보" className="space-y-3 rounded-2xl border p-4 text-xs text-slate-500">
        <h2 className="font-bold">전역 설치 소유 정보 · 읽기 전용</h2><p>설치 당시 선언과 현재 소유 영역을 대조합니다. 클라이언트 발견·Tool binding: 미확인 · 자동 적용 차단</p>
        <p>{catalog.installationPrerequisites.target.clientId} · {catalog.installationPrerequisites.target.surface} · {catalog.installationPrerequisites.consistency==='observed'?'원장 대조됨':'원장 확인 필요'}{catalog.installationPrerequisites.reason?` · ${catalog.installationPrerequisites.reason}`:''}</p>
        {catalog.installationPrerequisites.checks.map(item=><div key={item.nodeKey}><p>{item.assetId} · {({"ownership-observed":"소유 영역 확인됨",drift:'설치 내용 변경됨',unverified:'확인 필요'} as Record<string,string>)[item.status]||item.status}</p>
          <p>{item.reason}{item.revisionDigest?` · revision ${item.revisionDigest.slice(0,12)}`:''}</p>
          {item.dependencyState&&<p>{({'revision-observed':'설치 의존성 revision 일치',drift:'설치 의존성 변경 감지',unverified:'설치 의존성 기록 확인 필요'} as const)[item.dependencyState]}</p>}
          {item.bindingDeclarationsState==='recorded'&&<p>설치 당시 Tool 이름 기록 · 실행 가능 여부 미확인</p>}
          {item.dependencyBindings?.map((binding,index)=><p key={index}>{binding.toolId} → {binding.nativeId} · {binding.nativeName} · Kit {binding.providerId} · revision {binding.providerRevisionDigest.slice(0,12)}</p>)}
          {item.dependencyIssues?.map((issue,index)=><p key={index}>{issue.assetId?`${issue.assetId} · `:''}{({INSTALLED_DEPENDENCY_REVISION_CHANGED:'설치 후 의존 자원 revision이 바뀌었습니다.',INSTALLED_DEPENDENCY_CONTENT_DRIFT:'의존 자원의 설치 내용이 바뀌었습니다.',INSTALLED_NATIVE_TOOL_MAPPING_UNAVAILABLE:'설치 당시 native Tool 이름을 확인할 수 없습니다.',INSTALLED_DEPENDENCY_SNAPSHOT_UNAVAILABLE:'설치 당시 의존성 기록이 없습니다.'} as Record<string,string>)[issue.code]||issue.code}</p>)}
        </div>)}
      </section>}
      {catalog && ['skills','mcp','instructions'].includes(view) && onObserveNative && nativeClientId && <section className="space-y-2 rounded-2xl border p-4 text-xs text-slate-500">
        <button disabled={observingNative} className="rounded-xl border px-3 py-2 font-bold disabled:opacity-50" onClick={()=>void observeNative()}>{clientNames.get(nativeClientId)||nativeClientId} CLI 상태 확인</button>
        <p>{view==='mcp'?'설치된 CLI에서 MCP 실효 설정과 필드별 출처를 읽습니다. MCP 연결·Tool·모델 호출은 하지 않습니다.':view==='instructions'?'클라이언트 지침 설정과 문서상의 파일 선택 후보를 비교합니다. 실제 주입 여부: 미확인':'설치된 CLI에서 Skill 목록과 활성 상태를 읽습니다. 모델 호출은 하지 않습니다.'}</p>
        {observingNative&&<p role="status">클라이언트 목록을 확인하는 중…</p>}
        {nativeError&&<p role="alert">{nativeError}</p>}
        {catalog.nativeObservation&&<p>{catalog.nativeObservation.status==='observed'?'클라이언트 목록 확인됨':catalog.nativeObservation.status==='partial'?'일부 항목만 확인됨':'클라이언트 상태 미확인'} · {catalog.nativeObservation.clientId} {catalog.nativeObservation.surface}{catalog.nativeObservation.checkedAt?` · ${catalog.nativeObservation.checkedAt}`:''}{catalog.nativeObservation.reason?` · ${catalog.nativeObservation.reason}`:''}</p>}
      </section>}
      {catalog?.nativeObservation?.instructionPreview&&view==='instructions'&&<section aria-label="지침 선택 후보" className="space-y-3 rounded-2xl border p-4 text-xs text-slate-500">
        <h2 className="font-bold">문서 기준 지침 선택 후보 · 읽기 전용</h2><p>파일과 설정을 대조한 예상입니다. 실제 클라이언트 주입 상태: 미확인</p>
        <p>클라이언트 지침 예산: {catalog.nativeObservation.instructionPreview.byteBudget} bytes{catalog.nativeObservation.instructionPreview.budgetMayTruncate?' · 일부 내용이 잘릴 수 있음':''}</p>
        {catalog.nativeObservation.instructionPreview.customGuidancePresent&&<p>별도 지침 설정 있음 · 합성 문맥 미확인</p>}{catalog.nativeObservation.instructionPreview.contextIncomplete&&<p>사용자 정의 프로젝트 경계 · 상위 경로 미확인</p>}
        {catalog.nativeObservation.instructionPreview.files.filter(item=>item.state!=='missing').map(item=><div key={item.path}><p className="break-all font-mono">{item.path}</p><p>{({candidate:'문서 기준 선택 후보',shadowed:'같은 폴더의 우선 지침에 가려짐',empty:'빈 지침',unverified:'파일 확인 필요','selection-unverified':'우선 파일 미확인으로 선택 보류'} as Record<string,string>)[item.state]||item.state} · {item.scope==='context'?'상위 문맥':item.scope==='global'?'전역':'프로젝트'}</p></div>)}
      </section>}
      {catalog?.nativeObservation?.registrations&&view==='mcp'&&<section aria-label="MCP 실효 설정" className="space-y-3 rounded-2xl border p-4 text-xs text-slate-500">
        <h2 className="font-bold">MCP 실효 설정 · 읽기 전용</h2><p>클라이언트가 합성한 설정입니다. 등록·활성 상태와 실제 연결·Tool 사용 여부는 별개입니다.</p>
        {catalog.nativeObservation.registrations.map(item=><div key={item.name}><p>{item.name} · {item.enabled?'활성 설정':'비활성 설정'} · {item.composition==='composed'?'여러 원본 합성':item.composition==='single-source'?'단일 원본':'출처 미확인'}</p>
          {item.origins.map((origin,index)=><p key={index} className="break-all font-mono">{origin.field} ← {origin.path||'출처 미확인'}</p>)}<p>연결·Tool 사용 미확인</p></div>)}
      </section>}
      {!!catalog?.nativeObservation?.additional?.length&&view==='skills'&&<section aria-label="추가 탐색 경로" className="space-y-3 rounded-2xl border p-4 text-xs text-slate-500">
        <h2 className="font-bold">추가 탐색 경로 · 읽기 전용</h2><p>클라이언트가 추가로 발견한 항목입니다. 선택한 Kit이나 프로젝트의 관리 권한으로 연결하지 않습니다.</p>
        {catalog.nativeObservation.additional.map(item=><div key={item.path}><p>{item.name}</p><p className="break-all font-mono">{item.path}</p><p>{item.nativeScope} · {item.enabled?'활성':'비활성'}</p></div>)}
      </section>}
      </details>
    </div>
  );
}
