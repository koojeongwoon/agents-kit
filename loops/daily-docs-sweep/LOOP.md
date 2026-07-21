# daily-docs-sweep

문서 staleness 점검 및 코드 근거가 명확한 경우만 수정.

## Cadence

- interval: `1d`
- timezone: `Asia/Seoul`
- preferred_time: `09:00`

## Prompt

`loop-runner` 스킬을 따른다. 아래를 순서대로 수행:

1. `memory.md`를 읽고 이전 run에서 남긴 stale 목록·미완료 항목을 확인한다.
2. 최근 git history(기본 7일)와 아래 문서를 비교한다:
   - `README.md`
   - `AGENTS.md`
   - `docs/**`
   - `*.md` (프로젝트 루트)
3. 코드 변경 대비 문서가 outdated로 보이는 항목을 목록화한다.
4. **코드 diff와 직접 대응되는 경우에만** 문서를 수정한다. 추측으로 수정하지 않는다.
5. `loop-verify` 스킬로 Done condition을 검증한다.
6. 검증 pass 시 `memory.md`에 run 기록을 추가한다.

## Done condition

- [ ] stale 후보 목록이 `memory.md`에 기록됨 (없으면 "none found" 명시)
- [ ] 수정한 파일마다 lint/format 통과 (해당하는 경우)
- [ ] 이번 run 요약이 `memory.md` 하단에 추가됨
- [ ] loop-verify verdict = pass

## Memory

path: `./memory.md`

## Skills

- loop-runner
- loop-verify

## Sub-agents (optional)

- Checker: `agents/code-reviewer.md` (수정 diff 리뷰)
