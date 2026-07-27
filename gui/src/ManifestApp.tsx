import {useEffect, useState} from 'react';
import {Layers, Moon, Sun, ShieldCheck, Settings} from 'lucide-react';
import {ManifestDeploymentPanel} from './components/deploy/ManifestDeploymentPanel';
import {ManifestEditor} from './components/config/ManifestEditor';

export default function ManifestApp() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (
    (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
  ));

  const [activeTab, setActiveTab] = useState<'deploy' | 'editor'>('deploy');

  // Shared configuration states
  const [scope, setScope] = useState<'global' | 'project'>('project');
  const [clientId, setClientId] = useState('codex');
  const [projectName, setProjectName] = useState('default');
  const [projectPath, setProjectPath] = useState('');
  const [clientVersion, setClientVersion] = useState('');

  // Navigation state for editor
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const handleNavigateToAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
    setActiveTab('editor');
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 transition-colors dark:bg-[#0B0F17] dark:text-slate-100">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-900 dark:bg-[#0B0F17]/90">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/20">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-950 dark:text-white">Agent Kit Control Plane</h1>
              <p className="text-xs text-slate-500">Manifest · Capability · Transaction · Rollback</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <nav className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
              <button
                onClick={() => setActiveTab('deploy')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'deploy'
                    ? 'bg-white text-blue-600 shadow dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <ShieldCheck className="h-4 w-4" /> 배포 및 진단 (Deploy)
              </button>
              <button
                onClick={() => setActiveTab('editor')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'editor'
                    ? 'bg-white text-blue-600 shadow dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Settings className="h-4 w-4" /> 매니페스트 에디터 (Editor)
              </button>
            </nav>

            <button
              onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
              className="rounded-xl border border-slate-300 bg-slate-100 p-2 text-slate-700 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-500" />}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        {activeTab === 'deploy' ? (
          <ManifestDeploymentPanel
            scope={scope}
            setScope={setScope}
            clientId={clientId}
            setClientId={setClientId}
            projectName={projectName}
            setProjectName={setProjectName}
            projectPath={projectPath}
            setProjectPath={setProjectPath}
            clientVersion={clientVersion}
            setClientVersion={setClientVersion}
            onNavigateToAsset={handleNavigateToAsset}
          />
        ) : (
          <ManifestEditor
            scope={scope}
            projectName={projectName}
            projectPath={projectPath}
            selectedAssetId={selectedAssetId}
            setSelectedAssetId={setSelectedAssetId}
          />
        )}
      </main>
    </div>
  );
}
