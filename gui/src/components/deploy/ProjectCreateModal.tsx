import {ArrowUp, Folder, FolderPlus, Home} from 'lucide-react';
import {Modal} from '../common/Modal';

interface ProjectCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  newProjectKitInput: string;
  setNewProjectKitInput: (val: string) => void;
  handleCreateProjectKitSubmit: () => Promise<void>;
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

export function ProjectCreateModal({
  isOpen,
  onClose,
  newProjectKitInput,
  setNewProjectKitInput,
  handleCreateProjectKitSubmit,
  showDirBrowser,
  setShowDirBrowser,
  loadingBrowse,
  browserDirData,
  fetchBrowseDirs
}: ProjectCreateModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="신규 프로젝트 킷 생성">
      <div className="space-y-4 text-xs">
        <div className="space-y-1.5">
          <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
            <FolderPlus className="w-4 h-4 text-indigo-400" />
            <span>프로젝트 식별 폴더 이름:</span>
          </label>
          <input
            type="text"
            value={newProjectKitInput}
            onChange={(e) => setNewProjectKitInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { handleCreateProjectKitSubmit().catch(console.error); } }}
            placeholder="예: backend-api, my-web-app"
            autoFocus
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
          />
          <p className="text-[10px] text-slate-500 leading-relaxed leading-normal">
            * 프로젝트 킷 이름은 알파벳, 숫자, 하이픈(_), 대시(-)만 사용 가능합니다.
          </p>
        </div>

        {/* Directory Picker Button */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">내 로컬 프로젝트 경로에서 이름 가져오기:</span>
          <button
            type="button"
            onClick={() => {
              const nextShow = !showDirBrowser;
              setShowDirBrowser(nextShow);
              if (nextShow) {
                fetchBrowseDirs().catch(console.error);
              }
            }}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 font-normal"
          >
            {showDirBrowser ? '디렉터리 브라우저 닫기 ✕' : '📂 폴더 찾아보기...'}
          </button>
        </div>

        {/* Directory Browser Tree Panel */}
        {showDirBrowser && (
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
              <span className="truncate flex-1 pr-2 text-slate-200">
                📍 {browserDirData?.currentPath || '로딩 중...'}
              </span>
              <div className="flex items-center space-x-1 shrink-0">
                {browserDirData?.parentPath && (
                  <button
                    type="button"
                    onClick={() => { fetchBrowseDirs(browserDirData.parentPath!).catch(console.error); }}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 transition-colors"
                    title="상위 디렉터리로 이동"
                  >
                    <ArrowUp className="w-3 h-3" />
                    <span>상위</span>
                  </button>
                )}
                {browserDirData?.homePath && (
                  <button
                    type="button"
                    onClick={() => { fetchBrowseDirs(browserDirData.homePath!).catch(console.error); }}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 transition-colors"
                    title="홈 디렉터리로 이동"
                  >
                    <Home className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {loadingBrowse ? (
                <p className="text-xs text-slate-500 italic p-3 text-center">디렉터리 목록을 읽는 중...</p>
              ) : browserDirData?.directories.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 text-center">하위 폴더가 없습니다.</p>
              ) : (
                browserDirData?.directories.map((dir) => (
                  <div
                    key={dir.path}
                    onClick={() => {
                      setNewProjectKitInput(dir.name);
                    }}
                    onDoubleClick={() => { fetchBrowseDirs(dir.path).catch(console.error); }}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors border ${
                      newProjectKitInput === dir.name
                        ? 'bg-indigo-600/30 border-indigo-500/60 text-white font-medium'
                        : 'bg-slate-900/50 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Folder className={`w-4 h-4 shrink-0 ${dir.isProject ? 'text-amber-400' : 'text-blue-400'}`} />
                      <span className="truncate font-mono">{dir.name}</span>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      {dir.hasGit && (
                        <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-mono">
                          Git
                        </span>
                      )}
                      {dir.hasPackageJson && (
                        <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded text-[10px] font-mono">
                          Node
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchBrowseDirs(dir.path).catch(console.error);
                        }}
                        className="px-2 py-0.5 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded text-[10px] transition-colors"
                      >
                        열기 &gt;
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-[10px] text-slate-500 font-mono italic">
              💡 폴더를 클릭하여 생성할 이름을 자동 적용하거나, [열기 &gt;] 버튼 또는 더블 클릭으로 하위 폴더로 진입할 수 있습니다.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => { handleCreateProjectKitSubmit().catch(console.error); }}
            disabled={!newProjectKitInput.trim()}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
          >
            생성 완료
          </button>
        </div>
      </div>
    </Modal>
  );
}
