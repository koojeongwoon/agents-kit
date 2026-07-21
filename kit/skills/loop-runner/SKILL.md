---
name: loop-runner
description: >-
  Execute a loop recipe from loops/<name>/LOOP.md. Use when running a scheduled
  or recurring agent task, or when the user invokes /loop with a loop name.
compatibility: Cursor, Codex, Antigravity
---

# Loop Runner

공용 루프 실행 절차. 클라이언트 무관하게 동일하게 따른다.

## When to Use

- `loops/<name>/LOOP.md`가 존재하는 반복 작업
- `/loop` 또는 automation/schedule로 트리거된 run
- memory 기반 상태를 이어가야 하는 작업

## Procedure

1. **Load recipe**: `loops/<name>/LOOP.md` 전체를 읽는다.
2. **Load state**: `loops/<name>/memory.md`를 읽는다. 없으면 빈 상태로 시작한다.
3. **Execute prompt**: LOOP.md의 Prompt 섹션을 순서대로 수행한다.
4. **Verify**: Done condition을 하나씩 확인한다. 미충족 시 수정 후 재검증한다.
5. **Persist**: 아래 형식으로 `memory.md` 하단에 run 기록을 추가한다.

```markdown
## Run YYYY-MM-DD HH:MM

- status: completed | partial | failed
- summary: (1-3 sentences)
- next: (다음 run 힌트, optional)
```

6. **Stop**: Done condition 전부 충족 시 종료. 미충족 항목이 있으면 사용자에게 보고.

## Paths

agents-kit 루트 기준:

- Recipe: `loops/<name>/LOOP.md`
- Memory: `loops/<name>/memory.md`

프로젝트에 `loops/` symlink가 있으면 프로젝트 상대 경로를 사용한다.


<!-- Merged Existing Config from /Users/jw/.gemini/config/skills/loop-runner -->
(기존 파일 내용이 없습니다)