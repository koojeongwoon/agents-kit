# agents-kit

Cursor / Codex / Antigravity / Claude 등 모든 AI 코딩 클라이언트에 6대 핵심 자원(**하네스 · 스킬 · MCP · 서브에이전트 · 루프 · 전역 메모리**)을 원클릭으로 이식하고 동기화하는 멀티 어댑터 아키텍처.

## 🌟 이 repo가 하는 일

| 공용 마스터 (agents-kit) | 클라이언트별 배포 타겟 (adapters) |
|-------------------------|--------------------------------|
| 🛡️ 하네스 (`AGENTS.md`, `permissions/`) | symlink & JSON 설정 동기화 |
| ⚡ 스킬 (`skills/`) | symlink로 연결 (`~/.gemini/config/skills`, `~/.cursor/skills` 등) |
| 🔌 MCP (`mcp/mcp-servers.json`) | `mcp.json`, `claude_desktop_config.json` 자동 연결 |
| 🤖 서브에이전트 (`agents/`) | symlink로 연결 |
| 🔄 루프 (`loops/*/LOOP.md`) | 레포지토리 공용 |
| 🧠 전역 메모리 (`memory/global_memory.md`) | 개발자의 싱글 글로벌 개발 컨텍스트 일괄 공유 |

> **LangChain/LangGraph 불필요.**  
> 100% **Markdown / JSON 묶음 + Symlink + CLI / Tauri GUI 어댑터**로 가볍고 완벽하게 운영합니다.

---

## 📁 구조

```
agents-kit/
├── bin/                      # 💻 agents-kit CLI 툴 (npx agents-kit)
│   └── cli.js
├── AGENTS.md                 # 🛡️ 전역 규칙 (Guides)
├── permissions/              # 🛡️ 허용 명령어 백서 (allowed-commands.json)
├── skills/                   # ⚡ Agent Skills 표준 (agentskills.io)
├── mcp/                      # 🔌 공용 MCP 서버 정의 (mcp-servers.json)
├── agents/                   # 🤖 서브에이전트 역할 정의
├── loops/                    # 🔄 루프 레시피 + memory
├── memory/                   # 🧠 단일 개발자 전역 메모리 (global_memory.md)
├── adapters/                 # 클라이언트별 어댑터
├── gui/                      # 🖥️ Tauri v2 + React 기반 데스크톱 & 웹 대시보드
├── scripts/
│   ├── setup-symlinks.sh     # bash symlink 설치 스크립트
│   └── run-gui.sh            # GUI 실행 스크립트
```

---

## 🚀 사용법

### 1️⃣ 터미널 CLI 사용 (개발자 추천 🔥)

`agents-kit`을 글로벌 CLI로 등록하거나 `npx`로 바로 실행할 수 있습니다.

```bash
# 어디서나 1초 만에 전역 시스템(~/)으로 모든 자원 배포
agents-kit apply
# 또는
npx agents-kit apply

# 감지된 AI 클라이언트 상태 확인
agents-kit status

# 특정 프로젝트 폴더로 배포
agents-kit apply --project ./my-target-app

# 특정 AI 클라이언트(cursor 등)만 선택 배포
agents-kit apply --client cursor

# Git 원격 동기화 (Push / Pull)
agents-kit git --push
agents-kit git --pull
```

> **기존 파일 완전 보존**: 기존에 파일이 존재하는 경우 절대 그냥 삭제하지 않고 **`.bak` 백업 파일로 보존**한 뒤 심볼릭 링크를 연결합니다.

---

### 2️⃣ 🖥️ 대시보드 (GUI / macOS 데스크톱 앱)

원클릭 버튼과 시각적 인터페이스로 모든 자원을 관리합니다.

#### 웹 대시보드 실행
```bash
npm run gui
# 또는
./scripts/run-gui.sh
```

#### macOS 데스크톱 앱 실행 및 프로덕션 빌드
```bash
# 데스크톱 전용 독립 앱 실행
npm run tauri:dev

# macOS (.app / .dmg) 프로덕션 앱 패키징 빌드
npm run tauri:build
```

---

## 🎨 대시보드 핵심 기능

1. **⚡ Apply to Global & 📁 Apply to Project**:
   - `~/` 전역 시스템 또는 특정 프로젝트 디렉터리로 내 자원 묶음을 1-Click 일괄 배포.
2. **🎯 Selective Single-Client Deploy**:
   - Google Antigravity, Cursor, Codex, Claude 중 특정 클라이언트를 선택하여 개별 배포.
3. **📥 Import & Merge Existing Configs**:
   - 기존 클라이언트에 파편화되어 있던 `.cursorrules`, `permissions.json` 등을 `agents-kit` 마스터 자원으로 유실 없이 스마트 병합.
4. **Git-style Side-by-Side Diff 대조 & 병합**:
   - 기존 클라이언트 원본 파일 내용과 agents-kit 마스터 자원 내용을 시각적으로 대조한 뒤 한 번의 클릭으로 흡수 병합(`[Apply Merge]`).
5. **🐙 Git Remote & 1-Click Sync**:
   - GitHub 원격 저장소 URL 연결 및 1-Click `Commit & Push` / `Pull` 지원 (모든 연동 상태는 `.git/config`에 Git-Native 저장).

---

## 🔗 클라이언트별 자동 연결 타겟 경로

| AI 클라이언트 | 하네스 (AGENTS.md / 허용명령어) | 스킬 (skills/) | MCP (mcp/) | 전역 메모리 (memory/) |
|--------------|--------------------------------|----------------|------------|---------------------|
| **Google Antigravity** | `~/.gemini/config/AGENTS.md` | `~/.gemini/config/skills/` | `~/.gemini/config/mcp.json` | `~/.gemini/config/global_memory.md` |
| **Cursor IDE** | `~/.cursorrules` | `~/.cursor/skills/` | `~/.cursor/mcp.json` | `~/.cursor/rules/global_memory.md` |
| **Codex CLI** | `~/.codex/AGENTS.md` | `~/.codex/skills/` | `~/.codex/mcp.json` | `~/.codex/global_memory.md` |
| **Claude Desktop** | `~/Library/App Support/Claude/AGENTS.md` | - | `~/Library/App Support/Claude/claude_desktop_config.json` | `~/Library/App Support/Claude/global_memory.md` |

---

## 💡 개발 가이드 & 원칙

- **Pure Local & Git-Native**: 바이너리 DB를 사용하지 않고 마크다운/JSON과 Git 레포지토리 자체에 의존하여 어떤 디바이스나 OS 환경에서도 100% 작동합니다.
- **Ratchet 원칙**: 에이전트가 수행 중 실수를 하면 일회성 출력만 고치지 않고 `AGENTS.md` 지침(Guide)이나 하네스 센서(Sensor)를 강화합니다.
