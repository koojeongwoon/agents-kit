# Global dependency mutation v1 — guarded execution, rollback and recovery

2026-11-06. PR10의 등록된 pin을 보존하는 선택적 전역 변경 계약이다.
Manifest v1/v2와 v3 전역 apply/remove/rollback·저장 재개·검토 복구를 공통 application
service에 연결한다. CLI/HTTP/GUI가 같은 서비스를 사용한다. 일반 state 8 writer 차단과
v3 프로젝트 실행은 [별도 계약](scoped-deployment-execution-v1.md)의 coordinator/native 관측을 따른다. 이 global guard 자체로 native 사용·모델 응답을 증명하지 않는다.

## 계획

`planGlobalDependencyMutation`은 준비된 공통/typed 변경 계획과 실제 전역 원장에 대해
[설치 결과 예측](deployment-installation-prediction-v1.md)을 실행한다. native 원형은 이
작업의 client target이 바뀌지 않는 경우에만 실제 baseline/소유 검사를 재사용한다.
변경할 native target의 전체 예측을 지원하는 것으로 확대하지 않는다.

- 준비된 계획의 state hash, source/deployment pending, 모든 등록 프로젝트의 실제 원장과
  consumer 소유권을 확인한다. 누락/손상/이동/불일치 프로젝트는 삭제하거나 무시하지 않는다.
- 모든 pin을 exact origin·client/surface/configStore·locator digest로 찾고, 예측 후에도
  revision/locator/binding과 소유권·전이 선언이 유지되는지 공통 impact evaluator로 검사한다.
  같은 asset의 다른 설치 경로/definition을 대신 사용하지 않는다.
- 바뀌는 pin은 `GLOBAL_REVISION_IN_USE`로 차단하고 해당 consumer를 먼저 해제하도록 한다.
  원본 본문 수정이 아직 설치에 반영되지 않은 경우는 설치 변경과 구별한다.
- client definition/보조 protocol 정의로 각 등록 프로젝트의 native 설정 문맥을 읽는다.
  설정·git marker와 pin된 Skill의 discovery root에 파일 변경이 생기면
  `DEPENDENCY_NATIVE_CONTEXT_TRANSITION_REQUIRED`로 차단한다. 관련 없는 MCP asset도 같은
  config 파일을 바꾸면 이 gate를 통과하지 못한다. 문맥이 같다는 것은 native 사용 검증을
  갱신했다는 뜻이 아니다.
- 계획은 본문 없이 target fingerprint·파일 권한·impact·프로젝트/문맥 digest를 반환한다.
  JSON의 `automatic`/blocked 수정은 권한이 아니다. 실행 시 현재 입력으로 다시 계산한다.

현재는 common/typed 파일과 검증된 snapshot 명령의 공통 apply engine을 사용한다.
일반 legacy link처럼 durable journal이 없는 전략은 이 경로에서도 차단한다.

## 공개 계획·저장 재개·rollback

기존 계획에 선택적인 `dependencyProtection` 요약을 추가한다. 상태는 ready/blocked,
등록된 프로젝트 수와 진단만 제공하며 private guard·journal·lock owner는 노출하지 않는다.
기존 `automatic`과 함께 판정하며 브라우저의 상태 수정은 실행 권한이 아니다.
무관한 변경만 ready이며 pin 변경·미확인 프로젝트·native 설정 전환은 blocked다.
과거 경로/연결/공유 소유권 이관은 별도 영향 예측이 없어 계속 차단한다.

보호된 저장 계획은 schema 4/contract `global-dependency-mutation-v1`을 사용한다.
기존 schema 1/2/3의 digest/reader를 유지한다. 새 레코드는 global scope와 apply/remove/
rollback만 허용하며 mutation digest를 필수로 보관한다. 재시작 후 원본·현재 파일·소유권·
정의/보조 native 정의와 모든 등록 프로젝트 문맥을 다시 계산해 검토 digest와 대조한다.
실제 권한은 그때 획득한 private store session에만 있다. 중단된 저장 실행은 검토 복구로
확정하며 완료 결과를 재조회해도 적용을 반복하지 않는다.

rollback도 백업의 파일/tree/권한과 정확한 이전 managed map을 가상 after state로
계산한다. 원래 apply를 rolled-back으로 바꾸어 드러나는 이전 설치 영수증까지 impact에
반영한다. 실행 후 전체 managed map·원래 transaction의 상태·rollback transaction 관계와
client after image를 대조한다. 최초 provider 설치를 복원하여 pin을 잃는 작업은 차단한다.
보호된 scalar apply 이력에 권한을 기록하므로 정상 rollback도 수동 권한 변경을 보존한다.

## 잠금과 commit

전역 store instance에만 private `global-mutation` session을 부여하고 기존 전역 lock을
유지한다. 다른 프로젝트 coordinator는 global-first 순서를 사용하므로 동시에 index를
변경할 수 없다. 프로젝트 원장에는 쓰지 않는다. 수동 외부 편집은 재검사에서 감지한다.

locked 재계획·파일 쓰기 직전·commit 직전에 index, 모든 등록 프로젝트의 전체 원장
fingerprint, native 문맥을 다시 비교한다. nextState도 같은 index와 모든 pin을 보존해야 한다.
한 번 준비한 nextState hash만 commit할 수 있고 client after image도 검토한 값과 일치해야 한다.
기존 runtime preflight/beforeCommit callback을 함께 실행하며 새 session으로 생략하지 않는다.

관련 없는 지침 변경과 snapshot 갱신은 이 경로에서 실행할 수 있다. 원형 native MCP가
pin인 경우 이름·baseline·원래 client 파일/권한을 그대로 보존한 상태에서 무관한 변경만 한다.
프로젝트 수동 편집이 감지되면 그 편집을 보존하고 안전하게 복원 가능한 전역 변경만 되돌린다.

## Journal과 검토 복구

기존 scalar v2/tree v3 journal에 `dependencyGuard` v1을 덧붙인다. index/project/context의
digest만 기록하고 설정 본문을 추가하지 않는다. 보호된 scalar 변경은 원래 modeAware 여부와
무관하게 검토한 before/after 권한을 기록하며 새 파일은 배타적 생성과 실제 inode를 기록한다.
기존 v1/v2 일반 배포의 생성 권한·journal 의미는 바꾸지 않는다.

`planGlobalDependencyRecovery`/`applyGlobalDependencyRecovery`는 journal의 guard와 원래
lock owner/identity, 실제 현재 pin·프로젝트·native 문맥을 확인한 private session만 사용한다.
공개 recovery service는 실제 global journal의 `dependencyGuard`가 있으면 이 경로로
dispatch한다. 두 scope schema 4 journal을 이 경로에서 처리하지 않는다.
현재 state가 before/after 어느 쪽인지와 client 파일·백업은 기존 recovery engine이 판정한다.
기록 확정 전 중단은 복원, 확정 후 중단은 완료 상태 유지다. journal/lock을 정리하기 직전에도
guard를 다시 검사한다. index와 프로젝트 원장을 새로 쓰거나 등록을 재구성하지 않는다.

살아 있는 실행 owner는 public flag로 우회할 수 없다. 실제 실행이 실패한 경우에만 원래
lease와 guard를 대조하여 journal에 `dependencyFailure`를 기록하고, 검토 복구가 동일 host
process에서도 처리할 수 있게 한다. 증거가 불확실하면 failed marker를 만들지 않는다.
복구 자체가 중단되면 죽은 recovery guard는 inode를 확인해 별도로 보존한 뒤 재개한다.
수동 바이트/권한 변경·새 파일의 동일 내용 다른 inode 교체·native 문맥 변경은 보존하며 복구를
차단한다. immutable snapshot과 백업의 자동 GC는 하지 않는다.

## 검증과 남은 범위

`test/global-dependency-mutation.test.js`는 무관한 전역 변경, pin 변경/위장, 미확인 프로젝트,
native 문맥 전환 gate, 원래 MCP 이름/baseline, 다른 설치 layout/definition 분리, stale state,
파일/tree의 commit 전/후 SIGKILL, 복구 재중단·동일 host의 실패 lease, 수동 편집/권한/inode
보존을 검사한다. fixture는 native 지원 증거가 아니며 실제 native/model/Tool 호출은 없다.

`test/global-dependency-dispatch.test.js`와 HTTP/GUI 시험은 공개 apply/remove·저장 재개·
정상 scalar/tree rollback·저장/복구 멱등성·전/후 SIGKILL과 강제 flag 거절을 검증한다.
실제 CLI도 임시 HOME·합성 client profile에서 저장→재개→rollback을 실행한다.

[프로젝트 rollback/참조 해제](scoped-deployment-rollback-v1.md)는 별도의 두 scope 전환을 사용한다.
native 원형·과거 경로 이관 예측,
전역 설정 변경 후 각 등록 프로젝트 문맥의 실제 전환/재관측과 필요한 실제 교차 scope
consumer 왕복은 남아 있다. C07의 Skill client 호환성도 별도 작업이다.
