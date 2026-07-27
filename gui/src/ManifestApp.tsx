import {useEffect, useState} from 'react';
import {Layers, Moon, Sun} from 'lucide-react';
import {ManifestDeploymentPanel} from './components/deploy/ManifestDeploymentPanel';

export default function ManifestApp() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (
    (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
  ));

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
          <button
            onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
            className="rounded-xl border border-slate-300 bg-slate-100 p-2 text-slate-700 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-500" />}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <ManifestDeploymentPanel />
      </main>
    </div>
  );
}
