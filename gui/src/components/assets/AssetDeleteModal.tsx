import {AlertTriangle, Trash2} from 'lucide-react';
import {Modal} from '../common/Modal';

interface AssetDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  deletingAssetTarget: { path: string; name: string } | null;
  handleDeleteAssetSubmit: () => Promise<void>;
}

export function AssetDeleteModal({
  isOpen,
  onClose,
  deletingAssetTarget,
  handleDeleteAssetSubmit
}: AssetDeleteModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="자원 삭제 확인">
      <div className="space-y-4 text-xs">
        {deletingAssetTarget && (
          <div className="p-4 bg-rose-950/20 border border-rose-800/40 rounded-xl leading-relaxed text-rose-200 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              정말로 자원 파일 <strong className="text-white">'{deletingAssetTarget.name}'</strong>을(가) 삭제하시겠습니까?
              <br />
              이 작업은 복구할 수 없으며 로컬 시스템 파일이 즉시 영구 삭제됩니다.
            </div>
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => { handleDeleteAssetSubmit().catch(console.error); }}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-550 text-white text-xs font-semibold shadow-lg shadow-rose-600/35 transition-all active:scale-95 flex items-center space-x-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>삭제</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
