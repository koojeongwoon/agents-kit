# Shared Conversation Requirements Traceability

## Purpose

This register converts the shared design conversation into reviewable product
requirements. A requirement is complete only when its design, implementation,
tests, and user surface are linked here.

## Product and architecture

| ID | Requirement | Design owner | Initial status |
|---|---|---|---|
| AK-P01 | Manage client-neutral agent assets | Product definition, ADR-002 | Implemented |
| AK-P02 | Separate Configuration Plane from optional Runtime | ADR-001 | Designed |
| AK-P03 | Start from the Manifest contract without directory compatibility inference | Product reset | Implemented |
| AK-P04 | Keep client path and capability data outside control-flow branches | ADR-003 | Implemented for Codex and Claude Code |
| AK-P05 | Support global and project scopes | Asset model | Implemented |
| AK-P06 | Keep CLI and GUI behavior aligned | ADR-006 | Implemented through shared service |

## Asset coverage

| ID | Requirement | Model | Initial status |
|---|---|---|---|
| AK-A01 | Instructions and Rules | `InstructionDefinition` | Designed |
| AK-A02 | Skills | `SkillDefinition` | Designed |
| AK-A03 | Agents | `AgentDefinition` | Designed |
| AK-A04 | MCP Servers | `McpServerDefinition` | Designed |
| AK-A05 | Memory configuration | `MemoryDefinition` | Designed |
| AK-A06 | Policies | `PolicyDefinition` | Designed |
| AK-A07 | Hooks | `HookDefinition` | Designed |
| AK-A08 | Workflows and Loops | `WorkflowDefinition` | Designed |
| AK-A09 | Client-specific settings | namespaced client options | Designed |
| AK-A10 | Typed stable references between assets | `AssetReference` | Core implemented |
| AK-A11 | Skill and Agent logical Tool requirements | `ToolRequirement` | Core implemented |
| AK-A12 | MCP definitions declare provided Tools | `ToolProvider` | Core implemented |
| AK-A13 | Agent references Skills, Policies, Tools, and Memory | Resource reference model | Core implemented and tested |
| AK-A14 | Workflow steps reference Agent, Skill, or Tool | `WorkflowStepReference` | Implemented and tested |
| AK-A15 | Memory declares readers, writers, and approval | `MemoryAccessReference` | Implemented and tested |
| AK-A16 | Load versioned YAML or JSON Manifest files | Manifest loader | Implemented and tested |
| AK-A17 | Enforce kind-specific materialization contracts | Manifest domain | Implemented and tested |

## Client capability

| ID | Requirement | Design | Initial status |
|---|---|---|---|
| AK-C01 | Claude Code definition | Client capability audit | Implemented and tested |
| AK-C02 | Codex definition | Client capability audit | Implemented and tested |
| AK-C03 | Cursor definition | Client capability audit | Audit pending |
| AK-C04 | Windsurf definition | Client capability audit | Audit pending |
| AK-C05 | GitHub Copilot and VS Code definitions | Client capability audit | Audit pending |
| AK-C06 | Antigravity definition | Client capability audit | Audit pending |
| AK-C07 | Claude Desktop independent definition | Client capability audit | Audit pending |
| AK-C08 | Capability states include stable, preview, version-dependent, unsupported, and UI-only | ADR-005 | Designed |
| AK-C09 | Unverified capability is not treated as stable | ADR-005 | Designed |

## Deployment and safety

| ID | Requirement | Design | Initial status |
|---|---|---|---|
| AK-D01 | Plan before mutation | Deployment lifecycle | Implemented for copy and merge |
| AK-D02 | Show diff before apply | Deployment lifecycle | Implemented for copy and merge |
| AK-D03 | Support managed strategy | ADR-004 | Implemented for complete regular files |
| AK-D04 | Support merge strategy | ADR-004 | Implemented for JSON, TOML, and Markdown ownership units |
| AK-D05 | Support copy strategy | ADR-004 | Implemented |
| AK-D06 | Support link strategy | ADR-004 | Implemented for file and directory sources |
| AK-D07 | Support manual strategy | ADR-004 | Designed |
| AK-D08 | Track managed fields, sections, blocks, and files | ADR-004 | Implemented for copy and merge |
| AK-D09 | Preserve user-owned configuration | ADR-004 | Implemented for copy and structured merge |
| AK-D10 | Detect ownership and stale-plan conflicts | Deployment lifecycle | Implemented for copy and merge |
| AK-D11 | Backup and write atomically | Deployment lifecycle | Implemented for copy and merge |
| AK-D12 | Validate after apply | Deployment lifecycle | Implemented for copy and merge |
| AK-D13 | Roll back multi-file and multi-client failure | Deployment lifecycle | Implemented in common coordinator |
| AK-D14 | Persist transaction history and rollback | Deployment lifecycle | Implemented for committed apply transactions |
| AK-D15 | Retain self-target and symlink escape prevention | AGENTS.md, baseline | Implemented (see [security-boundary.js](../../lib/security-boundary.js); tested in [security-boundaries.test.js](../../test/security-boundaries.test.js) and [manifest-cli.test.js](../../test/manifest-cli.test.js)) |
| AK-D16 | Never store or display literal credentials | Asset and policy models | Manifest input implemented and tested |
| AK-D17 | Account for JSON, JSONC, TOML, YAML, and Markdown formats | Deployment lifecycle | Designed |
| AK-D18 | Do not silently fall back from link to copy | Deployment lifecycle | Implemented |
| AK-D19 | Resolve complete transitive dependency closure | Resource reference model | Core implemented and tested |
| AK-D20 | Reject missing asset references | `MISSING_REFERENCE` | Implemented and tested |
| AK-D21 | Reject missing or ambiguous Tool providers | Tool resolution | Implemented and tested |
| AK-D22 | Reject illegal global-to-project references | Scope rules | Implemented and tested |
| AK-D23 | Reject policy-denied Tool requirements | Effective policy | Implemented and tested |
| AK-D24 | Detect dependency cycles | Dependency graph | Implemented and tested |
| AK-D25 | Reject absolute, missing, traversal, and symlink-escaping sources | Manifest loader | Implemented and tested |
| AK-D28 | Apply selected Harness Capability denial to nested dependencies | Effective Harness policy | Implemented and tested |

## CLI and GUI

| ID | Requirement | User surface | Initial status |
|---|---|---|---|
| AK-U01 | `plan` workflow | CLI and GUI | Implemented as dry-run and plan preview |
| AK-U02 | `apply` workflow | CLI and GUI | Implemented through shared service |
| AK-U03 | `diff` workflow | CLI and GUI | Implemented as operation and conflict preview |
| AK-U04 | `validate` workflow | CLI and GUI | Pending |
| AK-U05 | `doctor` workflow | CLI and GUI | Pending |
| AK-U06 | `rollback` workflow | CLI and GUI | Implemented |
| AK-U07 | Capability and version warnings | Plan UI | Implemented as blocked plan reasons |
| AK-U08 | Conflict resolution | Plan UI | Detection implemented; interactive resolution deferred |
| AK-U09 | Ownership display | Plan UI | Implemented |
| AK-U10 | Transaction history and rollback | History UI | Implemented |
| AK-U11 | Secret reference input without secret disclosure | Settings UI | Pending |
| AK-U12 | Manifest-native marketplace and Git workflows | Future extension | Deferred; legacy direct mutation removed |
| AK-U13 | Select compatible Tools when creating a Skill | Skill editor | Pending |
| AK-U14 | Select Skills, Tools, Policies, and Memory for an Agent | Agent editor | Pending |
| AK-U15 | Show dependency graph and deletion impact | Dependency UI | Pending |
| AK-U16 | Explain missing provider, scope, policy, and cycle errors | Plan and editor UI | Pending |

## Local daemon integration

| ID | Requirement | Implementation and evidence | Status |
|---|---|---|---|
| AKS-00K / LM1 | Shared CLI/GUI read-only daemon status; version, capabilities, expiry, events; distinguish connectivity from execution readiness | `lib/application/local-daemon-status-service.js`, native `worker-status`, `DaemonStatusPanel`; [contract](../architecture/local-daemon-status-contract.md), [verification](../reconstruction/phase-lm1-local-daemon-status.md) | Implemented and verified for the existing experimental macOS native-worker profile; installation and IAM/Gateway integration remain separate |
| AKS-01 / LM2-1 | IAM owns device identity, key binding and revocation; services consume versioned OAuth/OIDC scope/claim contracts and request proof without client flags or scope-omission bypass | [Device identity contract](../architecture/iam-device-identity-contract.md), [LM2 and G-1A/G-2 gates](../product/three-component-implementation-plan.md) | [LM2-1 v1 contract](../architecture/daemon-management-auth-v1.md) and [shared fixtures](../contracts/daemon-management-v1/README.md) defined 2026-09-25; DPoP selected for management. Fixture integrity verified; IAM/daemon/Gateway runtime and compatibility tests remain LM2-2~4 |
| AKS-01 / LM2-2 | IAM enrollment, registered-key DPoP, scoped issuance, durable refresh binding and owner/org-admin revocation | [IAM implementation evidence](../reconstruction/phase-lm2-2-iam-device-identity.md) | IAM local implementation verified: 951 tests and bootJar pass; real daemon/Gateway and customer IdP E2E remain integration gates |

## Runtime and memory boundary

| ID | Requirement | Design | Initial status |
|---|---|---|---|
| AK-R01 | Harness executes the loop | Optional runtime | Designed, deferred |
| AK-R02 | Loop uses decision, selection, policy, execution, observation, update | Optional runtime | Designed, deferred |
| AK-R03 | Skill declares tools but does not own MCP | Optional runtime | Designed, deferred |
| AK-R04 | Tool Registry owns MCP tool connections | Optional runtime | Designed, deferred |
| AK-R05 | Compose global/project/agent/skill/tool policy | Policy model | Designed, deferred |
| AK-R06 | Do not persist hidden model reasoning | Policy model | Designed |
| AK-R07 | Persist only public plan, actions, results, and validation | Policy model | Designed |
| AK-R08 | Treat session summaries as memory candidates | Optional runtime | Designed, deferred |
| AK-R09 | Require approval for durable memory promotion | Policy model | Designed, deferred |

## Completion rule

No implementation phase may mark a requirement complete without:

1. a linked implementation,
2. automated tests or an explicit manual-validation contract,
3. compatibility impact,
4. user-surface behavior when applicable,
5. updated status in this register.

### LM2-3 데몬 인증 연동 (2026-09-25)

AKS-01: 보호 소프트웨어 P-256 저장소, native OAuth/DPoP, 갱신·회수·재시작을
[LM2-3 기록](../reconstruction/phase-lm2-3-daemon-auth.md)으로 추적한다. Rust 80개와
실제 IAM HTTPS 12개 점검 및 macOS 다른 UID의 키/세션 읽기·쓰기 거부 실측 통과.
Gateway/G-1A/G-2 및 전용 서비스 설치는 미완료다.

### LM2-4 Gateway 관리 수신·중앙 표시 (2026-09-25)

AKS-00A/01/07의 관리 채널은 [LM2-4 기록](../reconstruction/phase-lm2-4-gateway-reports.md)으로
추적한다. 공통 M01–M30 및 실제 IAM→데몬→Gateway, DB 중복·재생, 90초 stale,
회수 15초 상한, 본인 범위 중앙 표시를 로컬 검증했다. Gateway 259개 및 데몬 84개
시험이 통과했고 기존 JEV 오류로 전체 Gateway 빌드는 별도 차단 상태다. LM3, 조직 관리자
목록, 직접 MCP G-2, 전용 설치·운영 배포, 실제 브라우저 시각 검수는 미완료다.

### JEV 타입 검사 복구 (2026-09-25)

LM2-4 당시 남긴 JEV 타입 오류 10개를 [후속 수정](../reconstruction/phase-jev-typecheck-fix.md)으로 해결했다. 엄격한 타입 설정을 유지한 전체 Gateway 빌드와 회귀 시험 263개가 통과했다. 별도 통합 환경을 요구하는 8개 시험은 이번 실행에서 제외했다. LM3은 시작하지 않았다.

### LM3-1 서명 관리 작업 검증·계획 (2026-09-25)

AKS-09 및 AKS-03 일부에 대해 [관리 작업 v1](../architecture/daemon-management-jobs-v1.md)의
`managed_worker.revoke` 계약과 Gateway/Rust 검증·순수 계획을 구현했다.
공통 58개 서명 사례로 기기/조직/자원/기대 버전·만료·변조·중복 거부를 검증했다.
[완료 기록](../reconstruction/phase-lm3-1-signed-jobs.md)을 따른다.
조직 관리자 인가·작업 발행/저장·데몬 실제 집행과 결과 보고는 LM3-2~4에 남아 있다.
이 기록으로 LM3 전체나 진행 중 실행 종료를 완료 처리하지 않는다.

### LM3-2 조직 인가·작업 발행/전달 (2026-09-25)

AKS-09 및 AKS-03 일부: IAM 현재 `ORG_ADMIN`/사용자/조직/Gateway 접근 상태 조회와
Gateway 작업 승인·서명·PostgreSQL 원자 저장·기기별 DPoP 수령을 연결했다.
동시 중복·재시작 재조회·다른 조직/기기·역할/서비스 권한 회수·서명 키 교체·만료를 검증했다.
별도 수령 scope를 추가하며 기존 보고 전용 grant와 일반 서비스 인증을 유지한다.
[LM3-2 완료 기록](../reconstruction/phase-lm3-2-job-issuance.md)을 따른다.
`queued`는 실행 완료가 아니다. 데몬 집행·결과 보고·실제 프로세스 회수는 LM3-3~4에 남아 있다.

### LM3-3 데몬 수령·회수 집행 (2026-09-26)

AKS-09의 추가 scope/DPoP 작업 수령, 보호 원장/CAS, native worker 신규 차단·실행 중 회수,
크래시 unknown 보존과 durable 결과 보고를 [LM3-3 기록](../reconstruction/phase-lm3-3-daemon-execution.md)으로 추적한다.
Rust 96개, Gateway 339개와 실제 macOS/TLS 정상·크래시 시험을 통과했다.
운영 배포·실제 IAM/Gateway 통합 E2E·별도 UID 취소 확인·중앙 결과 대조는 완료 처리하지 않는다.

### LM3-4 실제 통합·중앙 결과 대조 (2026-09-26)

실제 IAM HTTPS/OAuth/DPoP → Gateway 인가/JWS/PostgreSQL → macOS native worker 회수,
원자 결과 대조와 durable 영수증 재시도, 본인/조직 조회 분리, stale·unknown UI를
[LM3-4 기록](../reconstruction/phase-lm3-4-integration.md)으로 추적한다. 별도 UID OS 회수와 비sandbox 파일 접근 거부 실측도 완료했다. LM3-4 로컬 검증 게이트 완료이며 운영 배포 완료로 해석하지 않는다.

## CA01: Codex·Antigravity 우선 자원 배포 계약 (2026-09-27)

요청: Claude 중심 순서를 수정하고 Codex·Antigravity CLI/앱 중심 계획으로 진행.

| 요구 | 구현 | 검증 |
|---|---|---|
| 제품별 CLI/앱 경로 분리 | ClientDefinition v2 surfaces, 명시적 capabilityIds/overrides | client-definitions, local-installation-discovery-service tests |
| 문서 확인과 실제 지원 분리 | capability 문서 evidence + surface/버전/OS/arch별 runtimeEvidence | 버전 불명·다른 surface·prerelease·UI-only 거부 테스트 |
| CLI/GUI 공통 판정 | plan/doctor 서비스, --surface, GUI 실행 화면 선택 | manifest-cli, manifest-deployment-service, deployment-routes, ManifestDeploymentPanel tests |
| 사용자 파일 보존 | 미검증 계획 자동 적용 차단, 구 파일 자동 이관 없음 | unverified apply 거부·파일 미생성, HTTP 합성 fixture apply/rollback |

범위와 미완료 항목: [CA01 기록](../reconstruction/phase-ca01-client-profiles.md).

## CA02-1: 공통 MCP 정의 변환 (2026-09-27)

| 요구 | 구현 | 검증 |
|---|---|---|
| 같은 원본으로 Codex·Antigravity 출력 | versioned definition/bindings, adapters/mcp | mcp-rendering의 동일 원본 TOML/JSON 시험 |
| 파일 없는 inline 자원과 안전 계획 | planClientDeployment 렌더링, prepareMergeDeployment 입력 연결, previewOnly 분리 | 합성 프로필 apply/rollback, production 미검증 apply 거부 |
| 비밀 참조와 기존 설정 보존 | 환경 이름 참조, 미확인 인증 차단, typed MCP 병합 guard | 오류 비노출, 사용자 값 보존, 충돌·stale 시험 |
| CLI·GUI 공통 경로 | 공유 plan service previews + GUI 펼침 보기 | CLI·HTTP·GUI 테스트 |

[범위와 남은 CA02 작업](../reconstruction/phase-ca02-1-mcp-rendering.md).

## CA02-2: 대상 선택과 공통 Agent (2026-09-27)

| 요구 | 구현 | 검증 |
| --- | --- | --- |
| 클라이언트별 선택과 의존성 배포 | manifest-targets, provider 재귀, 선택 source 로딩 | agent-target-deployment의 선택/순환/scope/없는 미선택 source 시험 |
| Codex·Antigravity 공통 Agent | Agent v1, adapters/agents, 생성 copy | 두 형식 변환, 정책 mapping 차단, 독립 TOML 파싱 |
| 공통 적용 경로와 파일 보호 | 기존 plan/copy/apply/rollback, private 생성 바이트 | 합성 profile 적용/멱등성/rollback/외부 수정/다른 소유권/preview 거부 |
| CLI·GUI 일관성 | 공유 plan/doctor 및 preview 응답 | CLI, HTTP Agent 예제와 기존 GUI 회귀 시험 |

완료 범위와 실기·daemon 후속 경계는 [CA02-2 기록](../reconstruction/phase-ca02-2-targets-and-agents.md)을 따른다.

## CA02-3: 공통 지침·Skill과 Agent 설정 연결 (2026-09-27)

| 요구 | 구현 | 검증 |
| --- | --- | --- |
| 네 자원 공통 원본 | opt-in source definition, 공통 Markdown/Skill 검사, 네 자원 예제 | 두 제품 임시 적용·사용자 본문 보존·부속 파일·멱등성·rollback |
| 논리 도구와 native 설정 분리 | MCP nativeName, Agent 및 Skill 의존 도구별 Codex provider 목록 | 누락·모호성·optional·미지원 정책 거부, 다중 provider 정렬·환경 이름 참조 |
| 정확한 권한 의미 | sandbox 기본값과 provider 제한 notice, 미확인 Antigravity mapping 차단 | renderer·서비스·GUI 안내 시험 |
| 공통 CLI/GUI 계약 | loader/plan/doctor/validate 및 preview 공유 | CLI 네 자원 예제·HTTP 오류 400·GUI 회귀 시험 |

완료 범위와 CA03/실기/daemon 후속 구분은 [CA02-3 기록](../reconstruction/phase-ca02-3-common-assets.md)을 따른다.

## CA03-1: 프로젝트 공유 지침·Skill 수명주기 (2026-09-27)

| 요구 | 구현 | 검증 |
| --- | --- | --- |
| Codex·Antigravity 공동 관리 | 여러 client/surface 기여를 같은 파일 한 건으로 합산, 소비자 집합 기록 | 동시 적용·순차 등록·멱등 적용 |
| 공유 갱신·제거 | 전체 소비자 참여 갱신, 첫 소비자 해제 시 보존, 마지막 소비자만 소유 파일/블록 제거 | bundle 추가·삭제, 사용자 본문 보존, 외부 수정 차단 |
| 소유권·복구 보존 | schema 2, 원장 hash와 배타 잠금, metadata/delete rollback | stale 계획·교차 rollback·검증 및 저장 실패 복구 |
| CLI·GUI 동일 서비스 | targets, removal-plan, 명시적 asset ID, 소비자 및 원장 전환 표시 | CLI·HTTP 수명주기·GUI 계획/승인 시험 |

전역 원장·기존 소유권 이관·지속 계획과 실제 클라이언트/daemon 검증은 남은 단계다.
[완료 범위와 검증 기록](../reconstruction/phase-ca03-1-shared-project-resources.md).


## CA03-2: 전역 통합 원장·명시적 소유권 이관 (2026-09-27)

| 요구 | 구현 | 검증 |
| --- | --- | --- |
| 전역 공유 관리 | 홈별 통합 원장, client/surface 소비자, 경로별 bundle 처리 | Codex cli/desktop 공동 갱신·Antigravity 별도 저장소 보존 |
| 기존 기록 보존 | 원장 원문 보관·백업 복사·이력 통합·구 원장 사용 중지 | 과거 배포 rollback·백업 hash·중복 소유권/ID 거부 |
| 명시적 소유권 전환 | client/asset/source/committed 이력 대조 후 metadata-only 계획 | 전역/프로젝트 전환·역rollback·불완전 bundle/외부 수정 거부 |
| 경쟁·실패 방지 | 원장 목록/hash·대상 재확인·다중 잠금·중단 표식 | stale·잠금·검증 실패·최종 상태 쓰기 실패 복원 |
| 동일 CLI/GUI 서비스 | migrate, migration-plan, 계획 검토/승인 | CLI runtime gate 보존·HTTP 이관부터 제거·GUI 승인 시험 |

[완료 범위와 검증 기록](../reconstruction/phase-ca03-2-global-ledger-migration.md).
실제 사용자 설정 이관, production runtimeEvidence와 daemon 자원 집행은 이번 단계에 포함하지 않았다.


## CA03-3: typed Agent/MCP 제거 (2026-09-27)

| 요구 | 구현 | 검증 |
| --- | --- | --- |
| Kit 소유 항목만 제거 | typed resource identity와 schema 4, Agent 파일·MCP 섹션/leaf hash | Codex·Antigravity 전역/프로젝트 제거와 rollback |
| 사용자 설정 보존 | 다른 설정·서버 보존, 미소유 필드/외부 수정/미지원 문법 거부 | TOML 주변 바이트·JSON 값·중복 키·UTF-8 시험 |
| 의존 자원 보호 | 배포 당시 전이 의존 ID와 제거 후 원장 그래프 검사 | Manifest 참조 삭제 후에도 단독 MCP 제거 차단 |
| 공통 실행·복구 | 혼합 제거 계획, 기존 잠금/backup/apply/rollback 서비스 | CLI·HTTP E2E·GUI 승인·검증 및 state 실패 복원 |

[완료 범위와 검증 기록](../reconstruction/phase-ca03-3-typed-resource-removal.md).
legacy Agent/MCP 식별자 이관 및 실제 클라이언트/daemon 검증은 후속 단계다. 지속 계획과 일반 파일의 검토 중단 복구는 아래 CA03-4를 따른다.

## CA03-4: 저장 계획·digest·중단 복구 (2026-09-27)

| 요구 | 구현 | 검증 |
| --- | --- | --- |
| 재시작 후 검토 계획 식별 | 재구성 입력·snapshot/context/body digest, 만료·claim | 별도 프로세스 재개, 원본·대상·원장·정의 변경 거부 |
| 중복 실행 방지 | 고정 transaction ID와 완료 기록 정리 | commit 후 완료 표시 전 SIGKILL, 트랜잭션 1회 |
| 중단 후 안전한 복구 | 파일 journal·PID/token·scope·전체 hash/backup 검사 | 적용·제거·rollback SIGKILL, 전역/프로젝트 복원, commit 보존 |
| CLI·GUI 같은 실행 | save/list/resume/recovery-plan/recover 서비스·HTTP | CLI 재시작, HTTP 앱 재생성/강제 종료, GUI 명시적 승인 |

[완료 범위와 검증 기록](../reconstruction/phase-ca03-4-persistent-deployment.md).
불변 daemon payload·실제 클라이언트 runtimeEvidence는 포함하지 않는다. link/다중 원장과
journal 작성 전 또는 복구 자체의 강제 종료는 수동 점검 경계를 유지한다.

## CA04-1: 설치된 CLI의 부분 인식 검증 (2026-09-27)

| 요구 | 구현/관측 | 완료 경계 |
| --- | --- | --- |
| 파일 적용과 실제 인식 구분 | 격리 CLI 검증 도구, 양쪽 project/global 수명주기 | 파일 rollback 바이트 확인. 전체 runtime 지원 미승격 |
| Codex 자원 실기 | 0.145.0 skills/list, instructionSources, mcp list/tool call | Skill 설명 갱신·제거·복원, 직접 MCP 표식 호출 확인. 모델 사용/Agent 미검증 |
| Antigravity 자원 실기 | 1.2.11 mcp list, agents와 전역 대조 자원 | 전역 MCP 목록 반영 확인. 프로젝트 목록/모델 사용 미확인 |
| 안전한 증거 수집 | 새 임시 홈, 인증 환경 제거, 제한 시간/출력, 프로세스 정리 | 기존 인증/설정 복사 없음, raw transcript/reasoning 보관 없음 |

[상세 결과와 다음 진행 조건](../reconstruction/phase-ca04-1-cli-recognition.md).
CA04-2는 기존 로그인을 재사용해 임시 프로젝트의 모델 사용을 확인한다. 격리 홈의 인증 부재를 사용자 로그아웃으로 해석하지 않는다. [검증 기록](../reconstruction/phase-ca04-2-cli-model-use.md).


## CA04-2: 기존 인증과 실제 모델 사용 (2026-09-27)

- 기존 로그인 재사용, 사용자 설정과 인증 복사·수정 없이 임시 프로젝트 시험.
- Codex 0.145.0: 지침·Skill·stdio MCP의 실제 사용과 갱신·제거·rollback 확인.
- Antigravity 1.2.12: 지침·Skill의 실제 사용과 갱신·제거·rollback 확인.
- Antigravity MCP 포함 시험의 빈 응답은 성공으로 처리하지 않음. 커스텀 Agent,
  전역 모델 사용, 앱/IDE, production runtimeEvidence 승격은 미완료.
- 기존 공통 배포 서비스와 어댑터를 실행하는 opt-in 검증기 추가, 212 tests 통과.

[실기 기록](../reconstruction/phase-ca04-2-cli-model-use.md)과
[기계 판독 증거](../reconstruction/ca04-2-cli-model-use-evidence.json).


## CA04-3: Antigravity MCP 권한 차단 (2026-09-27)

기존 로그인은 유지되며, native CLI가 MCP 권한을 비대화형으로 승인받지 못해 자동
거절하는 것을 확인했다. exit 0/SUCCESS도 `MCP_PERMISSION_REQUIRED`로 별도 판정한다.
시험용 한 도구의 임시 allow diff를 준비했고 사용자 승인 전에는 설정을 변경하지 않는다.
[원인·검증·다음 조건](../reconstruction/phase-ca04-3-antigravity-mcp-permission.md).


## CA04-4: 승인된 Antigravity MCP 실제 사용 (2026-09-27)

사용자가 시험용 한 도구의 임시 허용과 원복을 승인했다. Antigravity 1.2.12의 project
지침·Skill·stdio MCP가 baseline/적용/갱신/제거/rollback 전 단계를 통과했다.
원본 settings.json 바이트 복원과 임시 허용 항목 부재를 확인했다. 호출 관측은
call_mcp_tool의 정확한 ServerName/ToolName과 도구 반환·모델 응답 표식을 함께 대조한다.
자동 테스트 217개 통과. production runtimeEvidence, Agent·전역·앱/IDE·데몬 지원은 별도다.
[실기 기록](../reconstruction/phase-ca04-4-antigravity-mcp-use.md).

## CA04-5: CLI 커스텀 Agent 증거 수준 분리 (2026-09-27)

공통 Manifest 서비스가 배포한 Agent를 두 native CLI에서 시험한다.
표식 응답, 정확한 역할 호출, 직접 관측한 child 완료 결과를 별도 필드로 기록한다.
적용·갱신·제거·rollback의 응답 증거와 Antigravity 역할 호출은 확보했지만,
공개 스트림의 child 결과 누락 때문에 전체 실행 검증을 통과로 승격하지 않는다.
최종 Antigravity 갱신 단계의 예상 밖 `schedule` 호출도 실패로 보존했다.
전역 Agent는 계획만 점검했으며 사용자 설정·권한은 변경하지 않았다.
[CA04-5 상세 및 재현](../reconstruction/phase-ca04-5-cli-agent-use.md).

## CA04-6: 실제 child 완료·전역 Skill 경로 교정 (2026-09-27)

Codex App Server의 subAgentActivity → child metadata(role/parent) → 공개 메시지
→ 완료 turn을 연결하여 프로젝트 Agent의 다섯 단계 수명주기를 검증했다.
Codex 전역 Skill과 Antigravity CLI 1.2.12 공용 경로의 전역 Skill도 통과했다.
Antigravity CLI 전역 경로는 surface override로 교정하고, 기존 문서 경로의
사용자 파일 보존 및 별도 소유권 이관 절차를 명시했다. runtimeEvidence는 승격하지 않았다.
자동 테스트 226개 통과. [상세](../reconstruction/phase-ca04-6-agent-completion-global-skills.md).


## CA04-7: 검증된 CLI 지원 활성화 (2026-09-27)

- Codex CLI 0.145.0: 프로젝트 지침·Skill·stdio MCP·기본 Agent, 전역 Skill.
- Antigravity CLI 1.2.12: 프로젝트 지침·Skill·stdio MCP, 전역 Skill.
- macOS arm64·검증 실행 파일 SHA-256 제한. 계획과 실제 적용 직전 재확인,
  저장 계획 재개에도 동일 조건 적용. 버전 입력만으로 활성화 불가.
- MCP 전송/환경 전달·Agent 고급 옵션/native source 우회 차단.
- CLI/GUI HTTP는 같은 서비스로 지원 판단·실행. 실제 GUI 화면 검증과 데몬 배포는 후속.

[지원 범위와 검증](../reconstruction/phase-ca04-7-cli-activation.md).


## CA04-8: 실제 Kit GUI 흐름 검증 (2026-09-27)

두 CLI의 프로젝트 자원과 격리 홈의 전역 Skill을 실제 Chrome 화면에서 계획·미리보기·적용·제거·rollback 했다. 네 번의 복원 해시 대조와 공유 소비자 보존을 확인하고 시험 원장 항목을 모두 제거했다. 홈의 CLI 검증 표시와 자원 목록의 파일 계약/실행 지원 구분을 수정했다. 구성요소 23 tests, 타입 검사·빌드 통과. 네이티브 Tauri/앱/IDE 및 데몬 자원 배포는 별도 범위다. [기록과 화면 증거](../reconstruction/phase-ca04-8-gui-workflow.md).

## CA06-1: 불변 입력과 Kit 측 helper (2026-09-27)

공통 Manifest와 부속 파일을 SHA-256으로 고정하고, 로컬 대상 binding과 MCP 실행
정의 허용 목록을 거쳐 기존 CLI/GUI 공통 서비스의 prepare/apply·저장 계획·복구를
재사용한다. `test/resource-bundle.test.js`에서 변조/경로/만료/중복/실제 SIGKILL과
설치된 두 CLI 실행 파일의 hash gate를 검사한다. 파일 적용 결과와 클라이언트
인식을 구별한다. Gateway 서명 발급·데몬 원격 수신 및 사용자 프로세스 실행 연결은
CA06-2로 남아 있다. [계약](../contracts/resource-bundle-v1.md),
[구현·검증](../reconstruction/phase-ca06-1-resource-bundle.md).

## 공통 자원 관리: 외부 자원 관측 (2026-11-05)

| ID | 요구사항 | 구현·검증 | 상태 |
|---|---|---|---|
| AK-SR01 | 외부 ego-browser 링크의 존재·연결·관리 주체만 표시하고 원본·링크·updater 보존 | discovery application service, CLI `discover`, GUI resource cards, metadata-only/끊김/순환 링크 시험 | 구현·검증 |
| AK-SR02 | 동일 이름 자원을 자동 소유·병합하지 않고 effective surface inventory 표시 | candidate ID, project query, GUI 동명 분리·외부 자원 작업 버튼 부재 시험 | 기본 경로 구현·검증; parent/discovery manifest 후속 |
| AK-SR03 | 조회가 starter Kit를 생성하지 않음 | 경로 해석/명시적 init 분리, CLI discovery·daemon-status·bundle 및 HTTP/GUI 회귀 | 구현·검증 |
| AK-SR04 | 무효 Agent sandbox/MCP 옵션을 제한이 성립하는 설정으로 출력하지 않음 | adapter 차단과 synthetic profile 우회 방지, 기본 역할·registry 바인딩 회귀 | 구현·검증 |
| AK-SR05 | 선택 자원 편입·편집·재가져오기·병합 및 공통 배포 확장 | [상세 계획](../product/shared-resources-consolidation-plan.md), 후속 versioned 계약·서비스 | 등록·해제·Kit 편집·로컬 갱신/병합·명시적 원래 client 설치 반영·공통 Skill snapshot 집행 구현; 전체 client·scope 행렬은 후속 |
| AK-SR06 | 기존 설치·링크를 보존하며 선택 원본과 출처·baseline을 Kit에 등록·해제 | [원본 등록 계약](../contracts/resource-import-v1.md), application service, CLI/HTTP/GUI, 원본·native·링크·실행 모드 보존 시험 | 구현·검증 |
| AK-SR07 | 원본 등록 중단·외부 변경에서 fail-closed, 기존 Manifest 편집 무손실 | source journal·검토 복구, 실제 SIGKILL·변조·stale/tmp 테스트, typed GUI 전체 정의 왕복 | 구현·검증 |
| AK-SR08 | Kit 수정본과 수용 기준을 분리하고 원본 업데이트를 재가져와 병합 | [revision 계약](../contracts/source-revisions-v1.md), source-edit/refresh service, B/K/U·부분 수용·보류·native metadata·CLI/HTTP/GUI 시험 | 로컬 및 고정 Git/npm 출처 구현·검증 |
| AK-SR09 | source/baseline/보류 상태의 이력 복원과 갱신 중단 복구 | checkpoint digest·원본 유지·stale 검증·v2 journal 실제 SIGKILL 및 복구 시험 | 구현·검증; client 설치 rollback은 별도 |
| AK-SR10 | 기존 설치를 유지한 권한 인수·L/D/K 대조·설치 변경→Kit 병합·검토한 Kit 반영·해제 | [설치 계약](../contracts/native-installation-v1.md), native installation service와 CLI/HTTP/GUI, 네 자원·두 client·전역/프로젝트 Skill·선택 MCP byte 보존 시험 | 원래 canonical 경로의 일반 파일/선택 서버 구현·검증; 링크/추가 루트 쓰기 차단 |
| AK-SR11 | 기존 배포 이력·백업·rollback·중단 복구에서 설치 모드·소유권·동시 수정 보존 | 원장 v5, journal v2, 실행 모드·생성 inode 영수증·실제 SIGKILL·동시 수정 보존 시험, [실제 GUI 검증](../reconstruction/phase-native-installation.md) | 구현·검증; 실제 client 실행/사용 증거와 구분 |
| AK-SR12 | 기본 Kit 초기화 후 실제 client 환경의 적용·사용·복원에서 기존 설정·외부 링크 보존 | [실환경 기록](../reconstruction/phase-native-installation-live.md), 실제 Codex/AGY 전역 Skill 관리 등록·편집·반영·읽기·rollback·읽기·정리, 23개 항목/외부 링크 3개 비교 | 현재 정확한 CLI 빌드의 전역 Skill 검증·활성화; 중간 실행 파일 갱신 근거는 거절 |
| AK-SR13 | 기존 MCP·Agent·지침을 Kit에서 관리하고 실제 client 적용·복원, 공식 scope와 설계 원칙 확인 | [구현·증거·지연 진단](../reconstruction/phase-existing-native-management.md), 기존 자원 4개 등록·관리, Codex 지침/Agent/native stdio MCP 및 기존 node_repl 왕복, native ID/옵션·의존성·관측 예외 회귀 | Codex 현재 빌드 전역의 제한된 profile 검증; AGY Agent·MCP 현재 빌드 미승격, 재시도 중단 후 검증 계약 분리부터 보완 |
| AK-SR14 | 잘 진행되지 않는 원인을 먼저 진단하고 기존 환경 보존 상태를 확인 | [읽기 전용 체크포인트](../reconstruction/native-existing-management-checkpoint-20261105.json), 설정 적용·native 인식·모델 응답 판정 혼합과 verifier 결함 구분, 다음 변경의 제한된 완료 조건 | 27개 경로 내용·권한과 외부 링크 3개 보존, pending journal 없음; 진단 단계의 실제 모델 재실행 없음 |
| AK-SR15 | 검증기를 배포·복원 / 클라이언트 인식 / 모델 응답으로 분리, 기록된 실패로 TDD 후 필요한 실제 검증만 실행 | [계약](../contracts/verification-evidence-v1.md), [구현·시험·실제 조회](../reconstruction/phase-verifier-separation.md), 순수 도메인 판정·공개 이벤트 adapter·공통 배포 관측·네 CLI 연결·오프라인 재생 | 29개 신규 시험 및 전체 회귀 통과, 실제 MCP 등록 조회 1회·모델 0회·설정 쓰기 0회, 기존 27개 경로와 외부 링크 3개 보존; 미검증 capability 승격 없음 |
| AK-SR16 | Antigravity MCP 실제 적용·복원을 분리된 검증기로 확인하고 기존 설정·링크 보존 | [실기·TDD·보존 기록](../reconstruction/phase-antigravity-native-mcp.md), 전역 MCP 다섯 단계와 기존 canva의 적용/등록/설치·Kit 복원 | 현재 버전·binary의 기본 stdio만 검증·활성화. 기존 자원 4개와 외부 링크 3개 보존, HTTP/환경 확장 미승격 |
| AK-SR17 | Agent 자식 완료 증거의 공개 경로부터 확인 | ACP initialize, 현재 역할의 자식 ID만 공개 replay, 읽기 전용 manage_subagents list, 부분 Agent 목록/kill 거절/상태와 공개 응답 결합 TDD | 자식 공개 응답 직접 일치 확인. 완료 상태는 미확정으로 유지, 실제 역할 2회 조사 후 반복 중단, Agent 지원 미승격 |
| AK-SR18 | 기존 설치 origin과 독립적인 Git/package 출처 연결·갱신·병합·출처 포함 복원 | [출처 계약](../contracts/upstream-sources-v1.md), [PR04c 구현·검증](../reconstruction/phase-upstream-sources.md), domain/adapter/application 및 CLI/HTTP/GUI TDD, 공개 yaml npm/Git 무실행 취득 | 공개 HTTPS Git commit·npm version/SHA-512 범위 구현·검증. 외부 관리 링크는 관측 유지 |

| AK-SR19 | 원본을 편집해도 활성 내용이 바뀌지 않는 공통 Skill snapshot·소비자 연결 계획 | [계약](../contracts/skill-snapshot-plan-v1.md), [PR05 구현·검증](../reconstruction/phase-skill-snapshot-plan.md), source v2·state v6·canonical descriptor/store·공유 소비자 lifecycle·보관 참조와 CLI/HTTP/GUI 무쓰기/적용 차단 회귀 | 계획 단계 구현·검증. 실제 연결 집행·이관·backup/rollback·crash recovery·native 인식은 PR06에서 검증 후 활성화 |
| AK-SR20 | snapshot 링크 집행·copy↔link 이관·소비자 해제·저장 계획·backup/rollback·강제 종료 복구 | [실행 계약](../contracts/skill-snapshot-deployment-v1.md), [PR06 구현·검증](../reconstruction/phase-skill-snapshot-deployment.md), atomic filesystem adapter·tree journal v3·saved body v2·connection schema 2 | 423/30/54 자동 검사와 Codex 전역 CLI의 적용/갱신/복원 native 읽기 통과. AGY 링크 읽기 미관측은 차단, 기존 설정·외부 링크 보존 |
| AK-SR21 | 같은 저장소의 typed Agent/MCP 합산, 개별 capability gate 보존, 설정 제거의 전체 영향·의존 보호 | [저장소 계약](../contracts/physical-resource-deployment-v1.md), [PR07 부분 구현·검증](../reconstruction/phase-physical-resource-deployment.md), state v7/resource v2·saved body v3·공통 application service와 CLI/HTTP/GUI | 저장소 합산·격리 기본 행렬 구현, 기존 mode 보존 및 중단 복구 검증. 기본 native 후속은 AK-SR22 |
| AK-SR22 | 현재 빌드 전역/프로젝트 기본 CLI의 배포·native 인식·모델 응답 분리와 필요한 실기 | [기본 검증 계약](../contracts/basic-cli-verification-v1.md), [실기·TDD·보존 기록](../reconstruction/phase-basic-cli-verification.md), [14/16 gate](../reconstruction/basic-cli-matrix-current-20261106.json) | Codex 전역/프로젝트 네 자원, AGY 두 scope 지침·Skill·MCP만 활성화. AGY Agent child 완료 미관측·차단 유지. 465/31/55 회귀 통과 |
| AK-SR23 | 정의 갱신으로 바뀐 설치 경로의 과거 소유권 보존과 명시적 이관 | [이관 계약](../contracts/resource-path-migration-v1.md), [PR08 구현·검증](../reconstruction/phase-resource-path-migration.md), locator/domain·공통 service·CLI/HTTP/GUI 회귀 | 적용 locator 증거·명시적 이관·부분 consumer/selector·양쪽 rollback·SIGKILL 복구 구현. 489/33/57 회귀 통과. 무증거 과거 설치·Agent 등록·외부 링크는 차단해 보존 |
| AK-SR24 | 전역+선택 프로젝트의 원본·범위·동명 자원을 보존한 통합 조회 | [catalog 계약](../contracts/resource-catalog-v1.md), [PR09 부분 구현·검증](../reconstruction/phase-resource-catalog.md), CLI/HTTP/GUI 및 원래 scope 작업 회귀 | 497/35/60 통과. 실제 Codex 동명·disabled 격리 조회와 사용자 환경 무쓰기 조회 확인. 사용자 inventory의 활성화·상위 탐색 문맥 및 교차 scope 참조는 미완료 |
| AK-SR25 | native 인식 증거를 catalog에 연결하되 외부 링크·권한·다른 client gate 보존 | [native 연결 계약](../contracts/resource-catalog-v1.md), [실제 서비스](../reconstruction/codex-native-catalog-service-20261106.json), [사용자 환경 한 번 조회](../reconstruction/native-live-catalog-codex-20261106.json), RPC/세션/GUI 늦은 응답·활성 필터 회귀 | 507/37/62 통과. Codex CLI Skill의 활성/비활성·상위 읽기 전용 경로 연결. 모델/Tool 실행 0, 기존 설정·링크 보존. 다른 kind/surface와 교차 scope 참조는 미완료 |
| AK-SR26 | native MCP 등록/활성과 연결/Tool 사용을 구분하고 scope·필드별 실효 출처 보존 | [MCP catalog 계약](../contracts/resource-catalog-v1.md), [실제 서비스](../reconstruction/codex-native-mcp-catalog-service-20261106.json), [신뢰 제외](../reconstruction/codex-native-mcp-untrusted-control-20261106.json), [사용자 환경](../reconstruction/native-live-catalog-mcp-codex-20261106.json) | 514/39/63 통과. Codex CLI MCP 단일/합성/가림/제외와 읽기 전용 GUI. 연결/Tool/model 요청 0, 기존 설정·외부 링크 보존. 다른 kind/surface 및 PR10/11은 미완료 |

| AK-SR27 | Agent 파일 ID·선언 이름과 지침의 문서상 선택·실제 주입을 구분 | [catalog 계약](../contracts/resource-catalog-v1.md), [지침 설정 실제 서비스](../reconstruction/codex-instruction-settings-catalog-service-20261106.json), [사용자 환경](../reconstruction/native-live-catalog-instructions-codex-20261106.json), body/link·공백·fallback·예산·상위 문맥·phantom shadowing TDD | 522/40/64, typecheck·desktop·Cargo 통과. config-read만 사용하며 모델/Tool/MCP 요청 0, 기존 27개 경로·외부 링크 보존. Agent/지침 실제 로딩과 PR10/11은 미완료 |

| AK-SR28 | 교차 scope 참조의 설치 전제·역영향·잠금/복구 계약과 기존 provider 입력 fail-closed | [PR10 계약 초안](../contracts/scoped-dependencies-v1.md), [진행·TDD](../reconstruction/phase-scoped-dependencies.md), optional Tool·workflow selector 검증 | 계약·선행 교정 착수. 524/40/64 및 build/typecheck/Cargo 통과. qualified 참조·설치 전제·역참조·잠금/journal은 미구현이며 교차 scope 자동 적용 차단 유지 |

| AK-SR29 | versioned 전역/프로젝트 참조·provider·origin별 graph를 설치 증거와 분리해 조회 | [scoped 계약](../contracts/scoped-dependencies-v1.md), [PR10 구현·TDD](../reconstruction/phase-scoped-dependencies.md), [사용자 Kit 읽기](../reconstruction/native-live-scoped-catalog-20261106.json), 선언/정책 전이·물리 별칭·readonly API/GUI 회귀 | 538/41/66 및 typecheck/desktop/Cargo 통과. v3는 조회만 허용하고 일반 편집·배포 차단. 실제 설치 전제·역참조·잠금/journal 및 validate/doctor 전체 전환은 후속 |

| AK-SR30 | 설치 당시 선언·소유 영역 revision을 원본 편집과 구분하고 기존 파일·링크·원장 보존 | [영수증 계약](../contracts/installation-receipts-v1.md), [PR10 TDD·SIGKILL](../reconstruction/phase-scoped-dependencies.md), [사용자 read path](../reconstruction/native-live-installed-catalog-20261106.json), source-only/metadata-only·다른 owner·rollback·snapshot·pending·public alias·GUI 응답 순서 | 554/42/68 및 typecheck/desktop/Cargo 통과. ownership-observed만 제공하고 native/provider 충족·교차 scope 적용은 차단. native-owned 자원·역참조/잠금·두 scope journal은 미완료 |

| AK-SR31 | 기존 native ID·경로·소유 baseline을 보존한 영수증과 metadata-only 적용·복원 | [native v2 계약](../contracts/native-installation-receipts-v2.md), [TDD·구현](../reconstruction/phase-scoped-dependencies.md), [실환경 왕복](../reconstruction/native-owned-audit-roundtrip-20261106.json) | 563/43/69 및 typecheck/desktop/Cargo 통과. 네 종류 fixture, 실제 MCP 3·지침 1의 audit 적용·복원·유지. client 파일 작업 0·기존 설정/링크/소유 기록 보존. provider/native 발견·교차 scope 집행은 미완료 |

| AK-SR32 | 설치 당시 전이/provider revision·명시적 native Tool 이름을 원본 수정과 분리하고 provider 변경/rollback 대조 | [버전 계약](../contracts/installed-dependency-revisions-v1.md), [TDD·구현](../reconstruction/phase-scoped-dependencies.md), [실환경 기존 영수증 호환](../reconstruction/installed-dependency-live-compatibility-20261106.json) | 572/43/70 및 typecheck/desktop 통과. 새 schema 3 snapshot·생성/native alias·전이/내용/소유 drift·rollback·legacy 미확인·readonly CLI/HTTP/GUI. 기존 원장 145개/영수증 4개/설정·링크 27개 경로 유지. native Tool 발견·교차 scope 계획/역참조/잠금·복구는 미완료 |

| AK-SR33 | 등록 프로젝트의 역참조를 stable 전제 ID로 추적하고 누락·손상을 해제로 간주하지 않으며 legacy writer 덮어쓰기 차단 | [역참조 계약](../contracts/dependency-reverse-index-v1.md), [TDD·구현](../reconstruction/phase-scoped-dependencies.md), [실환경 CLI 조회](../reconstruction/dependency-reverse-index-live-inspection-20261106.json) | 583/44/74 및 typecheck/desktop 통과. state 8 모델·양쪽 원장/설치 대조·consumer별 순수 영향·단일 원장 writer 차단·readonly CLI/HTTP/GUI. 기존 schema 6 원장·설정/링크 유지. 공개 등록/해제 coordinator·모든 mutation 보호·교차 scope 잠금/journal·native 전제는 미완료 |

| AK-SR34 | 등록/해제의 순서 있는 두 scope 잠금·사전 target 검증·journal/검토 복구와 수동 편집/외부 링크 보존 | [내부 coordinator 계약](../contracts/dependency-coordination-v1.md), [TDD·SIGKILL 기록](../reconstruction/phase-scoped-dependencies.md), [사용자 기존 원장 호환](../reconstruction/dependency-coordination-live-compatibility-20261106.json) | 602/44/74 및 typecheck/desktop 통과. 임시 client 실제 apply/remove·예약/활성/해제/tombstone·9개 중단 경계/복구 재중단·미검토/전역 쓰기 사전 거절·수동 편집 보존. 공개 v3/native adapter/모든 mutation 보호는 미완료이며 사용자 index 비활성·설정/링크 유지 |

| AK-SR35 | native Skill·선택 MCP Tool 발견을 설치 revision·원본 출처·별칭·정책·문맥/만료에 묶고 public flag 위장/외부 링크 변경 방지 | [native 전제 계약](../contracts/native-prerequisite-observation-v1.md), [TDD 기록](../reconstruction/phase-scoped-dependencies.md), [실제 Codex 격리 왕복](../reconstruction/codex-native-prerequisite-service-roundtrip-20261106.json), [기존 사용자 원장 읽기](../reconstruction/native-prerequisite-live-compatibility-20261106.json) | 루트 621/집중 19 통과. Codex CLI private verifier·내부 coordinator 적용·metadata-only 무연결/선택 서버만 Tool 목록·설정/원장/외부 링크 보존. 모델/Tool 실행·consumer 활성 미확인, 공개 v3/예정 설정 전환/모든 mutation 보호와 추가 client/surface는 미완료 |

| AK-SR36 | origin별 v3 local/global 변경 계획과 consumer별 실제 설치 전제를 공통 서비스·CLI/HTTP/GUI에서 검토하고 실행/저장 우회와 기존 설정/링크 변경 방지 | [scoped 계획 계약](../contracts/scoped-deployment-compilation-v1.md), [TDD·회귀 기록](../reconstruction/phase-scoped-dependencies.md), [사용자 Kit 읽기](../reconstruction/scoped-compiler-live-compatibility-20261106.json) | 641/44/75 및 typecheck/desktop 통과. 전역 미복사·동명 분리·원래 capability gate·설치 pin·소스 편집/drift 구분·target image/mode·public clone·CLI/API/UI readonly 검증. scoped 영수증·공개 coordinator 집행/복구·모든 mutation 영향 보호와 실제 교차 scope consumer 왕복은 미완료 |

| AK-SR37 | scoped 설치 선언/snapshot에서 physical origin·원래 native ID·전이 pin을 보존하고 기존 owned 파일 metadata와 역참조를 함께 기록/복구 | [v4 계약](../contracts/scoped-installation-receipts-v4.md), [TDD·회귀](../reconstruction/phase-scoped-dependencies.md), [실제 Codex 격리 왕복](../reconstruction/codex-scoped-receipt-native-roundtrip-20261106.json), [기존 영수증 읽기](../reconstruction/scoped-receipts-live-compatibility-20261106.json) | 657/44 및 desktop 통과. v1/2/3 호환·동명/checkout 분리·전이 누락/타입 위장 차단·Native alias·v4 관측·metadata commit 전/후 복구·MCP 다른 owner/링크 보존. 새 consumer 전체 revision 예측·공개 집행/복구·모든 mutation 보호와 실제 교차 scope consumer 왕복은 미완료 |

| AK-SR38 | 전역/프로젝트 Skill의 배포 대상과 의미 호환성·native variant·실제 노출을 분리하고 client 전용 자원·기존 배포/링크를 보존 | [통합 계획 C07·T27](../product/shared-resources-consolidation-plan.md#c07-skill의-범위배포-대상호환성을-분리한다), [배포 계약](../contracts/skill-distribution-v1.md), [variant 원본 계약](../contracts/skill-variant-sources-v1.md), [native UI profile](../contracts/native-skill-interface-v1.md), [구현·실패 기록](../reconstruction/phase-skill-distribution.md), [native 서비스 왕복](../reconstruction/native-skill-variants-service-roundtrip-20261106.json), [브라우저 왕복](../reconstruction/native-skill-variants-gui-roundtrip-20261106.json), [native 체크포인트](../reconstruction/native-skill-variants-checkpoint-20261106.json) | common/shared와 variant별 등록/편집·Kit/local/Git/npm 재가져오기·B/K/U/보류·복원·SIGKILL 및 CLI/HTTP/GUI 연결. 선택 receipt v2는 다른 variant 초안과 설치 전제를 분리. Codex native UI profile·선택 3·보조 binary/version/scope/strategy 증거·원형 bytes/mode 보존 구현. 관리 native source 편집/병합 후 세 조합 인식/복원 및 전역 copy 실제 브라우저 계획/적용/이력 rollback 확인. 831/53/91·typecheck·desktop 통과. async 검증 코드 실패와 중간 HTTP 403 출처 미확정/진단 기록. 호출 정책·native Tool 의존성·다른 native 형식/client·exclusive·추가 discovery 설정·관리 해제·전체 GUI·PR10/07/09/11은 남아 있으며 C07 전체 완료로 합산하지 않음 |

| AK-SR39 | 새·변경 공통/typed 설치의 파일·소유 기록·전이 pin·consumer revision을 무쓰기로 예측하고 실제 commit 전 대조, 설정/외부 링크 보존 | [예측 계약](../contracts/deployment-installation-prediction-v1.md), [TDD·임시 적용/복원 기록](../reconstruction/phase-scoped-dependencies.md), [사용자 원장 읽기](../reconstruction/deployment-prediction-live-compatibility-20261106.json) | 666/44 및 desktop 통과. 새/갱신 consumer·MCP/지침/Skill·미게시 snapshot·umask/정렬·계획 변경/잔여 파일/증거 누락·불일치 복원 검증. 공개 실행/저장·native 원형/이관·모든 mutation 보호·예정 native 문맥·실제 교차 scope consumer 왕복은 후속 |

| AK-SR40 | 전역 원본 제거/관리 해제와 프로젝트 등록의 잠금 경합을 막고 v4 역참조·기존 native/saved/path/snapshot writer 보호를 유지 | [원본 보호 계약](../contracts/source-dependency-guards-v1.md), [실패·두 잠금 순서·적용/복구 기록](../reconstruction/phase-scoped-dependencies.md), [사용자 읽기 검사](../reconstruction/source-guards-live-compatibility-20261106.json) | 679/45 및 desktop 통과. canonical origin·삭제/범위 이동·계획 후 등록·source lock/미존재·수동 편집 보존·예약 복구·원형 detach·v3/v4 조회 검증. 선택적 global mutation·예정 native 문맥·공개 교차 scope 집행과 실제 consumer 왕복은 후속 |

| AK-SR41 | 등록된 pin·모든 프로젝트 원장·native 설정 문맥을 보존하는 전역 변경의 내부 선별 집행과 동일 guard 기반 검토 복구 | [전역 변경 내부 계약](../contracts/global-dependency-mutation-v1.md), [TDD·SIGKILL·복구 재중단 기록](../reconstruction/phase-scoped-dependencies.md), [사용자 읽기 검사](../reconstruction/global-mutation-live-compatibility-20261106.json) | 697/45 및 desktop 통과. 18개 global 사례·원형 MCP 이름/baseline·layout/definition 분리·stale 계획·권한/inode·기존 runtime hook·파일/tree 복구·프로젝트/index 무쓰기 검증. 공개 dispatch·global rollback/이관·예정 native 문맥 전환과 실제 consumer 왕복은 후속 |

| AK-SR42 | pin을 보존하는 기존 전역 apply/remove·정상 rollback·저장 재개·중단 복구를 공통 CLI/HTTP/GUI로 실행하고 강제 flag·stale 문맥·수동 권한 변경 차단 | [전역 변경/저장 v4 계약](../contracts/global-dependency-mutation-v1.md), [TDD·CLI·파일/tree rollback SIGKILL](../reconstruction/phase-scoped-dependencies.md), [사용자 읽기 검사](../reconstruction/global-dispatch-live-compatibility-20261106.json), [체크포인트](../reconstruction/global-dispatch-checkpoint-20261106.json) | 718/48/77 및 typecheck·desktop 통과. 공개 경로 20개·원래 provider rollback 차단·보조 native 정의 변경·저장 복구 멱등성·프로젝트/index 무쓰기 검증. Manifest v3 집행/저장·등록/해제/두 scope 복구·native 원형/이관 예측과 설정 전환·실제 consumer 왕복·C07은 미완료 |

| AK-SR43 | 검토한 프로젝트 설정 적용 후 native 전제를 새로 관측하고 async 대기 중 잠금·원장/수동 편집을 보존하며 최초 미변경 설정을 정확히 복원 | [native 문맥 전환 계약](../contracts/native-context-transition-v1.md), [TDD·async workflow·실패 기록](../reconstruction/phase-scoped-dependencies.md), [실제 Codex 왕복](../reconstruction/codex-native-context-transition-roundtrip-20261106.json), [체크포인트](../reconstruction/native-transition-checkpoint-20261106.json) | 733/48 및 desktop 통과. before/after private proof·동명 Skill 가림·await 중 lease/원장 교체·sync Promise 차단·파일/tree·최초 제거 표현 보존 검증. 격리 실제 v4 Skill/선택 MCP 재발견·등록 활성/해제·바이트/권한/링크 복원, 사용자 HOME 무쓰기·모델/Tool 실행 0. 공개 v3·전체 writer·전역 설정 전환·진단·consumer 활성/C07은 미완료 |

| AK-SR44 | 공개 v3 계획·native 관측/재관측·저장 v5 재개·적용/제거와 두 scope 복구를 CLI/HTTP/GUI에 연결하고 기존 consumer·Tool binding·claim과 외부 설정을 보존 | [실행 계약](../contracts/scoped-deployment-execution-v1.md), [TDD·SIGKILL·실제 CLI 기록](../reconstruction/phase-scoped-dependencies.md), [실제 공개 Codex CLI](../reconstruction/scoped-public-codex-cli-roundtrip-20261106.json), [체크포인트](../reconstruction/scoped-public-checkpoint-20261106.json) | 748/49/80 및 typecheck·desktop 통과. 새 서비스 15개·retained provider·claim 교체·old contract 위장·두 scope saved 복구 검증. 실제 CLI 저장/재개/제거·바이트/권한/링크 복원, model/Tool 실행 0. 사용자 원장/관리 파일/링크 유지, Antigravity 앱 시작 시각의 설정 차이 1건은 원인 미확정으로 현재 값 보존·별도 기록. 의존성 rollback·native/이관·전역 설정 전환·진단/편집·C07은 후속 |

| AK-SR45 | 프로젝트 의존성 rollback·참조만 해제하는 변경을 frozen 설치 closure로 검토하고 파일/설정·소유 snapshot·양쪽 등록·저장 재개/복구를 함께 보존 | [rollback 계약](../contracts/scoped-deployment-rollback-v1.md), [TDD·SIGKILL 기록](../reconstruction/phase-scoped-dependencies.md), [실제 공개 CLI](../reconstruction/scoped-rollback-codex-cli-roundtrip-20261106.json), [체크포인트](../reconstruction/scoped-rollback-checkpoint-20261106.json) | 761/50/83 및 typecheck·desktop 통과. 초기/갱신/제거 복원·local 선언 전환·frozen Tool binding·동시 편집 보존·두 commit 경계 복구·실제 CLI 저장 rollback 재개/멱등성 검증. 사용자 원장/관리 파일/링크 유지, 기존 외부 설정 차이 현재 값 보존. native/이관 영향·전역 설정 전환·v3 진단/편집·PR07/09/11·C07은 후속 |

| AK-SR46 | v3 source 문맥의 검증·읽기 전용 진단·일반 선언 CRUD를 설치/배포와 분리하고 구버전 전역 원본의 프로젝트 참조·stable target 선택·peer/lock·외부 링크를 보존 | [원본 관리 계약](../contracts/scoped-manifest-management-v1.md), [TDD·CLI/HTTP/GUI 기록](../reconstruction/phase-scoped-dependencies.md), [기본 Kit 읽기 진단](../reconstruction/scoped-management-existing-kit-diagnostics-20261106.json), [체크포인트](../reconstruction/scoped-management-checkpoint-20261106.json) | 781/51/86 및 typecheck·desktop 통과. 새 source 시험 20개·무쓰기 doctor·구버전 전역/미설치 참조·detach 우회·동명/qualified·일괄 교체 target 보존·잠금 교체 전후 복원 검증. 사용자 원장/관리 파일/링크 유지·기존 외부 설정 차이 보존, binary/native/model/Tool 호출 0. native 원형/과거 경로·편입된 원본 v3 수명주기·전역 설정 전환·PR07/09/11·C07은 후속 |

[관측 계약](../contracts/local-resource-observation-v1.md),
[시험·실제 GUI 확인 기록](../reconstruction/phase-shared-resource-observation.md).
