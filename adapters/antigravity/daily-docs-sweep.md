# Antigravity Adapter: daily-docs-sweep

## Schedule

Antigravity `schedule` 도구로 등록. **런타임(IDE/CLI)이 켜져 있을 때만** 동작한다.

| Field | Value |
|-------|-------|
| name | daily-docs-sweep |
| cron | `0 9 * * *` |
| timezone | Asia/Seoul |

## Task Prompt

```
Follow loop-runner skill for daily-docs-sweep.

1. Read /Users/in07375_etc23a00026_mac/__dev/agents-kit/loops/daily-docs-sweep/LOOP.md
2. Read and update memory.md in the same directory
3. Apply loop-verify before persisting memory
4. If code edits were made, invoke-subagent code-reviewer per agents/code-reviewer.md

Stop when Done condition in LOOP.md is satisfied.
```

## 24/7 Unattended Alternative

Antigravity 내장 스케줄러는 앱 종료 시 중단된다. 무인 운영이 필요하면:

- macOS `launchd` → `codex exec` 또는 Antigravity CLI
- OCI / GitHub Actions cron

외부 스케줄러가 `adapters/codex/daily-docs-sweep.toml`의 prompt를 `codex exec`로 실행하는 패턴도 가능.

## Related Files

- Recipe: `loops/daily-docs-sweep/LOOP.md`
- Memory: `loops/daily-docs-sweep/memory.md`
- Global rules: `AGENTS.md`
