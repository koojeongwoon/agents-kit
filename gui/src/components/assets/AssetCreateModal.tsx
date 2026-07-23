import {Sparkles} from 'lucide-react';
import {Modal} from '../common/Modal';

interface AssetCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  assetSubTab: string;
  newAssetNameInput: string;
  setNewAssetNameInput: (val: string) => void;
  newAssetPromptInput: string;
  setNewAssetPromptInput: (val: string) => void;
  newAssetContentInput: string;
  setNewAssetContentInput: (val: string) => void;
  isAiGenerating: boolean;
  setIsAiGenerating: (val: boolean) => void;
  aiProvider: string;
  kitScope: 'global' | 'project';
  selectedProjectName: string;
  handleCreateAssetSubmit: () => Promise<void>;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

export function AssetCreateModal({
  isOpen,
  onClose,
  assetSubTab,
  newAssetNameInput,
  setNewAssetNameInput,
  newAssetPromptInput,
  setNewAssetPromptInput,
  newAssetContentInput,
  setNewAssetContentInput,
  isAiGenerating,
  setIsAiGenerating,
  aiProvider,
  kitScope,
  selectedProjectName,
  handleCreateAssetSubmit,
  apiFetch
}: AssetCreateModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`+ 신규 ${assetSubTab.toUpperCase()} 자원 파일 생성`}>
      <div className="space-y-4 text-xs">
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium">자원 파일명 (영문/숫자/하이픈):</label>
          <input
            type="text"
            value={newAssetNameInput}
            onChange={(e) => setNewAssetNameInput(e.target.value)}
            placeholder={
              assetSubTab === 'agents' ? '예: security-auditor.md' :
              assetSubTab === 'skills' ? '예: git-commit-helper' :
              assetSubTab === 'loops' ? '예: daily-docs-sweep' :
              assetSubTab === 'memory' ? '예: database_notes.md' :
              assetSubTab === 'harness' ? '예: custom-rules.md' :
              '예: my-custom-asset.md'
            }
            autoFocus
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        {assetSubTab !== 'mcp' && (
          <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 rounded-xl flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-semibold text-purple-300 truncate">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="truncate">AI 전문가 템플릿 초안 자동 생성</span>
              </div>

              <button
                type="button"
                onClick={async () => {
                  setIsAiGenerating(true);
                  try {
                    const res = await apiFetch('/api/ai-assist', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        prompt: newAssetPromptInput,
                        currentContent: newAssetContentInput,
                        assetType: assetSubTab,
                        provider: aiProvider
                      })
                    });
                    const data = await res.json();
                    if (data.success && data.generatedText) {
                      setNewAssetContentInput(data.generatedText);
                    } else if (data.error) {
                      alert(`AI 생성 실패: ${data.error}`);
                    }
                  } catch (err: any) {
                    alert(`오류: ${err.message}`);
                  } finally {
                    setIsAiGenerating(false);
                  }
                }}
                disabled={isAiGenerating}
                className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 disabled:opacity-50 transition-all shadow-lg active:scale-95 shrink-0"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isAiGenerating ? 'animate-spin' : ''}`} />
                <span>{isAiGenerating ? 'AI 초안 생성 중...' : 'AI 전문가 초안 작성'}</span>
              </button>
            </div>

            <textarea
              rows={2}
              value={newAssetPromptInput}
              onChange={(e) => setNewAssetPromptInput(e.target.value)}
              placeholder="어떤 자원을 생성하고 싶으신가요? 생성하고 싶은 자원의 목적이나 기능을 적어주세요 (예: GitHub PR 자동 검토 스킬, Slack 알림 에이전트 등)"
              className="w-full bg-slate-900/80 border border-purple-800/30 rounded-lg p-2.5 text-xs text-purple-100 placeholder-purple-400/50 font-sans focus:outline-none focus:border-purple-500 leading-relaxed resize-none"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-medium">초기 내용 (Markdown / JSON):</label>
          <textarea
            rows={6}
            value={newAssetContentInput}
            onChange={(e) => setNewAssetContentInput(e.target.value)}
            placeholder="비워두시면 표준 기본 템플릿이 자동으로 작성됩니다."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 leading-relaxed"
          />
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          저장 위치: <code className="text-blue-300 font-mono">
            {kitScope === 'global' ? '~/.agents-kit/kit/global/' : `~/.agents-kit/kit/projects/${selectedProjectName}/`}{assetSubTab}/
          </code>
        </p>

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => { handleCreateAssetSubmit().catch(console.error); }}
            disabled={!newAssetNameInput.trim()}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all disabled:opacity-40"
          >
            + 자원 생성
          </button>
        </div>
      </div>
    </Modal>
  );
}
