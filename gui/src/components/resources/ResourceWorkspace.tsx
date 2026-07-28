import {useState} from 'react';
import {AlertCircle, ArrowUpRight, Bot, Boxes, Network, Plus, Search, Sparkles, Wrench} from 'lucide-react';
import type {ClientSummary, RegistryResource} from '../../api/deploy';
import type {ResourceView} from '../shell/ControlCenterShell';

interface ResourceWorkspaceProps {
  view: ResourceView;
  clients: ClientSummary[];
  resources: RegistryResource[];
  targetReady: boolean;
  loading: boolean;
  error: string;
  onOpenEditor: (assetId?: string) => void;
  onOpenDeploy: () => void;
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
    return {label: '지원', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'};
  }
  if (matching.length > 0) {
    return {label: '제한', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-300'};
  }
  return {label: '미지원', className: 'bg-slate-500/10 text-slate-500'};
}

export function ResourceWorkspace({
  view,
  clients,
  resources,
  targetReady,
  loading,
  error,
  onOpenEditor,
  onOpenDeploy
}: ResourceWorkspaceProps) {
  const [query, setQuery] = useState('');
  const config = workspaceConfig[view];
  const Icon = config.icon;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = resources
    .filter(resource => resource.kind === config.kind)
    .filter(resource => {
      if (!normalizedQuery) return true;
      return [
        resource.id,
        resource.displayName,
        ...resource.providedTools,
        ...resource.requiredTools
      ].some(value => String(value || '').toLowerCase().includes(normalizedQuery));
    });

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div>
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <Icon className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Managed Assets</span>
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-950 dark:text-white">{config.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">{config.description}</p>
        </div>
        <button
          type="button"
          onClick={() => onOpenEditor()}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          리소스 추가
        </button>
      </section>

      {targetReady && (
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

      {!targetReady && (
        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-amber-500" />
          <h2 className="mt-3 font-bold">프로젝트 경로가 필요합니다</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            상단에서 프로젝트 경로를 입력하면 {config.title}를 불러옵니다.
          </p>
        </section>
      )}

      {targetReady && loading && (
        <p role="status" className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-800">
          리소스를 불러오는 중…
        </p>
      )}

      {targetReady && error && (
        <p role="alert" className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600">
          {error}
        </p>
      )}

      {targetReady && !loading && !error && filtered.length === 0 && (
        <section className="rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <Network className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 font-bold">{config.empty}</h2>
          <p className="mt-2 text-sm text-slate-500">새 리소스를 추가하면 환경별 지원 상태와 의존성을 여기서 비교할 수 있습니다.</p>
        </section>
      )}

      {targetReady && !loading && !error && filtered.length > 0 && (
        <section className="grid gap-4 xl:grid-cols-2" aria-label={`${config.title} 목록`}>
          {filtered.map(resource => (
            <article key={resource.id} className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-slate-950 dark:text-white">{resource.displayName || resource.id}</h2>
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-300">
                      관리 중
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">{resource.id}</p>
                </div>
                <span className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-500 dark:border-slate-700">
                  {resource.scope?.type === 'global' ? '전역' : '프로젝트'}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {resource.providedTools.map(tool => (
                  <span key={tool} className="rounded-lg bg-violet-500/10 px-2 py-1 font-mono text-[10px] text-violet-600 dark:text-violet-300">
                    {tool}
                  </span>
                ))}
                {resource.requiredTools.map(tool => (
                  <span key={tool} className="rounded-lg bg-cyan-500/10 px-2 py-1 font-mono text-[10px] text-cyan-600 dark:text-cyan-300">
                    필요: {tool}
                  </span>
                ))}
                {resource.providedTools.length === 0 && resource.requiredTools.length === 0 && (
                  <span className="text-xs text-slate-500">직접 연결된 Tool 없음</span>
                )}
              </div>

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
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenEditor(resource.id)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold hover:border-blue-400 hover:text-blue-600 dark:border-slate-700"
                >
                  편집
                </button>
                <button
                  type="button"
                  onClick={onOpenDeploy}
                  className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold hover:border-blue-400 hover:text-blue-600 dark:border-slate-700"
                >
                  배포 검토 <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
