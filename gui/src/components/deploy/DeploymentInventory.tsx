import type {ClientSummary,LocalClientDiscovery,RegistryResource} from '../../api/deploy';
import {externalObservationTargets,isObservationOnly,isObservedResource,resourceStatus} from '../../domain/resource-presentation';

export function DeploymentInventory({clients,resources,localDiscovery,scope,surface}:{clients:ClientSummary[];resources:RegistryResource[];localDiscovery:LocalClientDiscovery[];scope:'global'|'project';surface?:string}) {
  const observations=localDiscovery.flatMap(client=>client.surfaces?.length?client.surfaces.flatMap(item=>item.observations||item.assets):client.observations||client.assets);
  const externalTargets=externalObservationTargets(observations);
  const shared=[...new Map(observations.filter(item=>isObservationOnly(item,externalTargets)).map(item=>[item.path||`${item.sourcePath}:${item.id}`,item])).values()];
  const managed=resources.filter(resource=>(resource.origin?.scope||resource.scope?.type)===scope&&!isObservedResource(resource,[]));
  return <>
    <section className="resource-observation-boundary" aria-label="공용 스킬 관측 전용"><h3>.agents/skills · 관측 전용</h3><p>추가·수정·삭제·배포·복원 제외 · 기존 파일과 ego-browser 같은 외부 링크 보존</p><details><summary>공용·외부 위치에서 발견한 항목 {shared.length}개</summary>{shared.map(item=><p key={item.path||`${item.sourcePath}:${item.id}`} className="break-all font-mono">{item.id} · {item.path||item.sourcePath}{item.linkTarget?` → ${item.linkTarget}`:''}</p>)}</details></section>
    <section className="resource-status" aria-label="클라이언트별 배포 자원"><h3>배포 자원·상태</h3><div className="resource-table-scroll"><table><thead><tr><th>자원·클라이언트</th><th>발견</th><th>지원</th><th>실제 동작 확인</th></tr></thead><tbody>
      {managed.flatMap(resource=>clients.map(client=>{
        const matching=observations.filter(item=>item.candidateId&&item.candidateId===resource.importedFrom?.candidateId&&item.clientId===client.id);
        const state=resourceStatus({client,kind:resource.kind==='mcpServers'?'mcp':resource.kind,scope,surface:surface||client.defaultSurface,observations:matching});
        return <tr key={`${resource.catalogId||resource.id}:${client.id}`}><th scope="row">{resource.displayName||resource.id}<small>{client.displayName} · {surface||client.defaultSurface||'기본 실행 환경'}</small></th>{(['discovery','support','runtime'] as const).map(axis=><td key={axis}><span className="resource-state">{state[axis].label}</span></td>)}</tr>;
      }))}
    </tbody></table></div>{managed.length===0&&<p className="resource-hint">선택한 범위에 등록된 배포 자원이 없습니다. 실제 포함·제외·지원 여부는 변경 계획에서 확인합니다.</p>}</section>
  </>;
}
