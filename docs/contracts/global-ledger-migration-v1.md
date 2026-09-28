# 전역 원장 통합·공유 소유권 이관 v1

2026-09-27, CA03-2. 실제 클라이언트 실행 검증 및 daemon 배포와 독립된 로컬 계약이다.

## 전역 원장

새 전역 배포는 홈 하나에 `~/.agents-kit/deployments/_global/state.json`과
`_global/backups`를 사용한다. 원장은 기본 schema 2이며, CA03-3 typed 소유권을 기록하면 schema 4로 전환한다. 모든 client/surface와 Kit가 공유한다.
프로젝트 원장은 `.agent-kit/state.json`을 유지한다. 전역 대상 루트는 서비스에 설정된 홈과 같아야 한다.

기존 `deployments/<clientId>/state.json`이 있으면 전역 plan/apply/history/rollback을
`GLOBAL_LEDGER_MIGRATION_REQUIRED`로 차단한다. 암묵적으로 원장을 합치지 않는다.
CLI `migrate --migration global-ledger` 또는 HTTP/GUI 이관 계획을 먼저 적용한다.
기존 원장이 없는 홈에서는 새 배포가 바로 통합 원장을 사용한다.

전역 원장 이관 계획은 다음 변경 경로와 전후 hash를 표시한다.

- 홈 아래 기존 client별 원장을 모두 검사하여 managed 기록과 transaction 이력을 합친다.
- 기존 원장 원문을 `_global/migrations/<migrationId>/<clientId>.state.json`에 보관한다.
- 이력에서 참조하는 파일 백업을 `_global/backups/<transactionId>/...`로 복사하고 참조를 바꾼다.
  백업의 hash가 과거 operation.beforeHash와 일치해야 한다. 원래 백업도 남긴다.
- 기존 원장은 `schemaVersion: 3`, `migratedTo`, `migrationId`만 포함하는 사용 중지 표식으로 바꾼다.
  일반 state reader는 schema 3 표식을 거부한다. 표식은 일반 배포 원장이 아니다.
- 클라이언트 설정 파일은 쓰지 않는다. 기존 배포 이력은 통합 원장에서 계속 rollback할 수 있다.

이관 조건은 보수적이다. 기존 소유 파일 hash와 committed apply 이력이 일치해야 하며,
중복 소유 경로·중복 transaction ID·손상 백업·홈 밖 경로·배포 메타데이터를 가리키는 이력은 거절한다.
symlink를 통과하는 대상/원장/백업도 거절한다. 기존 managed link의 자동 이관은 지원하지 않는다.
이미 통합 원장이 존재하는 상태에서 새 legacy 원장을 합치는 추가 이관도 자동 지원하지 않는다.

## 잠금·실패 복구·호환성

이관 전 다른 Kit 프로세스를 중지한다. 현재 버전과 CA03-1의 원장 잠금은 정렬된 경로 순서로
통합 원장과 기존 원장에 함께 잡는다. 잠금을 지원하지 않는 더 오래된 프로세스와의 동시 실행은 지원하지 않는다.
계획 후 원장 목록/원문, 대상, 백업이 바뀌거나 잠금이 존재하면 적용을 거부한다.
일반 전역 apply/rollback도 같은 통합 원장 잠금을 사용하며 매번 legacy 사용 중지 표식을 확인한다.
이전 Kit가 새 legacy 원장을 만들거나 표식을 바꾸면 현재 Kit의 전역 작업도 차단한다.

실행 중 예외·검증 실패·상태 쓰기 실패는 파일 트랜잭션으로 원장·백업·표식을 복원한다.
비어 있는 생성 디렉터리는 남을 수 있다. 프로세스 중단을 감지하기 위해
`_global/migration.pending.json`을 먼저 쓰고 완료 시 지운다. 남은 표식 또는 잠금은 자동 삭제하지 않는다.
`GLOBAL_LEDGER_RECOVERY_REQUIRED`에서는 모든 Kit를 중지하고 보관 원장·이력·백업·현재 파일을 대조한
수동 복구가 필요하다. 자동 crash recovery, fsync 기반 전원 장애 보장, durable journal은 아직 없다.

통합 완료 자체는 `ledger-migration` 이력이며 자동 역이관 대상이 아니다. 이후 배포와 과거 이력의
rollback은 계속 지원한다. 원장 구조를 구버전으로 되돌리려면 별도 검토된 복구가 필요하다.
원장 hash/schema 확인이 없는 외부 프로그램의 파일 덮어쓰기까지 방지하지는 않는다.

## 기존 지침·Skill 소유권의 명시적 전환

`migration: shared-ownership`은 전역/프로젝트 모두 지원한다. clientId, surface, assetIds를
명시하고 Manifest의 대상 선택·scope·정의와 대조한다. 공통 `definition`을 선언한 지침과 Skill만 대상이다.
기존 원장에는 Kit ID와 surface가 없으므로 이 요청이 **새 Kit/실행 화면과 기존 자원의 명시적 연결**이다.
기존 원장이 그러한 정보를 증명한다고 간주하지 않으며 다른 소비자를 추측해서 추가하지 않는다.

- 파일의 기존 clientId·assetId/소유 블록·내용 hash·committed apply 이력이 일치해야 한다.
- 현재 source와 기존 파일/블록 내용도 같아야 한다. source 갱신과 이관을 한 번에 하지 않는다.
- 지침 파일의 모든 기존 소유 블록을 함께 지정한다. 혼합 형식·미지정 소유자는 차단한다.
- Skill의 과거 소유 파일이 새 source에 없으면 불완전 이관으로 차단한다.
- `MIGRATE_OWNERSHIP`은 파일 바이트/모드를 유지하고 소비자를 등록한다. 원장 전후 hash와
  적용 직전 대상 경로/파일을 대조한다. 적용 후 일반 rollback으로 이전 단일 소유권을 복원할 수 있다.
- 원래 지침 파일의 생성 주체는 추정하지 않는다. 이관한 파일은 마지막 소유 블록 제거 후에도 빈 파일로 보존한다.

소유권 이관은 이미 있는 파일의 관리 메타데이터만 바꾸므로 runtime evidence를 요구하지 않는다.
unsupported/UI-only/unverified capability 형식은 이관하지 않는다. 이후 실제 apply는 기존 version/runtime gate를
그대로 통과해야 한다. 이관 성공이 클라이언트 실행 성공이나 지원 활성화를 뜻하지 않는다.

## 전역 공유 동작과 실행 화면

공통 지침·Skill의 계획/갱신/제거/rollback이 전역에도 적용된다. 공동 요청은 최대 8개의 서로 다른
`(clientId, resolved surface)` 조합을 받는다. Codex CLI와 desktop처럼 같은 client의 여러 화면도 가능하다.
같은 파일을 읽는 등록 소비자는 함께 갱신한다. 경로가 서로 다른 저장소는 별개로 취급하여
한 저장소의 갱신/파일 정리가 다른 저장소의 자원을 지우지 않는다. 경로 변경 시 과거 경로를 자동 이사하지 않는다.

여러 surface에서 native Agent/MCP 등이 같은 target을 요구하면 아직 중복 target 충돌로 차단한다.
중복 경로 합산은 공통 지침·Skill만 지원한다. 단일 소유권 native 파일은 다른 client가 인수할 수 없다.

## 실행 방법

```sh
# 실제 이관 전 계획을 검토. --dry-run을 빼면 같은 서비스가 계획을 생성하고 적용한다.
node bin/cli.js migrate --migration global-ledger --dry-run
node bin/cli.js migrate --kit /path/to/kit --client codex --surface cli \
  --migration shared-ownership --assets shared-rules,source-review --dry-run
# 프로젝트 소유권 전환에는 --project /path/to/project를 추가한다.
node bin/cli.js apply --kit /path/to/kit \
  --targets '[{"clientId":"codex","surface":"cli","clientVersion":"<verified-version>"},{"clientId":"codex","surface":"desktop","clientVersion":"<verified-version>"}]' --dry-run
node bin/cli.js remove --kit /path/to/kit --client codex --surface cli --assets source-review --dry-run
```

`POST /api/deployment/migration-plan`은 migration, scope, 필요 시 clientId/surface/assetIds와
기존 프로젝트 위치 인자를 받는다. 응답은 kind=migration이며 적용은 기존 `/api/deployment/apply`의
planId만 받는다. GUI의 **기존 관리 기록 이관 → 계획 → 이관 승인**도 같은 application service다.
계획은 5분간 메모리에만 존재하며 한 번 사용된다. daemon에 전달 가능한 지속 계획은 후속 단계다.
