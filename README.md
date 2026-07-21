# agents-kit

Cursor / Codex / Antigravity / Claude 등 모든 AI 코딩 클라이언트에 6대 핵심 자원(**하네스 · 스킬 · MCP · 서브에이전트 · 루프 · 전역 메모리**)을 원클릭으로 이식하고 동기화하는 멀티 어댑터 아키텍처.

## 🌟 이 repo가 하는 일

| 공용 마스터 (`kit/`) | 클라이언트별 배포 타겟 |
|---------------------|----------------------|
| 🛡️ 하네스 (`harness/`) | symlink & JSON 설정 동기화 |
| ⚡ 스킬 (`skills/`) | symlink로 연결 |
| 🔌 MCP (`mcp/mcp-servers.json` + `.env`) | 클라이언트별 전역 MCP 설정 |
| 🤖 서브에이전트 (`agents/`) | symlink로 연결 |
| 🔄 루프 (`loops/*/LOOP.md`) | symlink로 연결 |
| 🧠 전역 메모리 (`memory/global_memory.md`) | symlink로 연결 |
| 🛡️ 훅 (`harness/hooks.json`) | symlink로 연결 |

> **LangChain/LangGraph 불필요.**  
> 100% **Markdown / JSON 묶음 + Symlink + CLI / Tauri GUI 어댑터**로 운영합니다.

---

## 📁 구조

```
agents-kit/                   ← 툴 (CLI, GUI)
├── bin/
├── gui/
├── lib/
└── kit/
    ├── harness/              # 🛡️ 공용: AGENTS.md, allowed-commands, hooks
    ├── skills/
    ├── mcp/
    ├── agents/
    ├── loops/
    ├── memory/
    ├── adapters/             # 🔌 클라이언트 전용 (antigravity/plugin.json 등)
    ├── .env.example
    ├── .env                    (gitignore)
    └── mcp-servers.local.json  (gitignore)
```

**kit-only repo**로도 운영 가능: `kit/` 내용만 별도 Git repo에 두고 `agents-kit apply --kit ~/my-agent-kit`로 배포.

---

## 🚀 사용법

```bash
cp kit/.env.example kit/.env
# kit/.env 편집

agents-kit apply                      # kit/ → 전역 클라이언트
agents-kit apply --kit ~/my-kit       # 외부 kit repo
agents-kit apply --client cursor      # Cursor만
agents-kit status
agents-kit git --push                 # kit/ 디렉터리 Git 동기화
```

---

## 🔗 클라이언트별 배포 타겟

| AI 클라이언트 | 하네스 | 스킬 | MCP | 메모리 |
|--------------|--------|------|-----|--------|
| **Antigravity** | `plugins/agents-kit/` + `allowed_commands.json` | `plugins/.../skills/` | `mcp_config.json` | `global_memory.md` |
| **Cursor** | `.cursorrules` | `.cursor/skills/` | `.cursor/mcp.json` | `.cursor/rules/global_memory.md` |
| **Codex** | `.codex/AGENTS.md` | `.codex/skills/` | `.codex/mcp.json` | `.codex/global_memory.md` |

### Antigravity 플러그인 vs 전역 분리

- **플러그인** (`plugins/agents-kit/`): rules, skills, agents, loops, hooks
- **전역** (`~/.gemini/config/`): `mcp_config.json`, `allowed_commands.json`, `global_memory.md`

### MCP 시크릿 (`kit/.env`)

| 파일 | Git | 역할 |
|------|-----|------|
| `kit/mcp/mcp-servers.json` | ✅ | 서버 구조 (`${VAR}` placeholder) |
| `kit/.env.example` | ✅ | env 변수 예시 |
| `kit/.env` | ❌ | API 키·개인 경로 |
| `kit/mcp-servers.local.json` | ❌ | apply 시 생성 → 클라이언트 symlink |

---

## 💡 원칙

- **Pure Local & Git-Native**: `kit/` 디렉터리 하나로 마스터 키트 버전 관리
- **Ratchet 원칙**: 실수 시 `kit/harness/AGENTS.md` 또는 하네스 센서 강화
