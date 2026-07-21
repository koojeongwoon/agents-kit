# Global Agent Instructions

모든 AI 코딩 클라이언트(Cursor, Codex, Antigravity)에 공통 적용되는 규칙.

## Knowledge Base

- 기술·업무 질문 전 `llm-wiki` MCP의 `search_wiki_knowledge`를 1회 실행한다.
- 새 지식 기록은 사용자 확인 후 `commit_new_knowledge`로 수행한다.

## Working Agreements

- 변경 범위는 최소화한다. 요청과 무관한 코드는 수정하지 않는다.
- 기존 코드 스타일·네이밍·패턴을 따른다.
- 커밋은 사용자가 명시적으로 요청할 때만 한다.
- `.env`, credentials 등 시크릿 파일은 커밋하지 않는다.

## Harness (Ratchet Principle)

에이전트가 실수하면 출력만 고치지 말고 하네스를 고친다.

| 실수 유형 | 대응 |
|-----------|------|
| 규칙을 몰랐다 | `AGENTS.md` 또는 프로젝트 rules에 추가 (Guide) |
| 규칙을 어겼다 | hook/linter로 강제 (Sensor) |
| 정보가 부족했다 | Skill 또는 MCP 추가 (Context) |

## Sub-agents

서브에이전트 정의는 `agents/` 디렉터리를 참조한다.

- `agents/code-reviewer.md` — 코드 리뷰
- `agents/security-auditor.md` — 보안 검토

Maker-Checker 패턴: 구현(Maker)과 검증(Checker)을 분리한다.

## Loops

루프 레시피는 `loops/` 디렉터리를 참조한다.

실행 시 반드시:

1. 해당 `LOOP.md`를 읽는다.
2. `memory.md`를 읽고 이번 run 시작 상태를 파악한다.
3. Done condition 충족 후 `memory.md`를 갱신한다.

## MCP Usage

| MCP | 사용 시점 |
|-----|-----------|
| llm-wiki | 개인 지식·업무 이력 조회 |
| context7 | 라이브러리/API 최신 문서 조회 |
| playwright | 브라우저 UI 검증, 스크린샷 |
