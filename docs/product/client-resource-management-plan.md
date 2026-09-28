# 클라이언트별 자원 관리·데몬 중앙 배포 실행 계획

작성·공식 문서 확인: 2026-09-27. 상태: **CA01 및 CA02-1 MCP 변환 구현, LM4 나머지 범위 진행 전**.

검토 기준은 HEAD `02ac6bd64c6d8111aaa2309e3611384dc8aed791`와 현재 작업 트리다. 작업 트리에 기존 변경이 있으므로 HEAD만으로 이번 검토 상태를 재현할 수는 없다. 이 문서는 현재 클라이언트 설치·버전·실제 로딩을 검증했다는 증거가 아니다.

## 1. 목표와 범위

공통 Manifest에서 MCP·Skill·Agent·지침을 한 번 정의하고, 선택한 클라이언트의 공식 형식으로 변환하여 안전하게 배포·갱신·제거·복구한다. 개인은 Kit에서 자기 PC를 관리하고, 조직은 Gateway 중앙 UI에서 승인한 묶음을 데몬을 통해 등록 단말에 배포한다.

- Kit: 원본 편집, 의존성 검증, 클라이언트 변환, 계획·차이, 소유권, 적용·롤백.
- Gateway 중앙 UI/API: 대상·버전 선택, 승인, 불변 배포 묶음 발행, 기기별 결과.
- 데몬: 기기 인증, 작업 수신·서명 검증, 로컬 조건 재검증, 제한된 적용 및 결과 보고.
- 클라이언트: 실제 설정 로딩, Skill 선택, Agent 실행, MCP 연결. Kit이 클라이언트의 에이전트 루프를 대체하지 않는다.

최초 검증 OS는 macOS Apple Silicon으로 한다. 기존 Kit의 Node CLI 플랫폼 지원과 **각 AI 클라이언트·데몬 조합의 지원**은 별개다. Windows·Linux, 원격 SSH·WSL·컨테이너·클라우드 실행은 별도 시험 프로필이 확보될 때 추가한다.

첫 지원 묶음은 **Codex CLI/데스크톱과 Antigravity CLI/2.0 앱/IDE**다. 공통 모델과 어댑터의 첫 참조 구현·시험 fixture·GUI 기본 대상·데몬 배포 시험을 모두 이 두 제품으로 정한다. Claude Code는 지침 호환을 포함해 후속 P1이며 첫 묶음의 선행 조건이나 합격 조건에 넣지 않는다. 상세 작업은 [Codex·Antigravity 우선 구현 계획](codex-antigravity-implementation-plan.md)을 따른다. 다른 클라이언트의 기존 동작은 보존한다.

## 2. 현재 코드에서 확인한 출발점

| 항목 | 확인한 현재 상태 | 필요한 작업 |
|---|---|---|
| 안전한 파일 적용 | 계획·소유권·백업·충돌·롤백 서비스 존재 | 재사용하고 신규 변환·제거·중앙 집행을 이 경로에 연결 |
| 공통 자원 변환 | `prepare-merge-deployment.js`는 source 파일 내용을 그대로 원하는 출력으로 병합. copy도 원본 바이트 복사 | 공통 MCP·Agent 정의 → 클라이언트 출력의 명시적 변환 계층 추가 |
| inline MCP | Manifest 계약은 connection/environment 등을 허용하지만 merge는 source 파일을 요구 | 원본 파일이 없어도 정규화한 MCP 정의를 렌더링하는 경로 완성 |
| 대상 선택 | `targets`는 보존하지만 현재 plan 경로는 scope에 해당하는 모든 자원을 선택 | targets의 enabled·선택 자원·의존성 포함 규칙 실제 적용 |
| 제품·실행 화면 구분 | 정의는 `codex`, `antigravity`, `cursor` 등 가족 단위 | CLI·앱·IDE별 지원과 설치 신호·버전을 구분 |
| 설치 탐지 | PATH 실행 파일/사용자 디렉터리 존재를 탐지. 버전·실제 로딩 검증 없음 | 설치 추정과 지원 판정을 분리, 신뢰한 버전/채널 조회 |
| 제약 | `constraints`를 저장하지만 capability resolver는 신뢰 프로젝트·승인 상태를 평가하지 않음 | 제약을 배포 전제 및 사용자 후속 작업으로 평가 |
| 적용 후 검증 | `applyDeployment`의 기본 validate는 성공이며 CLI/GUI 기본 호출에 클라이언트 검증기가 연결되지 않음 | 구문·파일 검증과 실제 인식·연결 확인을 분리 연결 |
| 공유 경로 소유권 | 전역 상태는 clientId별 저장. 여러 클라이언트가 `.agents/skills` 등을 공유할 수 있음 | 물리 경로/설정 단위별 소유권과 소비 클라이언트 집합 관리 |
| 제거·동기화 | copy는 원하는 source 파일, merge는 원하는 키/섹션을 순회 | 원하는 상태에서 빠진 Kit 소유 자원의 제거 계획·백업·롤백 추가 |
| 중앙 배포 | 데몬 job v1은 `managed_worker.revoke`만 허용 | 기존 v1을 느슨하게 하지 않고 별도 버전형 배포 작업 계약 추가 |

근거: [배포 서비스](../../lib/application/manifest-deployment-service.js), [계획](../../lib/application/plan-client-deployment.js), [merge](../../lib/application/prepare-merge-deployment.js), [copy](../../lib/application/prepare-copy-deployment.js), [apply](../../lib/application/apply-deployment.js), [탐지](../../lib/application/local-installation-discovery-service.js), [capability](../../lib/domain/client-definition.js), [LM3 작업 계약](../architecture/daemon-management-jobs-v1.md).

LM1~LM3-4의 기존 로컬 완료 범위를 유지한다. LM4는 CA01과 CA02-1 공통 MCP 변환을 구현했으며 운영 배포 완료로 표시하지 않는다. [기존 단계·증거](three-component-implementation-plan.md#5-단계별-작업과-완료-게이트).

## 3. 모든 클라이언트에 적용할 설계 결정

### 3.1 제품과 실행 화면, 설정 저장소를 별도로 식별

다음은 **추가할 논리 모델 제안**이며 현재 YAML 필드가 아니다.

| 개념 | 예 | 역할 |
|---|---|---|
| family | `codex` | 공통 변환 어댑터 |
| surface | `cli`, `desktop`, `ide` | 실제 읽는 제품·실행 화면 |
| instance | 기기·사용자·프로필·실행 호스트·버전 | 적용·검증 대상 |
| configStore | 같은 홈/프로젝트의 Codex 설정 저장소 | 동일 파일에 한 번만 적용 |
| capability | MCP/Skill/Agent × scope × OS × surface | 지원 형식·경로·제약·증거 |

기존 `codex`, `antigravity` 같은 clientId는 바로 삭제하거나 다른 대상을 뜻하도록 바꾸지 않는다. 기존 배포 원장과 연결해 호환 모드를 제공하고, 새 선택 UI/API에서는 surface를 명시한다. 기존 Antigravity 정의는 CLI 경로를 뜻하므로 앱으로 자동 확대하지 않는다. 공유 파일 변경은 영향받는 소비 클라이언트를 계획에 표시한다.

문서 확인 상태와 제품 검증 상태는 별도다. `documented` → 변환 테스트 통과 → 특정 버전 실기 검증을 각각 기록한다. 문서의 기능 존재만으로 모든 버전을 `stable`로 열지 않는다. 최소 버전 근거가 없으면 검증한 버전/채널만 등록하고, 버전 불명은 지원 미확인으로 처리한다.

### 3.2 공통 원본과 클라이언트 변환

현재 Manifest v1을 암묵적으로 재해석하지 않는다. typed definition을 추가하는 스키마 변경과 v1 source 기반 자산의 호환·명시적 전환 경로를 먼저 확정한다.

| 자원 | 공통으로 관리할 의미 | 변환 책임 |
|---|---|---|
| 지침 | AGENTS.md 공통 원본, 범위, 적용 조건 | Codex·Antigravity의 공식 로딩 범위·우선순위와 전역 지침 위치를 각각 적용 |
| Skill | name/description/본문/부속 파일, 논리 도구 요구 | 공통 SKILL.md + 검증된 클라이언트 확장만 출력 |
| MCP | transport, 논리 실행물 또는 endpoint 참조, args, 인증 참조, 제공 도구 | `mcp_servers` TOML / `mcpServers` JSON / VS Code `servers` 등 |
| Agent | 역할·설명·본문, 논리 Skill/Tool 참조, 요청 모델·권한 | Codex TOML / 각 클라이언트 Markdown frontmatter |

모델 이름·내장 도구 이름·권한 의미는 클라이언트별 바인딩으로 해결한다. 요청된 도구 제한을 표현할 수 없으면 배포를 막고 사유를 표시한다. 지침 본문에 제한을 적는 것을 실제 실행 권한 제한과 동등하게 취급하지 않는다. 공통 의미로 표현할 수 없는 선택 기능은 명시적인 클라이언트 확장으로 둔다.

Skill/Agent의 도구 요구 → 논리 Tool → MCP provider → 클라이언트 연결명/도구명 순서로 해석한다. 렌더링 결과는 구조화된 중간 산출물로 만들어 검증 후 기존 copy/merge 트랜잭션에 전달한다. CLI·GUI·데몬 경로마다 변환기를 새로 구현하지 않는다.

소스 파일·부속 파일·변환 결과도 secret 검사 대상에 포함한다. 인증은 클라이언트 OAuth 또는 검증된 런타임 환경 참조를 사용한다. 터미널 환경 변수가 데스크톱 앱에도 전달된다고 가정하지 않는다. 클라이언트가 안전한 참조를 지원하지 않으면 인증 설정을 후속 사용자 작업으로 남기거나 해당 배포를 차단한다.

공통 프로젝트 지침은 AGENTS.md를 원본으로 유지하고 Codex·Antigravity에서 직접 사용하는 경로를 먼저 완성한다. 두 제품의 상위 지침·override·Rules 로딩 의미를 동일하다고 가정하지 않는다. 지침과 함께 Skill·Agent·MCP를 첫 배포 범위에 포함한다. 개인 전역 지침과 커스텀 Agent 정의는 프로젝트 지침 경로와 분리한다. Claude의 직접 읽기/import는 [후속 호환 계획](shared-instructions-implementation-plan.md)으로 분리한다.

### 3.3 파일 소유권, 공유, 삭제

- 키: 로컬에서 정규화한 실행 호스트·사용자·물리 경로·설정 selector. source 자산과 소비 클라이언트는 별도 연결한다.
- 동일 Skill을 같은 `.agents/skills`에 배포하면 하나의 산출물로 관리한다. 다른 클라이언트를 추가해도 두 번 쓰거나 두 개의 독립 소유권으로 만들지 않는다.
- 마지막 소비 대상이 사라졌을 때만 Kit 소유 산출물을 제거한다. 동일 경로에 서로 다른 내용이 필요하면 충돌로 막는다.
- 한 클라이언트만을 위한 자원인데 경로가 다른 클라이언트에도 노출되면 계획에 표시한다. 격리가 요구되면 전용 경로나 별도 프로필이 필요하며 지원되지 않으면 차단한다.
- 기존 원장들을 전환할 때 백업·내용 해시·소유자 대조를 먼저 수행한다. 내용이 같다는 이유로 미관리 파일을 자동 인수하지 않는다.
- 병합은 Kit 소유 키·섹션·블록만 변경/제거한다. JSONC 주석·TOML 인용 키·멀티라인/배열 등 실제 공식 예제를 시험한다. 현재 제한된 TOML 병합기로 일반 TOML 편집을 보장하지 않는다.
- 제거·롤백은 클라이언트 메모리에 이미 올라간 Skill/Agent 지침이나 진행 중 MCP 호출을 즉시 취소하지 않는다. 파일 상태와 다음 세션 반영 상태를 분리한다.

### 3.4 사용자에게 표시할 상태

`계획됨 → 파일 적용됨 → 다시 불러오기/승인/로그인 필요 → 클라이언트 인식 확인 → 사용 확인`을 구분한다. 오류·충돌·지원 미확인·오래된 관측도 따로 표시한다.

파일 배포 성공은 파일 및 구문 검증까지다. 실제 로딩은 검증된 읽기 API/CLI, 클라이언트 UI, 시험 로그로 확인한다. 모델이 단순히 “알고 있다”고 답한 것만으로 인식 증거를 만들지 않는다. 실제 호출 검증은 격리된 시험 자원에서 수행하며 일반 배포 중 임의 도구/스크립트를 자동 실행하지 않는다.

## 4. 클라이언트별 실행 계획

경로는 기본 로컬 프로필 기준이다. 표의 공식 경로는 문서 근거이며 **Kit의 현재 배포 성공 보증이 아니다**. 각 항목의 완료 기준에는 공통 시험(6장)이 추가로 적용된다.

### C01. Codex CLI — P0 / 부담 중 / 실현 가능성 높음

| 자원 | 프로젝트 | 사용자 전역 |
|---|---|---|
| 지침 | `AGENTS.md` | 기본 `~/.codex/AGENTS.md` |
| Skill | `.agents/skills/<id>/SKILL.md` | `~/.agents/skills/<id>/SKILL.md` |
| MCP | `.codex/config.toml`의 `mcp_servers` | 기본 `~/.codex/config.toml`의 `mcp_servers` |
| Agent | `.codex/agents/<id>.toml` | 기본 `~/.codex/agents/<id>.toml` |

공식 근거: [MCP](https://learn.chatgpt.com/docs/extend/mcp), [Skills](https://learn.chatgpt.com/docs/build-skills), [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents). 커스텀 Agent TOML은 name·description·developer_instructions를 요구한다. 프로젝트 설정은 신뢰 상태가 전제다.

작업:

1. 현재 `clients/codex.yaml`의 Agent config 섹션 출력을 개별 TOML 변환으로 전환한다. 이전에 배포한 Kit 소유 섹션만 이관 대상으로 계획하고, 실제 구버전 지원이 확인되기 전에는 기존 방식이 항상 무효라고 단정하지 않는다.
2. MCP connection 정의를 TOML로 변환하고 stdio/HTTP·인증 참조별 유효성을 검증한다. plugin 소유 MCP 설정은 직접 transport 설정과 구분한다.
3. `CODEX_HOME`, 프로젝트 신뢰, 상위 AGENTS/override, 공유 Skill 이름 충돌을 평가한다. client에서 선택한 모델/권한을 임의로 덮어쓰지 않는다.
4. Skill 갱신 감지와 지침의 세션 시작 시 로딩을 구별해 후속 동작을 안내한다.

선행: 공통 변환·소유권, 설치 버전 검출. 기대효과: 첫 번째 완전한 공통 자원 → 네이티브 파일 경로.

완료: 격리 프로젝트에서 지침·Skill·Agent가 실제 로딩되고 시험 MCP 목록/읽기 호출이 확인된다. 갱신·제거·롤백 후 새 세션 상태가 예상과 일치한다. untrusted 프로젝트에서는 파일 저장 여부와 실제 비활성 상태를 구분한다.

### C02. Codex 데스크톱 로컬 작업 — P0 / 부담 중 / 조건부로 높음

공식 MCP 문서는 데스크톱 앱·CLI·IDE 확장의 설정 공유를 명시한다. 단, 같은 실행 호스트/홈에 대한 근거다. [공식 MCP 문서](https://learn.chatgpt.com/docs/extend/mcp).

작업: C01과 변환기·configStore를 공유하고 앱 설치/내장 런타임 버전 및 로컬 작업 경로를 별도 탐지한다. 앱을 터미널 밖에서 실행한 환경, 기존 열린 작업, 새 작업, worktree에 대해 인식 범위를 확인한다. CLI 성공을 앱 성공으로 복사하지 않는다. 원격/클라우드 작업에는 로컬 홈 파일 배포 완료를 적용하지 않는다.

선행: C01과 공유 저장소 처리. 기대효과: CLI와 앱을 함께 써도 한 번 정의·한 번 배포.

완료: 앱에서 같은 시험 Skill·Agent·MCP를 읽고, CLI와 번갈아 갱신/롤백해도 설정 손실과 중복이 없다. 인증·재시작이 필요하면 완료 상태와 분리 표시한다. 앱에서 검증되지 않은 Agent 기능은 해당 surface만 미확인으로 유지한다.

Codex IDE 확장은 공통 어댑터를 재사용할 후속 surface다. 확장 버전 및 reload 후 같은 시험을 별도로 통과해야 한다.

### C03. Antigravity CLI — P0 / 부담 중 / 실현 가능성 높음

| 자원 | 프로젝트 | 사용자 전역 |
|---|---|---|
| 지침 | `AGENTS.md` 또는 `GEMINI.md` | `~/.gemini/GEMINI.md` 등 공식 지침 위치 |
| Skill | `.agents/skills/<id>/SKILL.md` | `~/.gemini/antigravity-cli/skills/<id>/SKILL.md` |
| MCP | `.agents/mcp_config.json` | `~/.gemini/config/mcp_config.json` |
| Agent | `.agents/agents/<id>.md` | `~/.gemini/config/agents/<id>.md` |

공식 근거: [MCP](https://antigravity.google/docs/mcp), [Skills](https://antigravity.google/docs/skills), [Subagents](https://antigravity.google/docs/subagents), [Rules](https://antigravity.google/docs/rules/), [CLI 이관](https://antigravity.google/docs/cli/gcli-migration). 원격 MCP 주소 필드는 `serverUrl`이다.

작업:

1. 현재 전역 MCP 경로 `~/.gemini/antigravity-cli/mcp_config.json`을 최신 문서 경로와 구분한다. 구경로는 인벤토리·이관 후보로만 읽고, Kit 소유 여부/서버 ID 충돌을 확인한 계획으로 옮긴다. 미관리 구파일은 삭제하지 않는다.
2. 현재 미검증 Agent capability에 Markdown frontmatter 변환을 추가한다. 논리 도구를 실제 도구 이름에 바인딩하고 미지원/오탈자 이름을 배포 전에 차단한다.
3. CLI의 전역 Skill 경로는 현재 문서와 일치하므로 앱 경로로 일괄 교체하지 않는다.
4. `/mcp`의 로딩 상태 및 reload, `/skills`, Agent 목록/호출로 검증할 절차를 버전별 기록한다.

선행: C01과 같은 공통 정의를 두 번째 형식으로 렌더링할 수 있어야 함. 기대효과: 제품의 “한 번 정의” 원칙을 서로 다른 클라이언트 간에 입증.

완료: C01과 **동일한 논리 MCP·Skill·Agent 원본**에서 각각 올바른 출력이 만들어지고, CLI가 이를 실제 사용한다. 모델/권한의 불가능한 변환은 명시적 오류가 된다.

### C04. Antigravity 2.0 앱 — P0 검증 / 부담 중 / 자원별 조건부

공식 확인: Skill은 프로젝트 `.agents/skills`, 전역 `~/.gemini/config/skills`; 커스텀 Agent는 `.agents/agents`와 `~/.gemini/config/agents`. MCP는 앱 Settings의 설치·활성화·새로고침 UI가 문서화되어 있다. **이번에 확인한 MCP 페이지는 앱의 직접 파일 경로를 명시적으로 확정하지 않는다.** [Skills](https://antigravity.google/docs/skills) · [Subagents](https://antigravity.google/docs/subagents) · [MCP](https://antigravity.google/docs/mcp).

작업: `antigravity` CLI와 별도 surface를 만든다. Skill·Agent·지침부터 파일 배포를 검증한다. MCP는 공식 앱 파일/API 계약 또는 동등한 일차 근거와 실기를 확보한 뒤 자동 배포를 연다. 그 전에는 `manual` 작업으로 설정 화면 경로·원하는 비밀 없는 서버 정의·확인 기준을 제공한다. 내부 DB나 미문서 설정 파일을 수정하지 않는다.

선행: 앱 버전 식별, C03 공통 변환. 기대효과: 앱도 같은 원본을 사용하면서 CLI 전용 경로의 잘못된 배포 방지.

완료: Skill·Agent는 실제 앱 인식/사용 확인. MCP는 공식 자동화 계약+실기를 통과하거나, **수동 설정 필요**라는 정확한 상태로 출시한다. 수동 상태를 자동 중앙 배포 완료에 포함하지 않는다.

### C05. Antigravity IDE — P0 검증 / 부담 중 / MCP·Skill·지침 가능

MCP는 전역 `~/.gemini/config/mcp_config.json`, 프로젝트 `.agents/mcp_config.json`; Skill은 전역 `~/.gemini/config/skills`, 프로젝트 `.agents/skills`가 문서화되어 있다. 커스텀 Subagents 문서의 지원 표기는 2.0 앱·CLI이므로 IDE의 Agent 자동 배포 근거로 사용하지 않는다. [MCP](https://antigravity.google/docs/mcp) · [Skills](https://antigravity.google/docs/skills) · [Subagents](https://antigravity.google/docs/subagents).

작업: MCP·Skill·Rules만 활성 후보로 등록한다. C03/C04와 공유되는 파일에 소비자 정보를 연결한다. IDE Agent는 미확인으로 유지한다. 에디터 재로드·새 대화·다중 workspace에서 파일 범위를 확인한다.

선행: C03, 공유 경로 계획. 기대효과: CLI·앱·IDE 간 설정 충돌 방지.

완료: 에디터의 활성 MCP 도구와 Skill·지침 인식 확인. Agent 선택 시 조용히 무시하지 않고 미확인 이유를 표시한다.

### C06. Claude Code CLI — 전체 P1 후속 / 부담 중 / 실현 가능성 높음

프로젝트 공통 지침은 `AGENTS.md` 직접 읽기 또는 `CLAUDE.md` import로 배포하고, 개인 전역 지침은 `~/.claude/CLAUDE.md`를 사용한다. Skill `.claude/skills`/`~/.claude/skills`, Agent `.claude/agents/*.md`/`~/.claude/agents/*.md`, MCP 프로젝트 `.mcp.json`/사용자 `~/.claude.json`을 대상으로 한다. MCP local scope는 프로젝트별 `~/.claude.json` 항목이므로 settings.local.json과 혼동하지 않는다. [Skills](https://code.claude.com/docs/en/skills) · [Subagents](https://code.claude.com/docs/en/sub-agents) · [MCP](https://code.claude.com/docs/en/mcp).

현재 추가된 AGENTS.md capability는 버전·우선순위 제약이 필요하다. 공식 문서는 v2.1.277 이상, CLAUDE.md 유무·설정·세션에 따른 조건을 설명한다. **직접 읽기 조건을 충족하면 AGENTS.md만 배포하고, 허용된 호환 경로가 필요하면 CLAUDE.md에 `@AGENTS.md`를 추가한다.** 공통 본문을 복제하거나 전역 읽기 설정을 자동 변경하지 않는다. [지침 공식 문서](https://code.claude.com/docs/en/memory) · [후속 호환 구현·시험](shared-instructions-implementation-plan.md).

작업: HTTP의 type/url 등 네이티브 schema 변환, Agent frontmatter 변환, 프로젝트 MCP 승인 필요 상태, CLAUDE/AGENTS의 조건별 선택을 구현한다. 같은 kind/scope 첫 항목만 찾는 현재 resolver에 대체 capability 선택 규칙이 필요하다. 프로젝트 신뢰/승인 파일을 몰래 편집하지 않는다.

완료: `/mcp`·Skill·Agent 호출, 기존 사용자 MCP/설정 보존, CLAUDE.md가 있는/없는 프로젝트 및 구버전 제약 시험. Claude 앱의 Code 화면은 CLI 결과를 상속하지 않고 별도 surface 검증 후 추가한다.

### C07. Cursor 에디터·CLI — P1 / 부담 중 / 실현 가능성 높음

기본 출력은 Rules `.cursor/rules/*.mdc`, MCP `.cursor/mcp.json`/`~/.cursor/mcp.json`, Skill `.cursor/skills`/`~/.cursor/skills`, Agent `.cursor/agents/*.md`/`~/.cursor/agents/*.md`로 한다. 공용 `.agents/skills`도 문서화되어 있으나 기본 전용 경로를 유지하고 중복 로딩을 검사한다. CLI의 MCP 설정 공유와 에디터·CLI의 Subagent 지원이 문서화되어 있다. [Rules](https://cursor.com/docs/rules) · [Skills](https://cursor.com/docs/skills) · [MCP](https://cursor.com/docs/mcp) · [CLI MCP](https://cursor.com/docs/cli/mcp) · [Subagents](https://cursor.com/docs/subagents).

작업: 현재 미검증 Agent를 변환·실기 검증 대상으로 올린다. 에디터 실행 명령 `cursor`의 존재와 Agent CLI 설치를 구분한다. `.claude`·`.codex` 호환 경로를 함께 읽는 환경에서 같은 Agent/Skill의 중복·우선순위를 확인한다. 전역 User Rules는 지원 파일 계약이 확보되기 전 UI 작업으로 둔다. CLI 권한 파일을 에디터의 정책 파일로 간주하지 않는다.

완료: 에디터와 CLI에서 각각 MCP·Skill·Agent 인식/시험 호출, Rules 적용, CLI 전용 설정 보존. Cloud Agents/원격 세션에 로컬 전역 Skill이 자동 동기화됐다고 표시하지 않는다.

### C08. VS Code + GitHub Copilot — P2 / 부담 중~높음 / 로컬 workspace 우선

| 자원 | 첫 자동 배포 범위 |
|---|---|
| 지침 | `.github/copilot-instructions.md` — 구현 시 전용 지침 공식 계약 재확인 |
| Skill | `.github/skills/<id>/SKILL.md` |
| Agent | `.github/agents/<id>.agent.md` |
| MCP | `.vscode/mcp.json`, 최상위 `servers` 계약 |

현재 정의의 Skill·Agent unsupported는 최신 지원 문서와 다르며 MCP도 정의에 빠져 있다. [Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills) · [Agents](https://code.visualstudio.com/docs/agent-customization/custom-agents) · [MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

작업: VS Code MCP 전용 변환과 JSONC 보존 시험, Skill·Agent 출력, workspace trust 상태를 추가한다. 최초 범위는 로컬 workspace다. 전역 MCP는 사용자 프로필의 `mcp.json`이므로 `~/.vscode` 아래로 추정하지 않는다. VS Code 버전·Copilot 실행 모드(Local/Agent Host)·프로필·remote host를 대상 identity로 기록한다. 전역 Skill/Agent는 공식 `~/.copilot/skills`·`~/.copilot/agents` 경로를 후속 검증한다.

완료: MCP 목록/연결, Skill 선택, Agent 선택 및 시험 호출을 로컬 모드에서 확인. 주석·기존 extension 설정 보존. Agent Host·SSH·WSL·Container·Copilot CLI는 각각 후속 검증하며 VS Code 결과로 지원을 추론하지 않는다.

### C09. Claude Desktop 일반 채팅 — P2 / 부담 중 / 로컬 MCP 우선

현재 Kit의 macOS 출력은 `~/Library/Application Support/Claude/claude_desktop_config.json`이다. 이 파일의 로컬 MCP와 계정 기반 원격 커넥터는 다른 경로다. 공식 지원 문서는 로컬 확장 `.mcpb` 배포도 안내한다. [로컬 MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) · [원격 커넥터](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

작업: 기존 config의 Kit 소유 stdio 서버 병합·상태 확인을 첫 범위로 잡고 대상 버전에서 파일 위치/로딩을 재검증한다. 확장은 후속 패키징 어댑터 후보로 둔다. 계정 커넥터 인증은 수동 단계로 표시한다. Skill·Agent·지침을 Claude Code 경로에 써서 Desktop 적용으로 보고하지 않는다. Cowork/Code/일반 채팅은 별도 surface다.

완료: 일반 채팅에서 시험 로컬 MCP가 연결되고 비밀 없는 읽기 호출이 확인됨. 연결 종료·갱신·제거 후 재시작 상태 검증. 원격 커넥터의 실행 출발점은 단말이 아니므로 데몬 기기 결합 완료로 표시하지 않음.

### C10. Windsurf 기존 정의 / 현재 Cascade 제품 — P2 조사 / 부담 중~높음

현재 저장소는 `.windsurf`·`~/.codeium/windsurf` 경로다. 이번 조회에서 기존 공식 문서가 Devin Desktop/Cascade 문서로 이동했다. 최신 문서는 Skill `.devin/skills`와 기존 `.windsurf/skills` 호환, MCP `~/.config/devin/mcp_config.json`(macOS/Linux 기본), Workflow `.devin/workflows`와 기존 경로 호환을 설명한다. [Skills](https://docs.devin.ai/desktop/cascade/skills) · [MCP](https://docs.devin.ai/desktop/cascade/mcp) · [Workflows](https://docs.devin.ai/desktop/cascade/workflows).

작업: 실제 설치 제품·버전·Cascade/다른 agent를 먼저 식별한다. 기존 Windsurf 프로필과 현재 제품 프로필을 자동 치환하지 않는다. 구/신 경로를 탐지하되 한쪽으로 이관하는 계획과 충돌·백업을 제공한다. 커스텀 Agent는 이번 근거로 확정되지 않아 미확인 유지. Workflow는 네이티브 지침 자원으로 관리하고 일반 agent loop와 동등시하지 않는다.

완료: 검증한 제품 프로필에서 MCP·Skill·Workflow 인식, 구경로 보존/이관·이름 중복·롤백 시험. 미검증 설치는 현재 문서의 새 경로에 자동 쓰지 않는다.

## 5. 구현 순서와 데몬 연결

아래는 기존 LM4의 세부 작업이다. CA01 대상 계약·지원 판정의 자동 검증은 [완료 기록](../reconstruction/phase-ca01-client-profiles.md)을 따르며, 클라이언트 실기와 중앙 배포 완료 체크는 비어 있다. LM1~LM3를 다시 시작하지 않는다. 부담은 상대적인 구현·검증 비용이고 일정 약속이 아니다.

| 단계 | 작업·산출물 | 선행 | 기대효과 | 부담 | 완료 게이트 |
|---|---|---|---|---|---|
| LM4-0A | surface/configStore·증거·버전·상태 계약, 현 정의 감사, 지원 문서 정합화 | 이 계획 | 과장된 지원과 잘못된 대상 방지 | 중 | CLI/GUI가 같은 지원 판정 사용, 모호한 대상을 막음 |
| LM4-0B | MCP·Agent 공통 스키마/변환 계약, targets 선택, source 호환 전환 | 0A | 한 원본의 다중 클라이언트 배포 | 중~높음 | 같은 원본→Codex/AGY 서로 다른 유효 출력, 표현 불가능한 권한 거부 |
| LM4-0C | 물리 경로 소유권·공유·제거·원장 전환·지속 가능한 계획 산출물 | 0B | 업데이트·제거·중앙 재전송의 일관성 | 높음 | 중복 경로/교차 rollback/외부 수정/실패 복구 시험 |
| LM4-1A | C01 Codex CLI + C03 Antigravity CLI의 지침·Skill·Agent·MCP | 0C | 같은 원본으로 두 제품의 전체 자원 배포 입증 | 중 | 각 4자원의 로딩·사용·갱신·제거·롤백 실기 |
| LM4-1B | C02 Codex 앱 + C04 AGY 앱 + C05 IDE | 1A | 사용자 주요 앱까지 확장 | 중 | surface별 검증, AGY 앱 MCP 미확인 시 수동 경계 명시 |
| LM4-2 | 서명 배포 묶음·prepare/apply/result 계약 및 fixture | 0C, LM3 계약 | 중앙 승인과 실제 로컬 계획 결합 | 높음 | 양쪽 검증기의 공통 성공·실패 fixture 통과 |
| LM4-3 | Gateway 발행/승인/보관·데몬 수신·고정 적용 어댑터·결과 | 2, 1A | 승인 자원을 등록 단말에 배포 | 높음 | 실제 IAM→Gateway→데몬→파일→결과 E2E |
| LM4-4 | 로컬/중앙 UI 통합, 상태 대조, 갱신·회수·재시작 복구 | 3, 1B의 지원 항목 | 운영자가 원하는/관측 상태를 비교 | 중~높음 | 두 단말에서 부분 실패·stale·중복·rollback 구분 |
| 확장 | C06 Claude Code 전체 → C07 Cursor → C08 VS Code → C09/C10 | Codex·Antigravity 첫 묶음 완료와 각 선행 | 지원 클라이언트 확대 | 각 절 참조 | 첫 묶음·LM5의 선행 조건에 넣지 않고 개별 공개 |
| LM5 | 설치·업데이트·운영 파일럿 | LM4 지원 묶음 | 실제 배포와 지원 | 높음 | 기존 LM5 설치·장애·운영 게이트 충족 |

첫 구현 단위는 **LM4-0A**다. C01/C03을 첫 참조 대상으로 계약·증거를 고정하고 현재 정의의 잘못된 경로·미확인 자동 적용을 정리한다. 그다음 0B에서 한 시험 MCP를 TOML/JSON으로 변환하여 적용하는 최소 경로부터 완성한다. 전체 UI 재설계나 자체 runtime 구현을 선행시키지 않는다.

세부 순서는 **CA01 대상 계약 → CA02 두 제품 변환 → CA03 안전 적용 → CA04 두 CLI 실기 → CA05 앱·IDE 실기 → CA06 데몬 배포**다. 지침 하나나 다른 제품의 호환 기능이 첫 구현을 대표하지 않는다. [작업별 수정 지점·완료 기준](codex-antigravity-implementation-plan.md#4-구현-작업-순서).

### 5.1 중앙 배포 계약의 구체적 범위

작업 종류 이름은 계약 단계에서 정한다. 아래 prepare/apply/rollback은 의미상의 제안이며 기존 job v1에 이미 존재하는 operation이 아니다.

1. 중앙에서 공통 원본·부속 파일·클라이언트 정의/어댑터 버전을 고정한 불변 묶음을 만든다. 서명·해시·크기 제한·허용 파일 유형·압축 해제 경계·실행 파일 권한을 검증한다. 전달은 고정된 인증 Gateway artifact 경로를 사용하고 임의 다운로드 URL을 작업에 넣지 않는다.
2. 인증된 prepare 작업이 기기/사용자/workspace 논리 ID와 승인된 묶음을 지정한다. 로컬 등록 정보가 실제 경로를 해석한다. 단말에서 기존 Kit 계획 서비스를 사용해 사용자 파일·정책·지원 버전과 대조한다.
3. 로컬 계획 digest는 묶음·변환기·대상 프로필·기대 파일 해시·소유권/상태 버전·변경 단위를 결합한다. 중앙에는 관리 자원의 변경 요약과 해시를 보고하고 사용자 파일 원문/토큰은 기본 전송하지 않는다.
4. 중앙 승인은 해당 기기의 구체적인 계획 digest에 결합한다. 승인 후 변경된 파일/정책/버전은 적용을 거부하고 다시 계획한다. 수신 확인만으로 승인/성공으로 처리하지 않는다.
5. 데몬은 기존 기기 바인딩·만료·서명·중복 방지 검증 후 고정 설치된 적용 어댑터를 실행한다. 보호된 작업 기록/CAS와 파일 트랜잭션의 복구 순서를 명시한다. 일반 GUI 서버를 관리자 권한으로 실행하지 않는다.
6. JS Kit 서비스를 재사용하는 고정 배포 helper는 대상 사용자 권한에서 실행하고, 검증된 버전/입력/산출물만 받는다. 데몬은 인증·승인·대상 허용 범위를 독립 검사한다. 보호된 시스템 설정 쓰기는 별도 좁은 인터페이스로 분리한다. 허용 명령/스크립트 문자열을 job에서 받지 않는다.
7. 적용 뒤 구문/해시/상태를 검증하고 결과를 영속 저장한다. 클라이언트 미실행·인증 미완료·새로고침 필요는 별도 결과다. 실제 사용 검증은 지정 시험 절차로 수집한다.
8. rollback은 이전 버전 자원을 새 승인 revision의 작업으로 복원한다. 오래된 서명 정책을 재생하지 않는다. 관리 파일 제거와 실행 중 native worker 회수는 서로 다른 작업·결과다.

현재 `planId`는 프로세스 메모리의 Map, merge 산출물은 WeakMap에 보관된다. 이를 그대로 Gateway/데몬에 넘길 수 없다. 계획 내용·해시·버전·복구 기록의 지속 가능한 계약을 만들고, 로컬 planId는 로컬 세션 인터페이스로 유지한다.

중앙 여러 단말을 하나의 원자적 트랜잭션으로 약속하지 않는다. 단말 내부 적용과 중앙 롤아웃을 분리하고 시험 단말 → 소규모 집합 → 나머지 순서로 진행한다. 실패 단말 중단/재계획과 이미 성공한 단말의 승인된 보상 rollback을 지원한다.

LM4 초기 범위는 지침·Skill·Agent·MCP 연결 설정과 **이미 검증된 실행물 참조**다. MCP 실행 파일/의존성 신규 설치·업데이트는 버전/해시·OS 패키징·격리 시험을 추가한 별도 LM4 하위 작업으로 둔다. 설정에 command를 썼다는 이유로 실행물 설치 완료로 보고하지 않는다.

## 6. 완료 증거와 회귀 시험

| 시험 | 필수 증거 |
|---|---|
| 정의·구문 | 공식 예제 기반 fixture, 잘못된 schema·transport·frontmatter·권한·도구명 거부 |
| 공통 원본 | 같은 논리 자산에서 두 클라이언트의 서로 다른 유효 출력, 손실된 의미 없음 |
| 최초 배포 | 기존 사용자 설정 옆에 Kit 소유 자원만 추가, 명령 인수·환경 설정·결과에 비밀 노출 없음 |
| 실제 로딩 | OS/제품/surface/버전/설정 루트/시각과 클라이언트 목록·관측 로그 |
| 실제 사용 | Skill 부속 파일의 시험 표식 사용, Agent 별도 세션/역할 관측, MCP initialize/tools/list/읽기 호출 |
| 갱신·제거 | 새 버전만 반영, 제거된 Kit 파일/키 정리, 다른 소비자와 사용자 내용 보존 |
| 충돌·승인 | 외부 수정, 미신뢰 프로젝트, 로그인 필요, 동명 자원, 지원 불명 버전 분리 |
| 공유 저장소 | Codex CLI/앱, `.agents/skills`, AGY 공용 파일의 중복 배포/rollback 영향 검증 |
| 복구 | 중간 쓰기 실패·원장 저장 실패·helper/데몬 재시작 후 실제 파일과 일치 |
| 중앙 관리 | 잘못된 tenant/device·서명·hash·만료·재생·같은 ID 다른 내용·stale 계획 모두 거부 |
| 실효 범위 | 파일 삭제 뒤 기존 세션 상태와 새 세션 상태 구별. 실행 강제/전체 PC 통제로 확대하지 않음 |

지침/Skill 적용 여부는 단순 모델 자기 보고로 대체하지 않는다. 동일한 내용을 다른 경로에서 읽는 오탐을 막기 위해 시험마다 고유한 자원 이름·표식·빈 프로필을 사용한다. 권한 거부는 실제 도구 실행 실패로 증명해야 한다.

개발 회귀는 변경 영역의 `node --test`, GUI API/컴포넌트 시험을 먼저 실행한다. 해당 단계의 런타임·GUI 변경을 완료할 때 저장소 필수 통합 검사와 실기 시험을 실행한다. 문서 변경만으로 기존 테스트를 반복해 클라이언트 지원 증거를 만들지 않는다.

증거 산출물에는 문서 URL·확인일, 실행 환경·버전, 자산/출력 해시, 성공/실패/미확인, 재현 명령/화면 절차, 예상·관측 결과를 넣는다. 계정 토큰·개인 설정 원문은 넣지 않는다. 지원 선언과 `SUPPORT.md`·capability audit·GUI 표시·추적성 문서를 같은 단계에서 갱신한다.

## 7. 첫 배포 묶음의 합격 조건

- [ ] C01/C03: 공통 지침·Skill·Agent·MCP 원본에서 변환·배포·로딩·사용·갱신·제거·롤백 확인.
- [ ] C02: 같은 설정 저장소에 대한 Codex 앱 실기 확인.
- [ ] C04/C05: 문서상 가능한 자원 실기 확인, 자동화 계약이 없는 항목은 수동/미확인으로 정확히 표시.
- [ ] 개인 Kit 사용은 데몬/중앙 서버 없이 계속 가능.
- [ ] 중앙 배포는 IAM/Gateway/데몬의 실제 채널을 통해 두 시험 단말에서 확인.
- [ ] 파일 적용, 클라이언트 인식, 인증/새로고침, 최근 관측, 실행 회수가 혼동되지 않음.
- [ ] 사용자 소유 설정·공유 경로·비밀 참조·실패 복구 시험 통과.
- [ ] 지원 표시는 시험한 OS·surface·버전·자원 조합만 포함.

위 조건을 통과하면 “주요 클라이언트의 파일 기반 자원을 공통 원본으로 관리하고 승인된 단말에 배포한다”고 말할 수 있다. 모든 클라이언트의 동일한 기능, 이미 진행 중인 대화의 지침 회수, 임의 로컬 도구/직접 API 호출의 전면 통제는 이 완료 조건에 포함되지 않는다.
