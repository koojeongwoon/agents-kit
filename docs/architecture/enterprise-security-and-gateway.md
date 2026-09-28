# Architecture Design: Enterprise Endpoint Security & Tool Gateway Integration

> 2026-09-25 기기 신원 연동 합의: IAM이 등록·회수를 소유하고 각 서비스는 필요한 기기 신원을 OAuth/OIDC scope·claim 및 요청 증명 계약으로 소비한다. Gateway가 첫 소비자이며 다른 IAM 서비스에는 일괄 강제하지 않는다. [상세 계약](iam-device-identity-contract.md)과 현재 구현 계획의 LM2/G-1A/G-2를 따른다.

> 현재 구현 기준은 [Agent Kit·데몬·Tools Gateway 구현 계획](../product/three-component-implementation-plan.md)이다.
> 외부 네트워크 보안 제품 연동은 이번 범위에서 제외한다. 아래는 초기 구상 기록이며
> 실제 구현 경로·책임·완료 기준은 현재 계획을 따른다.
> 현재 원격 MCP 경로는 AI 클라이언트→Gateway 직접 호출이다. 기기 등록·회수의 기준은 IAM, 데몬→Gateway는 정책 상태·로컬 이벤트와 제한된 단말 관리 작업을 위한 관리 채널로 계획한다. 아래 인라인 데몬 경유 도식은 초기 후보이며 현재 구현 경로가 아니다.

> 상태: 초기 구상안. 기능별 실현 가능성·우선순위·기대효과와 진행 기준은
> [제품 계획 평가](../product/security-companion-plan.md)를 따른다.
> 아래의 전체 호출 가로채기, 즉시 복구, 0.1초 회수, 위변조 방지 및 클라이언트 매핑은
> 검증된 지원·성능 보장이 아니다. 평가 문서의 범위와 조건을 확인한 뒤 상세 설계를 갱신한다.

## 2026-09-24 확정한 제품 역할

- **Agent Kit:** 개인 로컬 CLI/GUI와 이를 지원하는 로컬 서버. Manifest·Skill/MCP·클라이언트 설정 배포 및 자기 PC의 데몬 상태를 관리한다.
- **Tools Gateway + 연계 중앙 UI:** 조직 정책·승인·회수, 등록 기기의 관리 자원 현황과 제한된 관리 작업·중앙 감사를 담당한다. IAM이 기기 등록·신원을 소유한다.
- **Tools Daemon:** Kit 로컬 IPC와 데몬이 개설한 중앙 관리 채널의 요청을 검증하고, 허용된 단말 작업을 공통 집행 경계에서 수행한다. 두 UI와 독립 실행한다.
- 중앙 관리 범위는 승인된 MCP 묶음·조직 Skill/설정·검증된 도구 작업 영역·상태/감사다. 작업을 고정 스키마로 제한하고 기존 계획·소유권·롤백을 재사용한다.
- 다음 순서는 **Kit 로컬 상태 조회 → 중앙 상태 조회 → 정책·회수 → 승인 자원 배포 → 운영 검증**이다. 현재 구현 및 완료 조건은 위의 구현 계획 LM1~LM5를 따른다. 중앙 연계는 추가 구현 대상이다.

아래 초기 후보 도식·서버 역할보다 이 확정 내용과 현재 구현 계획이 우선한다.

## 1. 개요 및 배경

대상은 회사 지급 PC와 업무에 사용하는 개인 소유 PC 모두다. 업무 사용 시 Agent Kit 설치·조직 등록을 필수로 하고, 필요한 관리 정책이 검증된 기기만 보호 대상 회사 자원에 접근하도록 설계한다. 직원이 로컬 AI 클라이언트에 비인가 MCP를 추가해 회사 자료를 사용하는 위험을 핵심 위협으로 둔다. 비인가 MCP 차단과 기기 접근 조건은 제품 계획 평가의 P0에 포함하며, 클라이언트 조직 정책과 OS/단말 관리 통제를 결합해 검증한다. 설치 여부만으로 정책 준수나 우회 방지를 보장하지 않는다.

Agent Kit은 기본적으로 멀티 LLM 클라이언트(Claude Code, Cursor, Codex, Antigravity 등)의 설정 및 공통 자원(지침, MCP, 스킬, 서브에이전트)을 관리·배포하는 **Configuration & Distribution Plane**입니다.

기업 고객이 서버 측 **Tool Gateway**를 사용하는 환경에서 개발자 로컬 PC(엔드포인트)에 에이전트를 도입할 때, 로컬 환경의 자율성과 편의성은 극대화하면서 기업 보안(데이터 유출 방지/DLP, 섀도우 툴 방지, 전사 감사)을 만족시키기 위해 **로컬 백그라운드 보안 데몬(`agentkitd`)**과 **Tool Gateway 연동 2단계 심층 방어(Dual-Defense)** 체계를 구축합니다.

---

## 2. 2단계 심층 방어 (Dual-Defense) 구조

```text
[개발자 UI / 로컬 클라이언트]
  - Claude Code, Cursor, Codex, Antigravity, VS Code Copilot
  - Agent Kit Desktop App (Control Center GUI)
               │
               ▼ (Local IPC / Interceptor)
┌────────────────────────────────────────────────────────┐
│ 1차 방어선: 로컬 보안 데몬 (agentkitd)                 │
│  - Config Sentinel: 설정 파일(~/.claude.json 등) 변조 감시│
│  - Tool Allowlist: 서명/해시 검증 기반 미인가 툴 차단  │
│  - In-line DLP: 로컬 프롬프트/인자 시크릿 & PII 1차 마스킹│
│  - Local Audit Buffer: SQLite WAL 기반 위변조 방지 해시체인│
│  - Browser Guard: 격리 브라우저 인스턴스 & 도메인 화이트리스트 │
└────────────────────────────────────────────────────────┘
               │ (mTLS / Session Token)
               ▼
┌────────────────────────────────────────────────────────┐
│ 2차 방어선: 사내 Tool Gateway (서버 측)               │
│  - RBAC / ABAC 세션 및 스코프 검증                     │
│  - 2차 심층 DLP & 프롬프트 인젝션 방어                 │
│  - 실시간 이상 탐지 & 서킷 브레이커 (비정상 호출 차단)   │
│  - 비상 원격 킬 스위치 (Kill-Switch) 푸시               │
│  - 불변 감사 저장소 (WORM) 및 사내 SIEM 연동           │
└────────────────────────────────────────────────────────┘
               │
               ▼
   [사내 내부 인프라 / DB / 외부 SaaS]
```

---

## 3. 계층별 책임 및 상세 설계

### 3.1 데스크톱 앱 (Control Center GUI)
- **개발자 대면 편의성 허브**:
  - 단일 UI에서 프롬프트/지침(AGENTS.md, rules) 및 사내 공통 자원(MCP, Skill, Subagent) 카탈로그 탐색 및 관리.
  - 비파괴적 병합(Structured Merge)을 통해 개발자 개인 설정 보존 및 시각적 Diff 미리보기 제공.
  - 보안 정책에 의해 도구가 차단되었을 때, **1-Click 사내 예외 승인 요청(Slack/결재 연동)** 모달 제공.

### 3.2 로컬 보안 데몬 (`agentkitd`)
- **OS 상주 서비스**:
  - macOS(`launchd`), Linux(`systemd`), Windows Service로 자동 구동.
- **Config Sentinel**:
  - 클라이언트 설정 파일(`~/.claude.json`, `.cursor/mcp.json`, `.codex/config.toml` 등)을 실시간 감시(File Watcher).
  - 인가되지 않은 수동 추가 또는 악성 스크립트 변조 감지 시 즉각 롤백 및 데스크톱 알림.
- **서명 기반 도구 얼로우리스트 (Signed Tool Allowlist)**:
  - 중앙 Gateway에서 전자서명(Ed25519)한 `allowed-tools.manifest.json` 동기화.
  - 로컬 MCP 바이너리/스크립트의 SHA-256 체크섬을 검증하여, 서명이 없거나 불일치 시 `Fail-Closed`로 실행 차단.
- **1차 인라인 DLP (Inbound/Outbound)**:
  - 도구 호출 인수(Arguments) 및 출력(stdout/stderr) 속 AWS 키, 사내 토큰, 개인정보(주민번호/카드번호) 정규식/NER 기반 실시간 스크러빙(`[REDACTED]`).
- **위변조 방지 로컬 감사 버퍼**:
  - SQLite WAL 기반 해시체인(Hash Chaining) 구조로 로그를 기록하여 로컬 파일 삭제/변조 시 무결성 이상 감지.
  - 네트워크 단절 시 로컬 큐잉 후 복구 시 Gateway로 자동 스트리밍.
- **엔터프라이즈 제어형 브라우저 엔진**:
  - 개인 브라우징과 물리적으로 분리된 전용 Chromium 인스턴스 구동.
  - 사내 화이트리스트 도메인 외 URL 이동 차단 및 고위험 액션 시 화면 캡처 썸네일 감사 전송.

### 3.3 서버 측 Tool Gateway
- **실시간 이상 행위 감시 & 서킷 브레이커**:
  - 비정상 호출 빈도(Rate Limit), 대량 데이터 덤프 시도 감지 시 즉각 세션 동결 및 엔드포인트 중지 신호 발송.
- **2차 심층 DLP & 탈옥 방어**:
  - 문맥 기반 사내 특화 기밀(소스코드 서명, 재무 정보) 유출 및 프롬프트 인젝션 2차 검증.
- **중앙 원격 킬 스위치 (Kill-Switch)**:
  - 보안 침해 또는 단말 분실 시 관리자 콘솔에서 단말별/전사 툴 접근 권한 0.1초 내 즉시 파기.
- **전사 감사 저장소 & SIEM 연동**:
  - 로컬 엔드포인트 로그와 서버 도구 실행 로그를 상관분석(Correlation)하여 불변 저장(WORM) 및 Splunk/Datadog 연동.

### 3.4 모바일 기기 (Mobile Remote Controller & 2FA Authenticator)
- **접근 관점의 명확화**:
  - *관점 A (모바일 기기 자체 통제)* 대신 **관점 B ("모바일 기기로 기존 PC/서버 업무 환경을 통제")** 모델을 채택.
  - 모바일 OS 샌드박스 제약 및 개인 프라이버시 침해(BYOD)를 피하고, 모바일을 가볍고 강력한 **"에이전트 원격 리모컨 & 결재 도장"**으로 포지셔닝.
- **주요 기능**:
  - **생체인증 기반 HITL 2단계 승인 (Biometric 2FA)**: PC 에이전트가 고위험 액션(DB 업데이트, 파일 삭제, 배포) 시도시 직원 스마트폰 푸시 알림 ➔ FaceID/지문 인식으로 1초 승인/반려.
  - **안전한 외근/이동 중 작업 위임 (Safe Remote Proxy)**: 외부에서 모바일 메신저/웹을 통해 질의 시, Tool Gateway를 거쳐 로컬 PC 작업 대행 지시 및 모바일 최적화 DLP(화면 캡처 유출 방지 마스킹) 적용 응답 수신.
  - **모바일 비상 킬 스위치 (Mobile Emergency Stop)**: 퇴근 후 또는 주말 이상 징후 알림 수신 시 모바일에서 즉시 에이전트 세션 동결.

---

## 4. 클라이언트별 공식 에셋 매핑 기준

| 클라이언트 | 지침 (Instructions / Rules) | 설정 (Settings) | MCP 도구 | 스킬 (Skills) | 서브에이전트 (Subagents) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Claude Code** | `CLAUDE.md`, **`AGENTS.md`** | `~/.claude/settings.json`, `.claude/settings.json` | `~/.claude.json`, `.mcp.json` | `.claude/skills/{id}` | `.claude/agents/{id}.md` |
| **Cursor** | `.cursor/rules/{id}.mdc` | `~/.cursor/rules` (UI) | `.cursor/mcp.json`, `~/.cursor/mcp.json` | `.cursor/skills/{id}` | - |
| **Codex** | `AGENTS.md`, `~/.codex/AGENTS.md` | `.codex/config.toml`, `~/.codex/config.toml` | `.codex/config.toml` (`[mcp_servers]`) | `.agents/skills/{id}` | `[subagents.<id>]` in config.toml |
| **Antigravity** | `AGENTS.md`, `GEMINI.md` | `~/.gemini/antigravity-cli/settings.json` | `.agents/mcp_config.json`, `~/.gemini/.../mcp_config.json` | `.agents/skills/{id}` | Runtime Built-in & `.agents/` |
| **VS Code** | `.github/copilot-instructions.md` | `.vscode/settings.json` | VS Code Extension Settings | - | - |
