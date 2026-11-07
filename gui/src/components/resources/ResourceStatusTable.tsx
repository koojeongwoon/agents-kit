import type {ClientSummary, LocalDiscoveryAsset} from '../../api/deploy';
import {resourceStatus} from '../../domain/resource-presentation';

export function ResourceStatusTable({clients,observations,kind,scope,surface,observationOnly=false}:{
  clients:ClientSummary[];observations:LocalDiscoveryAsset[];kind:string;scope:'global'|'project';surface?:string;observationOnly?:boolean;
}) {
  return <section aria-label="발견·지원·실제 동작 확인" className="resource-status">
    <h3>클라이언트별 상태</h3>
    <div className="resource-table-scroll"><table><thead><tr><th>클라이언트·실행 환경</th><th>발견</th><th>지원</th><th>실제 동작 확인</th></tr></thead><tbody>
      {clients.map(client=>{
        const selectedSurface=surface||client.defaultSurface;
        const state=resourceStatus({client,kind,scope,surface:selectedSurface,observations,observationOnly});
        return <tr key={client.id}><th scope="row">{client.displayName}<small>{selectedSurface||'기본 실행 환경'} · {scope==='global'?'클라이언트 전역':'프로젝트'}</small></th>
          {(['discovery','support','runtime'] as const).map(axis=><td key={axis}><span className="resource-state">{state[axis].label}</span><details><summary>근거</summary><p>{state[axis].detail}</p></details></td>)}</tr>;
      })}
    </tbody></table></div>
    <p className="resource-hint">발견은 파일·링크 기준입니다. 지원 정의·활성 목록·설치 소유 기록은 이 자원의 실제 동작 확인을 대신하지 않습니다.</p>
  </section>;
}
