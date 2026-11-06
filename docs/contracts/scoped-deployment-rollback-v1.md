# Scoped deployment rollback v1

2026-11-06. 등록된 프로젝트의 정상 rollback과 전역 참조만 해제하는 변경을
[공개 v3 실행](scoped-deployment-execution-v1.md)에 연결한다. 전역 provider 파일은
변경하지 않고 프로젝트 client 파일과 양쪽 의존성 metadata를 함께 처리한다.
일반 rollback과 중단 journal 복구는 별도 작업이며 둘 모두 기존 사용자 설정을 보존한다.

## 복원될 설치 상태로 계획한다

`planRollback`은 현재 소유권·파일/권한·백업을 기존 file/tree planner로 검증한다.
등록에 기록된 canonical Kit project origin과 target을 다시 대조하고, 백업의 after image와
이전 managed map으로 복원될 상태를 무쓰기로 예측한다. 원래 apply를 rolled-back으로
바꿨을 때 다시 유효해지는 설치 영수증을 같은 reader로 계산한다.

복원 관계는 그 영수증의 frozen v4 선언·dependency snapshot에서 가져온다. 오늘의
Manifest에서 전역 참조가 없어졌다는 이유로 과거 설치의 의존성을 지우지 않는다.
정확한 revision/locator/binding·client/surface/configStore의 현재 전역 영수증과 매칭하고,
소유 영역과 전이 closure가 미확인이면 계획을 차단한다. 남아 있는 소유 anchor의 실패를
자원이 삭제된 것으로 취급하지 않는다. 이전에 해제된 프로젝트도 제거 rollback으로
consumer를 복원하면 전역 index에 다시 등록한다.

복원 이후 남을 모든 consumer와 전제를 포함한다. 현재 consumer가 사라지면 명시적으로
해제하며, 이전 local 선언으로 돌아갈 경우에는 아래 선언 변경 증거를 검사한다.
일반 파일·typed 설정·검증된 snapshot 연결을 지원한다. 등록된 원래 Kit origin이 없는
과거 관계나 검증할 수 없는 native/과거 경로 전환은 추정하지 않고 차단한다.

## 파일을 유지하는 참조 해제

선택한 consumer의 새 v4 영수증이 실제 소유권·설치 revision·Tool binding을 증명하고,
전역 installable dependency가 없으면 파일을 유지하면서 관계를 해제할 수 있다.
전역 참조를 지운 source JSON만으로는 충분하지 않다. 새 영수증과 예측·실제 적용이
일치해야 한다. rollback의 이전 local v3/v4 영수증도 같은 설치 대조를 통과해야 한다.
같은 영수증의 metadata를 삭제하거나 owner만 해제한 경우는 실제 제거의 대안이 아니다.

공개 `dependencyTransition` schema 1에 action, 복원 transaction, 해제할 consumer의
asset/client/surface/configStore, 변경 후 consumer·전제 수를 표시한다. GUI도 승인 전에
이를 표시한다. 참조가 없는 마지막 consumer 해제는 불필요한 native 관측을 요구하지 않는다.

## private 실행과 native 전환

coordinator 계획의 선택적 `rollbackTransactionId`가 대상 apply를 고정한다. 기존 apply
계획·journal은 그대로 읽는다. 이전 실행기는 새 필드를 알 수 없으면 fail-closed한다.
private store session도 그 원래 ID와 rollback action을 확인하므로 일반 apply 세션이나
client JSON이 rollback 권한을 만들지 못한다. 실제 commit은 rollback transaction,
원래 apply의 rolledBackBy, 전체 managed map·파일 image와 예측을 대조한다.

남을 전제는 새 private before 관측이 필요하고, 검토된 파일 변경 뒤 after 관측을
기다린다. frozen logical Tool→provider 요구도 유지한다. 선택 MCP 목록 조회는 명시적으로
승인한 경우만 수행한다. 파일/tree rollback은 기존 동기 API와 같은 generator 단계를
공유하며 async 경로만 Promise를 기다린다. 동기 경로에 Promise를 넣으면 적용을 거절한다.
대기 중 global→project 잠금·claim·검토 만료·runtime/정의 검사를 유지한다.

현재 symlink는 원장·v4 설치 영수증·immutable snapshot으로 Kit 소유가 확인된 연결만
native 전환 target으로 허용한다. 원장 revision과 snapshot을 before 단계에서 재검사한다.
ego-browser 같은 외부 관리 링크는 허용하지 않는다. 전역 provider와 다른 client 설정은
변경하지 않는다. 동시 수동 편집 때문에 복원할 수 없으면 그 값을 보존하고 journal을 남긴다.

## 저장·복구·인터페이스

저장 schema 5 / `scoped-deployment-v1`에 rollback/planRollback 조합을 추가했다.
재시작 때 복원 예측·원장·백업·문맥을 재계산하고 native 증거를 새로 확보한다.
완료 결과는 멱등 조회하며 중단된 실행을 임의로 다시 실행하지 않는다.
일반 rollback 차단의 기존 `ROLLBACK_PLAN_BLOCKED` 코드는 유지한다.

두 scope recovery는 rollback commit 전이면 변경 전 배포를 유지하고, commit 뒤면
복원된 배포와 의존성 등록을 유지한다. 저장 receipt도 같은 완료/복구 결과로 확정한다.
복구 후 native 상태는 미확인이며 consumer 활성이나 모델 응답을 증명하지 않는다.

- CLI: `rollback --transaction … --observe-prerequisites [--discover-providers]`,
  기존 `--dry-run`, `--save-plan`, `resume --plan --digest`, `recover`를 사용한다.
- HTTP: 기존 rollback-plan/rollback, prerequisites/observe, save-plan/resume/recovery와
  mutation session을 유지한다. 비동기 결과와 오류를 기다려 응답한다.
- GUI: 같은 계획·관측 서비스를 사용하고 ready 상태에서만 저장/rollback 승인을 허용한다.
  의존성 변경이 있는데 execution verdict가 누락되면 승인을 차단한다.

## 증거와 한계

[실제 격리 Codex CLI 왕복](../reconstruction/scoped-rollback-codex-cli-roundtrip-20261106.json)은
제거→rollback 계획→저장 v5→다른 process의 재개/재관측→중복 재개→최초 설치 rollback과
설정 바이트/권한·외부 링크 복원을 확인한다. 검토된 정확한 실행 파일만 사용했다.
선택 fixture MCP의 목록만 조회했고 모델/thread 요청·Tool 실행·사용자 HOME 쓰기는 없다.
합성 snapshot·Tool binding·동시 편집·SIGKILL 시험은 실제 client 지원 승격 근거가 아니다.

native 원형/과거 경로 이관의 영향 예측, 전역 설정 변경 후 모든 등록 프로젝트의
native 문맥 전환, 미지원 native 원본 관리 수명주기, PR07/09/11·C07와 별도 consumer 활성 검증은 남아 있다.
일반 v3 선언의 검증/진단/편집은 [원본 관리](scoped-manifest-management-v1.md)에 연결했다.
