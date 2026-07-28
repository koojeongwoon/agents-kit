import {AlertTriangle, ArrowRight, Boxes, CircleDot, Rocket, ShieldCheck, Wrench} from 'lucide-react';
import type {ClientSummary, LocalClientDiscovery, RegistryResource} from '../../api/deploy';

interface ControlCenterHomeProps {
  clients: ClientSummary[];
  localDiscovery: LocalClientDiscovery[];
  resources: RegistryResource[];
  targetReady: boolean;
  scope: 'global' | 'project';
  onOpenMcp: () => void;
  onOpenDeploy: () => void;
}

export function ControlCenterHome({
  clients,
  localDiscovery,
  resources,
  targetReady,
  scope,
  onOpenMcp,
  onOpenDeploy
}: ControlCenterHomeProps) {
  const discoveryByClient = new Map(localDiscovery.map(result => [result.id, result]));
  const discoveryIssues = localDiscovery.flatMap(result => result.issues);
  const discoveredAssets = localDiscovery.flatMap(result => result.assets);
  const countAssetUnion = (kind: string) => new Set([
    ...resources.filter(resource => resource.kind === kind).map(resource => resource.id),
    ...discoveredAssets.filter(asset => asset.kind === kind).map(asset => asset.id)
  ]).size;
  const resourceCounts = {
    mcp: countAssetUnion('mcpServers'),
    skills: countAssetUnion('skills'),
    agents: resources.filter(resource => resource.kind === 'agents').length,
    harness: resources.filter(resource => resource.kind === 'harness').length
  };

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="grid gap-8 p-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <CircleDot className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-[0.2em]">Local AI Control Center</span>
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              여러 AI 환경의 설정을 한곳에서 관리하세요
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              MCP가 제공하는 Tool을 확인하고, Skill과 Agent를 조합한 뒤 Codex, AGY, Cursor,
              Claude Code의 형식에 맞는 변경 계획을 검토할 수 있습니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onOpenMcp}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
              >
                <Wrench className="h-4 w-4" />
                MCP 확인하기
              </button>
              <button
                type="button"
                onClick={onOpenDeploy}
                className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:text-slate-200"
              >
                <Rocket className="h-4 w-4" />
                배포 센터 열기
              </button>
            </div>
          </div>

          <div className={`rounded-2xl border p-5 ${
            targetReady
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-amber-500/20 bg-amber-500/5'
          }`}>
            <div className="flex items-center gap-2">
              <ShieldCheck className={`h-5 w-5 ${targetReady ? 'text-emerald-500' : 'text-amber-500'}`} />
              <h2 className="font-bold">{targetReady ? '관리 대상 준비됨' : '먼저 관리 대상을 지정하세요'}</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">
              {targetReady
                ? `${scope === 'global' ? '내 PC 전역' : '선택한 프로젝트'} Kit의 자산을 읽을 수 있습니다. 진단은 선택 사항이며 계획 생성의 선행 조건이 아닙니다.`
                : '상단의 프로젝트 경로를 입력하면 기존 Manifest를 읽고 자산별 상태를 보여줍니다.'}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="자산 요약">
        {[
          {label: 'MCP', value: resourceCounts.mcp, description: 'Tool 제공자'},
          {label: 'Skill', value: resourceCounts.skills, description: '재사용 작업'},
          {label: 'Agent', value: resourceCounts.agents, description: '역할과 조합'},
          {label: 'Harness', value: resourceCounts.harness, description: '환경 프로필'}
        ].map(item => (
          <article
            key={item.label}
            aria-label={`${item.label} 자산 요약`}
            className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{item.label}</span>
              <Boxes className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-3 text-3xl font-bold text-slate-950 dark:text-white">{targetReady ? item.value : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">{item.description}</p>
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">지원 환경</h2>
            <p className="mt-1 text-xs text-slate-500">클라이언트별 검증된 capability 정의를 기반으로 표시합니다.</p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-400" />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {clients.map(client => (
            <article
              key={client.id}
              aria-label={`${client.displayName} 환경 상태`}
              className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">{client.displayName}</h3>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    {client.detection.commands.join(', ') || client.id}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-600 dark:text-blue-300">
                  지원 정의됨
                </span>
                {discoveryByClient.get(client.id)?.installed && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
                    PC에 설치됨
                  </span>
                )}
                {discoveryByClient.get(client.id)?.configured && (
                  <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[10px] font-bold text-violet-600 dark:text-violet-300">
                    설정 발견
                  </span>
                )}
                {!discoveryByClient.get(client.id)?.installed && !discoveryByClient.get(client.id)?.configured && (
                  <span className="rounded-full bg-slate-500/10 px-2 py-1 text-[10px] font-bold text-slate-500">
                    지원만 됨
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {new Set(client.capabilities.map(capability => capability.assetKind)).size}개 자산 유형 지원
              </p>
            </article>
          ))}
        </div>
        {discoveryIssues.length > 0 && (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"
          >
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              <h3 className="text-sm font-bold">일부 설정을 읽지 못했습니다</h3>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
              {discoveryIssues.map((issue, index) => (
                <li key={`${issue.code}:${issue.sourcePath}:${index}`} className="flex flex-wrap gap-2">
                  <span className="font-mono">{issue.code}</span>
                  <span className="font-mono">{issue.sourcePath}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
