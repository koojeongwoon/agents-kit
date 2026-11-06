import type {ManifestPlanOperation} from '../../api/deploy';

export function SnapshotConnectionPreview({operation}: {operation: ManifestPlanOperation}) {
  const snapshot = operation.connection?.snapshot;
  if (!snapshot) return null;
  return <div className="mt-3 space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/20">
    <p className="font-semibold">{operation.connection?.strategy === 'copy' ? '연결 해제·디렉터리 복사' : '고정 사본 연결'}{operation.previewOnly ? ' · 계획만' : ''}</p>
    {operation.previewOnly && <p className="text-amber-700 dark:text-amber-300">실제 연결은 검증 완료 전까지 차단됩니다.</p>}
    <p>{operation.connection?.strategy === 'copy' ? 'Kit 내용을 디렉터리로 배포' : operation.snapshotStatus === 'present' ? '보관 사본 재사용 예정' : '새 사본 생성 예정'} · {snapshot.files.length}개 파일 · {snapshot.files.reduce((sum, file) => sum + file.bytes, 0)}바이트</p>
    <p className="break-all font-mono">사본 ID: {snapshot.treeDigest}</p>
    <p className="text-slate-500">원본 편집은 새 배포 계획으로 반영합니다. 이전 사본은 복원을 위해 보존합니다.</p>
    <ul aria-label="고정 사본 파일 변경" className="max-h-40 space-y-1 overflow-auto font-mono">{operation.snapshotChanges?.map(file => <li key={file.path} className="break-all">
      {file.operation} · {file.path}{file.before && file.after && file.before.mode !== file.after.mode ? ` · 권한 ${file.before.mode.toString(8)} → ${file.after.mode.toString(8)}` : ''}
    </li>)}</ul>
  </div>;
}
