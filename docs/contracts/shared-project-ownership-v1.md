# 프로젝트 공유 자원 소유권 v1

2026-09-27, CA03-1. 공통 source definition을 사용하는 프로젝트 지침·Skill에 적용한다.
실제 클라이언트 discovery나 실행 상태를 의미하지 않는다.

## 소비자와 원장

원장은 기존 프로젝트 `.agent-kit/state.json`을 사용한다. 소비자는
`kitId:clientId:surface`로 식별한다. schema 1 client의 surface는 `default`다.
파일 소유권의 자원 식별자는 `(kitId, assetId)`이고 Markdown은 블록별로 기록한다.
같은 assetId라도 다른 Kit의 기록을 인수하지 않는다. consumer ID에 파일 경로나 비밀값은 넣지 않는다.

공유 자원의 첫 적용은 원장을 schemaVersion 2로 전환한다. 계획에 `stateUpgrade`를
표시하며 기존 managed/transaction 기록을 유지한다. 구버전 Kit의 schema 1 reader는 이 원장을
거절하므로 공유 소유권을 무시한 덮어쓰기를 막는다. rollback해도 원장 버전은 낮추지 않는다.
현재 Kit는 schema 1/2와 CA03-3의 typed 소유권용 schema 4를 읽는다.

이미 배포된 동일 경로의 단일 소유권 기록은 소비자를 추정하지 않고
`SHARED_OWNERSHIP_MIGRATION_REQUIRED`로 차단한다. 명시적 전환은 [CA03-2 이관 계약](global-ledger-migration-v1.md)을 따른다.
같은 경로를 native source-only/managed/link 방식으로 다시 적용해 공유 원장을 우회할 수 없다.

| 계획 동작 | 의미 |
| --- | --- |
| CREATE / UPDATE | 소유 파일 또는 블록의 바이트 갱신 |
| REGISTER | 동일 내용에 새 소비자 등록 또는 원장 대조; 파일 바이트/모드 유지 |
| SKIP | 내용과 소비자가 같음 |
| RELEASE | 해당 소비자만 해제; 다른 소비자의 파일 보존 |
| REMOVE_BLOCK | 마지막 소비자의 지침 블록만 제거 |
| REMOVE | 마지막 소비자의 소유 파일 제거 |

소비자 목록은 Kit가 등록한 사용 대상이다. 미등록 클라이언트도 같은 공유 경로를 읽을 수
있으므로 접근통제 목록이 아니다. 실행 중인 대화나 이미 로딩된 지침을 회수한다는 보장도 없다.

## 계획·갱신·제거

단일 clientId 요청은 기존 API와 호환된다. 공동 갱신은 `targets` 배열에 각 clientId,
surface, clientVersion을 명시한다. CA03-2부터 최대 8개의 서로 다른 clientId/resolved surface 조합을 허용한다.
같은 clientId의 CLI·desktop도 별도 소비자로 함께 선택할 수 있다.
모든 대상의 capability/runtime gate를 통과해야 전체 계획을 적용할 수 있다.

같은 공유 경로의 요청은 한 작업으로 합친다. 내용 또는 자원 식별자가 다르면 차단한다.
이미 여러 소비자가 있는 자원은 내용 변경 시 모든 기록된 소비자가 같은 계획에 있어야 한다.
Skill의 새 부속 파일과 소스에서 삭제된 파일도 같은 규칙을 적용한다. 삭제 파일은 원장의
정확한 파일 목록으로만 정리하며 디렉터리를 재귀 삭제하지 않는다.

제거는 별도 명시적 assetIds 목록으로 계획한다. 원장에 기록된 선택 client/surface 소비자만
해제하며 Manifest를 편집하지 않는다. 다음 apply가 같은 자원을 선택하면 다시 등록된다.
소스 파일이 삭제되거나 target.enabled가 false여도 유효한 Manifest의 Kit ID로 기존 자원을
제거할 수 있다. Manifest 자체가 없거나 잘못된 구조인 경우의 복구는 후속 작업이다.
CA03-3에서 같은 API에 [typed Agent/MCP 제거](typed-resource-removal-v1.md)를 연결했다.
일반 native source-only 자원 제거는 범위에 넣지 않는다.

지침 제거는 소유 블록 밖의 사용자 본문을 보존한다. Kit가 처음 만든 지침 파일이고
마지막 소유 블록을 제거한 후 공백만 남으면 파일도 삭제한다. 원래 사용자 파일이었다면
빈 파일이 되더라도 보존한다. 블록 주변 공백은 사용자 내용으로 보존될 수 있다.
소유 블록의 외부 수정, 중복 marker, Skill 파일 수정은 적용·제거를 차단한다.

## 동시 실행과 rollback

계획은 원장 전체 hash와 각 대상의 현재 hash를 저장한다. 적용 시 둘을 다시 대조한다.
파일이 그대로여도 소비자 등록/해제 등 원장이 바뀌면 `STALE_DEPLOYMENT_STATE`다.
rollback도 원장 hash와 파일 hash를 재검증하며 이후 트랜잭션이 소유권을 넘겨받았으면 거절한다.
소비자만 바꾸는 작업은 rollback에서도 파일 바이트/모드를 쓰지 않는다.

적용과 rollback은 `state.json.lock`의 배타적 생성으로 프로세스 간 원장 잠금을 잡는다.
기존 잠금은 `DEPLOYMENT_STATE_LOCKED`이며 자동 삭제하지 않는다. 예외 시 잠금을 해제하고
검증·원장 저장 실패 시 파일과 백업 생성을 복원한다. 공유 경로의 symlink 변경도 재확인한다.

프로세스 강제 종료 후 남은 잠금은 자동 복구하지 않는다. 모든 Kit 실행을 중지하고
파일/원장/백업을 대조한 뒤 검토된 복구가 필요하다. 이 단계는 durable journal, crash recovery,
재시작 후 기존 plan 재사용을 구현한 것이 아니다. plan은 기존처럼 5분간 메모리에 보관된다.

## 인터페이스

```sh
node bin/cli.js apply --kit /tmp/example-kit --project /tmp/example-project \
  --targets '[{"clientId":"codex","surface":"cli","clientVersion":"<verified-version>"},{"clientId":"antigravity","surface":"cli","clientVersion":"<verified-version>"}]' --dry-run
node bin/cli.js remove --kit /tmp/example-kit --project /tmp/example-project \
  --client codex --surface cli --assets shared-rules,source-review --dry-run
```

`--dry-run` 없이 실행하면 출력한 계획을 같은 서비스에서 적용한다.
버전 입력만으로 runtime evidence 검증을 통과하는 것은 아니다.

- HTTP `POST /api/deployment/plan`: clientId 또는 targets, 기존 프로젝트 위치 입력.
- HTTP `POST /api/deployment/removal-plan`: clientId, surface, assetIds, 프로젝트 위치 입력.
- HTTP `POST /api/deployment/apply`: 기존과 같이 planId만 받는다. 제거 계획도 동일한 승인·실행 경로다.
- GUI: 함께 적용할 client와 별도 버전 입력, 제거할 자원 ID 입력, 계획 검토 후 제거 승인.
  추가 client의 surface와 버전을 별도로 선택한다.

## 남은 범위

CA03-2에서 [전역 통합 원장과 명시적 legacy 이관](global-ledger-migration-v1.md)을 추가했다.
전역 공동 배포·제거는 기존 원장의 이관 조건을 통과한 뒤 사용할 수 있다.
Agent/MCP 구조적 필드 제거는 [CA03-3](typed-resource-removal-v1.md)을 따른다.
지속 가능한 계획/digest, crash recovery와 daemon 집행은 후속 단계다.
