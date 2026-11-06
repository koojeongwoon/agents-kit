# Native context transition v1 — internal coordinated apply

2026-11-06. Codex CLI 전역 Skill·선택 MCP의 기존 긍정 관측을 검토한 프로젝트 변경과
연결하고, 실제 적용 직후 같은 native 전제를 재관측하는 내부 계약이다. 전환 ID만으로 공개 Manifest v3
집행 권한을 만들지 않는다. [공개 실행](scoped-deployment-execution-v1.md)이 같은 검증을 사용하며 native consumer 활성·모델 응답·Tool 실행과 구분한다.

## 검토와 private 전환 증거

`createNativePrerequisiteService.prepareTransition`은 같은 instance의 유효한 observation ID와
정확한 target before/after fingerprint를 받는다. 현재 설치 pin·binary·정의·전체 native 문맥과
before target을 다시 확인하고 private bounded map에 고정한다. 전환 준비 자체는 무쓰기다.
반환 ID/JSON을 복사하거나 verified flag를 넣어 다른 instance의 증거를 만들 수 없다.

target은 인가된 프로젝트 내부여야 한다. Kit source/원장·중첩 target·Git 경계·상위 디렉터리
교체·기존 외부 링크는 거절한다. native 설정 파일은 정확히 그 파일의 변경만 허용한다.
global·상위 설정과 나머지 context 파일의 bytes/mode/identity는 그대로 유지해야 한다.
ego-browser 같은 외부 링크를 Kit 소유로 전환하지 않는다. 기존 snapshot symlink는 프로젝트
원장·v4 설치 영수증·immutable snapshot이 소유권을 증명한 경우에만 변경 target으로 허용한다.
before 단계에서 원장 revision과 snapshot을 다시 확인하며 일반 외부 링크를 허용하지 않는다.

`transitionVerifier`의 before 단계는 원래 관측과 모든 before image를 재검증한다. after는
검토한 모든 after image와 실제 새 native 관측이 있어야 통과한다. 두 단계는 같은 검토
digest를 반환하되, before 성공만으로 after를 만족시키지 않는다. 만료·시계 역행·다른
프로젝트/pin·불완전 적용·수동 편집·보조 정의/실행 파일 변화는 실패다. 새 ID를 만들어 기존
관측의 유효 기간을 연장할 수 없다.

`observeTransition`은 실제 파일이 모두 after image인지 확인한 뒤 기존 `observe`의
config/Skill/선택 provider 경로를 실행한다. 관측 전/중/후 문맥 검사는 그대로 적용한다.
관측 실패는 전환을 무효화하며 새 검토가 필요하다. 같은 완료 결과는 재사용하되 문맥을
다시 검사한다. target이 없거나 전부 no-op이면 기존 현재 proof를 재사용해 native 호출을
늘리지 않는다. 이 경우도 원래 identity를 변경한 파일을 같은 내용이라는 이유로 허용하지 않는다.

같은 native 이름의 다른 활성 Skill이 목록에 있으면 global pin의 가림 가능성을
`NATIVE_SKILL_NAME_SHADOWED`로 차단한다. 정확한 global 경로가 함께 나열됐다는 사실만으로
실효 선택을 추정하지 않는다. 다른 이름의 외부 Skill은 기존 관측 정책을 유지한다.

## 비동기 트랜잭션과 등록

`applyDeploymentAsync`·snapshot/tree async engine과 `executeDependencyCoordinationAsync`는
동기 API와 같은 generator workflow를 실행한다. native 읽기를 기다리는 동안 양쪽 lock
owner/identity와 private store session을 유지한다. 파일 쓰기 후 validation에서 전환 관측을
기다리고, project commit 전과 global index 완료 전에 after proof를 확인한다.

동기 API에 Promise validation을 넣으면 `ASYNC_DEPLOYMENT_REQUIRED`로 거절하고 복원한다.
일반 비동기 배포도 commit 직전 현재 원장을 다시 대조하며 lock inode/nonce를 확인한다.
수동 원장 편집은 보존하며 안전한 client 변경만 복원한다. lock이 교체되거나 client target이
수동 변경되면 새 소유자의 lock과 파일을 보존하고 journal을 남긴다. 두 scope의 기존 예약/
완료 journal·실패 marker·검토 복구 계약은 바꾸지 않는다. 복구 결과의 native 상태는 계속
unverified다. async 과거 경로 이관은 별도 전환 계약이 없어 차단한다.

## 최초 설치 제거의 원래 파일 복원

MCP 제거 시 모든 해당 파일 소유 항목이 사라지고, 파일 hash가 최초 설치 이력과 같으며,
그 이력의 previousManaged가 명시적 null이고, 백업이 원래 before hash와 맞는 경우만
원래 표현을 되살릴 수 있다. 생성된 구분용 빈 줄/JSON 들여쓰기 때문에 같은 사용자 설정이
다른 바이트로 남는 것을 방지한다. TOML은 끝 공백 외의 문자열이 같아야 하고 JSON은 전체
구조가 같아야 한다. 현재 권한은 유지한다. 사용자 편집·이전 소유자·다른 설정 값·백업 미확인은
이 최적화를 사용하지 않고 기존 소유 섹션 제거/차단 규칙을 따른다. 갱신 이력 전체를 임의로
역추적하여 예전 사용자 설정을 덮어쓰지 않는다.

## 증거와 남은 범위

[격리 실제 왕복](../reconstruction/codex-native-context-transition-roundtrip-20261106.json)은
검토된 Codex 0.166.0-alpha.6으로 v4 global Skill/MCP를 발견하고 프로젝트 Agent·별도 MCP
설정을 적용한 뒤 global 전제를 다시 발견했다. 등록 활성→해제, 프로젝트 설정 바이트/권한과
전역 설정 복원·외부 링크 identity 보존을 확인했다. 선택한 fixture MCP의 initialize/tools/list만
실행했으며 다른 provider 시작·thread/model 요청·Tool 실행은 0회다. 실제 사용자 HOME은 쓰지 않았다.
이는 Agent 자식 실행/완료 증거가 아니며 client 지원 행렬을 승격하지 않는다.

[프로젝트 rollback/참조 해제](scoped-deployment-rollback-v1.md)는 같은 private 전환을 사용한다.
모든 native/과거 경로 writer 영향 예측과 전역 설정 변경 후 각 등록 프로젝트의 실제 문맥 전환,
PR07/09/11·C07 Skill 호환성은 후속이다.
