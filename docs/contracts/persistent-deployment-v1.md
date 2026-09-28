# 저장 계획과 중단 복구 v1

2026-09-27, CA03-4. 로컬 Configuration and Distribution Plane의 계약이다.
CLI와 GUI는 같은 application service를 사용한다. 데몬 작업, 서명된 배포 묶음,
실제 클라이언트 인식 검증은 이 계약에 포함되지 않는다.

CA06-1의 [불변 자원 묶음](resource-bundle-v1.md)은 별도 전송 계약이다. 수신 측
Kit helper가 해당 스냅샷으로 이 저장 계획 서비스를 호출한다. 저장 계획 자체를
다른 단말에 전달하거나 digest를 조직 승인으로 해석하지 않는다.

## 계획 저장과 재개

일반 plan은 기존처럼 메모리에서 5분간 유효하고 한 번만 소비한다. 명시적으로
savePlan을 호출하면 적용 가능한 일반 파일 계획을 기본 24시간 동안 보관한다.
저장은 클라이언트 파일을 변경하지 않고 기존 메모리 계획을 소비한다.
apply, remove, shared-ownership migration, rollback을 지원한다. 차단/preview/link 계획,
전역 원장 통합(global-ledger), Manifest 편집, recovery 계획은 저장하지 않는다.

CLI와 GUI는 `<kitRoot>/.deployment-plans/<UUID>.json`을 공유한다. 라이브러리는
planStoreRoot를 주입할 수 있으며 기본값은 `<home>/.agents-kit/plans`다. 디렉터리 신규
생성 모드는 0700, 기록 파일 모드는 0600이다. 저장소를 다른 호스트로 복사하는 배포는 지원하지 않는다.

저장 body(schemaVersion 1)는 계획 ID, 종류, 만료 시각, 재구성 입력, 대상/작업 목록,
호스트·클라이언트 정의 digest, 준비된 계획 digest를 포함한다. body 전체의 정규화된
JSON SHA-256을 검토 digest로 반환한다. 설정 본문·생성 파일·사용자 비밀 값은 보관하지 않는다.
백업은 기존 비공개 백업 저장소에 남는다.

재개에는 planId와 검토한 digest가 모두 필요하다. body digest를 비교한 뒤 현재
Manifest/원본/클라이언트 정의로 계획을 재구성하고 준비된 계획 digest를 비교한다.
대상 파일·원장·원본·지원 정의가 달라지면 새 계획이 필요하다. runtime evidence,
소유권, 의존성, scope 검증을 우회하지 않는다. digest는 무결성 비교값이며 서명이나
외부 발행자 인증이 아니다. 저장소를 수정할 수 있는 로컬 사용자를 격리하는 기능도 아니다.

실행 claim을 배타 생성하고 ready → running → completed/failed 상태를 기록한다.
트랜잭션 ID는 `tx-plan-<UUID>`로 고정한다. 완료된 계획의 재요청은 이전 결과를 반환한다.
실패/중단된 계획은 자동 재실행하지 않는다. 다만 journal과 원장 잠금이 없고 동일 ID의
완료 이력이 있으면 기록된 결과로 정리한다. 이 정리는 클라이언트 파일을 쓰지 않는다.
복구로 원본 상태를 되돌린 계획은 recovered 상태이며 새 계획을 검토해야 한다.
만료·완료 기록과 백업은 자동 삭제하지 않는다.

이것은 **재구성 가능한 계획**이다. 원본 없이 실행하는 불변 payload가 아니며,
CA06의 서명된 daemon 전달 묶음으로 그대로 사용하면 안 된다.

## 중단 기록과 검토 복구

공통 배포 서비스의 일반 파일 apply/remove/shared-ownership/rollback은 파일을 바꾸기 전에
`<statePath>.journal.json`에 PID/token 잠금 소유자, 이전 원장 hash, 대상 경로와 scope,
파일 변경 전후 hash, 백업 참조를 기록한다. 원장 commit 전에 다음 원장 hash도 기록한다.
중단 기록이 남으면 새 배포를 차단하고 원래 잠금을 보존한다.

recovery-plan은 읽기만 한다. 다음 조건을 모두 확인한다.

- journal·잠금의 PID/token이 일치하고 원래 PID가 종료되었다.
- journal의 scope가 현재 서비스의 인가된 대상 scope와 일치한다. 경로는 다시 authorize한다.
- 원장 hash가 변경 전 또는 commit 예정 값과 일치한다.
- 모든 대상이 일반 파일/부재이며 변경 전 또는 변경 후 hash와 일치한다.
- 되돌리는 데 필요한 백업 바이트가 변경 전 hash와 일치한다.

변경 전 원장이면 파일을 변경 전 상태로 복원한다. commit된 원장이면 변경 후 파일을
보존한다. 모든 대상과 백업을 먼저 검사하므로 한 파일의 외부 수정이 있으면 복원을 시작하지
않는다. 승인된 복구를 실행할 때도 전체 검사를 다시 수행하고 계획이 바뀌었으면 거절한다.
복구 guard를 배타 생성하고 일반 실패는 FileTransaction으로 되돌린다.
복구 결과를 `<statePath>.recovery-result.json`에 남기고 journal과 원래 잠금을 정리한다.
필요한 파일 복원은 백업에 기록한 권한을 사용한다. 빈 디렉터리·보관 백업은 남을 수 있다.

## 한계와 수동 점검이 필요한 경우

- journal 기록 전(예: 백업 생성 중)의 종료는 파일 변경 전이어도 버려진 잠금 점검이 필요하다.
- 복구 자체가 강제 종료되어 recovery guard가 남으면 자동 잠금 회수를 하지 않는다.
- PID 재사용/권한 부족으로 종료를 증명할 수 없거나 journal이 손상되면 차단한다.
- link가 포함된 트랜잭션, global-ledger 다중 원장 이관, targetRoot가 없는 저수준 coordinator 호출은 이 복구 대상이 아니다.
- 프로세스 SIGKILL 복구를 검증했다. fsync 기반 전원 장애 내구성, 적대적 로컬 사용자/동시 외부 편집 격리를 보장하지 않는다.
- 시작 시 자동 복원하지 않는다. 복구 계획 확인과 명시적 실행이 필요하다.
- 실제 Codex/Antigravity 프로세스의 reload, 인증, 메모리 상태를 복원하는 기능이 아니다.

잠금 파일을 무조건 삭제하거나 원장을 직접 고쳐 재실행하지 않는다. 차단된 경우 journal,
원장, 백업, 프로세스 상태를 보존해 점검한다.

## CLI / HTTP / GUI

```sh
# 현재 지원 판정을 통과하는 계획에만 사용한다.
node bin/cli.js apply --kit /path/to/kit --project /path/to/project \
  --client codex --surface cli --client-version <verified-version> --save-plan
node bin/cli.js saved-plans --kit /path/to/kit
node bin/cli.js resume --kit /path/to/kit --plan <UUID> --digest <reviewed-sha256>
node bin/cli.js recover --kit /path/to/kit --project /path/to/project --client codex --dry-run
# 복구 계획 검토 후 --dry-run을 빼면 같은 조건을 재검사하고 실행한다.
```

remove/migrate(shared-ownership)/rollback에도 --save-plan을 사용할 수 있다.
POST `/api/deployment/save-plan`, `/resume`, `/recovery-plan`, `/recover`와
GET `/api/deployment/saved-plans`를 제공한다. POST는 기존 세션 토큰/origin 검사를 적용한다.
resume/recover는 클라이언트가 보내는 임의 파일 작업을 받지 않는다.

GUI는 계획 저장 버튼, Kit의 저장 계획 불러오기, 대상/작업/digest/만료 표시,
저장 계획 적용 승인, 현재 대상의 복구 계획 → 복구 승인을 제공한다.
페이지 재시작·목록 로드만으로 실행하지 않는다.
