# Scoped dependencies v1 — PR10 조회 구현과 집행 계약 초안

2026-11-06. C05·S05-2·S05-3의 versioned 참조와 교차 scope 집행 경계다.
qualified 참조 해석·설치 영수증·역참조·순서 있는 잠금과 journal/복구를 구현했다.
[공개 실행 계약](scoped-deployment-execution-v1.md)은 같은 기반 위에 CLI/HTTP/GUI의
v3 계획·명시적 관측·적용/제거·의존성 rollback/참조 해제·저장 v5 재개·두 scope 복구를 연결한다. 조회 성공이나
public flag만으로 적용할 수 없으며 미지원 client/전략/native 전환은 계속 차단한다.
기존 v1/v2의 단일 scope 계획과 상태를 유지하고 사용자 원장을 자동으로 승격하지 않는다.

기반 계약은 [설치된 revision/Tool 이름](installed-dependency-revisions-v1.md),
[역참조](dependency-reverse-index-v1.md), [coordinator](dependency-coordination-v1.md),
[native 전제 관측](native-prerequisite-observation-v1.md),
[읽기 전용 compiler](scoped-deployment-compilation-v1.md), [scoped 영수증 v4](scoped-installation-receipts-v4.md),
[설치 예측](deployment-installation-prediction-v1.md), [원본 보호](source-dependency-guards-v1.md),
[선택적 전역 변경](global-dependency-mutation-v1.md),
[프로젝트 rollback/참조 해제](scoped-deployment-rollback-v1.md)다. native 원형/과거 경로
이관·전역 설정 문맥 전환·진단은 남아 있다.

## 참조와 문맥 식별

새 qualified 참조는 Manifest v3에서만 허용한다. 기존 v1/v2를 읽고 쓸 때
자동 변환하지 않는다. bare ID는 선언한 Manifest 안에서만 해석하며 전역 fallback을
하지 않는다. 프로젝트에 같은 ID가 있더라도 명시적 전역 참조를 대체하지 않는다.
현재 v1/v2의 Tool providerId는 유효한 문자열 asset ID만 허용한다. optional Tool이어도
미지원 객체/빈 값/경로를 누락된 provider처럼 무시하지 않으며 workflow에서도 Tool
step에만 providerId를 허용한다. 이 입력 검증은 PR10 선행 교정으로 구현했다.

```yaml
# 조회 가능한 Manifest v3의 프로젝트 Agent 참조 부분
dependsOn:
  skills:
    - schemaVersion: 1
      kitId: shared-kit
      scope: {type: global}
      kind: skills
      assetId: review
requires:
  tools:
    - id: repository.search
      capability: repository.read
      providerId:
        schemaVersion: 1
        kitId: shared-kit
        scope: {type: global}
        kind: mcpServers
        assetId: repository-mcp
```

qualified 참조는 위 필드만 가진다. 버전·종류·ID·scope를 검사하고 문자열로 강제 변환하지
않는다. project scope는 projectName도 필요하다. 동일 Manifest 안의 기존 bare 참조는
그대로 유지하며, schema 1의 qualified 객체를 v1/v2의 문자열 자리에 넣으면 거절한다.
논리 Tool의 providerId도 bare ID 또는 qualified MCP 참조로 정확히 구별한다.

참조 자체에는 파일 경로나 출처 URL을 넣지 않는다. application이 권한을 확인하고
읽은 global+선택 project Manifest 문맥만 domain resolver에 전달한다. 각 문맥은
kitId·scope·projectName과 별도로 canonical Kit scopeRoot·실제 targetRoot에서 만든
origin key를 가진다. 같은 projectName을 사용하는 다른 checkout, 같은 kitId의 다른
물리 Kit를 합치지 않는다. 중복되거나 확정할 수 없는 문맥은 ambiguous로 차단한다.
사용자가 준 projectName만으로 다른 프로젝트를 찾아 의존성을 충족시키지 않는다.

허용 방향은 같은 Manifest 내부 및 선택 프로젝트→그 Kit catalog의 전역이다.
global→project, project A→project B, 선택하지 않은 Kit 참조는 거절한다. 도메인
노드/간선·cycle·provider binding·정책 판정은 qualified origin을 사용한다.
동명 ID가 있는 두 scope를 하나의 방문 집합이나 policy map으로 만들지 않는다.

## 조회와 실행 진입점

공통 catalog service의 `includeDependencies: true`가 `dependencyGraph`를 반환한다.
CLI는 `catalog --dependencies`, HTTP는 `GET /api/manifest/registry?view=catalog&dependencies=true`,
GUI는 같은 catalog를 사용한다. CLI의 `--assets a,b`는 조회할 로컬 root만 선택한다.
프로젝트 미선택 시 전역 Manifest가 source이며 선택 시 그 프로젝트가 source다.

graph에는 origin별 node/key·edge·Tool binding, localAssetKeys와 globalPrerequisites가
있다. `valid`는 선언 해석 결과다. `readOnly: true`, `deploymentReady: false`,
`installationState: unverified`는 계속 유지한다. 원문·Agent 지침·Tool 실행 정보와
자격 증명은 응답에 넣지 않는다. source 내용이나 파일 존재만으로 전역 설치를 확정하지 않는다.
접근 불가 문맥을 missing이나 빈 의존성으로 단정하지 않는다.

새 v3는 기존 management schema 1 메타데이터를 포함한다. 일반 loader·배포 selector·
직접 client plan은 `SCOPED_DEPLOYMENT_NOT_ENABLED`로 거절한다. 내부 catalog/별도 scoped
compiler와 [원본 관리](scoped-manifest-management-v1.md)가 `resolveSources: false, allowScopedPreview: true`로 읽으며 HTTP caller가 이
loader gate를 바꿀 수 없다. 공통 service `plan`은 표준 Kit/한 client의 v3 요청을 compiler에
보낸다. compiler의 `scoped-preview`는 자체 실행 권한이 아니다. 공개 서비스는 별도
`scoped-apply`/execution과 private 준비물을 사용하며 ready인 검토만 적용/저장한다.
GUI는 [원본 관리](scoped-manifest-management-v1.md)의 일반 v3 선언 편집과 전역 설치 전제의
관측/배포를 구별한다. validate/doctor·기존 registry/resource·의존성 조회와 선언 편집은
별도 source context를 사용한다. 미지원 native 원본 관리 수명주기는 차단하며 일반 loader와
직접 planner의 차단을 유지한다. single-scope registry 조회는 v3 집행 권한이 아니다.

## 선언 해석과 설치 전제의 분리

[설치 영수증](installation-receipts-v1.md)은 적용 당시의 선언·소유 영역 revision을
별도로 기록한다. catalog의 명시적 설치 대조는 그 영수증과 현재 파일/selector를 읽되
설치 당시 provider revision·alias도 대조하지만 native 발견과 실제 provider binding을
충족으로 표시하지 않는다. 이 감사 metadata와
기존 단일 scope journal 검증은 아래 교차 scope 집행 조건의 완료를 뜻하지 않는다.

순수 resolver는 missing/kind mismatch/scope/cycle/논리 Tool provider 모호성·정책
거절을 판정하고 local closure와 global prerequisites를 분리해 반환한다. global
closure의 전이 의존성과 provider binding도 포함한다. bare Tool provider 선택도
암묵적으로 다른 scope까지 넓히지 않으며, 전역 provider는 qualified 선택을 요구한다.
optional Tool도 잘못된 참조나 모호한 provider를 조용히 무시하는 통로가 될 수 없다.
Agent/Harness의 deny는 전이 의존성으로 전달한다. 여러 root가 같은 Skill을 공유하면
먼저 방문한 경로가 정책을 없애지 않도록 모든 dependency edge에서 deny를 합성한다.
Kit 별칭은 canonical scopeRoot를 사용해 같은 물리 origin으로 식별한다. 선택 checkout이
다르면 같은 projectName이라도 다른 origin이다. scope와 저장 문맥이 맞지 않으면 차단한다.

프로젝트 Agent의 dependsOn.skills는 설치 의존성이다. runtime Skill 강제 활성화나
MCP allowlist를 뜻하지 않는다. 기존 adapter의 unsupported/fail-closed gate와 모든
선택 client/surface의 capability 검사를 그대로 통과해야 한다.

application은 각 global prerequisite의 실제 설치를 다음과 같이 검증한다.

| 전제 | 확인할 소유 증거 |
|---|---|
| 자원 | global Kit·qualified asset·소유 consumer/selector·설치 revision |
| 대상 | 실제 home/target·client·surface·configStore·적용 locator |
| 내용 | 설치 자원 digest와 현재 파일/소유 selector의 일치, 링크이면 검증된 snapshot |
| Tool | 설치 시점의 provides/binding digest와 요구 논리 Tool·capability |
| 발견 가능성 | 현재 정확한 client profile의 scope/연결 전략 및 실효 문맥 증거 |
| 일관성 | global 원장 generation·관련 역참조 index generation·pending 복구 부재 |

global source만 존재, 미설치, 다른 client/surface 설치, 비활성·가림·미확인 발견 문맥,
소유권 없는 native 설정은 충족이 아니다. 빠진 전역 선행 계획을 안내하고 프로젝트
계획에서 전역 client 파일을 생성하거나 수정하지 않는다. 여러 scope client 파일의
원자적 혼합 배포는 범위 밖이다. 프로젝트 적용에 필요한 전역 메타데이터 등록은 아래
공유 transaction에 포함하며 client 파일 쓰기 권한과 구분한다.

global source의 편집과 실제 설치 revision 변경을 구분한다. source가 편집됐어도 기존
프로젝트가 의존하는 설치 revision이 그대로면 의존성을 무효화하지 않는다. 실제 배포·
제거·rollback이 그 revision/binding을 바꾸려 할 때 역영향을 판정한다. 같은 물리 설정의
다른 owner 변경을 해당 자원의 revision 변경과 혼동하지 않는다.

## 역참조와 변경 경계

기존 전역 배포 메타데이터 아래에 versioned 의존성 index를 두고 프로젝트 원장의
qualified prerequisites와 상호 대조한다. 프로젝트 항목에는 실제 Kit/target origin,
프로젝트 deployment/consumer, 요구 global revision과 binding, metadata generation을
기록한다. 임의 전체 디스크 탐색으로 프로젝트 등록을 대체하지 않는다.

global 갱신·제거·rollback·원래 설치 반영·경로 이관은 같은 역참조 검사를 사용한다.
Manifest 편집의 삭제·등록 해제도 사용 중인 stable 참조를 없애지 못하도록 같은
resolver/역참조 서비스를 사용한다. validate·doctor·계획·제거 API에서 다른 기준으로
결론을 내리지 않는다. source 내용 편집 자체는 위 설치 revision 경계에 따른다.

의존 중인 global revision 교체는 프로젝트 의존 자원의 명시적 제거→전역 변경→
프로젝트 재배포 순서로만 진행하며 중간 사용 공백과 영향 프로젝트를 계획에 표시한다.
자동 cascade, 먼저 참조만 바꾸기, 전역 변경 후 사후 검사로 우회하지 않는다.
경로 이동·삭제·접근 거절·index 손상·원장 불일치·pending journal은 등록 해제의 근거가
아니다. 별도 검토 복구가 끝날 때까지 관련 변경을 차단한다. 이 보호 범위는 등록된 Kit
프로젝트이며, 미등록 native 사용자를 모두 추적한다고 주장하지 않는다.

## 계획·저장·잠금·중단 복구

순수 계획은 파일과 잠금을 생성하지 않고 읽은 문맥의 fingerprint, 전역 설치 전제와
역참조 snapshot을 결과에 포함한다. 기존 saved plan과 호환되는 새 body 버전은 전제
digest를 포함해야 하며, 재개 시 원본 계획을 그대로 신뢰하지 않고 다시 계획·비교한다.
과거 body에 없던 전제를 추측해서 보충하지 않는다.

적용은 전역→프로젝트 순서로 잠그고 해당 global 전제를 프로젝트 적용이 끝날 때까지
유지한다. global 변경도 같은 전역 잠금 아래 역참조를 재검사해야 한다. 적용 직전
hash 검사만으로 race가 해결됐다고 주장하지 않는다. 사용자 파일·모드·외부 링크·다른
owner selector 보존, self-target 방지, backup 충돌 검사, atomic write는 그대로 필요하다.

프로젝트 client 변경·프로젝트 원장·전역 index는 하나의 검토 가능한 복구 단위다.
준비 예약/활성/해제 중 상태와 transaction ID를 journal로 연결한다. 전역 index에
미확정 예약이 있으면 global 변경을 차단하고, 프로젝트 commit 여부와 검증된 파일
영수증으로만 재개/복원을 결정한다. 프로젝트 commit 후 index 완료 전 SIGKILL도
다른 작업이 의존 관계를 누락한 채 진행할 수 없어야 한다. 복구가 사용자 변경을
발견하면 자동으로 파일이나 참조를 지우지 않는다. 잠금 획득 실패·프로세스 종료·
index 충돌·backup 실패에서도 기존 두 scope의 일관성과 복구 가능성을 검증한다.

## 구현 순서와 승격 기준

1. qualified reference 값·catalog origin·순수 resolver. v1/v2 회귀와 ambiguous/범위/
   cycle/provider/policy 시험. 새 Manifest 버전은 집행 준비 전 자동 적용 차단.
2. read-only graph/validate/doctor 및 전역 설치 전제 projection. CLI/HTTP/GUI는 같은
   application service와 origin을 사용하며 선행 계획·실제 영향 대상을 표시.
3. versioned 프로젝트 prerequisite·global index, 저장 계획 전제와 역참조 검사.
   관련 편집·등록 해제·배포·제거·rollback·경로 이관 진입점을 함께 연결.
4. 공통 잠금 순서와 index/project journal·검토 복구. 실제 하위 프로세스로 경합과
   각 commit 경계 SIGKILL을 재현한 뒤에만 qualified dependency 자동 적용 활성화.

최소 인수 시험은 전역 review Skill+프로젝트 Agent, 같은 ID의 local/global 분리,
전역 source만 있음/미설치/다른 surface·binding·revision, 계획 후 전역 변경,
프로젝트 적용 중 전역 변경/제거/rollback, 두 프로젝트의 경합, 저장 계획 재개,
index·폴더 이동·삭제·접근 불가·손상·중단 복구다. 기존 프로젝트 파일이 복원됐는데
역참조만 남거나, 파일이 활성인데 역참조가 누락되는 경우도 실패로 기록한다.
격리 fixture로 먼저 검증하며 실제 클라이언트 확인은 새로 필요한 조합에 한정한다.
