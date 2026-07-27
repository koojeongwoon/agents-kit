import {useState} from 'react';
import {Sparkles, Link, CheckSquare, Square} from 'lucide-react';
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
  kits?: any;
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
  apiFetch,
  kits
}: AssetCreateModalProps) {
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
      setNewAssetContentInput(newAssetContentInput + suffix);
      setSelectedResources({}); // reset selection after injection
    }
  };

  const showManualInjector = assetSubTab === 'harness' || assetSubTab === 'agents';
  const availableSkills = kits?.skills || [];
  const availableLoops = kits?.loops || [];
  const hasResources = availableSkills.length > 0 || availableLoops.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`+ 신규 ${assetSubTab.toUpperCase()} 자원 파일 생성`}>
      <div className="space-y-4 text-xs flex flex-col h-full max-h-[75vh]">
        
        {/* Scrollable Content Area */}
        <div className="space-y-4 overflow-y-auto pr-1 flex-1 custom-scrollbar min-h-0">
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs text-slate-700 dark:text-slate-300 font-medium">자원 파일명 (영문/숫자/하이픈):</label>
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
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-750 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          {assetSubTab !== 'mcp' && (
            <div className="p-3.5 bg-purple-50 dark:bg-purple-950/20 border border-purple-250 dark:border-purple-900/30 rounded-xl flex flex-col space-y-3 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-semibold text-purple-750 dark:text-purple-300 truncate">
                  <Sparkles className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0" />
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
                className="w-full bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-900/30 rounded-lg p-2.5 text-xs text-slate-800 dark:text-purple-100 placeholder-purple-400 dark:placeholder-purple-400/40 font-sans focus:outline-none focus:border-purple-500 leading-relaxed resize-none"
              />
            </div>
          )}

          {/* Manual Resource Link Injector Section (For Creation) */}
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

          <div className="space-y-1.5">
            <label className="text-xs text-slate-700 dark:text-slate-300 font-medium">초기 내용 (Markdown / JSON):</label>
            <textarea
              rows={5}
              value={newAssetContentInput}
              onChange={(e) => setNewAssetContentInput(e.target.value)}
              placeholder="비워두시면 표준 기본 템플릿이 자동으로 작성됩니다."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-450 dark:placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 leading-relaxed"
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed shrink-0">
          저장 위치: <code className="text-blue-600 dark:text-blue-300 font-mono">
            {kitScope === 'global' ? '~/.agents-kit/kit/global/' : `~/.agents-kit/kit/projects/${selectedProjectName}/`}{assetSubTab}/
          </code>
        </p>

        {/* Static Footer (Creation Actions) */}
        <div className="flex items-center justify-end space-x-3 pt-3.5 border-t border-slate-200 dark:border-slate-800 shrink-0 mt-auto">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-300 transition-colors"
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
