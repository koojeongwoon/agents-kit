import type {ReactNode} from 'react';
import {
  Bot,
  Boxes,
  Layers,
  Moon,
  PackageSearch,
  Rocket,
  Settings,
  Sparkles,
  Sun,
  Wrench
} from 'lucide-react';
import type {ClientSummary, LocalClientDiscovery} from '../../api/deploy';

export type ResourceView = 'mcp' | 'skills' | 'agents' | 'harness';
export type AppView = 'home' | ResourceView | 'deploy' | 'editor';

interface ControlCenterShellProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  clients: ClientSummary[];
  clientsLoading: boolean;
  clientsError: string;
  localDiscovery: LocalClientDiscovery[];
  localDiscoveryLoading: boolean;
  localDiscoveryError: string;
  clientId: string;
  setClientId: (clientId: string) => void;
  scope: 'global' | 'project';
  setScope: (scope: 'global' | 'project') => void;
  projectName: string;
  setProjectName: (projectName: string) => void;
  projectPath: string;
  setProjectPath: (projectPath: string) => void;
  children: ReactNode;
}

const tabs: Array<{id: ResourceView; label: string; icon: typeof Wrench}> = [
  {id: 'mcp', label: 'MCP', icon: Wrench},
  {id: 'skills', label: 'Skill', icon: Sparkles},
  {id: 'agents', label: 'Agent', icon: Bot},
  {id: 'harness', label: 'Harness', icon: Boxes}
];

export function ControlCenterShell({
  activeView,
  onViewChange,
  theme,
  onToggleTheme,
  clients,
  clientsLoading,
  clientsError,
  localDiscovery,
  localDiscoveryLoading,
  localDiscoveryError,
  clientId,
  setClientId,
  scope,
  setScope,
  projectName,
  setProjectName,
  projectPath,
  setProjectPath,
  children
}: ControlCenterShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 transition-colors dark:bg-[#080C13] dark:text-slate-100">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-[#080C13]/95">
        <div className="mx-auto flex min-h-16 max-w-[1480px] items-center gap-6 px-6">
          <button
            type="button"
            onClick={() => onViewChange('home')}
            className="flex min-w-fit items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Agent Kit 홈"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/20">
              <Layers className="h-5 w-5 text-white" />
            </span>
            <span>
              <span className="block text-sm font-bold text-slate-950 dark:text-white">Agent Kit</span>
              <span className="block text-[10px] font-medium text-slate-500">Local AI Control Center</span>
            </span>
          </button>

          <nav aria-label="주요 자산" className="min-w-0 flex-1">
            <div role="tablist" className="flex items-center justify-center gap-1">
              {tabs.map(tab => {
                const Icon = tab.icon;
                const selected = activeView === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => onViewChange(tab.id)}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      selected
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="flex min-w-fit items-center gap-2">
            <button
              type="button"
              onClick={() => onViewChange('deploy')}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                activeView === 'deploy'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                  : 'border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              <Rocket className="h-4 w-4" />
              배포 센터
            </button>
            <button
              type="button"
              onClick={() => onViewChange('editor')}
              className={`rounded-xl border p-2 transition ${
                activeView === 'editor'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-600'
                  : 'border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300'
              }`}
              aria-label="고급 편집기"
              title="고급 편집기"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              className="rounded-xl border border-slate-300 p-2 text-slate-600 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
              aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
              title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200/80 bg-slate-50/90 dark:border-slate-800 dark:bg-slate-950/70">
          <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-3 px-6 py-3">
            <div className="flex items-center gap-2">
              <PackageSearch className="h-4 w-4 text-slate-400" />
              <label htmlFor="control-scope" className="sr-only">Kit 범위</label>
              <select
                id="control-scope"
                value={scope}
                onChange={event => setScope(event.target.value as 'global' | 'project')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="global">내 PC 전역</option>
                <option value="project">프로젝트 Kit</option>
              </select>
            </div>

            {scope === 'project' && (
              <>
                <label htmlFor="control-project-name" className="sr-only">Kit 이름</label>
                <input
                  id="control-project-name"
                  value={projectName}
                  onChange={event => setProjectName(event.target.value)}
                  className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Kit 이름"
                />
                <label htmlFor="control-project-path" className="sr-only">프로젝트 경로</label>
                <input
                  id="control-project-path"
                  value={projectPath}
                  onChange={event => setProjectPath(event.target.value)}
                  className="min-w-64 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                  placeholder="관리할 프로젝트 경로를 입력하세요"
                />
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-500">현재 배포 환경</span>
              <label htmlFor="control-client" className="sr-only">현재 배포 환경</label>
              <select
                id="control-client"
                value={clientId}
                onChange={event => setClientId(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
              >
                {clients.length === 0 && <option value={clientId}>{clientsLoading ? '불러오는 중…' : clientId}</option>}
                {clients.map(client => (
                  <option key={client.id} value={client.id}>{client.displayName}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mx-auto flex max-w-[1480px] items-center gap-2 overflow-x-auto px-6 pb-3" aria-label="지원 환경">
            <span className="min-w-fit text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">지원 환경</span>
            {(clientsLoading || localDiscoveryLoading) && <span className="text-xs text-slate-500">설치 상태를 확인하는 중…</span>}
            {clientsError && <span role="alert" className="text-xs text-rose-600">{clientsError}</span>}
            {localDiscoveryError && <span role="alert" className="text-xs text-rose-600">{localDiscoveryError}</span>}
            {clients.map(client => {
              const discovery = localDiscovery.find(item => item.id === client.id);
              const installed = discovery?.installed === true;
              return (
                <span
                  key={client.id}
                  className="flex min-w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${installed ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
                  {client.displayName} · {installed ? 'PC에 설치됨' : '지원만 됨'}
                </span>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1480px] px-6 py-8">
        {children}
      </main>
    </div>
  );
}
