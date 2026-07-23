import {useState} from 'react';
import {fetchLlmKeys, saveLlmKeys} from '../api/config';

export function useLlmConfig(
  setDeployMsg: (msg: string | null) => void,
  setAiProvider: (provider: string) => void
) {
  const [showLlmKeyModal, setShowLlmKeyModal] = useState<boolean>(false);
  const [selectedLlmProvider, setSelectedLlmProvider] = useState<string>('gemini');
  const [selectedLlmKeyInput, setSelectedLlmKeyInput] = useState<string>('');
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>('');
  const [openaiKeyInput, setOpenaiKeyInput] = useState<string>('');
  const [anthropicKeyInput, setAnthropicKeyInput] = useState<string>('');
  const [llmKeyStatus, setLlmKeyStatus] = useState<{
    provider?: string;
    hasGemini: boolean;
    hasOpenai: boolean;
    hasAnthropic: boolean;
    geminiMasked: string;
    openaiMasked: string;
    anthropicMasked: string;
  } | null>(null);

  const fetchLlmKeysStatus = async () => {
    try {
      const data = await fetchLlmKeys();
      setLlmKeyStatus(data);
      if (data.provider) {
        setSelectedLlmProvider(data.provider);
        setAiProvider(data.provider);
      }
    } catch (err) {
      console.error('Failed to fetch LLM keys status:', err);
    }
  };

  const handleSaveLlmKeys = async () => {
    try {
      const data = await saveLlmKeys({
        provider: selectedLlmProvider,
        apiKey: selectedLlmKeyInput,
        geminiApiKey: geminiKeyInput,
        openaiApiKey: openaiKeyInput,
        anthropicApiKey: anthropicKeyInput
      });
      if (data.success) {
        setSelectedLlmKeyInput('');
        setGeminiKeyInput('');
        setOpenaiKeyInput('');
        setAnthropicKeyInput('');
        setShowLlmKeyModal(false);
        await fetchLlmKeysStatus();
        setDeployMsg('선택한 LLM 프로바이더 및 API 키가 환경설정(~/.agents-kit/config/config.yaml)에 성공적으로 저장되었습니다!');
        setTimeout(() => setDeployMsg(null), 4000);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };

  return {
    showLlmKeyModal,
    setShowLlmKeyModal,
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
    fetchLlmKeysStatus,
    handleSaveLlmKeys
  };
}
