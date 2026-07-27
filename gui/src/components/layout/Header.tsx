import {GitBranch, Layers, Sun, Moon} from 'lucide-react';

interface HeaderProps {
  kitRoot: string;
  projectRoot: string;
  gitStatus: {
    isConnected: boolean;
    branch: string;
    remoteUrl: string;
    changedFiles: { status: string; file: string }[];
  } | null;
  handleOpenGitModal: () => Promise<void>;
  setShowLlmKeyModal: (show: boolean) => void;
  fetchLlmKeysStatus: () => Promise<void>;
  mainView: 'assets' | 'clients';
  setMainView: (view: 'assets' | 'clients') => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export function Header({
  kitRoot,
  projectRoot,
  gitStatus,
  handleOpenGitModal,
  setShowLlmKeyModal,
  fetchLlmKeysStatus,
  mainView,
  setMainView,
  theme,
  toggleTheme
}: HeaderProps) {
  return (
    <header className="border-b border-slate-900/60 bg-[var(--bg-color)]/90 backdrop-blur sticky top-0 z-50 transition-all duration-200">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 dark:from-white dark:via-slate-200 dark:to-slate-400 font-sans">
              agents-kit Adapter Hub
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono truncate max-w-md" title={kitRoot || projectRoot}>
              Kit: {kitRoot || '—'}
            </p>
          </div>
        </div>

        {/* Navigation Views */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setMainView('assets')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 ${
              mainView === 'assets'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-600 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800'
            }`}
          >
            <span>내 자원 묶음</span>
          </button>

          <button
            onClick={() => setMainView('clients')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 ${
              mainView === 'clients'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-600 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800'
            }`}
          >
            <span>적용된 클라이언트</span>
          </button>

          {/* Git Sync Button */}
          <button
            onClick={() => { handleOpenGitModal().catch(console.error); }}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 border ${
              gitStatus?.isConnected
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-600/40'
                : 'bg-slate-200/50 border-slate-300 dark:bg-slate-800/60 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
            title={gitStatus?.isConnected ? `Git: ${gitStatus.branch} — ${gitStatus.remoteUrl}` : 'Git 미연동 — 클릭하여 설정'}
          >
            <GitBranch className={`w-4 h-4 ${gitStatus?.isConnected ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} />
            <span>{gitStatus?.isConnected ? `${gitStatus.branch}` : 'Git 연동'}</span>
            {gitStatus?.isConnected && gitStatus.changedFiles.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 dark:text-amber-400 text-[10px] font-bold border border-amber-500/30">
                {gitStatus.changedFiles.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setShowLlmKeyModal(true);
              fetchLlmKeysStatus().catch(console.error);
            }}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700/80 transition-all flex items-center space-x-1.5"
          >
            <span>API 키 관리</span>
          </button>

          {/* Theme Toggle Switched Button */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl border border-slate-300 dark:border-slate-700/80 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center"
            title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />}
          </button>
        </div>
      </div>
    </header>
  );
}
