# Agent/MCP 소유 항목 제거 v1

2026-09-27, CA03-3. Codex·Antigravity의 Kit typed definition으로 배포한 Agent/MCP를
프로젝트·전역에서 제거한다. 실제 클라이언트/daemon 실행 검증과는 별개다.

## 소유권 기록과 호환성

새 typed Agent 파일과 MCP 소유 단위에 `resource.version=1` 기록을 추가한다.
Kit ID, asset ID/kind, client ID, configStore, 배포 surface, scope, format,
배포 당시의 전이 의존 asset ID 목록을 기록한다. 파일 경로는 기존 managed key가 담당한다.

이 기록을 사용하는 첫 배포는 원장을 **schemaVersion 4**로 전환하고 계획의 `stateUpgrade`에 표시한다.
schema 3은 CA03-2의 구 전역 원장 사용 중지 표식으로 예약되어 있다.
현재 일반 원장 reader는 1/2/4를 읽고, typed 소유권을 schema 1/2에 넣은 원장은 거절한다.
이전 Kit는 schema 4를 읽을 수 없다. rollback 후에도 원장 버전을 내리지 않는다.
전역 원장 통합도 원본의 schema 4와 typed metadata를 보존한다.

기존 기록에 Kit 식별자가 없으면 `RESOURCE_REMOVAL_OWNERSHIP_UNPROVEN`으로 차단한다.
내용이 같다는 이유로 legacy Agent/MCP를 새 Kit 소유로 추정하지 않는다. 기존 배포의
일반 갱신은 호환되지만 식별자가 없는 기록에는 새 typed 소유권을 자동 부여하지 않는다.
이 legacy Agent/MCP의 명시적 이관은 후속 범위다. CA03-2의 shared-ownership 이관은 지침·Skill 전용이다.

Kit 식별자가 기록된 자원은 다른 Kit와 native source/managed/link 방식이 덮어쓸 수 없다.
새 native structured owner가 기존 typed owner의 같은 selector를 인수하는 것도 차단한다.

## 계획과 제거

기존 `remove --assets` 및 `POST /api/deployment/removal-plan`에 지침·Skill·Agent·MCP ID를
함께 지정한다. 요청한 모든 항목이 안전해야 전체 계획을 적용한다. 자동 cascade는 하지 않는다.
Manifest의 Kit ID와 기록을 비교하되 target이 비활성화되거나 자원 source가 사라져도
기록으로 제거를 계획할 수 있다. 유효한 Manifest 자체는 필요하다.

선택 surface의 configStore, scope, 문서 검증된 capability path/format을 기록과 대조한다.
지원하지 않는 화면·UI-only 항목이나 다른 경로를 추측해 제거하지 않는다.
파일 제거에는 클라이언트 실행이 필요하지 않으므로 runtime evidence를 요구하지 않는다.
실제 배포 apply는 기존 runtime gate를 유지한다.

Agent/MCP는 **저장소의 설정 자원 제거**다. Codex CLI와 앱처럼 같은 설정을 읽는 실행 화면에도
반영된다. 공통 지침·Skill의 소비자 한 명만 해제하는 동작과 다르며 GUI에 이 차이를 표시한다.
실행 중인 세션의 메모리, 인증, MCP 프로세스를 회수한다는 보장은 없다.

| 대상 | 소유 단위와 동작 | 보존/거부 |
| --- | --- | --- |
| Agent | 파일 hash 확인 후 REMOVE | 파일 외부 수정·symlink·경로 변경 거부 |
| Codex MCP | 기록된 `mcp_servers.<assetId>` 섹션 hash 확인 후 REMOVE_UNITS | 다른 섹션과 preamble 바이트 보존. 지원하지 않는 TOML 문법·중첩/중복 섹션 거부 |
| Antigravity MCP | 기록된 JSON leaf hash 확인 후 해당 서버 항목 제거 | 다른 JSON 설정과 서버 값 보존. JSON 들여쓰기는 재직렬화될 수 있음 |

MCP 설정 파일 자체는 마지막 Kit 서버를 제거해도 보존한다. JSON의 빈 mcpServers 객체도 유지한다.
현재 지원하는 TOML은 기존 MCP merger의 제한된 단일 행 문법이다. 인용된 table, multiline,
inline table 등 지원 범위 밖 문법은 보수적으로 거절한다. JSON 중복 키와 잘못된 UTF-8도 거절한다.

제거할 JSON 서버에 Kit가 소유하지 않은 추가 필드가 있으면 `MCP_UNOWNED_FIELDS_REMAIN`으로 차단한다.
사용자 필드를 지우거나 실행 설정이 일부만 남는 상태를 자동으로 만들지 않는다.
TOML은 섹션 전체를 소유하므로 섹션 내부에 추가된 필드·주석도 외부 수정으로 취급한다.

## 의존성과 복구

새 typed Agent/MCP와 공통 지침·Skill의 원장에 배포 당시 의존 ID 목록을 저장한다.
제거 후 남을 원장 그래프에서 요청 client의 자원이 제거할 자원을 참조하면 `RESOURCE_STILL_REQUIRED`다.
현재 Manifest에서 참조를 지워도 배포 원장의 의존성이 사라지지 않는다.
필요하면 의존 자원부터 제거하거나 의존 자원과 공급자를 같은 제거 계획에 명시한다.

소스 바이트는 같아도 의존성이 바뀌면 원장 갱신을 계획한다. 공유 자원의 의존성 변경에도
모든 기록된 소비자가 참여해야 한다. 관계를 증명할 수 없는 legacy 관리 기록이 남으면
`REMOVAL_DEPENDENCIES_UNVERIFIED`로 보수적으로 차단한다. 미등록 사용자 설정·외부 클라이언트의
참조까지 추적하는 그래프는 아니다. project→global 교차 배포는 기존 scope 계약에서 차단한다.

원장 hash, 대상 hash, 경로 authorization을 적용 직전에 다시 확인한다. 기존 잠금·backup·
파일 트랜잭션을 사용하고 검증/상태 저장 실패 시 전체 제거를 복원한다. 성공 후 기존 rollback
API로 설정 바이트·관리 기록을 복구한다. 재시작 후 저장 계획 재개와 일반 파일의 검토 중단 복구는 후속 [CA03-4 계약](persistent-deployment-v1.md)을 따른다. 시작 시 자동 복원하지 않는다.

## 인터페이스

```sh
node bin/cli.js remove --kit /path/to/kit --project /path/to/project \
  --client codex --surface cli --assets reviewer,docs --dry-run
# --project를 생략하면 전역 원장을 사용한다. --dry-run을 빼면 계획을 생성하고 적용한다.
```

HTTP와 GUI는 같은 application service와 기존 apply(planId) 경로를 사용한다.
계획은 REMOVE 또는 REMOVE_UNITS, 대상 경로, hash와 제거할 소유 selector를 표시한다.
사용자 설정 원문을 제거 계획에 포함하지 않는다. runtimeEvidence는 변경하지 않는다.
