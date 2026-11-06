import type {ClientSummary, LocalDiscoveryAsset, RegistryResource} from '../api/deploy';
import {isSharedSkillPath} from '../../shared/observed-skill-policy.js';
export {isSharedSkillPath};

export function isObservationOnly(asset:LocalDiscoveryAsset,externalTargets:ReadonlySet<string>=new Set()):boolean {
  return asset.managementMode==='external'||[asset.path,asset.sourcePath,asset.resolvedTarget,asset.linkTarget].some(isSharedSkillPath)
    ||Boolean(asset.entryType==='symlink'&&asset.resolvedTarget&&externalTargets.has(asset.resolvedTarget));
}
export function externalObservationTargets(observations:LocalDiscoveryAsset[]):ReadonlySet<string> {
  return new Set(observations.filter(item=>isObservationOnly(item)).flatMap(item=>item.resolvedTarget?[item.resolvedTarget]:[]));
}
export function isObservedResource(resource:RegistryResource|undefined,observations:LocalDiscoveryAsset[],externalTargets?:ReadonlySet<string>):boolean {
  return (!resource&&observations.some(item=>isObservationOnly(item,externalTargets)))||Boolean(resource?.kind==='skills'&&isSharedSkillPath(resource.source?.path));
}
export function resourceStatus({client,kind,scope,surface,observations,observationOnly=false}:{client:ClientSummary;kind:string;scope:'global'|'project';surface?:string;observations:LocalDiscoveryAsset[];observationOnly?:boolean}) {
  const matching=observations.filter(item=>item.clientId===client.id&&(item.scope||scope)===scope&&(!item.surface||!surface||item.surface===surface));
  const readOnly=observationOnly||matching.some(item=>isObservationOnly(item));
  const selectedSurface=client.surfaces?.find(item=>item.id===surface);
  const capabilities=selectedSurface?.capabilities||(!client.surfaces?.length||surface===client.defaultSurface?client.capabilities:[]);
  const capability=capabilities.find(item=>item.assetKind===kind&&item.scope===scope);
  const surfaceKnown=!client.surfaces?.length||client.surfaces.some(item=>item.id===surface);
  return {
    discovery:{label:matching.length?(matching.some(item=>item.entryType==='symlink')?'링크 발견':'파일 발견'):'관측 기록 없음',detail:matching.map(item=>item.path||item.sourcePath).join(' · ')||'이 자원과 연결된 발견 기록 없음'},
    support:{label:readOnly?'관측 전용 · 미확인':!surfaceKnown||!capability?'미확인':capability.status==='stable'?'파일 계약 · 계획 확인 필요':['unsupported','ui-only'].includes(capability.status)?'자동 배포 미지원':'지원 확인 필요',
      detail:readOnly?'공용 위치의 존재로 호환성을 추정하지 않습니다.':'실제 적용 가능 여부는 선택한 실행 환경·버전·자원 옵션의 배포 계획에서 판정합니다.'},
    runtime:{label:'미확인',detail:'이 자원·클라이언트·범위·프로젝트·현재 사본에 대응하는 실제 실행 근거가 조회되지 않았습니다.'}
  };
}
