# Dependency reverse index v1

2026-11-06. PR10의 역참조 **모델·읽기 대조·영향 계산·기존 writer 차단** 계약이다.
후속 [내부 coordinator](dependency-coordination-v1.md)는 등록/해제·두 원장 transaction과
중단 복구를 연결했다. 공개 계획/집행과 모든 mutation 보호에는 아직 연결하지 않았다.
독립 metadata 등록 API나 자동 state 승격은 없다. [공개 v3 집행](scoped-deployment-execution-v1.md)은 실제 client 변경과 함께 등록/해제를 수행한다.

## 관계와 원장 버전

기존 global state의 `dependencyIndex`와 프로젝트 state의 `dependencyRegistration`은
deployment state **schema 8**에서만 읽는다. schema 1/2/4/5/6/7에 이 필드를 넣으면
거절한다. schema 8은 둘 중 하나를 정확히 가져야 한다. 과거 reader는 모르는 schema 8을
거절하므로 소유 관계를 모르는 구버전 writer가 정상 배포처럼 덮어쓰는 경로를 막는다.
기존 사용자 원장에는 이 필드를 추가하거나 버전을 바꾸지 않는다.

global index schema 1은 generation과 최대 256개 프로젝트 등록을 가진다. 등록에는 다음이 있다.

| 항목 | 내용 |
|---|---|
| project | Kit ID, projectName, canonical sourceRoot와 실제 targetRoot |
| id | project 물리 origin을 canonical hash한 stable registration ID |
| generation/indexGeneration | 프로젝트 등록 generation 및 기록 당시 index generation |
| transactionId/status | 프로젝트 committed apply와 연결한 ID, reserved/active/releasing; project-only released tombstone |
| consumers | 프로젝트 자원의 stable ID/kind·client/surface/configStore·receipt/locator digest |
| prerequisites | 전역 자원의 stable ID/kind·물리 Kit origin·같은 client profile·receipt/locator/binding digest |

각 prerequisite는 revision과 무관한 origin/asset/profile의 stable hash ID를 갖는다.
consumer는 필요한 prerequisite ID를 명시적으로 참조한다. revision은 참조 대상의
별도 값이다. 같은 프로젝트의 다른 소비자까지 변경 영향에 넣지 않으며, 여러 소비자가
공유하는 전제를 특정 소비자의 해제만으로 버릴 수 없도록 관계를 분리했다.
consumer/prerequisite가 다른 client·surface·configStore로 연결되거나 참조가 누락되면
거절한다. 중복·미사용 전제·빈 소비자·강제 변환한 generation/hash·추가 접속/credential
필드·경로 우회도 거절한다. 이름이 같은 다른 checkout과 다른 Kit 물리 origin은 합치지 않는다.

경로는 설치 관계의 ID로 사용하지 않는다. project/sourceRoot/targetRoot는 원장 대조를
허가할 운영 origin metadata이며, 자원 관계는 stable registration/prerequisite/asset ID다.
등록을 검증한다고 임의 디스크 탐색이나 현재 Kit 파일의 경로 참조를 해석하지 않는다.

## 읽기 전용 대조

`inspectDependencyDependents`는 전역 원장에 등록된 프로젝트만 읽는다. 양쪽 등록의
내용·generation·transaction과 프로젝트 consumer 영수증/현재 소유 영역을 대조한다.
전역 전제는 설치 schema 3/4 영수증의 정확한 revision/locator/binding digest 및 현재
소유·전이 설치 revision과 맞아야 한다. 이는 원장 관계의 일치이며 native 로딩·Tool
발견·모델 실행 증거가 아니다. fulfilled는 항상 false다.

프로젝트 state는 실제 targetRoot의 `.agent-kit/state.json`으로만 읽고, parent link·파일
link·hard link를 허용하지 않는다. 기존 bounded/nofollow reader로 1 MiB까지 snapshot을
읽어 동일한 deployment state validator에 전달한다. 초과·손상·권한 실패는 unverified다.
읽기 전후 원장 fingerprint와 lock/journal을 대조하며, 경합을 발견하면 긍정 관측을 버린다.
이 대조는 교차 scope 잠금을 대신하지 않는다.

- `status: not-enabled`: 아직 index가 없다. ‘전역 자원에 사용자가 없다’는 의미가 아니다.
- `status: observed`: 전역 snapshot이 안정적으로 읽혔다. 프로젝트별 verification은 별도다.
- 프로젝트 `verification: consistent`: 양쪽 등록과 consumer/전역 설치 proof가 일치한다.
- 누락/이동/손상·등록 불일치·소비자나 provider drift·pending transaction/lock/journal은
  프로젝트 항목을 그대로 보존하고 unverified로 표시한다. 등록 해제 근거로 쓰지 않는다.

global 원장 자체가 손상돼 등록을 읽을 수 없으면 status unverified이며 빈 projects를
관계가 없다는 증거로 쓰지 않는다. 과거 원장도 lock/recovery가 있으면 not-enabled로
단정하지 않는다. 조회는 폴더/원장/lock/index를 만들거나 고치지 않는다.

공통 catalog의 `includeDependents: true`, CLI `catalog --inspect-dependents`,
HTTP `GET /api/manifest/registry?view=catalog&dependents=true`, GUI의 명시적 조회가
같은 서비스를 사용한다. coverage는 `registered-projects-only`이며 미등록 native
사용자를 추적한다고 주장하지 않는다. GUI의 느린 응답도 기존 inventory 요청 번호와
선택 문맥을 대조하고 최신 installation/native 조회 결과를 덮어쓰지 않는다.

## 영향 계산과 현재 쓰기 경계

순수 `evaluateGlobalDependencyChanges`는 실제 설치의 다음 revision/locator/binding
digest 또는 명시적 제거(null)를 받아 등록된 전제와 대조한다. source-only/no-op와
다른 물리 origin은 설치 교체로 취급하지 않는다. 변경된 전제를 사용하는 consumer만
영향 목록에 포함한다. 관측이 정확한 index와 맞지 않거나 프로젝트가 미확인/pending이면
검토를 요구한다. 정상 사용 중인 revision 교체도 프로젝트 의존 자원 제거→전역 변경→
프로젝트 재배포 순서를 요구하며 자동 cascade는 하지 않는다.

이 함수의 allowed는 **조회용 영향 결과**이며 write authorization이 아니다. 실제
허용에는 별도 private session·locked 재계산과 commit 검사가 필요하다. 내부 coordinator의
예약/활성/해제·잠금/journal 검증과 공개 전역 mutation 허용은 구분한다.
현재 일반 DeploymentStateStore writer는 활성 등록이 있는 schema 8을
`DEPENDENCY_COORDINATOR_REQUIRED`로 거절한다. apply/rollback의 lock 진입 전에 막고,
commit에서 index/등록 삭제·generation 변경·버전 downgrade도 거절한다. lock을 얻는
사이 metadata가 바뀐 경우를 위해 획득 후 다시 검사한다. 기존 direct copy/merge와
tree transaction/recovery 경로에도 집행 전 차단을 둔다. 빈 global index는 보존하면서
기존 배포를 허용하지만 일반 writer로 등록을 생성/변경할 수 없다. HTTP는 이를 409로 반환한다.

독립 metadata 등록/해제 API는 제공하지 않는다. 공개 v3 적용/제거도 내부 coordinator의
private session을 통해 실제 client 증거와 함께 예약/활성/해제와 복구를 실행한다. 마지막 해제의 project tombstone은 일반
writer가 보존하면서 사용할 수 있다. 현재 차단을 완성된
교차 scope 변경 조정으로 승격하지 않는다. [Manifest 삭제/원본 관리 해제 보호](source-dependency-guards-v1.md)는
source/deployment 잠금과 현재 전역 identity를 coordinator에서 교차 검사한다.
[선택적 전역 변경·rollback·복구](global-dependency-mutation-v1.md)는 pin과 native 문맥을
보존하는 기존 v1/v2 명령만 공통 공개 서비스에서 처리한다. 보호된 저장 계획은 schema 4다.
일반 writer·native 원형/이관·전역 설정 문맥 전환은 차단한다. 사용자 원장을 자동 승격하지
않으며 [공개 v3 서비스](scoped-deployment-execution-v1.md)의 검토된 적용/제거와 함께만
관계를 등록/해제한다. 저장 계획은 v3 실행에 schema 5를 사용한다.

[프로젝트 rollback/참조 해제](scoped-deployment-rollback-v1.md)도 같은 index를 조정한다.
다음 단계는 native 원형·과거 경로 이관과
전역 설정 변경 후의 프로젝트 문맥 전환에 같은 보호/관측을 확장하는 것이다. 미지원 경로는
차단하며 수동 외부 편집을 자동으로 되돌리지 않는다.
