import {AlertTriangle, Folder} from 'lucide-react';
import {Modal} from '../common/Modal';

interface DeploymentPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  deploymentPlan: {
    title: string;
    changes: {
      clientId: string;
      clientName?: string;
      category?: string;
      action: string;
      target: string;
      source: string;
      backupPath?: string;
      previousSource?: string;
    }[];
  } | null;
  dryRunError: string | null;
  dryRunLoading: boolean;
  deployingProject: boolean;
  handleDeployProjectSubmit: (onSuccess?: () => void) => Promise<void>;
  handleDeployGlobal: () => Promise<void>;
  deployingGlobal: boolean;
  kitScope: 'global' | 'project';
  targetProjectPath: string;
  setTargetProjectPath: (val: string) => void;
  showDirBrowser: boolean;
  setShowDirBrowser: (val: boolean) => void;
  loadingBrowse: boolean;
  browserDirData: {
    currentPath: string;
    parentPath: string | null;
    homePath: string;
    directories: { name: string; path: string; isProject: boolean; hasGit: boolean; hasPackageJson: boolean }[];
  } | null;
  fetchBrowseDirs: (dirPath?: string) => Promise<void>;
}

export function DeploymentPlanModal({
  isOpen,
  onClose,
  deploymentPlan,
  dryRunError,
  dryRunLoading,
  deployingProject,
  handleDeployProjectSubmit,
  handleDeployGlobal,
  deployingGlobal,
  kitScope,
  targetProjectPath,
  setTargetProjectPath,
  showDirBrowser,
  setShowDirBrowser,
  loadingBrowse,
  browserDirData,
  fetchBrowseDirs
}: DeploymentPlanModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={deploymentPlan?.title || '배포 예정 검토 (Dry-run)'}>
      <div className="space-y-4 text-xs">
        {dryRunError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl flex items-start space-x-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{dryRunError}</span>
          </div>
        )}

        {dryRunLoading && (
          <p className="text-center text-slate-400 py-6">배포 구성안 계산 중...</p>
        )}

        {deploymentPlan && (
          <>
            <p className="text-slate-400 font-medium">동기화 진행 시 생성/변경될 심볼릭 링크 목록:</p>
            <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
              {deploymentPlan.changes.length === 0 ? (
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-center text-slate-500 italic">
                  변경 예정이 없습니다. 모든 설정이 완벽하게 동기화되어 있는 상태입니다.
                </div>
              ) : (
                deploymentPlan.changes.map((change, idx) => (
                  <div key={idx} className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1.5 font-mono text-[10px]">
                    <div className="flex items-center justify-between text-[11px] font-sans">
                      <span className="font-bold text-indigo-400">
                        {change.clientName || change.clientId}
                      </span>
                      <span className={`px-2 py-0.5 rounded font-semibold ${
                        change.action === 'CREATE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        change.action === 'BACKUP' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      }`}>
                        {change.action === 'CREATE' ? '링크 생성' : change.action === 'BACKUP' ? '백업 후 링크' : '링크 교체'}
                      </span>
                    </div>

                    <div className="space-y-0.5 text-slate-400">
                      <div><span className="text-slate-500">Source:</span> {change.source}</div>
                      <div className="truncate"><span className="text-slate-500">Target:</span> {change.target}</div>
                      {change.backupPath && (
                        <div className="text-amber-500/90"><span className="text-slate-500">Backup:</span> {change.backupPath}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Target Path configuration if Project scope */}
            {kitScope === 'project' && (
              <div className="p-3.5 bg-indigo-950/20 border border-indigo-900/40 rounded-xl space-y-3 pt-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-indigo-300 font-semibold">동기화 이식 대상 프로젝트 경로:</label>
                  <input
                    type="text"
                    value={targetProjectPath}
                    onChange={(e) => setTargetProjectPath(e.target.value)}
                    placeholder="예: /Users/jw/__dev/my-target-app"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">이식할 대상 로컬 디렉터리 경로 선택:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextShow = !showDirBrowser;
                      setShowDirBrowser(nextShow);
                      if (nextShow) {
                        fetchBrowseDirs(targetProjectPath || undefined).catch(console.error);
                      }
                    }}
                    className="text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 font-normal"
                  >
                    {showDirBrowser ? '디렉터리 브라우저 닫기 ✕' : '📂 폴더 찾아보기...'}
                  </button>
                </div>

                {showDirBrowser && (
                  <div className="p-2 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 overflow-hidden flex flex-col max-h-40">
                    <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 bg-slate-900/80 px-2 py-1 rounded border border-slate-800 shrink-0">
                      <span className="truncate flex-1 pr-2 text-slate-200">📍 {browserDirData?.currentPath || '로딩 중...'}</span>
                      <div className="flex items-center space-x-1 shrink-0">
                        {browserDirData?.parentPath && (
                          <button
                            type="button"
                            onClick={() => { fetchBrowseDirs(browserDirData.parentPath!).catch(console.error); }}
                            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                          >
                            상위
                          </button>
                        )}
                        {browserDirData?.homePath && (
                          <button
                            type="button"
                            onClick={() => { fetchBrowseDirs(browserDirData.homePath!).catch(console.error); }}
                            className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                          >
                            홈
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-y-auto space-y-0.5 pr-1 custom-scrollbar flex-1">
                      {loadingBrowse ? (
                        <p className="text-[10px] text-slate-500 italic text-center p-2">로딩 중...</p>
                      ) : browserDirData?.directories.map((dir) => (
                        <div
                          key={dir.path}
                          onClick={() => setTargetProjectPath(dir.path)}
                          onDoubleClick={() => { fetchBrowseDirs(dir.path).catch(console.error); }}
                          className={`flex items-center justify-between p-1.5 rounded text-[10px] cursor-pointer transition-colors border ${
                            targetProjectPath === dir.path
                              ? 'bg-indigo-600/30 border-indigo-500/60 text-white font-medium'
                              : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5 truncate">
                            <Folder className={`w-3.5 h-3.5 shrink-0 ${dir.isProject ? 'text-amber-400' : 'text-blue-400'}`} />
                            <span className="truncate font-mono">{dir.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons to trigger actual deployment */}
            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800 shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                취소
              </button>
              {kitScope === 'project' ? (
                <button
                  onClick={() => { handleDeployProjectSubmit(() => onClose()).catch(console.error); }}
                  disabled={deployingProject || !targetProjectPath.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
                >
                  {deployingProject ? '배포 처리 중...' : '확인 및 프로젝트 배포 완료'}
                </button>
              ) : (
                <button
                  onClick={() => { handleDeployGlobal().then(() => onClose()).catch(console.error); }}
                  disabled={deployingGlobal}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/25 transition-all disabled:opacity-40"
                >
                  {deployingGlobal ? '배포 처리 중...' : '확인 및 전역 배포 완료'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
