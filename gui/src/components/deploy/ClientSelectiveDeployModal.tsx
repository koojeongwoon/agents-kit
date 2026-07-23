import {Sliders} from 'lucide-react';
import {Modal} from '../common/Modal';

interface ClientSelectiveDeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalSelectedClientId: string;
  setModalSelectedClientId: (val: string) => void;
  clients: { id: string; name: string; isDetected: boolean }[];
  deployingSingleClient: boolean;
  handleDeploySingleClientSubmit: (clientId: string, onSuccess?: () => void) => Promise<void>;
}

export function ClientSelectiveDeployModal({
  isOpen,
  onClose,
  modalSelectedClientId,
  setModalSelectedClientId,
  clients,
  deployingSingleClient,
  handleDeploySingleClientSubmit
}: ClientSelectiveDeployModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="개별 AI 클라이언트 설정 이식 (Selective Apply)">
      <div className="space-y-4 text-xs">
        <div className="space-y-1.5">
          <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>설정을 이식할 대상 AI 클라이언트 선택:</span>
          </label>
          <select
            value={modalSelectedClientId}
            onChange={(e) => setModalSelectedClientId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-mono focus:outline-none"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.isDetected ? '🟢 감지됨' : '⚪ 미설치'})
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-500 leading-relaxed font-sans mt-1">
            * 선택한 특정 클라이언트에 대해서만 agents-kit 심링크 구성 및 권한 이식 처리가 일어납니다. 다른 클라이언트에는 영향을 주지 않습니다.
          </p>
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
            onClick={() => { handleDeploySingleClientSubmit(modalSelectedClientId, () => onClose()).catch(console.error); }}
            disabled={deployingSingleClient}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/35 transition-all"
          >
            {deployingSingleClient ? '배포 적용 중...' : '확인 및 이식 실행'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
