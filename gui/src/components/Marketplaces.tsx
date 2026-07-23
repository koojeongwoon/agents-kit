import {ArrowRightLeft, Download, Layers, Search, XCircle} from 'lucide-react';

export interface SkillSearchResult {
  id: string;
  name: string;
  skillId: string;
  source: string;
  installs: number;
  url: string;
  recommendationReason?: string;
}

export interface SmitherySearchResult {
  qualifiedName: string;
  displayName: string;
  description: string;
  verified: boolean;
  useCount: number;
  bySmithery: boolean;
  recommendationReason?: string;
}

export interface SmitheryConfigField {
  name: string;
  targetName: string;
  transport: 'header' | 'query';
  required: boolean;
  description: string;
  secret: boolean;
}

export interface SmitheryServerDetail {
  qualifiedName: string;
  displayName: string;
  description: string;
  deploymentUrl: string;
  fields: SmitheryConfigField[];
  toolCount: number;
  security: { scanPassed?: boolean } | null;
}

type Scope = 'global' | 'project';

interface SkillMarketplaceProps {
  open: boolean;
  scope: Scope;
  projectName: string;
  projectPath: string;
  query: string;
  results: SkillSearchResult[];
  loading: boolean;
  installing: boolean;
  searchError: string | null;
  installError: string | null;
  message: string | null;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onProjectPathChange: (value: string) => void;
  onSearch: () => void;
  onInstall: (locator: string) => void;
}

export function SkillMarketplaceModal(props: SkillMarketplaceProps) {
  if (!props.open) return null;
  const projectBlocked = props.scope === 'project' && !props.projectPath.trim();
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-cyan-500/30 bg-[#111827] shadow-2xl shadow-cyan-950/30">
        <div className="flex items-start justify-between border-b border-slate-800 p-6">
          <div><h3 className="flex items-center space-x-2 text-lg font-bold text-white"><Download className="h-5 w-5 text-cyan-400" /><span>skills.sh 마켓</span></h3><p className="mt-1 text-xs text-slate-400">앱 안에서 검색하고, 원하는 스킬을 현재 {props.scope === 'global' ? 'Global' : `Project (${props.projectName})`} 스코프에 바로 적용합니다.</p></div>
          <button onClick={props.onClose} className="text-slate-400 hover:text-white"><XCircle className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 border-b border-slate-800 p-5">
          <div className="flex gap-3"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input autoFocus type="search" value={props.query} onChange={event => props.onQueryChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') props.onSearch(); }} placeholder="필요한 스킬 검색: React, testing, Kubernetes, documentation…" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none" /></div><button onClick={props.onSearch} disabled={props.loading || props.query.trim().length < 2} className="rounded-xl bg-cyan-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-40">{props.loading ? '검색 중…' : '검색'}</button></div>
          {props.scope === 'project' && <input type="text" value={props.projectPath} onChange={event => props.onProjectPathChange(event.target.value)} placeholder="바로 적용할 프로젝트 경로: /Users/jw/__dev/my-project" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-xs text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none" />}
          {props.searchError && <p className="text-xs text-rose-300">{props.searchError}</p>}
          {props.installError && <p className="text-xs text-rose-300">설치 실패: {props.installError}</p>}
          {props.message && <p className="text-xs text-emerald-300">{props.message}</p>}
        </div>
        <div className="min-h-[280px] flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-center justify-between text-[11px]"><span className="font-semibold text-cyan-300">{props.query.trim() ? `'${props.query.trim()}' 실시간 검색 결과` : '🔥 인기 + 최근 급상승 추천'}</span><span className="text-slate-500">입력을 멈추면 자동으로 검색됩니다</span></div>
          {props.results.length === 0 ? <div className="flex h-full min-h-[260px] items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/30 text-center"><div><Search className="mx-auto mb-3 h-8 w-8 text-slate-600" /><p className="text-sm text-slate-400">{props.loading ? 'skills.sh에서 검색하는 중입니다…' : '검색어를 입력하면 skills.sh 결과가 여기에 표시됩니다.'}</p></div></div> : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{props.results.map(skill => <div key={skill.id} className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-cyan-500/40"><div><div className="flex items-start justify-between gap-3"><h4 className="break-all text-sm font-bold text-slate-100">{skill.name}</h4><span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-300">{new Intl.NumberFormat('ko-KR').format(skill.installs)} installs</span></div><p className="mt-2 break-all font-mono text-[11px] text-slate-500">{skill.source}</p>{skill.recommendationReason && <span className="mt-2 inline-block rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-300">{skill.recommendationReason}</span>}</div><button onClick={() => props.onInstall(`${skill.source}@${skill.skillId}`)} disabled={props.installing || projectBlocked} className="mt-4 flex items-center justify-center space-x-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"><Download className={`h-3.5 w-3.5 ${props.installing ? 'animate-bounce' : ''}`} /><span>{props.installing ? '설치 중…' : '설치 + 바로 적용'}</span></button></div>)}</div>}
        </div>
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4 text-[11px] text-slate-500"><span>skills.sh 공개 카탈로그 · GitHub 소스 스킬</span><span>외부 스킬은 적용 후 내용을 검토하세요.</span></div>
      </div>
    </div>
  );
}

interface SmitheryMarketplaceProps {
  open: boolean;
  scope: Scope;
  projectName: string;
  projectPath: string;
  query: string;
  results: SmitherySearchResult[];
  selected: SmitheryServerDetail | null;
  alias: string;
  configValues: Record<string, string>;
  searchLoading: boolean;
  detailLoading: boolean;
  merging: boolean;
  error: string | null;
  message: string | null;
  onClose: () => void;
  onBack: () => void;
  onQueryChange: (value: string) => void;
  onProjectPathChange: (value: string) => void;
  onAliasChange: (value: string) => void;
  onConfigChange: (name: string, value: string) => void;
  onSearch: () => void;
  onSelect: (qualifiedName: string) => void;
  onMerge: () => void;
}

export function SmitheryMarketplaceModal(props: SmitheryMarketplaceProps) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-violet-500/30 bg-[#111827] shadow-2xl shadow-violet-950/30">
        <div className="flex items-start justify-between border-b border-slate-800 p-6"><div><h3 className="flex items-center space-x-2 text-lg font-bold text-white"><Layers className="h-5 w-5 text-violet-400" /><span>Smithery MCP 마켓</span></h3><p className="mt-1 text-xs text-slate-400">검색부터 설정 병합, 현재 {props.scope === 'global' ? 'Global' : `Project (${props.projectName})`} 스코프 적용까지 앱 안에서 처리합니다.</p></div><button onClick={props.onClose} className="text-slate-400 hover:text-white"><XCircle className="h-5 w-5" /></button></div>
        {!props.selected ? <><div className="space-y-3 border-b border-slate-800 p-5"><div className="flex gap-3"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input autoFocus type="search" value={props.query} onChange={event => props.onQueryChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') props.onSearch(); }} placeholder="필요한 MCP 검색: GitHub, browser, database, Slack…" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none" /></div><button onClick={props.onSearch} disabled={props.searchLoading || props.query.trim().length < 2} className="rounded-xl bg-violet-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-40">{props.searchLoading ? '검색 중…' : '검색'}</button></div>{props.error && <p className="text-xs text-rose-300">{props.error}</p>}</div><div className="min-h-[300px] flex-1 overflow-y-auto p-5"><div className="mb-3 flex items-center justify-between text-[11px]"><span className="font-semibold text-violet-300">{props.query.trim() ? `'${props.query.trim()}' 실시간 검색 결과` : '🔥 인기 + 최신 MCP 추천'}</span><span className="text-slate-500">입력을 멈추면 자동으로 검색됩니다</span></div>{props.results.length === 0 ? <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/30 text-center"><div><Search className="mx-auto mb-3 h-8 w-8 text-slate-600" /><p className="text-sm text-slate-400">{props.searchLoading ? 'Smithery에서 검색하는 중입니다…' : '검색어를 입력하면 배포 가능한 원격 MCP가 표시됩니다.'}</p></div></div> : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{props.results.map(server => <div key={server.qualifiedName} className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-violet-500/40"><div><div className="flex items-start justify-between gap-3"><h4 className="break-all text-sm font-bold text-slate-100">{server.displayName}</h4>{server.verified && <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300">verified</span>}</div><p className="mt-1 break-all font-mono text-[11px] text-violet-300">{server.qualifiedName}</p><p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-400">{server.description || '설명 없음'}</p>{server.recommendationReason && <span className="mt-2 inline-block rounded-md bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-300">{server.recommendationReason}</span>}</div><div className="mt-4 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-500">{new Intl.NumberFormat('ko-KR').format(server.useCount)} uses</span><button onClick={() => props.onSelect(server.qualifiedName)} disabled={props.detailLoading} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40">{props.detailLoading ? '불러오는 중…' : '설정 및 병합'}</button></div></div>)}</div>}</div></> : <div className="flex-1 overflow-y-auto p-6 space-y-5"><button onClick={props.onBack} className="text-xs text-violet-300 hover:text-violet-200">← 검색 결과로 돌아가기</button><div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-base font-bold text-white">{props.selected.displayName}</h4><p className="mt-1 font-mono text-xs text-violet-300">{props.selected.qualifiedName}</p></div><span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-300">{props.selected.toolCount} tools</span></div><p className="mt-3 text-xs leading-relaxed text-slate-400">{props.selected.description}</p><p className="mt-3 break-all font-mono text-[11px] text-slate-500">{props.selected.deploymentUrl}</p></div><div><label className="mb-2 block text-xs font-semibold text-slate-300">MCP 별칭</label><input value={props.alias} onChange={event => props.onAliasChange(event.target.value)} placeholder="예: github" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-sm text-white focus:border-violet-500 focus:outline-none" /><p className="mt-1 text-[10px] text-slate-500">동일 별칭이 이미 있으면 기존 설정을 덮어쓰지 않고 중단합니다.</p></div>{props.selected.fields.map(field => <div key={field.name}><label className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-300"><span>{field.name}{field.required ? ' *' : ''}</span><span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">{field.transport}: {field.targetName}</span></label><input type={field.secret ? 'password' : 'text'} value={props.configValues[field.name] || ''} onChange={event => props.onConfigChange(field.name, event.target.value)} placeholder={field.description || `${field.name} 값을 입력하세요`} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none" /></div>)}{props.scope === 'project' && <input value={props.projectPath} onChange={event => props.onProjectPathChange(event.target.value)} placeholder="바로 적용할 프로젝트 경로" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-xs text-white focus:border-violet-500 focus:outline-none" />}{props.error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{props.error}</div>}{props.message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">{props.message}</div>}<button onClick={props.onMerge} disabled={props.merging} className="flex w-full items-center justify-center space-x-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40"><ArrowRightLeft className="h-4 w-4" /><span>{props.merging ? '병합 및 적용 중…' : 'MCP에 병합 + 바로 적용'}</span></button></div>}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4 text-[11px] text-slate-500"><span>Smithery 공개 레지스트리 · 원격 HTTP MCP</span><span>인증값은 .env에만 저장</span></div>
      </div>
    </div>
  );
}
