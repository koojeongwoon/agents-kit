import type {UpstreamSource} from '../../api/deploy';

export type UpstreamChoice = 'bound' | 'local' | 'git' | 'npm';
export type UpstreamDraft = {repository: string; commit: string; package: string; version: string; integrity: string; subpath: string};
export const emptyUpstreamDraft: UpstreamDraft = {repository: '', commit: '', package: '', version: '', integrity: '', subpath: ''};
export function upstreamInput(choice: UpstreamChoice, draft: UpstreamDraft): {upstream?: UpstreamSource | null} {
  if (choice === 'bound') return {};
  if (choice === 'local') return {upstream: null};
  return {upstream: {schemaVersion: 1, subpath: draft.subpath, ...(choice === 'git'
    ? {type: 'git', repository: draft.repository, commit: draft.commit}
    : {type: 'npm', package: draft.package, version: draft.version, integrity: draft.integrity})}};
}
export function UpstreamSourceFields({choice, draft, current, busy, onChoice, onDraft,localLabel='원래 로컬 설치본'}: {
  choice: UpstreamChoice; draft: UpstreamDraft; current?: UpstreamSource | null; busy: boolean;
  localLabel?:string;
  onChoice: (choice: UpstreamChoice) => void; onDraft: (draft: UpstreamDraft) => void;
}) {
  const fields: Array<[keyof UpstreamDraft, string, string]> = choice === 'git'
    ? [['repository', 'Git 저장소 HTTPS 주소', 'https://github.com/team/repository.git'], ['commit', 'Git 커밋 전체 해시', '40자리 또는 64자리 커밋 해시'], ['subpath', '출처 내부 경로', 'skills/review']]
    : choice === 'npm' ? [['package', 'npm 패키지 이름', '@team/review'], ['version', 'npm 정확한 버전', '1.0.0'],
      ['integrity', 'npm SHA-512 무결성', 'sha512-…'], ['subpath', '출처 내부 경로', 'skills/review']] : [];
  return <fieldset disabled={busy} className="space-y-3 rounded-xl border p-3">
    <legend className="px-1 text-xs font-bold">업데이트 출처</legend>
    <p className="break-all text-xs text-slate-500">현재 연결: {current ? current.type === 'git'
      ? `${current.repository} · ${current.commit} · ${current.subpath}`
      : `${current.package}@${current.version} · ${current.subpath}` : localLabel}</p>
    <label className="block text-xs">가져올 출처 <select aria-label="가져올 출처" value={choice} onChange={event => onChoice(event.target.value as UpstreamChoice)} className="ml-2 rounded border bg-transparent p-2">
      <option value="bound">현재 연결 사용</option><option value="local">{localLabel}으로 연결</option><option value="git">Git 커밋 연결</option><option value="npm">npm 패키지 연결</option>
    </select></label>
    {fields.map(([key, label, placeholder]) => <label key={key} className="block text-xs">{label}<input aria-label={label} value={draft[key]} placeholder={placeholder}
      onChange={event => onDraft({...draft, [key]: event.target.value})} className="mt-1 w-full rounded border bg-transparent p-2 font-mono text-xs" /></label>)}
    <p className="text-xs text-slate-500">버전·해시로 고정한 원본을 비교합니다. 출처 연결도 변경 계획을 Kit에 적용한 뒤 저장됩니다.</p>
  </fieldset>;
}
