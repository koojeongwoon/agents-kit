import {useState} from 'react';
import {generateExpertAsset} from '../api/assets';

export function useAiAssist(
  assetSubTab: string,
  editContent: string,
  setEditContent: (val: string) => void,
  setSaveSuccessMsg: (msg: string | null) => void,
  previewModal: { category?: string } | null
) {
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiProvider, setAiProvider] = useState<string>('gemini');
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);

  const handleAiAssistGenerate = async () => {
    setIsAiGenerating(true);
    try {
      const data = await generateExpertAsset({
        prompt: aiPrompt,
        currentContent: editContent,
        assetType: previewModal?.category || assetSubTab || 'skills',
        provider: aiProvider
      });
      if (data.success && data.generatedText) {
        setEditContent(data.generatedText);
        setSaveSuccessMsg('AI 도움으로 마스터 자원 내용이 새로 생성/수정되었습니다.');
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      alert(`AI 생성 중 오류: ${err.message}`);
    } finally {
      setIsAiGenerating(false);
    }
  };

  return {
    aiPrompt,
    setAiPrompt,
    aiProvider,
    setAiProvider,
    isAiGenerating,
    setIsAiGenerating,
    handleAiAssistGenerate
  };
}
