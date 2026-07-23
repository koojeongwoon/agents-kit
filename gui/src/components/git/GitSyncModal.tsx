import {Download, ExternalLink, GitBranch, Info, LogIn, RefreshCw, Settings} from 'lucide-react';
import {Modal} from '../common/Modal';
import type {GitStatus} from '../../App';

interface GitSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  gitStatus: GitStatus | null;
  remoteUrlInput: string;
  setRemoteUrlInput: (val: string) => void;
  commitMessage: string;
  setCommitMessage: (val: string) => void;
  gitSyncing: boolean;
  gitOutput: string | null;
  gitError: string | null;
  ghStatus: { isInstalled: boolean; isLoggedIn: boolean; username: string; version?: string; ghPath?: string } | null;
  loadingGh: boolean;
  installingGh: boolean;
  loggingInGh: boolean;
  ghLoginOutput: string;
  handleInstallGh: () => Promise<void>;
  handleGhLogin: () => Promise<void>;
  handleOpenGhAuthPage: () => Promise<void>;
  handleSaveRemoteUrl: () => Promise<void>;
  handleGitSync: (action: 'push' | 'pull') => Promise<void>;
}

export function GitSyncModal({
  isOpen,
  onClose,
  gitStatus,
  remoteUrlInput,
  setRemoteUrlInput,
  commitMessage,
  setCommitMessage,
  gitSyncing,
  gitOutput,
  gitError,
  ghStatus,
  loadingGh,
  installingGh,
  loggingInGh,
  ghLoginOutput,
  handleInstallGh,
  handleGhLogin,
  handleOpenGhAuthPage,
  handleSaveRemoteUrl,
  handleGitSync
}: GitSyncModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="마스터 자원 Git 원격 백업 & 동기화">
      <div className="space-y-5 text-slate-300 text-xs">
        {/* Row 1: GitHub CLI Integration */}
        <div className="bg-slate-900/50 p-4 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">GitHub CLI 연동 및 인증:</span>
            {loadingGh ? (
              <span className="text-[10px] text-slate-500">인증 확인 중...</span>
            ) : ghStatus?.isInstalled ? (
              ghStatus.isLoggedIn ? (
                <span className="text-[10px] text-emerald-400 font-mono">인증됨: @{ghStatus.username}</span>
              ) : (
                <span className="text-[10px] text-amber-500">로그인 필요</span>
              )
            ) : (
              <span className="text-[10px] text-rose-500">gh 미설치</span>
            )}
          </div>

          {!ghStatus?.isInstalled ? (
            <button
              onClick={() => { handleInstallGh().catch(console.error); }}
              disabled={installingGh}
              className="w-full py-2 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 rounded-lg text-xs font-semibold text-indigo-300 flex items-center justify-center space-x-1.5 disabled:opacity-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{installingGh ? 'Homebrew를 통해 gh 설치 중...' : 'macOS Homebrew로 GitHub CLI(gh) 자동 설치'}</span>
            </button>
          ) : (
            !ghStatus.isLoggedIn && (
              <div className="space-y-2">
                <button
                  onClick={() => { handleGhLogin().catch(console.error); }}
                  disabled={loggingInGh}
                  className="w-full py-2 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 rounded-lg text-xs font-semibold text-emerald-300 flex items-center justify-center space-x-1.5 disabled:opacity-50 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{loggingInGh ? '브라우저 기기 인증 대기 중...' : 'GitHub CLI (gh) 브라우저 자동 로그인'}</span>
                </button>
                {ghLoginOutput && (
                  <pre className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-[10px] font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap leading-normal">
                    {ghLoginOutput}
                    {ghLoginOutput.includes('https://github.com/login/device') && (
                      <button
                        onClick={() => { handleOpenGhAuthPage().catch(console.error); }}
                        className="mt-2 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center space-x-1 transition-colors border border-slate-700"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>기기 인증 브라우저 창 열기</span>
                      </button>
                    )}
                  </pre>
                )}
              </div>
            )
          )}
        </div>

        {/* Row 2: Git Config & Info */}
        <div className="bg-slate-900/50 p-4 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center space-x-2 text-slate-200">
            <Settings className="w-4 h-4 text-blue-400" />
            <span className="font-semibold">Git 레포지토리 정보:</span>
          </div>

          {gitStatus?.isRepo ? (
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              <div><span className="text-slate-500">Branch:</span> <span className="text-blue-400">{gitStatus.branch}</span></div>
              <div><span className="text-slate-500">User:</span> {gitStatus.userName || '—'}</div>
              <div className="col-span-2 truncate"><span className="text-slate-500">Remote:</span> <span className="text-slate-400">{gitStatus.remoteUrl || '(원격 없음)'}</span></div>
            </div>
          ) : (
            <p className="text-[11px] text-amber-500 italic">
              * 마스터 킷에 아직 Git 레포지토리가 이식되지 않았습니다. Remote URL 등록 시 자동으로 초기화됩니다.
            </p>
          )}

          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-medium">원격 저장소 주소 (GitHub Clone URL):</label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={remoteUrlInput}
                onChange={(e) => setRemoteUrlInput(e.target.value)}
                placeholder="예: https://github.com/my-username/my-master-agent-kit.git"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => { handleSaveRemoteUrl().catch(console.error); }}
                className="px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold active:scale-95 transition-all"
              >
                저장
              </button>
            </div>
          </div>
        </div>

        {/* Row 3: Push / Pull Actions */}
        {gitStatus?.isRepo && (
          <div className="bg-slate-900/50 p-4 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center space-x-2 text-slate-200">
              <GitBranch className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold">원격 동기화 동시 반영 (Push & Pull):</span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 font-medium">로컬 변경사항 백업 커밋 메시지 (Push 전용):</label>
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="예: agents-kit 자원 목록 업데이트"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => { handleGitSync('pull').catch(console.error); }}
                disabled={gitSyncing || !gitStatus.remoteConfigured}
                className="py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold flex items-center justify-center space-x-1.5 border border-slate-700 disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${gitSyncing ? 'animate-spin' : ''}`} />
                <span>원격 백업 가져오기 (Pull)</span>
              </button>

              <button
                onClick={() => { handleGitSync('push').catch(console.error); }}
                disabled={gitSyncing || !gitStatus.remoteConfigured}
                className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-600/20 disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${gitSyncing ? 'animate-spin' : ''}`} />
                <span>로컬 변경 저장 (Push)</span>
              </button>
            </div>

            {/* Changed files alert */}
            {gitStatus.changedFiles.length > 0 && (
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg flex items-start space-x-1.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  로컬에 커밋되지 않은 파일이 {gitStatus.changedFiles.length}개 있습니다. 저장(Push)을 누르면 자동으로 커밋 후 동기화됩니다.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Sync Status / Logs Terminal Output */}
        {(gitOutput || gitError) && (
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-medium">콘솔 동기화 처리 로그:</span>
            <pre className={`p-3 border rounded-xl text-[10px] font-mono leading-normal overflow-auto whitespace-pre-wrap max-h-36 ${
              gitError ? 'bg-rose-950/20 border-rose-900/40 text-rose-300' : 'bg-slate-950 border-slate-800 text-slate-300'
            }`}>
              {gitError || gitOutput}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  );
}
