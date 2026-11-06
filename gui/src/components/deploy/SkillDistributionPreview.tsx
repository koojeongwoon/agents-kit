import type {SkillDistributionReview} from '../../api/deploy';

export function SkillDistributionPreview({reviews}: {reviews?: SkillDistributionReview[]}) {
  if(!reviews?.length)return null;
  return <div aria-label="Skill 배포 대상과 노출" className="mt-4 space-y-3 rounded-xl border border-slate-300 p-3 text-xs dark:border-slate-700">
    {reviews.map(item=>{
      const additional=[...new Set(item.exposure.readers.filter(reader=>reader.clientId!==item.clientId||reader.surface!==item.surface).map(reader=>`${reader.clientId}${reader.surface?` / ${reader.surface}`:''}`))];
      return <div key={`${item.assetId}:${item.clientId}:${item.surface}`}>
        <p className="font-semibold">{item.assetId} · {item.selection.variantId||'선택 없음'} · {item.clientId} / {item.surface}</p>
        <p>{item.selection.compatibilityState==='author-reviewed'?'작성자 호환성 검토 있음':'호환성 확인 필요'} · {item.selection.clientVersion||'버전 미확인'}</p>
        {item.selection.native&&<p>클라이언트 원형: {item.selection.native.clientId} · 검증된 metadata 보존</p>}
        <p>실제 클라이언트 발견·사용은 별도 확인이 필요합니다.</p>
        <p className="break-all">설치 위치: {item.exposure.target}</p>
        {additional.length>0&&<p className="text-amber-700 dark:text-amber-300">같은 경로를 읽을 수 있는 추가 대상: {additional.join(', ')}</p>}
        <p>추가 탐색 설정에 따른 노출은 미확인입니다. 대상 선택만으로 클라이언트가 격리되지는 않습니다.</p>
        {item.selection.exposure==='exclusive-client'&&<p className="text-rose-600 dark:text-rose-300">전용 배포에 필요한 격리가 확인되지 않아 적용을 차단합니다.</p>}
      </div>;
    })}
  </div>;
}
