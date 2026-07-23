import {Key} from 'lucide-react';
import {Modal} from '../common/Modal';

interface LlmKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLlmProvider: string;
  setSelectedLlmProvider: (val: string) => void;
  selectedLlmKeyInput: string;
  setSelectedLlmKeyInput: (val: string) => void;
  geminiKeyInput: string;
  setGeminiKeyInput: (val: string) => void;
  openaiKeyInput: string;
  setOpenaiKeyInput: (val: string) => void;
  anthropicKeyInput: string;
  setAnthropicKeyInput: (val: string) => void;
  llmKeyStatus: {
    provider?: string;
    hasGemini: boolean;
    hasOpenai: boolean;
    hasAnthropic: boolean;
    geminiMasked: string;
    openaiMasked: string;
    anthropicMasked: string;
  } | null;
  handleSaveLlmKeys: () => Promise<void>;
}

export function LlmKeyModal({
  isOpen,
  onClose,
  selectedLlmProvider,
  setSelectedLlmProvider,
  selectedLlmKeyInput,
  setSelectedLlmKeyInput,
  geminiKeyInput,
  setGeminiKeyInput,
  openaiKeyInput,
  setOpenaiKeyInput,
  anthropicKeyInput,
  setAnthropicKeyInput,
  llmKeyStatus,
  handleSaveLlmKeys
}: LlmKeyModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Multi-LLM API Keys 설정">
      <div className="space-y-4">
        {/* Active Provider Selector */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-400 font-medium">기본 활성 AI 프로바이더:</label>
          <select
            value={selectedLlmProvider}
            onChange={(e) => setSelectedLlmProvider(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-mono focus:outline-none"
          >
            <option value="gemini">Gemini (Google AI Studio)</option>
            <option value="openai">OpenAI (ChatGPT)</option>
            <option value="claude">Anthropic (Claude)</option>
          </select>
        </div>

        {/* API Key Input */}
        <div className="space-y-1.5 pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between text-xs">
            <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
              <span>{selectedLlmProvider === 'claude' ? 'Anthropic' : selectedLlmProvider.toUpperCase()} API Key</span>
            </label>
            {selectedLlmProvider === 'gemini' && llmKeyStatus?.hasGemini && (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                설정됨: {llmKeyStatus.geminiMasked}
              </span>
            )}
            {selectedLlmProvider === 'openai' && llmKeyStatus?.hasOpenai && (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                설정됨: {llmKeyStatus.openaiMasked}
              </span>
            )}
            {selectedLlmProvider === 'claude' && llmKeyStatus?.hasAnthropic && (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                설정됨: {llmKeyStatus.anthropicMasked}
              </span>
            )}
          </div>
          <input
            type="password"
            value={selectedLlmKeyInput}
            onChange={(e) => setSelectedLlmKeyInput(e.target.value)}
            placeholder={
              selectedLlmProvider === 'openai' ? 'sk-... 형태의 OpenAI API Key 입력' :
              selectedLlmProvider === 'gemini' ? 'AIza... 형태의 Gemini API Key 입력' :
              'sk-ant-... 형태의 Anthropic Claude API Key 입력'
            }
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
          />
        </div>

        {/* Advanced Accordion */}
        <details className="space-y-3 pt-1 text-xs text-slate-400">
          <summary className="cursor-pointer font-medium hover:text-purple-300 transition-colors">
            ⚙️ 프로바이더별 키 일괄 입력 / 개별 수정 (옵션)
          </summary>
          <div className="space-y-3 pt-2 pl-2 border-l border-slate-800">
            <div className="space-y-1">
              <label className="text-[11px] text-slate-300 font-medium">OpenAI Key (sk-...):</label>
              <input
                type="password"
                value={openaiKeyInput}
                onChange={(e) => setOpenaiKeyInput(e.target.value)}
                placeholder={llmKeyStatus?.hasOpenai ? `변경 시 입력 (현재: ${llmKeyStatus.openaiMasked})` : 'sk-...'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-slate-300 font-medium">Gemini Key (AIza...):</label>
              <input
                type="password"
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                placeholder={llmKeyStatus?.hasGemini ? `변경 시 입력 (현재: ${llmKeyStatus.geminiMasked})` : 'AIza...'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-slate-300 font-medium">Anthropic/Claude Key (sk-ant-...):</label>
              <input
                type="password"
                value={anthropicKeyInput}
                onChange={(e) => setAnthropicKeyInput(e.target.value)}
                placeholder={llmKeyStatus?.hasAnthropic ? `변경 시 입력 (현재: ${llmKeyStatus.anthropicMasked})` : 'sk-ant-...'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 font-mono"
              />
            </div>
          </div>
        </details>

        <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
          저장 위치: <code className="text-purple-300">~/.agents-kit/config/config.yaml</code><br />
          * 선택한 프로바이더({selectedLlmProvider})와 API Key가 로컬에 안전하게 저장됩니다.
        </p>

        {/* Action Button */}
        <button
          onClick={() => { handleSaveLlmKeys().catch(console.error); }}
          className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/35 transition-all flex items-center justify-center space-x-2 active:scale-95"
        >
          <Key className="w-4 h-4 text-purple-200" />
          <span>설정 저장하기</span>
        </button>
      </div>
    </Modal>
  );
}
