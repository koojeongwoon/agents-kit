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

## 2026-11-05 계약 교정: Agent 파일의 권한/MCP 기본값

CA02-3에서 추가한 아래 두 선택 필드는 기존 Manifest를 읽고 문제를 설명하기 위해
구조상 보존하지만 현재 Codex·Antigravity adapter는 `AGENT_NATIVE_DEFAULTS_UNSUPPORTED`로
자동 변환·적용을 차단한다. 기본 역할 정의는 기존대로 변환한다.

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

현재 Codex custom Agent 파일의 `sandbox_mode`와 `mcp_servers`는 부모의 설정을
덮어쓰지 않는다. 과거 렌더러가 해당 필드를 출력하고 notice를 붙이던 동작을 중단한다.
synthetic runtime evidence도 이 차단을 우회하지 못한다. 다른 검증 가능한 mapping이
없는 Antigravity에도 같은 차단을 유지한다. 프롬프트 문장으로 권한을 대신하지 않는다.

논리 tool → provider → nativeName의 registry 바인딩 검증은 유지한다. 이는 의존성
분석이며 Agent의 native 도구 허용 목록이 성립한다는 의미가 아니다. 기존 설치 파일,
원장, 백업을 변경하거나 과거 배포를 자동 제거하지 않는다. 해당 옵션을 사용하는
Manifest는 별도 변경 계획에서 기본 역할 또는 검증된 후속 계약으로 수정해야 한다.

공식 근거: [Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[Codex MCP enabled_tools](https://learn.chatgpt.com/docs/extend/mcp),
[Antigravity Subagents](https://antigravity.google/docs/subagents).
