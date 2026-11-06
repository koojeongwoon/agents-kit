# Source dependency guards v1

2026-11-06. PR10의 전역 Kit 원본 삭제·관리 해제와 새 프로젝트 의존성 등록 사이의
보호 계약이다. 공개 교차 scope 적용을 허용하거나 다른 클라이언트의 Skill 호환성을
증명하지 않는다. 기존 installed revision과 편집 중인 desired source를 구별한다.

## 제거할 원본의 식별

`removedGlobalSourceIdentities`는 검증한 before/after Manifest에서 전역 자원의
`(kitId, assetKind, assetId)`가 사라졌는지 계산한다. 이름 변경·전역에서 프로젝트로 이동·
Kit ID 변경도 원래 identity의 제거다. 본문 수정·새 사본 revision·같은 identity의 source
경로 변경을 설치 제거로 해석하지 않는다.

application은 실제 canonical `scopeRoot`와 전역 index의 `sourceRoot`를 함께 대조한다.
같은 이름/Kit ID라도 다른 원본 위치는 구별하고 같은 원본의 symlink 별칭은 동일하게
판정한다. active/reserved/releasing 항목의 pin이 제거할 원본을 가리키면
`GLOBAL_SOURCE_IN_USE`로 거절한다. 프로젝트가 없어졌거나 현재 설치 소유가 미확인이어도
pin을 삭제하거나 관리 해제의 근거로 삼지 않는다. 관련 없는 원본 제거는 허용한다.

일반 Manifest 편집과 기존 native 원본 관리 해제는 계획 시와 실제 적용 시 검사한다.
source-edit/refresh/source-rollback도 공통 apply 경로에서 identity 제거 여부를 확인한다.
계획 후 등록된 의존성도 적용 시 거절한다. 전역 Manifest가 구버전이어도 알려진 미설치 v3
프로젝트의 선언에 새 오류를 만드는 변경은 [원본 관리](scoped-manifest-management-v1.md)의
같은 순수 graph 대조로 차단한다. 이 검사는 native detach와 body-only 원본 변경에도 적용하며
설치 pin과 원래 client 파일을 갱신하지 않는다.
CLI/HTTP/GUI는 같은 application service를 사용한다. HTTP는 새 충돌 코드를 409로 반환하고
응답에 내부 참조 목록·원문을 추가하지 않는다.

## 두 잠금의 교차 확인

원본 변경은 기존 Kit source lock을 잡은 상태에서 전역 배포 lock/journal·중단된
coordination/migration이 없는지와 현재 index를 다시 검사한다. 전역 문맥이 pending이면
`GLOBAL_DEPENDENCY_CONTEXT_PENDING`으로 거절한다. 잠금은 기다리지 않으며 기존 링크나
다른 소유자의 잠금 파일을 제거하지 않는다.

프로젝트 coordinator는 전역 배포 lock을 잡은 상태에서 각 필수 pin의 sourceRoot가
canonical인지, 원래 Kit ID·kind·asset ID의 전역 선언이 현재 존재하는지와 Kit source
lock/journal이 없는지를 확인한다. 원본이 사라졌거나 다른 위치로 바뀌면
`DEPENDENCY_SOURCE_UNAVAILABLE`, 편집/중단 중이면 기존 source-management 코드로 거절한다.
검사는 locked 재계획·project commit 직전·commit 후/index 확정과 완료 복구에서 반복한다.

원본 변경이 먼저 Kit lock을 잡으면 coordinator가 진행할 수 없고, coordinator가 먼저
전역 lock을 잡으면 원본 제거가 진행할 수 없다. 원본 작업은 manifest를 바꾸기 직전에도
검사하므로 무잠금 계획의 TOCTOU 검사를 실제 배타성으로 오인하지 않는다. 새 전역 원장
쓰기나 별도 lease/journal schema를 도입하지 않고 기존 Kit/coordination 복구를 유지한다.
수동 외부 편집은 이후 검사에서 감지하며 그 편집을 자동으로 되돌리지 않는다.

## 기존 설치 writer와 조회

등록된 state 8의 일반 설치 writer는 기존 store lock/commit 경계에서 계속 차단된다.
회귀 시험은 apply/rollback 외에 removal·saved execution·과거 경로 이관·snapshot 연결과
native apply/ownership detach도 client bytes·권한·링크를 바꾸기 전에 거절함을 확인한다.
무관한 전역 client 변경도 일반 writer로 실행할 수 없다.
후속 [선택적 전역 변경 계약](global-dependency-mutation-v1.md)은 pin과 native 문맥이
유지되는 기존 v1/v2 공통 변경·rollback·저장 재개/검토 복구만 private session으로 연결한다.
과거 경로 이관·native 원형 writer는 계속 차단한다. 공개 v3 집행/저장은 [실행 계약](scoped-deployment-execution-v1.md)의 private coordinator/검증을 따른다.

역참조 조회는 설치 영수증 v3와 v4 모두의 실제 revision·locator·binding·소유권을 대조한다.
v4를 이유만으로 미확인으로 낮추지 않으며 native 발견/사용이나 consumer 활성 성공으로
승격하지 않는다. 등록 프로젝트만 조회한다는 coverage는 기존 계약과 같다.

## 증거와 남은 작업

`test/dependency-reverse-index.test.js`, `test/dependency-coordination.test.js`,
`test/resource-import.test.js`, `test/native-installation.test.js`와 HTTP control-plane 시험에
원본 삭제/등록 경합·두 잠금 순서·수동 편집 보존·적용 복원/예약 metadata 복구·동명 다른 origin·
alias·dangling lock·native 원형·saved/path/snapshot writer 회귀를 기록한다.

[프로젝트 rollback·참조 해제](scoped-deployment-rollback-v1.md)는 설치 당시 원본 identity와 pin을 유지한다.
전역 설정의
native 문맥 전환/재관측, native 원형/이관 예측 및
필요한 실제 교차 scope consumer 적용/복원은 후속이다. 기존 설정과 ego-browser 외부 링크를
유지하며 이번 변경으로 사용자 원장을 승격하지 않는다.
