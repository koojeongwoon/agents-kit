# CA04-2: 기존 로그인으로 CLI 모델 사용 검증

2026-09-27. **재로그인 불필요. 프로젝트 지침·Skill의 실제 사용 검증을 추가했고,
Codex는 stdio MCP까지 확인했다. CA04 전체 및 production 지원 승격은 미완료다.**

## 인증 정정과 검증 경계

CA04-1에서 `Not logged in`이 나온 것은 인증이 없는 새 테스트 HOME이었다.
현재 사용자 홈의 Codex 로그인은 ChatGPT로 정상이며, Antigravity도 기존 인증으로 실제
모델 응답을 반환했다. 전용 프로필 로그인은 필수가 아니다.

새 `npm run verify:client-use`는 native HOME/CODEX_HOME의 인증을 그대로 이용한다.
인증 파일을 읽어 복사하거나 새 로그인·credential 갱신을 직접 수행하지 않는다.
Kit 배포 대상과 원본·원장·시험용 ClientDefinition은 매 실행 새 임시 폴더에 둔다.
사용자 홈의 설정은 수정하지 않는다. 이는 **프로젝트 자원 격리이며, 전체 홈 격리는 아니다**.
클라이언트의 전역 지침·Skill·관리 정책이 영향을 줄 수 있다.

Codex는 `--ignore-user-config --ignore-rules --ephemeral --sandbox read-only`로 실행하며,
프로젝트 trust는 실행 인자로만 전달한다. Antigravity는 `--sandbox --mode plan`과
기본 승인 정책을 유지한다. 전체 권한 우회 옵션은 사용하지 않는다.
검증기는 원시 대화/로그/추론을 파일에 저장하지 않지만, Antigravity 자체의 native
대화 기록·캐시가 남지 않는다고 보장하지는 않는다.

## 관측과 증거

[기계 판독 결과](ca04-2-cli-model-use-evidence.json)에 실행별 정확한 버전·OS·아키텍처,
검증기·collector·시험 MCP·실행 파일·ClientDefinition의 SHA-256과 단계별 boolean을 남긴다.
초기 CA04-1의 Antigravity 1.2.11 증거와 이번 1.2.12 증거는 서로 대체하지 않는다.

| 범위 | Codex CLI 0.145.0 | Antigravity CLI 1.2.12 |
| --- | --- | --- |
| 프로젝트 지침 | 질문에 없는 무작위 표식을 새 세션 응답에서 대조 | 같은 방식으로 대조 |
| 프로젝트 Skill | 부속 파일을 읽은 성공한 command 이벤트 + 정확한 응답 표식 | 부속 파일을 지정한 성공한 view_file 이벤트 + 정확한 응답 표식 |
| 프로젝트 stdio MCP | 모델의 ca04-marker/read_marker 호출 성공 + 도구 결과와 응답 표식 | MCP 포함 시험은 최종 응답이 비고 호출 성공을 확인하지 못함 |
| 커스텀 Agent | 미검증 | 미검증 |
| 전역 자원 모델 사용, 앱/IDE | 이번 범위 밖 | 이번 범위 밖 |

**최종 실행 결과:** Codex 지침·Skill·stdio MCP와 Antigravity 지침·Skill은 각각
다섯 단계 모두 `confirmed: true`, `fullLifecycleConfirmed: true`다. Antigravity의
MCP 포함 적용 시험은 `confirmed: false`로 별도 보존했다.

수명주기는 baseline → apply v1 → update v2 → remove → removal rollback이다.
각 단계에서 새 모델 세션을 시작한다. 지침·Skill·MCP마다 서로 다른 96-bit 무작위 표식을
쓰고, 갱신 때 다시 생성한다. 질문에는 정답을 넣지 않는다. baseline/제거는 `ABSENT`를
요구하며, 파일이 없다는 사실만으로 정상 동작을 판정하지 않는다.

`fullLifecycleConfirmed`는 해당 실행의 **resources에 나열된 자원만** 대상으로 한다.
Antigravity의 `resources: [instructions, skill]` 실행은 MCP 사용 성공이 아니다.
그 실행의 `final.mcp: true`는 요청대로 `ABSENT`를 반환했다는 비교 결과일 뿐이며,
`mcpToolCalled`는 false다. 전체 CA04는 항상 `complete: false`, 종료 코드 2다.

두 CLI의 공개 도구 이벤트에는 파일 내용을 그대로 포함하지 않는 관측이 있어,
정확한 부속 파일 경로의 성공한 읽기 이벤트와 정답을 모르는 새 세션의 표식 응답을 함께
요구한다. 응답만 있거나 파일 읽기만 있는 경우에는 통과하지 않는다. 빈 최종 응답은
CLI status가 SUCCESS여도 검증 성공으로 처리하지 않는다.

## 구현 중 확인한 차이

- Codex 0.145.0의 `-c` 경로 parser는 점으로 단순 분리한다. 인용된 경로를 dotted key에
  넣지 않고 `projects={"/temporary/project"={trust_level="trusted"}}` 테이블 값으로 전달했다.
  이는 검증기 수정이며 제품 설정 형식이나 사용자 설정을 변경한 것이 아니다.
- 시험 MCP의 동작은 고정 문자열 반환뿐이다. 이에 맞게 `readOnlyHint`, `idempotentHint`,
  `destructiveHint: false`, `openWorldHint: false`를 선언한 뒤 Codex 호출이 성공했다.
  선언 전에는 호출 취소가 관측됐다. 이것을 임의 MCP의 자동 승인 보장으로 일반화하지 않는다.
- Antigravity는 MCP를 요청한 시험에서 파일 읽기 이후 빈 응답을 반환했지만, 같은 조건에서
  MCP를 제외한 지침·Skill 요청은 성공했다. 공식 문서의 기본 MCP 승인 요구와 일치하는
  후보 원인이지만, 이 관측만으로 승인 거절이나 프로젝트 MCP 미지원이라고 확정하지 않는다.
  사용자 전역 allow/ask/deny 설정은 변경하지 않았다.

## 재현

이 명령은 기존 계정의 실제 모델 호출을 사용한다. 일반 `npm test`에는 포함되지 않는다.

```sh
# Codex: 지침·Skill·stdio MCP 전체 수명주기
npm run verify:client-use -- --client codex --codex /absolute/path/to/codex \
  --output /tmp/codex-model-use.json

# Antigravity: 지침·Skill 수명주기
npm run verify:client-use -- --client antigravity --resources instructions-skills \
  --antigravity /absolute/path/to/agy --output /tmp/antigravity-model-use.json

# MCP 포함 적용 단계만 진단
npm run verify:client-use -- --client antigravity --stages applied \
  --antigravity /absolute/path/to/agy --output /tmp/antigravity-mcp-probe.json
```

실행당 90초/표준출력 4 MiB 제한, 소유한 프로세스 그룹 종료, 임시 파일 정리를 수행한다.
collector는 추론 이벤트를 JSON 디코딩 전에 제외하고 공개 답변·도구 결과를 boolean으로
축약한다. 오류 본문·명령 본문·표식 원문·native 대화 ID는 보고서에 넣지 않는다.
임시 정의의 bootstrap evidence는 실제 공통 배포 서비스를 시험하기 위한 fixture일 뿐이다.
`clients/*.yaml`의 production runtimeEvidence는 활성화하지 않았다.

## 근거와 남은 단계

- [Codex 비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode): 기존 인증, exec/ephemeral, JSON 이벤트.
- [Codex 0.145.0 override parser](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/config/src/overrides.rs): trust 인자의 dotted key 해석 확인.
- [Antigravity headless](https://antigravity.google/docs/cli/headless/): 캐시된 인증, 출력 형식과 공개 도구 이벤트.
- [Antigravity CLI permissions](https://antigravity.google/docs/permissions#cli-fine-grained-permissions): 전역 settings.json과 MCP 기본 Ask 정책.

[CA04-3](phase-ca04-3-antigravity-mcp-permission.md)에서 Antigravity의 MCP 권한 자동 거절을
확인했다. 다음은 시험 도구만 임시 허용한 뒤 호출을 확인하고, 커스텀 Agent 실행과
전역 모델 사용을 독립 검증하는 것이다. CA05 앱/IDE와 CA06 Gateway→daemon 배포는
이 CLI 증거로 완료 처리하지 않는다.

## 회귀 검증

`npm test`: **212 tests 통과**. 시간·출력 제한, 인증 환경변수 비전달, 추론 이벤트 제외,
응답만으로 사용을 확정하지 않는 판정, 실패한 호출·다른 서버·이전 표식 거부,
Antigravity 공개 응답 보완 및 시험 MCP annotations를 검증한다.
