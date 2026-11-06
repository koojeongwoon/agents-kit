# Scoped deployment execution v1 — public plan, observation, apply and recovery

2026-11-06. 기존 capability·소유권·설치 revision·원본 보호와 두 scope transaction을 연결해
Manifest v3의 공개 배포를 제공한다. 전역 자원은 전역 위치에 두며 프로젝트에 복제하지 않는다.
지원하지 않는 client/전략/native 원형·과거 경로 변경은 기존 gate로 차단한다. 아래 성공은
Configuration and Distribution Plane의 결과이며 consumer 활성·모델 응답의 증거가 아니다.

## 공통 서비스와 계획

`createManifestDeploymentService.plan`은 기존 v3 compiler를 사용하고 같은 private 준비물을
집행까지 유지한다. 전역 v3는 기존 공통 파일 engine과 선택적 global mutation 보호를 사용한다.
프로젝트는 global 전제가 있으면 두 scope coordinator, 없으면 기존 단일 scope engine을 사용한다.
관계·변경 target·파일/tree 예측은 다시 계산해 비교한다. old loader와 직접 저수준 planner의
v3 gate를 client JSON으로 바꾸지 않는다. 선택된 client/surface는 한 번에 하나다.

공개 계획은 `kind: scoped-apply`와 `execution` schema 1을 반환한다. 제거 계획은 기존 `kind:
remove`에 같은 execution을 추가한다. 상태는 blocked/requires-observation/ready다. `automatic`
flag를 고쳐도 private 준비물이나 native proof를 만들 수 없다. 계획은 여전히 무쓰기다.
현재 source·설치 pin·target·원장·정의/binary가 바뀌면 새 검토가 필요하다.

선택하지 않은 기존 등록 consumer도 유지한다. 같은 프로젝트의 설정 변경이 그 consumer의
전역 전제에도 영향을 줄 수 있으므로 등록된 모든 pin을 합치고 기존 v4 영수증의 frozen
logical Tool→global provider binding도 재검사한다. native 이름을 추정하거나 unselected
consumer 파일을 다시 배포하지 않는다. 선언에서 전역 참조를 뺐다는 이유로 활성 등록을
지우지 않으며, 지원되지 않는 관계 교체는 `DEPENDENCY_CONSUMER_RELEASE_REQUIRED`로 차단한다.

## 명시적 native 관측과 적용

`observeDeploymentPrerequisites({planId, observeProviders})`는 private 계획에 고정된 프로젝트·
설치 전제만 관측한다. boolean 외의 provider 선택을 거절한다. 기본은 provider를 시작하지
않는 metadata 읽기다. 사용자가 명시적으로 선택한 경우만 해당 MCP의 Tool 목록을 조회한다.
네트워크/credential/Tool 실행의 일반 권한으로 해석하지 않는다. 관측 중 중복 적용/저장도 막는다.

긍정 결과가 있으면 [native 문맥 전환](native-context-transition-v1.md)의 before/after 검증기를
생성한다. 적용은 global→project 잠금을 유지하고 파일 변경 후 실제 after 관측을 기다린다.
등록/완료 전에 전체 전제와 예측·정의·원본·소유권을 확인한다. source/runtime 검사와 기존
preflight/beforeCommit도 유지한다. 결과는 `fulfilled: false`이며 native 발견과 실제 사용을 구분한다.

## 제거와 rollback 경계

v3 제거는 현재 소유 기록에서 공통/typed 제거 계획을 만든다. 선택 consumer의 실제 파일/
block/server 제거를 증명하고 등록을 해제한다. 남은 consumer의 native 전제는 새로 확인한다.
마지막 consumer 제거는 새 provider를 켜는 작업이 아니므로 불필요한 native 관측을 요구하지 않는다.
가능한 최초 설치 제거는 원래 사용자 설정의 정확한 바이트와 현재 권한을 보존한다.
shared file이 계속 남는 metadata 해제를 실제 consumer 제거로 대신하지 않는다.

등록된 프로젝트의 [의존성 rollback·참조 해제](scoped-deployment-rollback-v1.md)는 복원될
설치 영수증과 현재 전역 pin을 예측·대조해 같은 coordinator로 실행한다. 소유권이 확인된
snapshot 링크도 보존·복원하며 미확인 과거 관계는 차단한다. 새 local 선언의 실제 영수증이
전역 전제 부재를 증명하면 파일을 유지하고 참조만 해제한다. native writer·과거 경로/연결
이관은 후속이다. 일반 v3 source 선언의 검증/진단/편집은 [원본 관리](scoped-manifest-management-v1.md)를 따른다.

## 저장 계획 v5와 소유권

새 v3 저장 계획은 schema 5 / contract `scoped-deployment-v1`이며 apply/remove/rollback을 허용한다.
scope·scoped review digest·provider 관측 선택을 필수로 기록한다. private observation ID나
긍정 flag를 영속 실행 권한으로 보관하지 않는다. 기존 저장 schema 1/2/3/4는 유지한다.
새 v3 replay를 오래된 저장 버전으로 바꿔도 digest가 맞는다는 이유로 실행하지 않는다.

재시작 후 Manifest·원본·실제 파일·원장과 전역/프로젝트 origin을 먼저 재계산한다. private
native 증거는 새로 수집하고 정의/보조 정의·binary·설정 bytes/mode/identity의 안정된 review
digest를 비교한 뒤 적용한다. no-op/제거-only에는 불필요한 관측을 추가하지 않는다.

저장 실행의 claim은 PID/nonce·inode에 묶이며 async 관측이 끝날 때까지 유지한다. 대기 중
claim·저장 review가 교체되거나 만료되면 적용을 중단한다. 새 owner의 claim과 수동 기록을
덮어쓰거나 지우지 않는다. 결과가 완료된 같은 digest의 재조회는 다시 실행하지 않는다.

## 공개 복구와 인터페이스

선택 프로젝트의 `planRecovery`는 실제 global coordination journal schema 4가 있으면
원래 프로젝트 origin/target을 대조해 기존 두 scope 검토 복구로 dispatch한다. commit 전에는
원래 파일/metadata를 복원하고 commit 뒤에는 확정된 변경을 유지한다. private journal/backup/
lock owner를 HTTP 계획에 노출하지 않는다. 저장 실행의 결과도 completed/recovered로 확정한다.
native 상태는 복구 후 미확인으로 남기며 복구를 모델/Tool 사용 성공으로 표시하지 않는다.

- CLI: `apply`/`remove --observe-prerequisites [--discover-providers]`, 기존 `--save-plan`,
  `resume --plan --digest`, 선택 프로젝트의 `recover`. 비동기 결과를 기다리고 오류를 반환한다.
- HTTP: 기존 plan/apply/save/resume/removal/recovery 경로와
  `POST /api/deployment/prerequisites/observe`. mutation session을 유지하며 async 결과를 응답한다.
- GUI: 같은 서비스의 execution 상태로 승인/저장을 제어한다. 전역 전제 확인과 선택된 MCP
  Tool 목록 조회를 명시적으로 선택하며 ready 결과만 적용할 수 있다.

## 증거와 남은 범위

[실제 공개 CLI 왕복](../reconstruction/scoped-public-codex-cli-roundtrip-20261106.json)은 검토된
Codex 0.166.0-alpha.6과 격리 HOME에서 공개 전역 v3 감사·프로젝트 계획/관측·저장 v5·다른
process의 재개/재관측·중복 실행 방지·등록 활성/해제와 정확한 설정/권한/링크 복원을 확인한다.
private 실행 gate 제거는 없으며 native 관측 3회, 모델/thread 요청·Tool 실행·미선택 provider
시작은 0회다. 사용자 HOME/client 설정/원장은 바꾸지 않았다.

native 원형/과거 경로 이관의 영향 예측,
전역 설정 변경 후 각 등록 프로젝트의 실제 문맥 전환, 미지원 native 원본 관리 수명주기,
PR07/09/11·C07 Skill compatibility/variant와 별도의 consumer 활성 검증은 남아 있다.
