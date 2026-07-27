import {useState} from 'react';
import {Save, Send, Sparkles, Link, CheckSquare, Square} from 'lucide-react';
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
  
  // Available resources for manual link insertion
  kits?: any;
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
  isAiGenerating,
  handleAiAssistGenerate,
  kits
}: AssetPreviewEditModalProps) {
  const [selectedResources, setSelectedResources] = useState<Record<string, boolean>>({});

  const handleToggleResource = (id: string) => {
    setSelectedResources(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleInjectLinks = () => {
    const list: string[] = [];
    const skills = kits?.skills || [];
    const loops = kits?.loops || [];

    skills.forEach((s: any) => {
      const uniqueId = `skill-${s.name}`;
      if (selectedResources[uniqueId]) {
        // Build markdown file link based on file naming convention
        list.push(`- **${s.name}**: [SKILL.md](file://${s.path || `./skills/${s.name}/SKILL.md`})`);
      }
    });

    loops.forEach((l: any) => {
      const uniqueId = `loop-${l.name}`;
      if (selectedResources[uniqueId]) {
        list.push(`- **${l.name}**: [LOOP.md](file://${l.path || `./loops/${l.name}/LOOP.md`})`);
      }
    });

    if (list.length > 0) {
      const suffix = '\n\n' + list.join('\n');
      setEditContent(editContent + suffix);
      setSelectedResources({}); // reset selection after injection
    }
  };

  const showManualInjector = previewModal?.isEditable && (previewModal.category === 'harness' || previewModal.category === 'agents');
  const availableSkills = kits?.skills || [];
  const availableLoops = kits?.loops || [];
  const hasResources = availableSkills.length > 0 || availableLoops.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={previewModal?.title || '자원 미리보기 및 편집'}>
      <div className="space-y-4 text-xs flex flex-col h-full max-h-[75vh]">
        {previewModal && (
          <>
            {previewModal.message && (
              <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium italic shrink-0">{previewModal.message}</p>
            )}

            {/* Scrollable Content Area */}
            <div className="space-y-4 overflow-y-auto pr-1 flex-1 custom-scrollbar min-h-0">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono block truncate">
                  파일 경로: {previewModal.readPath || previewModal.targetPath}
                </span>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  readOnly={!previewModal.isEditable}
                  rows={9}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-indigo-500/80 leading-relaxed resize-y"
                />
              </div>

              {/* Manual Resource Link Injector Section */}
              {showManualInjector && hasResources && (
                <div className="p-3.5 bg-slate-100/60 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/40 rounded-xl space-y-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                      <Link className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                      <span>🔗 로컬 자원(스킬/루프) 링크 수동 주입</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleInjectLinks}
                      disabled={!Object.values(selectedResources).some(Boolean)}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      본문에 링크 삽입하기
                    </button>
                  </div>

                  <div className="max-h-28 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {availableSkills.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Skills ({availableSkills.length})</div>
                        <div className="grid grid-cols-2 gap-2">
                          {availableSkills.map((s: any) => {
                            const uniqueId = `skill-${s.name}`;
                            const isChecked = selectedResources[uniqueId];
                            return (
                              <button
                                key={uniqueId}
                                type="button"
                                onClick={() => handleToggleResource(uniqueId)}
                                className={`flex items-center space-x-2 p-1.5 rounded-lg border text-left transition-colors ${isChecked ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-700 dark:text-indigo-200' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-350 dark:hover:border-slate-700'}`}
                              >
                                {isChecked ? <CheckSquare className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" /> : <Square className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600 shrink-0" />}
                                <span className="truncate font-medium">{s.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {availableLoops.length > 0 && (
                      <div className="space-y-1 pt-1.5 border-t border-slate-200 dark:border-slate-800/60">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Loops ({availableLoops.length})</div>
                        <div className="grid grid-cols-2 gap-2">
                          {availableLoops.map((l: any) => {
                            const uniqueId = `loop-${l.name}`;
                            const isChecked = selectedResources[uniqueId];
                            return (
                              <button
                                key={uniqueId}
                                type="button"
                                onClick={() => handleToggleResource(uniqueId)}
                                className={`flex items-center space-x-2 p-1.5 rounded-lg border text-left transition-colors ${isChecked ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-700 dark:text-indigo-200' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-350 dark:hover:border-slate-700'}`}
                              >
                                {isChecked ? <CheckSquare className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" /> : <Square className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600 shrink-0" />}
                                <span className="truncate font-medium">{l.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* AI Assist Section inside preview modal */}
              {previewModal.isEditable && previewModal.category !== 'mcp' && (
                <div className="p-3.5 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/30 rounded-xl space-y-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-purple-700 dark:text-purple-300">
                      <Sparkles className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0" />
                      <span>✨ AI 어시스턴트로 자원 지침 작성/고도화</span>
                    </div>

                    <div className="flex items-center shrink-0">
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
                    className="w-full bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-900/30 rounded-lg p-2.5 text-xs text-slate-800 dark:text-purple-100 placeholder-purple-400 dark:placeholder-purple-400/40 font-sans focus:outline-none focus:border-purple-500 leading-relaxed resize-none"
                  />
                </div>
              )}
            </div>

            {/* Notification / Alert messages within editor */}
            {saveSuccessMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center space-x-1.5 font-sans font-medium shrink-0">
                <span>✓</span>
                <span>{saveSuccessMsg}</span>
              </div>
            )}

            {/* Static Action Footer Area - ALWAYS Fixed at bottom */}
            <div className="flex items-center justify-between pt-3.5 border-t border-slate-200 dark:border-slate-800 shrink-0 mt-auto">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans italic">
                * 저장 시 마스터 자원 원본이 업데이트됩니다.
              </span>
              <div className="flex space-x-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-300 text-xs font-semibold transition-colors"
                >
                  닫기
                </button>
                {previewModal.isEditable && (
                  <>
                    <button
                      onClick={() => { handleSaveAssetContent().catch(console.error); }}
                      disabled={savingAsset}
                      className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors flex items-center space-x-1.5"
                    >
                      <Save className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
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
