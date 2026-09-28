# Typed Agent v1 and target selection

확인일: 2026-09-27. 범위: CA02-2. 실제 클라이언트 인식 증거와 독립적인 파일 생성 계약이다.

## 공통 Agent

[실행 가능한 예제](../examples/agent-common.yaml)의 `assets.agents[].definition`은
`schemaVersion: 1`, 비어 있지 않은 `description`, `instructions`, 명시적인
`permissions: client-default`를 요구한다. 네이티브 이름은 안정적인 asset ID다.
모델과 권한은 각 클라이언트 기본값에 맡긴다. 두 제품의 권한이 동일하다는 의미가 아니다.

| 대상 | 생성 파일 | 변환 |
| --- | --- | --- |
| Codex CLI / desktop | `.codex/agents/{assetId}.toml` | name, description, developer_instructions |
| Antigravity CLI / desktop | `.agents/agents/{assetId}.md` | YAML name, description, mainAgent=false, subagent=true 및 Markdown 본문 |
| Antigravity IDE | 생성하지 않음 | 해당 capability는 계속 미검증 |

전역 경로는 client definition을 따른다. `source`와 typed definition 동시 사용은 거절한다.
기존 native `source` 복사는 유지한다. 알 수 없는 typed 필드는 버리지 않고 거절한다.
제어 문자, 잘못된 Unicode, 인식 가능한 credential literal은 오류이며 오류에 값을 넣지 않는다.
사용자는 비밀값을 지침에 넣어서는 안 된다. 문장 속 임의 비밀값을 모두 검출할 수는 없다.

`dependsOn.skills`는 **함께 배포할 파일 의존성**이다. 자동 호출·preload를 보장하지 않는다.
Agent의 `uses.skills`, policies 및 명시적 강제 권한·모델 설정은
아직 검증된 native mapping이 없어 자동 배포를 차단한다. 도구 요구는 아래 CA02-3의
명시적인 Codex provider 설정을 선택할 때만 변환한다. 권한을 프롬프트 문장으로 대체하지 않는다.
Skill→logical tool→MCP provider 관계는 기존 resolver로 검증하고 공급자까지 배포 계획에 포함한다.
policy 등 native 배포 capability가 없는 의존성도 제거하지 않고 계획에서 차단한다.

공식 근거:
- [Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents): standalone TOML의 세 필수 필드와 설정 상속.
- [Antigravity Custom Subagents](https://antigravity.google/docs/subagents): Markdown frontmatter, 본문, discovery 경로와 subagent 선택.

## targets 계약 (Manifest v1의 추가 검증)

`targets.<clientId>` 허용 필드는 `enabled`(boolean, 생략 시 true),
`assetIds`(중복 없는 기존 ID 배열), `projectName`(기본 default)이다.
오타·없는 asset ID·알 수 없는 필드·잘못된 타입은 manifest 로딩 단계에서 거절한다.

- targets 생략 또는 빈 map: 기존처럼 요청한 client/scope의 모든 자원을 선택한다.
- targets가 있으면 명시된 활성 client만 선택할 수 있다.
- assetIds 생략: 해당 scope 전체. 빈 배열: 선택 없음. 목록은 의존성 제외 목록이 아닌 출발 자원이다.
- 목록 중 현재 요청 scope의 자원만 출발점으로 사용한다. global/project는 따로 요청한다.
- projectName은 targetRoot에 배포할 논리 프로젝트를 고른다. 다른 프로젝트 자원을 같은 디렉터리에 합치지 않는다.
- 참조와 tool provider의 의존성을 재귀적으로 포함한다. 누락·모호성·정책 거부·순환은 계획 생성 전 거절한다.
- closure가 다른 scope를 포함하면 `DEPENDENCY_SCOPE_REQUIRES_SEPARATE_DEPLOYMENT`.
  global 의존성이 이미 설치됐더라도 현재 프로젝트 계획은 차단된다. 설치 증거와 교차 scope 트랜잭션은 후속 범위다.
- Plan은 `selection.rootAssetIds`, `dependencyAssetIds`, `selectedAssetIds`, `toolBindings`를 반환한다.
- 선택된 closure의 source만 읽는다. manifest 전체 구조/비밀값 검사는 유지하며 `validate`는 모든 source를 검사한다.
- doctor도 같은 선택 규칙을 사용한다. 빈 scope는 기존 호환상 warning, 배포 plan에서는 오류다.

기존 버전에서는 targets가 배포에 반영되지 않았다. 업그레이드 전 client 목록, enabled와
projectName을 확인해야 한다. 암묵적으로 다른 client나 프로젝트까지 배포하던 동작은 유지하지 않는다.

## 적용 경계

변환 결과는 copy 준비 단계에서 target hash·소유권을 검증하고 기존 트랜잭션/backup/rollback을 사용한다.
동일 내용이라도 unmanaged Agent 파일은 소유권을 자동 인수하지 않는다. 다른 자원 소유와 외부 수정도 차단한다.
렌더링된 바이트는 원본 prepared operation에만 연결되며 복제 객체·preview는 적용할 수 없다.
미검증 profile은 출력 미리보기만 제공한다. 실제 홈 설정, 클라이언트 실행, daemon job은 이 계약으로 변경하지 않는다.

## CA02-3: 명시적인 Codex 기본 설정과 MCP 도구 연결

Agent definition v1에 두 선택 필드를 추가했다.

```yaml
definition:
  schemaVersion: 1
  permissions: client-default
  description: 문서 조사
  instructions: 필요한 문서를 검색하고 출처를 보고하세요.
  sandboxDefault: read-only
  mcpToolAccess: required-providers
requires:
  tools:
    - id: docs.search
      providerId: docs
```

`sandboxDefault: read-only`는 Codex `sandbox_mode` 기본값이다. **강제 보안 정책이 아니다.**
공식 Subagents 문서에 따르면 부모의 live runtime override가 이를 덮어쓸 수 있다.
원격 MCP 부작용까지 read-only로 만드는 설정도 아니다. GUI/CLI preview notice로 이 한계를 표시한다.

`mcpToolAccess: required-providers`는 Agent와 그 Skill 의존성의 tool requirement를 resolver로
검증한 후 provider별 `enabled_tools`에 실제 native 도구명을 넣는다.
`provides.tools: [{id: docs.search, nativeName: search_docs}]`처럼 MCP 자원에 명시적으로 선언한다.
logical ID를 native 이름으로 추정하지 않는다. nativeName은 1~128자의 영문자·숫자·underscore·점·hyphen
부분집합이며 첫 글자는 영문자·숫자·underscore다. 중복 이름과 모호한 logical ID는 거절한다.

해당 provider는 typed MCP여야 하며 같은 endpoint/실행물·환경 변수 참조로 Agent 내부 설정을 생성한다.
이 목록은 **그 provider에만 적용**된다. 다른 상속 서버·기본 도구를 모두 차단하는 Agent 전체 allowlist가 아니다.
Skill 의존 도구도 포함하지만 Skill을 preload하거나 자동 호출하는 설정은 생성하지 않는다.
optional tool 요구, 누락된 native 이름, 해석되지 않는 source provider와 provider 정책은 차단한다.

현재 Antigravity에서는 두 필드 모두 `AGENT_NATIVE_DEFAULTS_UNSUPPORTED`다. 공식 문서의
`commandExecutionPolicy`를 강제 파일 읽기 전용과 동일시하지 않고, `mcpServers` object 및 MCP 도구 이름의
Agent 전용 mapping도 추정하지 않는다. 기본 역할 Agent는 두 제품 모두 기존대로 변환한다.

공식 근거: [Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[Codex MCP enabled_tools](https://learn.chatgpt.com/docs/extend/mcp),
[Antigravity Subagents](https://antigravity.google/docs/subagents).
