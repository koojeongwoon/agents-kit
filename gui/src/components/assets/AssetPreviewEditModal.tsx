import {Save, Send, Sparkles} from 'lucide-react';
import {Modal} from '../common/Modal';

interface PreviewModalData {
  title: string;
  targetPath: string;
  readPath?: string;
  content: string;
  message?: string;
  isEditable?: boolean;
  category?: string;
}

interface AssetPreviewEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  previewModal: PreviewModalData | null;
  editContent: string;
  setEditContent: (val: string) => void;
  savingAsset: boolean;
  saveSuccessMsg: string | null;
  handleSaveAssetContent: () => Promise<void>;
  handleSaveAndApplyAsset: () => Promise<void>;
  
  // AI Assist variables and handlers
  aiPrompt: string;
  setAiPrompt: (val: string) => void;
  aiProvider: string;
  setAiProvider: (val: string) => void;
  isAiGenerating: boolean;
  handleAiAssistGenerate: () => Promise<void>;
}

export function AssetPreviewEditModal({
  isOpen,
  onClose,
  previewModal,
  editContent,
  setEditContent,
  savingAsset,
  saveSuccessMsg,
  handleSaveAssetContent,
  handleSaveAndApplyAsset,
  aiPrompt,
  setAiPrompt,
  aiProvider,
  setAiProvider,
  isAiGenerating,
  handleAiAssistGenerate
}: AssetPreviewEditModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={previewModal?.title || '자원 미리보기 및 편집'}>
      <div className="space-y-4 text-xs">
        {previewModal && (
          <>
            {previewModal.message && (
              <p className="text-[10px] text-indigo-400 font-medium italic">{previewModal.message}</p>
            )}

            <div className="space-y-1">
              <span className="text-[10px] text-slate-500 font-mono block truncate">
                파일 경로: {previewModal.readPath || previewModal.targetPath}
              </span>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                readOnly={!previewModal.isEditable}
                rows={10}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500/80 leading-relaxed resize-y"
              />
            </div>

            {/* AI Assist Section inside preview modal */}
            {previewModal.isEditable && previewModal.category !== 'mcp' && (
              <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-purple-300">
                    <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>✨ AI 어시스턴트로 자원 지침 작성/고도화</span>
                  </div>

                  <div className="flex items-center space-x-2.5 shrink-0">
                    <select
                      value={aiProvider}
                      onChange={(e) => setAiProvider(e.target.value)}
                      className="bg-slate-900 border border-purple-700/50 rounded-lg px-2 py-0.5 text-[10px] text-purple-200 font-mono focus:outline-none"
                    >
                      <option value="gemini">Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="claude">Claude</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => { handleAiAssistGenerate().catch(console.error); }}
                      disabled={isAiGenerating || !aiPrompt.trim()}
                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-semibold flex items-center space-x-1 disabled:opacity-50 transition-colors"
                    >
                      <Sparkles className={`w-3 h-3 ${isAiGenerating ? 'animate-spin' : ''}`} />
                      <span>{isAiGenerating ? '생성 중...' : 'AI 초안 작성'}</span>
                    </button>
                  </div>
                </div>

                <textarea
                  rows={2}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="예: 이 프롬프트 지침을 더 정교한 TypeScript 코딩 규칙이 반영된 형태로 보완해줘."
                  className="w-full bg-slate-900/80 border border-purple-800/30 rounded-lg p-2 text-xs text-purple-100 placeholder-purple-400/50 font-sans focus:outline-none focus:border-purple-500 leading-relaxed resize-none"
                />
              </div>
            )}

            {/* Notification / Alert messages within editor */}
            {saveSuccessMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl flex items-center space-x-1.5 font-sans font-medium">
                <span>✓</span>
                <span>{saveSuccessMsg}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800 shrink-0">
              <span className="text-[10px] text-slate-500 font-sans italic">
                * 저장 시 마스터 자원 원본이 업데이트됩니다.
              </span>
              <div className="flex space-x-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-850 hover:bg-slate-850 text-slate-400 hover:text-slate-300 text-xs font-semibold transition-colors"
                >
                  닫기
                </button>
                {previewModal.isEditable && (
                  <>
                    <button
                      onClick={() => { handleSaveAssetContent().catch(console.error); }}
                      disabled={savingAsset}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center space-x-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingAsset ? '저장 중...' : '원본 저장'}</span>
                    </button>
                    <button
                      onClick={() => { handleSaveAndApplyAsset().catch(console.error); }}
                      disabled={savingAsset}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all flex items-center space-x-1.5"
                    >
                      <Send className="w-3.5 h-3.5 text-indigo-200" />
                      <span>저장 후 즉시 적용</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
