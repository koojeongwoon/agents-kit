# Cursor Adapter: daily-docs-sweep

## Option A — /loop (로컬, 빠른 테스트)

```
/loop 1d Run loop-runner for daily-docs-sweep.
Read __dev/agents-kit/loops/daily-docs-sweep/LOOP.md and follow it.
Use loop-verify before updating memory.md.
```

agents-kit 경로는 환경에 맞게 조정한다.

## Option B — Cursor Automations (프로덕션)

Automations editor에서 아래를 설정:

| Field | Value |
|-------|-------|
| Name | daily-docs-sweep |
| Trigger | Schedule — daily 09:00 Asia/Seoul |
| Repo | (대상 repo) |

### Instructions (Automations prompt)

```
Follow agents-kit loop-runner skill.

1. Read loops/daily-docs-sweep/LOOP.md (symlink or repo path)
2. Read and update loops/daily-docs-sweep/memory.md
3. Run loop-verify before persisting memory
4. Stop when Done condition is met

Sub-agent: agents/code-reviewer.md for diff review if edits were made.
```

### Tools

- git (repo access)
- MCP as needed (llm-wiki optional)

## Notes

- Cursor Automations는 클라우드 UI 설정. Instructions만 이 파일에서 복사.
- `/loop`은 Cursor 에이전트 세션 안에서만 동작 (cloud agent 제외 가능).
