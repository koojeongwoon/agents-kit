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
| AK-D15 | Retain self-target and symlink escape prevention | AGENTS.md, baseline | Implemented (see [security-boundary.js](file:///Users/in07375_etc23a00026_mac/__dev/agents-kit/lib/security-boundary.js); tested in [security-boundaries.test.js](file:///Users/in07375_etc23a00026_mac/__dev/agents-kit/test/security-boundaries.test.js) and [manifest-cli.test.js](file:///Users/in07375_etc23a00026_mac/__dev/agents-kit/test/manifest-cli.test.js)) |
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
