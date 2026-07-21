---
name: loop-verify
description: >-
  Maker-Checker verification for loop output. Use after a loop run completes
  implementation to grade against LOOP.md Done condition before updating memory.
compatibility: Cursor, Codex, Antigravity
---

# Loop Verify (Maker-Checker)

루프 실행 결과를 LOOP.md의 Done condition으로 검증한다.

## When to Use

- loop-runner가 Prompt 수행을 마친 직후
- automation/schedule run의 마지막 단계
- memory.md 갱신 **전**

## Procedure

1. **Load rubric**: `loops/<name>/LOOP.md`의 Done condition 섹션을 rubric으로 사용한다.
2. **Check each item**: 항목별 pass/fail과 근거(파일 경로, 명령 출력)를 기록한다.
3. **Run sensors** (가능하면 결정적 검증 우선):
   - linter / typecheck
   - test suite
   - git diff scope check
4. **Verdict**:
   - **pass**: 모든 Done condition + sensors 통과 → memory 갱신 허용
   - **fail**: 실패 항목 목록 + 수정 제안 → Maker에게 반환, memory 갱신 금지

## Output Format

```markdown
## Verification YYYY-MM-DD HH:MM

| Done condition | Result | Evidence |
|----------------|--------|----------|
| (item 1)       | pass/fail | ... |

**Verdict**: pass | fail
**Action**: (pass → update memory / fail → retry items)
```

## Sub-agent Mapping

| Client | Checker 호출 |
|--------|-------------|
| Codex | `.codex/agents/` 또는 `agents/security-auditor.md` 참조 spawn |
| Cursor | review-bugbot / review-security 스킬 또는 별도 agent |
| Antigravity | invoke-subagent + `agents/code-reviewer.md` |

Checker는 **구현에 관여하지 않는다**. rubric과 sensor 결과만 보고 판정한다.
