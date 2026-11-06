# Resource catalog v1

PR09의 읽기 전용 통합 조회 계약이다. 배포 Manifest나 기존 단일 scope registry
응답을 합치거나 저장하지 않는다. catalog는 배포·의존성·권한 gate를 활성화하지 않는다.

## 진입점

공통 `manifestDeploymentService.catalog({kitRoot, projectName?, projectPath?, clientId?, surface?})`를
CLI `catalog`와 `GET /api/manifest/registry?view=catalog` 및 GUI에서 사용한다.
`view`가 없는 registry는 기존 단일 scope 응답을 유지한다. HTTP 읽기는 기존 localhost
GET 정책을 유지하고, 변경 API는 기존 세션 token 정책을 그대로 사용한다.

```sh
node bin/cli.js catalog --kit /path/to/kit
node bin/cli.js catalog --kit /path/to/kit --project /path/to/checkout --project-name default
node bin/cli.js catalog --client codex --surface cli
node bin/cli.js catalog --client codex --surface cli --project /path/to/checkout --observe-native
node bin/cli.js catalog --client codex --surface cli --project /path/to/checkout --observe-native --resource-kind mcpServers
node bin/cli.js catalog --client codex --surface cli --project /path/to/checkout --observe-native --resource-kind instructions
```

항상 전역을 조회하며 프로젝트는 실제 경로가 선택된 경우에만 읽는다. 다른 named
project는 열거하지 않는다. 기본 projectName은 `default`다. 초기화·snapshot 생성·
원장 기록·사용자 설정 변경·모델 호출을 하지 않는다.

## 출처와 부분 실패

응답은 `schemaVersion: 1`, `readOnly: true`이며 아래 항목을 가진다.

| 항목 | 의미 |
|---|---|
| scopes | scope, projectName, 실제 targetRoot, Kit scopeRoot, 조회 상태 |
| registry | Kit 원본의 안전한 메타데이터·source 가용성·origin·catalogId |
| clients / observations | 정의에 선언된 root의 기존 파일·링크 관측과 해당 origin |
| duplicates | 동종·동일 Kit ID의 서로 다른 origin. 합치지 않음 |
| effective | client/surface/native 이름 후보별 묶음과 확인 수준·문서상 규칙 |
| issues | scope·개별 source·탐색 실패. 한쪽 오류가 다른 쪽 결과를 없애지 않음 |
| coverage | 현재 탐색의 범위와 전체 인식·활성화 여부 미확인 표시 |

catalogId에는 scope, projectName, 실제 targetRoot, Kit scopeRoot, Kit ID,
종류/asset ID 및 관측 항목의 client/surface/candidate ID를 사용한다. 같은
projectName을 다른 checkout에 사용해도 동일 자원으로 합치지 않는다.

scope의 `missing`, `unreadable`, `invalid`, `recovery-required`, `unselected`를
구분한다. source 하나가 없어도 Manifest의 다른 자원은 표시한다. source의
`available`은 경로 metadata와 읽기 권한의 가용성이며 배포 계약 검증을 대신하지 않는다.
복구 필요 범위는 해당 scope의 기존 복구 계획으로 연결한다.

## 이름·우선순위·활성화의 증거

Skill의 디렉터리 ID와 frontmatter 이름은 별개다. 일반 디렉터리의 일반 `SKILL.md`만
범위 검사·nofollow·64 KiB 제한·파일 identity 검사 후 metadata를 읽는다. 본문과
description은 응답에 보관하지 않는다. 자원 링크·연결된 SKILL.md는 따라가 읽지 않는다.
외부 ego-browser는 링크 metadata와 관리 주체만 관측한다.

Agent도 파일 ID와 선언된 native 이름을 분리한다. 일반 TOML의 제한된 header `name`,
Markdown frontmatter `name`만 같은 bounded/nofollow reader로 읽는다. 본문 속 `name`을
역할 이름으로 사용하지 않으며 보수적 parser로 확정할 수 없으면 미확인으로 남긴다.
이름이 같아도 원본을 합치지 않고 기존 stable ID·import·소유권을 바꾸지 않는다.
선언 이름은 native 등록·부모의 선택·child 완료 증거가 아니다.

surface의 선택적 `inventoryRules`는 schema 1의 문서상 합성 규칙이다. `coexist`,
`accumulate`, 명시적 scoped root/tier의 `priority`를 구분한다. 중복 root·잘못된
schema·근거 URL/날짜 누락은 거부한다. 설치 경로가 바뀌어 기존 규칙과 맞지 않으면
catalog의 선택 후보는 미확인으로 남기며 배포 경로 이관 자체를 금지하지 않는다.
알 수 없는 root나 동률의 최고 tier는 우선 자원을 단정하지 않는다.

현재 공식 문서에 따라 Codex CLI Skill의 동명 공존 및 Antigravity CLI Skill의
위치별 우선순위만 정의했다. AGY의 두 legacy 전역 root 사이 순서는 문서로 정해져
있지 않으므로 동률이다. MCP나 Agent, 다른 surface에 이 규칙을 전용하지 않는다.
문서상 후보는 native 선택·로딩·비활성 상태를 증명하지 않는다.

- [Codex Skill 위치·이름·비활성 설정](https://learn.chatgpt.com/docs/build-skills)
- [Antigravity 탐색과 이름 충돌 우선순위](https://antigravity.google/docs/customization-discovery?tab=cli)

기본 파일 조회에서 `effective.status/runtimeState`는 `unverified`, `selected`는 false,
activation은 unknown으로 유지한다. 문서상 `higher-priority-candidate`,
`shadowed-candidate`, `coexists`는 별도 필드이며 자동 편집·덮어쓰기 근거가 아니다.
명시적 native 조회의 확인 범위는 아래와 같다. 지침의 trust/예산·override 합성이나
미지원 종류·실행 화면까지 Skill 규칙을 확장하지 않는다. 교차 scope 참조/적용은 PR10이다.

## 명시적 native Skill 조회

위 기본 조회에 더해 `manifestDeploymentService.observeCatalog`와 CLI의
`--observe-native`, 세션으로 보호되는 `POST /api/manifest/inventory/observe`를 제공한다.
GUI의 **클라이언트 CLI 상태 확인** 버튼만 이 동작을 요청한다. 기본 GET이나 화면 진입이
실행 파일을 자동 시작하지 않는다. GUI는 다른 client/surface의 미확인 관측도 유지한다.

현재 Codex CLI의 검증된 정확한 binary/version/platform/arch 조합만 native 조회를
허용한다. surface의 versioned `nativeInventory`가 adapter, 환경 경로, 읽을 설정
문맥과 binary 증거를 선언한다. 정의에 없는 실행 명령·환경 변수·RPC·HTTP body의
실행 파일/증거 주입을 허용하지 않는다. 외부 자격 증명 환경 변수를 복사하지 않는다.

Skill reader는 실제 클라이언트 프로세스에 `initialize`와 `skills/list`만 보낸다.
server 요청은 거절하고 `thread/start`, `turn/start`, Tool/MCP 호출, 설정 쓰기,
로그인, model 요청을 실행하지 않는다. 프로세스 시간과 stdout/stderr 합계에 제한을
두고 종료한다. 단, 클라이언트 자체의 일반 캐시 활동까지 무쓰기라고 주장하지 않는다.
`readOnly`는 Agent Kit 원본·원장·설정 변경을 수행하지 않는다는 의미다.

응답의 cwd, 경로, 이름, boolean enabled, native scope를 검사한다. description,
dependencies, 원문 error/log는 보관하지 않는다. 중복 경로는 ambiguous, 응답 오류가
있는 상태의 미등재 항목은 unverified다. 조회 중 설정 문맥 또는 실행 파일이 바뀌면
전체 긍정 증거를 폐기한다. Git 상위 설정 문맥도 기존 경계까지 fingerprint한다.

정확히 일치한 일반 Skill에는 `nativeEvidence.state: listed`, activation
`enabled/disabled`, `availableToClient`를 연결한다. 실효 그룹의 `native-observed`는
목록 인식 증거이며 모델 실행 증거가 아니다. `runtimeState: unverified`와
`selected: false`는 유지한다. 미등재는 삭제나 배포 실패로 바꾸지 않는다.

클라이언트가 발견한 상위/추가/bundled 경로는 `nativeObservation.additional`의
`manageable: false`로 표시한다. 선택한 프로젝트의 import/edit/apply 권한을 확대하지
않는다. 외부/자원 링크는 Agent Kit source reader가 따라가 읽지 않고 활성 증거도
붙이지 않는다. native 클라이언트 자체는 자기 탐색 규칙으로 파일을 읽을 수 있지만,
그 결과로 외부 링크를 Kit 관리 항목이나 중복 추가 항목으로 만들지 않는다.

아래 MCP reader와 지침 설정 reader 외의 종류, AGY 및 다른 surface의 native 실효 조회는
미확인이다. Codex의 조회 성공이나 문서상 Skill 우선순위를 이들에 전용하지 않는다.
다른 VCS·사용자 정의 경계와 추가 설정 문맥도 확인 범위 밖이면 미확인으로 남긴다.

프로토콜 출처: [공식 App Server의 Skill 목록](https://learn.chatgpt.com/docs/app-server).

## 명시적 native MCP 실효 설정 조회

같은 application service/API에서 `kind: mcpServers`를 선택한다. CLI에서는
`--resource-kind mcpServers`, GUI에서는 MCP 화면의 CLI 상태 확인 버튼을 사용한다.
kind를 생략한 이전 호출은 계속 Skill을 조회한다.

client definition의 `nativeInventory` schema 2는 kind별 reader·adapter·exact binary
evidence를 가진다. 환경·설정 문맥은 공통이며 schema 1의 단일 reader도 계속 읽는다.
임의 method, executable, 중복 kind나 종류가 맞지 않는 adapter는 허용하지 않는다.
desired Manifest, 배포 원장 및 기존 native deployment gate는 바꾸지 않는다.

Codex CLI MCP reader는 `initialize` 뒤 `config/read(includeLayers: true, cwd)`만
실행한다. MCP 서버의 시작/연결, Tool/model 호출, 로그인과 설정 쓰기를 요청하지 않는다.
`mcp list`에는 원본 경로가 없기 때문에 이름만으로 전역/프로젝트의 승자를 추정하지 않는다.
실효 설정의 boolean enabled 및 공개 origins/layers metadata로 필드별 출처를 읽는다.

원문 config/layer에는 자격 증명 등이 있을 수 있으므로 command/args/env/header/URL
값과 관련 없는 설정은 응답·기록에서 제거한다. 반환하는 것은 서버 이름, 활성 여부,
transport 종류, 필드 범주, 출처 파일·opaque version과 확인 수준이다. env 하위 변수
이름도 전체 field path로 표시하지 않는다. 불명확한 origin/profile/이름 충돌은 출처를
단정하지 않는다. 설정 중복·stale·실행 파일 변경의 기존 실패 규칙을 유지한다.

`nativeObservation.registrations` 및 실효 그룹의 `nativeConfiguration`은 client가
합성한 읽기 전용 설정이다. `sourceCandidates`는 실제 catalogId를 참조하며 파일 이름이나
native 이름만으로 Kit 소유권·논리 Tool/provider를 생성하지 않는다.

| 원본 상태 | 의미 |
|---|---|
| listed + enabled/disabled | 모든 확인된 실효 필드가 해당 단일 원본에서 옴 |
| shadowed | 확인된 실효 필드는 다른 원본에서 옴 |
| contributing + activation unknown | 여러 원본의 필드가 합성돼 이 원본 전체를 활성이라고 할 수 없음 |
| ignored | native layer metadata상 client가 해당 설정 원본을 제외함 |
| unverified / not-listed | 출처를 확인할 수 없거나 실효 설정에 등재되지 않음. 삭제/수정 권한을 만들지 않음 |

전역 command와 프로젝트 args가 합성되면 두 원본 모두 일부 필드 제공으로 표시한다.
상위 repository 설정이 참여해도 선택한 프로젝트 밖의 파일을 편집/import 대상으로
확대하지 않는다. 단일/합성/출처 미확인을 별도 표시하고 `manageable: false`,
`connectionState/toolUseState: unverified`, `selected: false`를 유지한다.
MCP 등록·활성 설정 관측은 실제 연결이나 Tool 사용의 증거가 아니다.

근거: [공식 effective config API](https://learn.chatgpt.com/docs/app-server),
[공식 MCP 설정](https://learn.chatgpt.com/docs/extend/mcp).

## 지침 설정과 문서 기준 선택 예상

같은 service/API에서 `kind: instructions`를 사용한다. 검증된 Codex CLI reader는
`initialize`와 `config/read`만 요청한다. versioned discovery definition에 전역/프로젝트
파일 후보와 `.git` 경계를 두고 config의 byte budget·단일 파일명 fallback만 검사한다.
사용자 정의 지침 설정은 존재 여부만 보관하고 값·본문은 응답에 넣지 않는다.

전역 override/base, Git root부터 cwd까지 각 디렉터리의 override/base/fallback 중
첫 비어 있지 않은 일반 파일을 문서 기준 후보로 표시한다. 공백 파일은 건너뛰며
연결·읽기 실패는 해당 디렉터리의 선택을 미확인으로 남긴다. 낮은 우선순위의 파일도
`lstat`으로 존재 여부부터 확인해 없는 파일을 shadowed로 만들지 않는다. 이때 기존
링크의 대상 내용은 읽지 않는다. 상위 문맥에 편집/설치 권한을 추가하지 않는다.

예상 결과는 `instructionPreview.state: documented-prediction`, `status: partial`,
`reason: INSTRUCTION_LOAD_UNVERIFIED`, `loadedSourcesState: unverified`다. 총 후보 byte가
설정 예산보다 크면 일부 내용이 잘릴 수 있음을 알릴 뿐 실제 주입 길이를 단정하지 않는다.
기본 `.git` marker와 사용자 정의 경계를 구분하며 후자는 cwd만 확인하고 문맥 누락을 표시한다.
Agent·지침의 실제 native 로딩과 모델 행동을 파일 선택 예상으로 대신하지 않는다.

공개 app-server schema에서 확인한 `instructionSources`는 thread 초기화 응답의 필드다.
격리 control에서만 MCP 비활성화를 확인한 ephemeral thread로 관측했으며 production
inventory reader는 thread 초기화를 제공하지 않는다. 사용자 환경에서 추가 MCP·hook·plugin
초기화를 유발하며 목록을 얻는 방법으로 확대하지 않는다. native Agent 정의 목록도 현재
검토한 공개 read method에는 없어 미확인으로 남긴다.

근거: [공식 지침 탐색](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[공식 Agent 이름 계약](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[공식 App Server](https://learn.chatgpt.com/docs/app-server).

## 화면 작업

전역과 선택 프로젝트의 행을 함께 표시하고 범위·관리 상태를 필터링한다. 동일 이름만으로
설치 관측과 Kit 원본을 연결하지 않는다. 편집, 사본 갱신·복원, 설치 반영, 등록 해제,
배포 검토는 행의 origin을 사용한다. 전역 행에서 프로젝트 파일로 잘못 연결하지 않는다.
외부 링크에 편집·설치·재가져오기 버튼을 제공하지 않는다.
