# Master Kit

Git으로 관리하는 에이전트 마스터 키트.

```
kit/
├── harness/          # 🛡️ 공용: AGENTS.md, allowed-commands, hooks
├── skills/
├── mcp/
├── agents/
├── loops/
├── memory/
├── adapters/         # 🔌 클라이언트 전용 (antigravity/plugin.json 등)
├── .env.example
├── .env              (gitignore)
└── mcp-servers.local.json  (gitignore)
```

```bash
cp .env.example .env
agents-kit apply
```
