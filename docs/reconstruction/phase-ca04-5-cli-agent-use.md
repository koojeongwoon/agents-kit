# CA04-5: CLI 커스텀 Agent 응답·호출과 공개 출력의 한계

2026-09-27. 대상: macOS arm64, Codex CLI 0.145.0, Antigravity CLI 1.2.12, project.

**Agent 정의에 따른 단계별 응답 일치와 Antigravity 역할 호출을 관측했다.
하위 Agent 완료 결과를 직접 연결하는 검증은 미완료이며 production 지원을 활성화하지 않았다.**

## 검증 방식

공통 Manifest 배포 서비스로 임시 프로젝트에서 baseline → 적용 v1 → 갱신 v2 → 제거 →
제거 rollback을 실행한다. 매 단계 새 native 세션을 시작하며 기존 로그인을 사용한다.
Agent 이름은 실행마다 무작위로 정하고, 독립적인 96-bit 표식은 Agent 본문에만 넣는다.
부모 질문이나 Agent 설명에는 표식이 없다. 부모에게 정확한 사전 정의 역할만 호출하도록
지시하고 파일·로그 읽기, shell, MCP, 임시 Agent 정의와 모델 재설정을 금지한다.

사용자 설정·권한·인증 파일은 변경하지 않는다. 시험용 client definition에만 임시
bootstrap evidence를 넣으며 저장소의 `runtimeEvidence`는 그대로 비워 둔다.
검증기는 공개 응답·호출 메타데이터를 비교한 boolean과 고정 진단만 저장한다.
추론 이벤트는 JSON decode 전에 제외한다. 원시 대화, 표식, native conversation ID는
보고서에 저장하지 않는다. native 클라이언트 자체의 history/cache 생성은 별개다.

## 증거 수준

| 수준 | 통과 조건 | 의미 |
| --- | --- | --- |
| `markerConfirmed` | 정상 종료 + 현재 단계 표식/ABSENT + 금지 도구 미관측 | Agent 정의 변경에 따른 최종 모델 응답 |
| `invocationConfirmed` | 위 조건 + 정확한 역할과 실제 child ID를 가진 완료 호출 | 커스텀 역할 호출과 최종 응답 연결 |
| `confirmed` | 위 증거에 해당 하위 Agent의 성공한 완료 결과까지 확인 | 직접 관측한 하위 Agent 완료 증거 |

부모 최종 응답만으로 `confirmed`를 true로 만들지 않는다. 제거 단계에서 이름만 포함한
실패한 Antigravity 호출 메타데이터는 `roleRequested`일 뿐 `roleObserved`나 `spawned`가
아니다. baseline/제거에서 실제 child가 만들어지지 않고 ABSENT를 반환하는지 확인한다.

## 설치본 관측

[실기 보고서](ca04-5-cli-agent-use-evidence.json)에 단계별 결과와 실행 파일·검증기 hash를 기록한다.

- Codex: v1/v2/제거/복원에 맞는 최종 응답을 확인했다. 관측된 `collab_tool_call`은
  `wait`이며 `receiver_thread_ids`와 `agents_states`가 비어 있다. 따라서 실행 결과에 대한
  직접 증거는 부족하다. 이를 Agent 미지원이나 실행 실패로 단정하지 않는다.
- Antigravity: 적용·갱신·복원 때 `subagent_info.subagents`의 정확한 `type_name`과
  child ID를 확인했다. baseline/제거 때는 child ID가 없다. 단일 `--print` 호출은 비동기
  결과 도착 전에 끝날 수 있어 `--input-format stream-json` 세션을 사용한다. 필요할 때
  같은 세션에 최대 두 번 결과 확인 질문을 보내며 전체 실행은 120초로 제한한다.
  표식은 최종 응답으로 돌아오지만 공개 `system_message`에는 본문이 없어 하위 Agent
  완료 결과 자체를 직접 관측하지 못한다.

최종 재검증에서 두 CLI 모두 다섯 단계의 `finalMatches`는 true다. Codex의
`markerLifecycleConfirmed`는 true이며, Antigravity는 갱신 단계에 예상하지 않은
`schedule` 도구가 추가되어 `UNEXPECTED_TOOL`로 거절했다. 이 때문에 Antigravity의
`markerLifecycleConfirmed`와 `invocationLifecycleConfirmed`는 false다.
도구 parameter key는 `DurationSeconds`, `Prompt`였으며 값이나 원문은 저장하지 않았다.
이를 정상 대기로 간주해 allowlist에 추가하거나 실패를 지우지 않는다.

`CHILD_RESULT_NOT_EXPOSED`는 로그인·권한 오류가 아니라 **검증 증거의 제약**이다.
종료 코드 2, `complete: false`, `fullLifecycleConfirmed: false`를 유지한다.
사용자에게 추가 로그인이나 포괄적 권한 허용을 요구할 근거는 없다.

## 공식 계약과 차이

[Codex custom subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)는
프로젝트 `.codex/agents/*.toml`과 `name`, `description`, `developer_instructions`를 정의한다.
공개 [exec 이벤트 소스](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs)의
하위 Agent 필드 존재와, 설치된 0.145.0이 그 필드를 채워 주는지는 별도다.

[Antigravity custom subagents](https://antigravity.google/docs/subagents?tab=cli)의
`.agents/agents/*.md`, `mainAgent: false`, `subagent: true` 계약을 그대로 사용한다.
[headless stream 계약](https://antigravity.google/docs/cli/headless/)에 따른 역할 호출
메타데이터를 수집한다. 편의를 위해 primary Agent로 바꾸거나 전체 권한을 우회하지 않는다.

## 전역 자원 사전 점검

전역 Agent는 실제 배포 없이 공통 서비스의 계획만 생성했다.
[사전 점검 결과](ca04-5-global-agent-preflight.json)는 두 대상 모두 CREATE 계획이며
사용자 파일을 쓰지 않았음을 기록한다. Codex의 현재 `~/.codex/agents`는 심볼릭 링크여서
해석된 대상은 Kit의 global agents 디렉터리다. 이 사실을 전역 runtime 지원으로 간주하지 않는다.

다음 검증은 공개 API에서 child 완료 결과를 직접 연결할 수 있는지 확인하고,
전역 자원의 기존 소유권·설정 보존과 복원까지 별도 계획으로 실행하는 것이다.
앱/IDE와 데몬 자원 배포도 별도이며, 이번 시험으로 완료 처리하지 않는다.

## 재현과 회귀 검증

```sh
npm run verify:client-agents -- --client all \
  --codex /absolute/path/to/codex --antigravity /absolute/path/to/agy \
  --output /tmp/cli-agent-use.json
npm test
```

`npm test`: 222 tests 통과. 회귀 검증은 부모 응답만으로 통과 방지, 잘못된 역할/child/표식/실패 상태 거절,
native ID·표식 비저장, 실패한 호출과 실제 spawn 구분, 스트림 종료 및 timeout을 포함한다.
