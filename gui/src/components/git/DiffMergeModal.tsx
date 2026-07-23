import {GitCompare} from 'lucide-react';
import {Modal} from '../common/Modal';

interface DiffMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  diffModal: {
    title: string;
    targetPath: string;
    sourcePath: string;
    existingContent: string;
    masterContent: string;
    hasExisting: boolean;
  } | null;
  handleApplyDiffMerge: () => Promise<void>;
}

export function DiffMergeModal({
  isOpen,
  onClose,
  diffModal,
  handleApplyDiffMerge
}: DiffMergeModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={diffModal?.title || 'Diff 대조 및 병합'}>
      <div className="space-y-4 text-xs">
        {diffModal && (
          <>
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded-xl leading-relaxed">
              💡 <strong>마스터 설정 템플릿(Master Asset)</strong> 아래에 클라이언트의 <strong>기존 설정 내용(Existing Config)</strong>을 주석과 함께 병합하여 마스터 자원을 업데이트합니다.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold block">🌱 마스터 템플릿 내용 (Master Asset):</span>
                <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-mono leading-normal text-slate-300 overflow-auto max-h-40 whitespace-pre-wrap">
                  {diffModal.masterContent}
                </pre>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold block">⚠️ 클라이언트 기존 내용 (Existing Config):</span>
                <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-mono leading-normal text-slate-300 overflow-auto max-h-40 whitespace-pre-wrap">
                  {diffModal.existingContent}
                </pre>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800 shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => { handleApplyDiffMerge().catch(console.error); }}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/35 transition-all flex items-center space-x-1.5"
              >
                <GitCompare className="w-3.5 h-3.5 text-indigo-200" />
                <span>마스터 자원에 병합 반영</span>
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
