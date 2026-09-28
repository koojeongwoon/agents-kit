# Codex·Antigravity 우선 구현 계획

작성: 2026-09-27. 상태: **CA01, CA02-1~3 공통 자원 변환·검증, CA03-1 프로젝트 공유 수명주기, CA03-2 전역 원장·명시적 소유권 이관, CA03-3 typed Agent/MCP 제거, CA03-4 일반 파일 저장 계획·검토 중단 복구 완료. CA04-1 CLI 부분 인식과 CA04-2 프로젝트 모델 사용 증거 확보. CA04-3 승인 차단 식별, CA04-4 승인된 Antigravity 프로젝트 stdio MCP 실제 사용 검증. CA04-5 Agent 부분 증거, CA04-6 Codex child 완료·전역 Skill 검증 및 Antigravity CLI Skill 경로 교정 완료. CA04-7 검증된 CLI 9개 자원 범위 활성화, CA04-8 Kit 브라우저 GUI 흐름 검증 완료. CA04 전체·앱/IDE·데몬 자원 배포는 미완료**.

상위 계획: [클라이언트별 자원 관리·중앙 배포](client-resource-management-plan.md). 공식 문서 확인 결과와 현재 소스의 차이를 기준으로 실행 순서를 구체화한다. 기존 LM1~LM3 완료 기록은 유지한다.

## 1. 제품 목표와 우선순위

**한 Manifest에 지침·Skill·Agent·MCP를 정의하고, Codex와 Antigravity의 CLI 및 앱에서 사용한다.** 개인 로컬 관리부터 완성하고 같은 배포 서비스를 데몬의 승인된 작업에 연결한다.

- P0 구현: Codex CLI·데스크톱 로컬 작업, Antigravity CLI·2.0 앱. 네 자원 모두 계획·변환·배포·갱신·제거·롤백 대상으로 다룬다. 자동화 근거가 없는 개별 기능은 미확인/수동으로 남긴다.
- P0 검증: Antigravity IDE의 지침·Skill·MCP 및 CLI/앱과 공유하는 저장소. IDE Agent는 공식 지원 근거와 실기 확보 전 자동 적용하지 않는다.
- P1 후속: Claude Code의 지침 호환을 포함한 전체 자원, Cursor 등. 이들의 완료를 P0나 데몬 배포의 선행 조건에 넣지 않는다.

공통 모델의 첫 예제·변환 fixture·GUI 기본 선택·실기 보고서는 Codex와 Antigravity를 사용한다. Claude import나 Claude 전용 Agent 형식을 공통 모델의 기준으로 삼지 않는다. 기존 타 클라이언트 기능의 호환성은 보존한다.

## 2. 클라이언트별 배포 계약

경로는 기본 로컬 프로필 기준이다. 아래는 공식 문서에 따른 목표 계약이며 현재 Kit에서 실기 지원을 완료했다는 뜻이 아니다. 실제 홈·프로젝트·실행 호스트·버전은 대상별로 확인한다.

| 대상 | 지침 | Skill | 커스텀 Agent | MCP |
|---|---|---|---|---|
| Codex CLI | 프로젝트 `AGENTS.md`, 전역 `$CODEX_HOME/AGENTS.md` | 프로젝트 `.agents/skills`, 전역 `~/.agents/skills` | 프로젝트 `.codex/agents/*.toml`, 전역 `$CODEX_HOME/agents/*.toml` | 프로젝트 `.codex/config.toml`, 전역 `$CODEX_HOME/config.toml` |
| Codex 앱의 로컬 작업 | CLI와 같은 파일 원본, 작업 경로별 로딩 확인 | 공유 경로, 앱 인식 별도 검증 | 같은 TOML 출력, 앱 인식·실행 별도 검증 | 같은 호스트/홈의 설정 공유, 앱 인증·환경 별도 검증 |
| Antigravity CLI | 프로젝트 `AGENTS.md`, 전역 `~/.gemini/GEMINI.md`를 기본 출력으로 선택 | 프로젝트 `.agents/skills`, 전역 `~/.gemini/config/skills` (CLI 1.2.12 실기 교정) | 프로젝트 `.agents/agents/*.md`, 전역 `~/.gemini/config/agents/*.md` | 프로젝트 `.agents/mcp_config.json`, 전역 `~/.gemini/config/mcp_config.json` |
| Antigravity 2.0 앱 | 공식 Rules 로딩 범위에 맞춰 공통 지침 적용 | 프로젝트 `.agents/skills`, 전역 `~/.gemini/config/skills` | CLI와 같은 Agent 경로, 앱에서 별도 검증 | 문서의 설정 UI로 수동 연결. 파일/API 자동화 계약 확보 후 활성화 |
| Antigravity IDE | 공식 Rules 로딩 범위에 맞춰 적용 | 프로젝트 `.agents/skills`, 전역 `~/.gemini/config/skills` | 미확인으로 차단 | CLI와 같은 공식 JSON 경로, IDE에서 별도 검증 |

`CODEX_HOME` 기본값은 `~/.codex`다. Codex 프로젝트 설정의 신뢰 조건, AGENTS.override.md와 상위 지침의 우선순위를 평가한다. Antigravity의 AGENTS.md/GEMINI.md/Rules가 누적되는 범위는 별도로 평가한다. 같은 본문을 배포해도 두 제품의 모든 로딩 의미가 같다고 보장하지 않는다.

공식 근거:

- Codex: [지침](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Skills](https://learn.chatgpt.com/docs/build-skills), [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [MCP](https://learn.chatgpt.com/docs/extend/mcp).
- Antigravity: [Rules](https://antigravity.google/docs/rules/), [Skills](https://antigravity.google/docs/skills), [Subagents](https://antigravity.google/docs/subagents), [MCP](https://antigravity.google/docs/mcp), [CLI 이관](https://antigravity.google/docs/cli/gcli-migration).

Antigravity 앱 MCP의 파일 경로와 IDE Agent 지원은 이번 공식 문서 확인만으로 확정되지 않았다. CLI 지원 사실을 이 두 항목에 복사하지 않는다. 문서 근거와 특정 설치 버전의 실기 증거를 따로 기록한다.

## 3. 구현할 공통 흐름

```text
Manifest: instructions / skills / agents / mcpServers
  → 대상 선택·의존성·논리 도구·권한 검증
  → Codex adapter / Antigravity adapter
  → 산출물·공유 소비자·변경 내용·후속 작업이 포함된 Deployment Plan
  → 사용자 파일 대조·소유권·백업·적용·검증·롤백
  → CLI/앱별 인식·사용 증거
```

지침은 공통 AGENTS.md 본문, Skill은 SKILL.md와 부속 파일을 원본으로 삼는다. 기존 사용자 파일은 명시적으로 등록하거나 Kit 소유 블록만 관리한다. 파일이 있다는 이유로 Kit 소유권을 얻지 않는다.

MCP는 공통 transport·endpoint/실행물 참조·args·인증 참조를 각각 Codex `mcp_servers` TOML과 Antigravity `mcpServers` JSON으로 변환한다. Antigravity 원격 주소 필드는 `serverUrl`로 출력한다. inline MCP도 source 파일 없이 렌더링할 수 있어야 한다. 새 MCP 실행물 설치는 초기 범위 밖이며 이미 검증된 실행물/endpoint를 사용한다.

Agent는 공통 역할·설명·본문·논리 Skill/Tool 요구에서 Codex TOML과 Antigravity Markdown frontmatter를 각각 만든다. 모델·도구명·권한의 바인딩은 어댑터에서 검증한다. 표현 불가능한 필수 제한은 거부하고, 본문에 적는 것으로 대체하지 않는다. AGENTS.md 지침과 커스텀 Agent는 별개 자원이다.

동일 프로젝트의 AGENTS.md와 `.agents/skills`는 한 번만 쓰고 소비 클라이언트 집합을 기록한다. 한 클라이언트만 제거해도 다른 소비자가 있으면 파일을 보존한다. 같은 경로에 서로 다른 내용이 요구되면 계획을 차단한다. 선택하지 않은 클라이언트에도 공유 경로가 노출되는 경우 계획에 표시한다.

개인 CLI·GUI는 같은 application service를 사용한다. 데몬이 없어도 동작한다. 이후 데몬도 고정 배포 helper를 통해 이 서비스를 재사용하며 임의 명령 실행이나 별도의 변환 구현을 추가하지 않는다.

## 4. 구현 작업 순서

단계는 LM4의 세부 작업이다. 부담은 상대적인 비용이며 일정 약속이 아니다. 첫 수정 대상은 **CA01**이고 이후 단계의 완료 증거를 미리 성공으로 표시하지 않는다.

| 작업 | 범위·수정 지점 | 선행 | 이점 / 부담 | 완료 기준 |
|---|---|---|---|---|
| CA01 / LM4-0A | `clients/codex.yaml`, `clients/antigravity.yaml`, client-definition, 설치 탐지: surface/configStore/버전/문서·실기 상태 계약 | 현재 계획 | 잘못된 경로·지원 추정 방지 / 중 | 두 제품의 CLI·앱·IDE 지원표와 계약 fixture. 기존 clientId 호환. 버전 불명·미문서 자동 적용 거부 |
| CA02 / LM4-0B | Manifest의 versioned typed asset 계약, targets 선택, 논리 참조 해결, 두 제품 adapter와 순수 렌더링 | CA01 | 같은 원본으로 두 네이티브 형식 생성 / 중~높음 | 같은 네 자원 fixture에서 유효 출력. 누락 참조·scope 위반·정책 거부·순환·변환 손실 거부. v1 source 호환 |
| CA03 / LM4-0C | prepare/copy/merge/apply/rollback: 렌더링 연결, 공유 원장, 소유 필드 제거, 이관, 지속 가능한 계획·digest | CA02 | 안전한 갱신·제거와 데몬 재사용 / 높음 | 두 제품 동시 선택·멱등 적용·외부 수정 거부·사용자 본문 보존·교차 rollback·중간 실패 복구 |
| CA04 / LM4-1A | 두 CLI의 진단 및 실기. CLI/GUI에 같은 diff와 검증 상태 노출 | CA03 | 완전한 자원 배포의 첫 실증 / 중 | Codex CLI와 Antigravity CLI 각각 지침·Skill·Agent·MCP 인식/사용/갱신/제거/롤백 |
| CA05 / LM4-1B | Codex 앱, Antigravity 앱·IDE의 설치/실행 환경·reload·인증·공유 경로 검증 | CA04 | 사용자의 실제 앱까지 지원 / 중 | surface별 증거. CLI 성공을 앱 성공으로 복사하지 않음. 앱 MCP/IDE Agent의 미확인 경계 표시 |
| CA06 / LM4-2~4 | 불변 자원 묶음, Gateway 승인, 데몬 prepare/apply/result, UI 결과 대조 | CA03 계약, CA04 로컬 동작. 최종 게이트는 CA05 지원 항목 포함 | 로컬 기능을 중앙 관리로 연결 / 높음 | 실제 IAM→Gateway→데몬→두 제품 파일→클라이언트 인식→결과 보고. 두 단말 부분 실패·재시작·rollback |

CA02의 첫 작은 구현은 **같은 시험 MCP 원본 → Codex TOML + Antigravity JSON → 두 대상의 dry-run diff**다. 이를 CA03의 기존 안전 적용 경로에 연결한 뒤 지침·Skill·Agent를 완성한다. MCP 한 종류가 성공했다고 CA04 전체를 완료하지 않는다.

CA01에서 특히 바로잡을 현재 차이:

1. Codex Agent의 현재 config.toml 섹션 출력과 공식 개별 `.codex/agents/*.toml` 계약을 구분한다. 기존 Kit 소유 섹션만 명시적 이관 계획으로 처리한다.
2. Antigravity 전역 MCP의 현재 `~/.gemini/antigravity-cli/mcp_config.json`과 공식 `~/.gemini/config/mcp_config.json`을 구분한다. 미관리 구파일을 자동 삭제하지 않는다.
3. Antigravity CLI의 전역 Skill 경로는 유지하고 앱/IDE의 전역 Skill 경로를 별도 정의한다.
4. 현재 family 단위 지원 표기를 실행 화면별 판정으로 확장한다. 문서상 지원, 설치 탐지, 실제 로딩 검증을 혼합하지 않는다.

CA02~CA03의 주요 연결 지점은 [계획 서비스](../../lib/application/plan-client-deployment.js), [공유 배포 서비스](../../lib/application/manifest-deployment-service.js), [merge 준비](../../lib/application/prepare-merge-deployment.js), [copy 준비](../../lib/application/prepare-copy-deployment.js), [적용](../../lib/application/apply-deployment.js)이다. client-specific 변환은 어댑터로 분리하고 CLI·GUI 라우트에 넣지 않는다.

## 5. 검증과 출시 기준

| 검증 범위 | 필수 결과 |
|---|---|
| 같은 원본 | 동일한 자산 ID의 지침·Skill·Agent·MCP에서 두 제품의 출력과 논리 참조가 일치 |
| 두 CLI | 지침 로딩 증거, Skill 부속 파일 사용, Agent 별도 실행, 시험 MCP 목록/읽기 호출 |
| Codex 앱 | 터미널 밖에서 실행한 앱의 실제 인식·인증, 새 작업/worktree 범위, CLI와 공유 갱신·복구 |
| Antigravity 앱·IDE | 공식 지원 자원의 실제 인식. 앱 MCP 수동 설정은 자동 배포 완료에 포함하지 않음 |
| 공유·제거 | Codex만 제거/Antigravity만 제거/마지막 소비자 제거, 사용자 파일·다른 소비자 보존 |
| 실패·복구 | stale 계획, 원장 저장 실패, 중간 쓰기 실패, 프로세스 중단 후 실제 파일 재대조 |
| 비밀·권한 | 토큰 없는 원본/출력/로그, 안전한 인증 참조, 표현 불가능한 제한 거부 |
| 데몬 | 승인 digest와 실제 적용 일치, 서명·대상·만료·재생 검사, 부분 실패·재시작 후 일관된 결과 |

모델의 “읽었다”는 답변만으로 검증하지 않는다. 격리된 홈/프로젝트와 고유 시험 표식, 버전별 목록·시작 로그·도구 호출 관측을 함께 사용한다. 사용자 현재 설정을 실기 시험용으로 바꾸지 않는다. 파일 제거가 기존 대화의 지침이나 진행 중 호출까지 회수한다는 보장도 하지 않는다.

CLI·GUI는 `파일 적용됨`, `승인/로그인/reload 필요`, `클라이언트 인식 확인`, `사용 확인`, `미확인/차단`을 구별한다. 기존 validate 기본 성공을 클라이언트 인식 성공으로 표시하지 않는다. 지원 선언은 시험한 OS·surface·버전·자원 조합에 한정하고 SUPPORT·capability audit·추적성 문서를 함께 갱신한다.

**첫 로컬 출시 게이트는 CA01~CA05, 중앙 배포 게이트는 CA06**이다. Antigravity 앱 MCP처럼 자동 연동이 확인되지 않은 항목은 제외 내역을 명시한 부분 지원으로 출시하며, 전체 자원 자동 배포가 끝났다고 표현하지 않는다. Claude 후속 작업은 두 게이트의 조건이 아니다.

CA01 결과는 [구현·검증 기록](../reconstruction/phase-ca01-client-profiles.md)과 [ClientDefinition v2 계약](../contracts/client-definition-v2.md)을 따른다. 실제 클라이언트 설정과 데몬 작업 종류는 변경하지 않았다. CA02-1 MCP 변환 결과는 [구현·검증 기록](../reconstruction/phase-ca02-1-mcp-rendering.md), CA02-2 대상 선택·최소 공통 Agent 변환은 [별도 기록](../reconstruction/phase-ca02-2-targets-and-agents.md)을 따른다. CA02-3의 공통 지침·Skill 검사 및 확인된 Codex Agent 설정 연결은 [검증 기록](../reconstruction/phase-ca02-3-common-assets.md)을 따른다.

CA03-1의 프로젝트 공유 소비자·공동 갱신·제거·rollback은 [구현·검증 기록](../reconstruction/phase-ca03-1-shared-project-resources.md)과 [공유 소유권 계약](../contracts/shared-project-ownership-v1.md)을 따른다. CA03-2 전역 통합 원장·명시적 소유권 이관은 [구현·검증 기록](../reconstruction/phase-ca03-2-global-ledger-migration.md)을 따른다. CA03-3 typed Agent/MCP 제거는 [구현·검증 기록](../reconstruction/phase-ca03-3-typed-resource-removal.md)을 따른다. CA03-4 저장 계획·digest·검토 중단 복구는 [구현·검증 기록](../reconstruction/phase-ca03-4-persistent-deployment.md)을 따른다. CA04-1의 설치본 CLI 부분 인식 결과는 [실기 기록](../reconstruction/phase-ca04-1-cli-recognition.md)을 따른다. CA04-2는 기존 native 로그인을 유지하고 임시 프로젝트로 실제 모델 사용을 검증한다. 재로그인이나 전용 인증 프로필은 필수가 아니다. [실기 기록](../reconstruction/phase-ca04-2-cli-model-use.md)을 따르며 커스텀 Agent 실행은 별도 검증한다. Kit 식별자가 없는 legacy Agent/MCP 이관과 link/다중 원장 중단 복구는 별도 확장으로 남아 있다. 강제 권한·Skill preload·Antigravity 고급 도구 mapping은 미확인 경계를 유지하며 별도 확장한다.

Antigravity MCP의 후속 차단 원인과 제한된 설정 변경안은 [CA04-3 기록](../reconstruction/phase-ca04-3-antigravity-mcp-permission.md)을 따른다.

사용자가 승인한 임시 권한으로 수행한 Antigravity MCP 검증과 설정 원복은 [CA04-4 기록](../reconstruction/phase-ca04-4-antigravity-mcp-use.md)을 따른다. [CA04-5](../reconstruction/phase-ca04-5-cli-agent-use.md)는 Agent 표식 응답 수명주기와 Antigravity 역할 호출을 확인했다. [CA04-6](../reconstruction/phase-ca04-6-agent-completion-global-skills.md)에서 Codex child 완료 결과와 두 CLI 전역 Skill 사용을 확인했다. Antigravity child 직접 완료, 전역 Agent/지침/MCP 및 앱/IDE는 아직 미확인이다.


CA04-7은 [검증된 CLI 지원 활성화](../reconstruction/phase-ca04-7-cli-activation.md)를
구현했다. 검증된 네이티브 실행 파일의 SHA-256을 계획·적용에서 확인하고, stdio MCP와
기본 Agent 역할만 제한적으로 허용한다. CA04-8에서 Kit 브라우저 GUI의 실제 화면을 통한
선택→미리보기→적용→제거·복원을 검증했다. HTTP 경로 테스트를 실제 화면
검증이나 Codex/Antigravity 앱 지원으로 간주하지 않는다.

[CA04-8 GUI 검증](../reconstruction/phase-ca04-8-gui-workflow.md) 이후의 다음 구현은 검증된 CLI 자원 묶음의 불변 배포 계약과 데몬 연결이다. 앱/IDE 자원 지원 검증(CA05)은 CLI 증거를 재사용하지 않고 별도로 진행한다.

CA06-1에서 [불변 자원 묶음과 Kit 측 prepare/apply helper](../reconstruction/phase-ca06-1-resource-bundle.md)를 구현했다.
기존 공통 배포 서비스와 저장 계획을 재사용하며 로컬 binding, 묶음/계획 digest,
MCP 허용 정의 및 실행 파일을 확인한다. **Gateway 서명 배포 작업 발급과 실제 데몬
수신·사용자 helper 실행 연결은 CA06-2로 남아 있으며 CA06 전체는 미완료**다.
