# CA04-3: Antigravity MCP 승인 차단 식별

2026-09-27. 상태: **Antigravity CLI 1.2.12의 비대화형 MCP 권한 거절 확인.
사용자 승인 후 실제 호출 검증은 [CA04-4](phase-ca04-4-antigravity-mcp-use.md)로 이어졌다.**

## 확인한 원인

기존 native 로그인으로 모델 요청은 정상 실행되지만, MCP를 요청한 turn에서 CLI가
`"mcp" permission`을 비대화형으로 승인받을 수 없어 자동 거절했다고 stderr에 명시했다.
실제 반환은 exit 0, terminal status SUCCESS, 빈 응답이었다. 따라서 앞 단계의 빈 응답을
로그인 실패로 설명하거나 성공한 MCP 사용으로 처리해서는 안 된다.

[공식 headless 문서](https://antigravity.google/docs/cli/headless/#permissions-in-headless-mode)는
이 동작을 soft-denial로 설명하며, 거절 후에도 exit 0이 가능하다고 명시한다.
[CLI 권한 문서](https://antigravity.google/docs/permissions#cli-fine-grained-permissions)에 따르면
MCP의 기본 정책은 Ask이고 세부 allow 규칙은 사용자 settings.json에 둔다.

CLI 안내는 권한 종류가 MCP라는 사실까지 제공한다. 개별 서버/도구 이름은 안내에 없으므로,
특정 도구의 거절이 native 이벤트로 식별됐다고 확대 해석하지 않는다. 이번 프롬프트는
고정 시험 서버 `ca04-marker`의 `read_marker`만 요청했다.

## 검증기 변경

- stderr의 알려진 MCP 거절 안내를 `MCP_PERMISSION_REQUIRED`로 분류한다.
- exit 0과 terminal SUCCESS는 원래 관측으로 보존하되 `success: false`, `confirmed: false`다.
- 분할되어 도착하는 stderr도 8 KiB 범위 안에서 판별한다. 보고서에는 안내 원문이나
  명령·인증 값 대신 boolean과 고정 오류 코드를 저장한다.
- Antigravity의 init 도구 목록, 공개 도구 승인 요청, terminal 상태를 구별한다.
  init 목록에 시험 서버가 없다는 사실만으로 프로젝트 MCP 미지원을 선언하지 않는다.
- 모델 추론 내용은 디코딩하거나 기록하지 않는다. step 종류만 진단 metadata로 남긴다.
- production runtimeEvidence 및 사용자 설정은 변경하지 않았다.

[실기 증거](ca04-3-antigravity-mcp-permission-evidence.json)에는 설치본 버전과 스크립트 hash,
권한 차단 관측을 남겼다. 초기 진단에서 확인한 안내 문장은 원인 분석에만 사용했고
보고서에는 원시 stderr를 넣지 않았다.

## 다음 실행을 위한 변경안

[검토 가능한 설정 변경안](ca04-3-antigravity-permission-plan.json):

```json
{"permissions.allow": ["mcp(ca04-marker/read_marker)"]}
```

이 표기는 기존 permissions.allow 배열에 **한 항목만 추가하는 diff**다. settings.json
전체나 기존 allow 배열을 이 JSON으로 교체하라는 뜻이 아니다. 현재 동일 허용 규칙은
없으며, 같은 도구에 적용되는 정확한 규칙·서버 와일드카드·전체 MCP 와일드카드의
ask/deny도 발견하지 못했다. 기존 Ask/Deny를 덮어쓰는 동작은 계획하지 않는다.

사용자가 이 항목의 임시 추가와 검증 직후 원복을 명시적으로 승인했다. 실제 적용·호출·
설정 복원 관측은 [CA04-4 기록](phase-ca04-4-antigravity-mcp-use.md)에 별도로 남긴다.
이 문서의 차단 증거와 변경안 JSON은 승인 전 상태를 보존한다.
전체 도구 권한 우회, 재로그인, credential 복사는 필요하지 않다.

## 검증

- exit 0/SUCCESS여도 MCP 자동 거절을 성공으로 판정하지 않는 회귀 테스트.
- 분할 stderr, 진단 원문 비노출, 도구 노출/승인 요청/실제 사용의 구별.
- 전체 `npm test`: 214 tests 통과.

커스텀 Agent 실행, 전역 모델 사용, 앱/IDE, 데몬 배포는 이 단계로 완료 처리하지 않는다.
