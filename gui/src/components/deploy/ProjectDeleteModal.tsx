import {Modal} from '../common/Modal';

interface ProjectDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProjectName: string;
  handleDeleteProjectKitSubmit: (projectName: string) => Promise<void>;
}

export function ProjectDeleteModal({
  isOpen,
  onClose,
  selectedProjectName,
  handleDeleteProjectKitSubmit
}: ProjectDeleteModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="프로젝트 킷 삭제 확인">
      <div className="space-y-4 text-xs">
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl leading-relaxed">
          ⚠️ 정말로 프로젝트 킷 <strong className="font-mono text-white text-sm bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/40">'{selectedProjectName}'</strong>과 관련 자원(SKILL.md, AGENTS.md 등) 파일 전체를 영구 삭제하시겠습니까?
          이 작업은 되돌릴 수 없으며 로컬 시스템 파일들이 물리적으로 완전히 소멸됩니다.
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => { handleDeleteProjectKitSubmit(selectedProjectName).catch(console.error); }}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/35 transition-all active:scale-95"
          >
            예, 영구 삭제합니다
          </button>
        </div>
      </div>
    </Modal>
  );
}
