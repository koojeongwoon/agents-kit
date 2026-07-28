# 어댑터 기반 로컬 설치 상태 탐지 설계

## 목적

Agent Kit이 지원하는 AI 클라이언트의 실제 로컬 설치 여부와 MCP·Skill 설정을 읽기 전용으로 탐지한다. 화면에서는 다음 네 상태를 서로 다른 의미로 표시한다.

- **지원 정의됨**: `clients/*.yaml`에 클라이언트 정의가 존재한다.
- **PC에 설치됨**: 정의된 명령 중 하나가 실행 경로에 있거나 사용자 루트 경로가 존재한다.
- **설정 발견**: 어댑터에 선언된 탐지 소스에서 MCP 또는 Skill 이름을 하나 이상 읽었다.
- **Agent Kit 등록됨**: 같은 종류와 ID의 자산이 현재 선택한 Agent Kit Manifest에 존재한다.

탐지 과정은 사용자 설정을 수정하지 않으며 설치, 배포, 진단, CLI 실행을 하지 않는다.

## 범위

첫 구현은 저장소에 정의된 다음 클라이언트를 대상으로 한다.

- Codex CLI
- Claude Code
- Antigravity
- Cursor
- VS Code / GitHub Copilot
- Windsurf
- Claude Desktop

탐지 자산은 MCP와 Skill이다. Agent와 Harness의 로컬 역탐지는 이번 범위에 포함하지 않는다. Agent Kit Manifest에 이미 등록된 Agent와 Harness는 기존 Registry 화면에서 계속 표시한다.

## 핵심 원칙

클라이언트별 차이는 서비스 코드가 아니라 YAML 어댑터가 소유한다. 탐지 엔진에는 클라이언트 ID에 따른 조건문을 두지 않는다. 새 클라이언트는 정의 파일과 지원되는 reader 조합만 추가하면 같은 엔진으로 탐지할 수 있어야 한다.

배포에 사용되는 `path`, `format`, `strategy`의 의미는 변경하지 않는다. 탐지는 capability의 선택 필드인 `discovery`만 사용한다. 따라서 기존 copy, merge, managed-link, manual 배포 계획과 적용 로직에는 영향이 없다.

## 어댑터 확장

전역 MCP 및 Skill capability에 선택적인 `discovery` 객체를 추가한다.

```yaml
- id: mcp-global
  assetKind: mcp
  scope: global
  path: ~/.codex/config.toml
  format: toml-section
  strategy: merge
  status: stable
  discovery:
    reader: toml-table-prefix
    selector: mcp_servers
```

```yaml
- id: skills-global
  assetKind: skills
  scope: global
  path: ~/.claude/skills/{assetId}
  format: directory
  strategy: copy
  status: stable
  discovery:
    reader: directory-entries
```

지원 reader는 다음 세 종류로 제한한다.

| reader | 입력 | 반환 |
|---|---|---|
| `json-object-keys` | JSON 파일과 최상위 `selector` | 해당 객체의 키 |
| `toml-table-prefix` | TOML 파일과 table prefix | prefix 바로 아래 table 이름 |
| `directory-entries` | `{assetId}`를 포함한 capability 경로 | 바로 아래 파일·폴더 이름 |

`json-object-keys`와 `toml-table-prefix`는 `selector`가 필수다. `directory-entries`에는 `selector`를 허용하지 않는다. 탐지 정의가 없는 capability는 탐지하지 않는다.

클라이언트 정의 로더는 reader와 selector 조합을 검증하고 불변 객체로 정규화한다. 잘못된 어댑터는 기존 정의 오류와 같은 fail-closed 방식으로 거부한다.

## 탐지 엔진

`local-installation-discovery-service`는 로드된 클라이언트 정의, `homeDir`, `PATH`를 입력받는다.

클라이언트 설치 여부는 다음 규칙으로 계산한다.

1. `detection.commands` 중 하나가 `PATH`의 실행 가능한 일반 파일이면 명령 설치로 판단한다.
2. `detection.userRoot`가 존재하면 앱 또는 설정 루트 설치로 판단한다.
3. 둘 중 하나라도 참이면 `installed`가 참이다.

명령을 직접 실행하거나 버전을 조회하지 않는다.

설정 및 자산 탐지는 `scope: global`이고 `discovery`가 선언된 capability만 대상으로 한다. 경로는 다음 순서로 처리한다.

1. `~/`를 주입된 `homeDir`로 확장한다.
2. `{assetId}`가 있다면 해당 부분을 제거해 스캔할 부모 디렉터리를 구한다.
3. 정규화된 경로가 `homeDir` 내부인지 확인한다.
4. 심볼릭 링크의 실제 경로도 `homeDir` 내부인지 확인한다.
5. 파일 reader는 최대 1 MiB까지만 읽는다.

MCP 결과의 kind는 Manifest와 동일한 `mcpServers`, Skill 결과의 kind는 `skills`로 반환한다. 각 자산은 `{id, kind, clientId, sourcePath}`만 가진다. `sourcePath`는 홈 경로를 `~/`로 축약한 표시용 경로다.

JSON과 TOML reader는 키 이름만 반환한다. command, args, URL, headers, env, 토큰, 파일 내용은 결과 객체와 오류 메시지에 포함하지 않는다. 디렉터리 reader는 바로 아래 엔트리의 이름만 반환하며 내부 파일은 읽지 않는다.

같은 클라이언트에서 중복 이름이 발견되면 `clientId + kind + id` 기준으로 하나로 합친다. 서로 다른 클라이언트에서 같은 이름이 발견되면 각각 유지한다.

## API

읽기 전용 엔드포인트를 추가한다.

```http
GET /api/local-discovery
```

응답 형태:

```json
{
  "success": true,
  "clients": [
    {
      "id": "codex",
      "displayName": "Codex",
      "supported": true,
      "installed": true,
      "configured": true,
      "signals": {
        "commands": ["codex"],
        "userRootExists": true
      },
      "assets": [
        {
          "id": "context7",
          "kind": "mcpServers",
          "clientId": "codex",
          "sourcePath": "~/.codex/config.toml"
        }
      ],
      "issues": []
    }
  ]
}
```

`signals.commands`에는 실제 발견된 명령 이름만 포함하며 실행 파일의 절대 경로는 노출하지 않는다. `issues`에는 `{code, sourcePath}`만 포함한다. 파서 원문이나 운영체제 오류 원문은 반환하지 않는다.

한 소스의 파일이 없으면 정상적인 미발견으로 처리한다. 권한 거부, 크기 초과, 형식 오류는 해당 클라이언트의 issue로 기록하고 다른 클라이언트 탐지를 계속한다. 정의 로딩 실패처럼 전체 결과를 신뢰할 수 없는 경우에만 API 오류를 반환한다.

## UI 데이터 결합

`ManifestApp`은 클라이언트 정의, 로컬 탐지 결과, 현재 Kit Registry를 독립적으로 읽는다. 등록 상태는 프런트엔드에서 `kind + id`로 결합한다.

- `supported`: 클라이언트 정의 응답에 존재
- `installed`: 로컬 탐지 응답
- `configured`: 로컬 탐지 자산이 하나 이상 있거나 탐지 소스가 존재
- `registered`: 현재 Kit Registry에 같은 `kind + id`가 존재

홈의 환경 카드는 기존의 일괄 초록색 점을 제거한다. 모든 카드에는 `지원 정의됨`을 표시하고, 탐지 결과에 따라 `PC에 설치됨`과 `설정 발견` 배지를 각각 추가한다. 설치와 설정이 모두 발견되지 않은 카드에는 `지원만 됨`을 표시한다.

MCP와 Skill 화면은 Manifest 자산과 PC 발견 자산의 합집합을 표시한다. 각 행은 다음 배지를 가질 수 있다.

- `PC에서 발견`
- `Agent Kit 등록됨`
- 발견 클라이언트 이름

PC에서만 발견된 행에는 편집 버튼을 노출하지 않고 `읽기 전용` 상태를 명확히 표시한다. 이번 범위에는 Manifest로 가져오는 버튼을 추가하지 않는다.

탐지 오류가 있어도 나머지 결과를 표시하며, 화면 상단에 “일부 설정을 읽지 못했습니다” 요약과 클라이언트별 경로만 보여준다.

## 안전 경계

- 사용자 설정 파일에 쓰지 않는다.
- 클라이언트 CLI를 실행하지 않는다.
- 배포, 진단, Manifest 편집 API를 호출하지 않는다.
- 홈 디렉터리 밖의 경로를 읽지 않는다.
- 파일 크기 제한은 1 MiB다.
- 비밀 가능성이 있는 값과 원문을 API에 포함하지 않는다.
- 심볼릭 링크를 이용한 홈 디렉터리 탈출을 거부한다.
- 테스트는 임시 홈 디렉터리와 임시 PATH만 사용한다.

## 테스트

도메인 및 서비스 테스트는 다음을 검증한다.

- discovery reader와 selector 조합 검증
- 명령 파일과 userRoot를 이용한 설치 상태 판정
- JSON MCP 이름 추출
- TOML MCP table 이름 추출 및 중첩 table 제외
- Skill 폴더 이름 추출
- 중복 제거
- 파일 없음은 issue가 아님
- 잘못된 형식, 1 MiB 초과, 권한 오류를 부분 issue로 격리
- 심볼릭 링크와 홈 외부 경로 차단
- 응답에 secret, command, args, URL, env 값이 포함되지 않음

라우터 테스트는 `GET /api/local-discovery`만 추가되고 mutation 표면은 늘어나지 않는지 검증한다.

GUI 테스트는 다음을 검증한다.

- 환경 카드가 지원만 됨과 PC에 설치됨을 구분
- MCP·Skill 합집합 표시
- PC 발견 및 Agent Kit 등록 배지 결합
- 읽기 전용 발견 자산에 편집 동작이 노출되지 않음
- 부분 탐지 오류 표시

마지막으로 실제 Chrome에서 로컬 전역 범위를 선택해 현재 PC의 Codex MCP와 Claude Skill 이름이 나타나는지 확인한다. 확인 과정에서 서버 로그에 `GET /api/local-discovery`, `GET /api/clients`, `GET /api/manifest/registry` 이외의 mutation 요청이 없는지 검증한다.

## 완료 조건

- 일곱 클라이언트의 설치·설정 존재 여부를 어댑터 정의로 탐지한다.
- 실제 MCP·Skill 이름을 비밀값 없이 표시한다.
- 지원, 설치, 설정 발견, Agent Kit 등록 상태를 구분한다.
- 기존 배포 어댑터와 적용 전략 파일에는 변경이 없다.
- 전체 자동 테스트, 타입 검사, GUI 빌드와 Chrome 검증이 통과한다.
- 변경 사항이 기존 Draft PR #1에 한국어 설명으로 반영된다.
