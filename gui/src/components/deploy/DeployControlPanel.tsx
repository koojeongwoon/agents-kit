import {FolderGit2, Globe, Plus, XCircle, Eye, Target, FolderPlus} from 'lucide-react';

interface DeployControlPanelProps {
  kitScope: 'global' | 'project';
  setKitScope: (scope: 'global' | 'project') => void;
  selectedProjectName: string;
  setSelectedProjectName: (name: string) => void;
  managedProjects: string[];
  fetchKits: (scope: 'global' | 'project', proj: string) => Promise<void>;
  setShowDeleteProjectModal: (show: boolean) => void;
  setShowCreateProjectModal: (show: boolean) => void;
  setShowClientModal: (show: boolean) => void;
  
  // Deploy handler props
  deployingGlobal: boolean;
  dryRunLoading: boolean;
  handleDeployGlobal: () => Promise<void>;
  handlePreviewGlobal: () => Promise<void>;
  handlePreviewProject: () => Promise<void>;
}

export function DeployControlPanel({
  kitScope,
  setKitScope,
  selectedProjectName,
  setSelectedProjectName,
  managedProjects,
  fetchKits,
  setShowDeleteProjectModal,
  setShowCreateProjectModal,
  setShowClientModal,
  deployingGlobal,
  dryRunLoading,
  handleDeployGlobal,
  handlePreviewGlobal,
  handlePreviewProject
}: DeployControlPanelProps) {
  return (
    <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 p-6 rounded-2xl space-y-5 shadow-sm dark:shadow-none">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center space-x-2 font-sans">
            <span>내 자원 묶음 (agents-kit Master Assets)</span>
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {kitScope === 'global'
              ? '전역 공통 스코프 (~/.agents-kit/kit/global): 모든 AI 클라이언트에 기본 적용되는 시스템 공통 자원'
              : `프로젝트 스코프 (~/.agents-kit/kit/projects/${selectedProjectName}): 프로젝트 전용 맞춤 자원`}
          </p>
        </div>

        {/* Scope Switcher Bar */}
        <div className="flex items-center space-x-2 p-1.5 bg-slate-100 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl shrink-0">
          <button
            onClick={() => { setKitScope('global'); fetchKits('global', '').catch(console.error); }}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all ${
              kitScope === 'global'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-blue-300" />
            <span>Global (~/ 전역 공통)</span>
          </button>

          <button
            onClick={() => { setKitScope('project'); fetchKits('project', selectedProjectName).catch(console.error); }}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all ${
              kitScope === 'project'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5 text-indigo-300" />
            <span>Project (프로젝트별)</span>
          </button>
        </div>
      </div>

      {kitScope === 'project' && (
        <div className="pt-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5 text-xs">
            <span className="text-slate-500 dark:text-slate-400 font-medium">관리 중인 프로젝트 킷:</span>
            <select
              value={selectedProjectName}
              onChange={(e) => {
                setSelectedProjectName(e.target.value);
                fetchKits('project', e.target.value).catch(console.error);
              }}
              className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-indigo-500/40 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-indigo-200 font-mono focus:outline-none focus:border-indigo-400 shadow-inner"
            >
              {managedProjects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            {selectedProjectName !== 'default' && (
              <button
                onClick={() => setShowDeleteProjectModal(true)}
                className="px-3 py-1.5 bg-rose-600/10 dark:bg-rose-600/20 hover:bg-rose-600/20 dark:hover:bg-rose-600/40 text-rose-700 dark:text-rose-300 border border-rose-500/25 dark:border-rose-500/35 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all"
                title="선택한 프로젝트 킷 전체 삭제"
              >
                <XCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                <span>프로젝트 킷 삭제</span>
              </button>
            )}

            <button
              onClick={() => setShowCreateProjectModal(true)}
              className="px-3 py-1.5 bg-indigo-600/10 dark:bg-indigo-600/25 hover:bg-indigo-600/20 dark:hover:bg-indigo-600/45 text-indigo-700 dark:text-indigo-200 border border-indigo-500/25 dark:border-indigo-500/35 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>+ 신규 프로젝트 킷 생성</span>
            </button>
          </div>
        </div>
      )}

      {/* Sub-Action Deploy Buttons Group */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
        {kitScope === 'global' ? (
          <>
            <button
              onClick={() => { handleDeployGlobal().catch(console.error); }}
              disabled={deployingGlobal}
              className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-xs shadow-lg shadow-blue-600/25 transition-all flex items-center space-x-2 disabled:opacity-50"
            >
              <Globe className="w-4 h-4" />
              <span>Apply to Global (~/)</span>
            </button>

            <button
              onClick={() => { handlePreviewGlobal().catch(console.error); }}
              disabled={dryRunLoading}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold rounded-xl text-xs border border-slate-300 dark:border-slate-700 transition-all flex items-center space-x-2"
            >
              <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>{dryRunLoading ? '배포 계획 계산 중…' : 'Dry-run 미리보기'}</span>
            </button>

            <button
              onClick={() => setShowClientModal(true)}
              className="px-4 py-2.5 bg-purple-600/10 dark:bg-purple-600/20 hover:bg-purple-600/20 dark:hover:bg-purple-600/40 text-purple-700 dark:text-purple-300 border border-purple-500/25 dark:border-purple-500/45 font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-sm dark:shadow-md dark:shadow-purple-600/25"
            >
              <Target className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>Apply to Specific Client (클라이언트 선택)</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { handlePreviewProject().catch(console.error); }}
              className="px-4 py-2.5 bg-indigo-600/10 dark:bg-indigo-600/20 hover:bg-indigo-600/20 dark:hover:bg-indigo-600/40 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25 dark:border-indigo-500/35 font-semibold rounded-xl text-xs transition-all flex items-center space-x-2 shadow-sm"
            >
              <FolderPlus className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Apply to Project (경로 선택)</span>
            </button>
            <button
              onClick={() => { handlePreviewProject().catch(console.error); }}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold rounded-xl text-xs border border-slate-300 dark:border-slate-700 transition-all flex items-center space-x-2"
            >
              <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Dry-run 미리보기</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
