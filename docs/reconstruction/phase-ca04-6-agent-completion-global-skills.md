# CA04-6: Codex Agent 완료 확인과 전역 Skill 경로 교정

2026-09-27, macOS arm64. Codex CLI 0.145.0 / Antigravity CLI 1.2.12.

**Codex 프로젝트 Agent와 두 CLI의 전역 Skill 수명주기를 확인했다.
Antigravity CLI의 전역 Skill 프로필을 실기에서 동작한 공용 경로로 교정했다.**

| 대상 | 확인 결과 | 증거 범위 |
| --- | --- | --- |
| Codex 프로젝트 Agent | baseline·적용·갱신·제거·rollback 통과 | 실제 하위 Agent 역할·부모 연결·공개 완료 응답 |
| Codex 전역 Skill | 다섯 단계 통과, 시험 소유 파일 제거 | `~/.agents/skills`, 부속 파일 읽기와 현재 표식 |
| Antigravity 전역 Skill: 기존 CLI 경로 | 적용·갱신·복원에서 ABSENT | 문서 경로의 설치본 불인식 대조군 |
| Antigravity 전역 Skill: 공용 경로 | 다섯 단계 통과, 시험 소유 파일 제거 | `~/.gemini/config/skills`, 교정한 CLI 프로필 재검증 |
| Antigravity 프로젝트 Agent | 역할 호출과 부모 응답까지 확인, 직접 child 결과 미확인 | child resume 별도 시험도 표식 불일치로 거절 |

## Codex 완료 결과: 이벤트 구독

[공식 App Server](https://learn.chatgpt.com/docs/app-server)의 모델 목록, 임시 thread,
공개 item/turn 이벤트를 사용한다. 설치본이 생성한 JSON schema의 `subAgentActivity`는
하위 thread ID를 제공한다. 그 ID 하나에 `thread/resume` + `excludeTurns: true`로 즉시
구독하고 실제 `agentRole` 및 `parentThreadId`를 확인한다. 해당 child의 공개
`agentMessage` 표식과 성공한 `turn/completed`, 부모 최종 응답을 모두 대조한다.
하위 Agent가 끝난 뒤 구독하면 이벤트를 놓칠 수 있어 생성 시점에 연결한다.
메타데이터 응답과 이벤트가 같은 입력 청크에 도착하는 경우도 회귀 테스트한다.

원시 rollout이나 과거 대화/추론을 읽지 않는다. reasoning item은 JSON decode 전에
제외하며 thread resume은 과거 turns를 포함하지 않는다. native ID는 메모리에서만
연결하고 보고서에는 boolean·고정 상태·공개 item 종류만 남긴다.

기존 사용자 config의 모델은 설치 CLI의 제공 목록에 없어 첫 turn이 실패했다.
설정을 변경하지 않고 `model/list`가 `isDefault: true`로 반환한 모델을 임시 thread에
사용했다. 이번 설치본의 기본값은 `gpt-5.6-sol`이며 이름을 하드코딩하지 않는다.
승인 정책은 never, sandbox는 read-only다. 실패한 turn은 timeout으로 오인하지 않고
`TURN_FAILED`로 종료한다. App Server 자체의 native 사용자 설정 로딩은 유지되므로
완전히 분리된 HOME 시험이나 Codex 데스크톱 UI 검증은 아니다.

- [전체 수명주기](ca04-6-codex-agent-lifecycle-evidence.json)
- [최종 수집기 재확인](ca04-6-codex-agent-final-probe.json)

각 기록의 검증기 hash는 해당 실행 시점 코드다. 전체 수명주기 이후 같은 청크의
메타데이터/이벤트 순서 처리를 보강했고 최종 수집기를 별도로 재확인했다.

## Antigravity 전역 Skill: 문서와 설치본의 차이

[공식 Skills 문서](https://antigravity.google/docs/skills)는 CLI 전역 경로를
`~/.gemini/antigravity-cli/skills`로, 앱/IDE 공용 경로를 `~/.gemini/config/skills`로 구분한다.
1.2.12의 실제 CLI 모델 시험에서는 첫 경로를 인식하지 못하고 두 번째 경로에서만
Skill과 부속 파일을 사용했다. 같은 Manifest 서비스·로그인·빈 프로젝트·프롬프트로
경로만 바꾸어 대조했다. 파일 존재나 CLI 목록만으로 판정하지 않는다.

- [Codex 전역 성공 및 Antigravity 기존 경로 실패](ca04-6-global-skills-original-path-evidence.json)
- [Antigravity 교정 프로필 수명주기](ca04-6-antigravity-global-skill-evidence.json)

`clients/antigravity.yaml`의 CLI surface override를 공용 경로로 교정했다. 기본 capability의
문서 경로는 legacy baseline으로 보존한다. 앱/IDE의 경로는 그대로다. 이는 1.2.12의
관측이며 다른 버전으로 일반화하지 않는다. production `runtimeEvidence`는 여전히 비어 있어
미검증 버전/표면에 대한 실제 배포는 계속 차단된다.

### 기존 설치의 이관

이번 작업은 기존 전역 Skill을 자동 이동·삭제하지 않는다. 새 경로에 사용자 소유 항목이
있으면 기존 소유권 규칙대로 계획이 차단된다. 기존 CLI 경로의 파일은 보존한다.
이전 경로를 사용하는 설치를 이관할 때에는 다음을 별도 검토한다.

1. 이전 client definition과 소유권 원장·백업을 보존한다.
2. Kit 소유 항목은 기존 논리 ID의 제거 계획으로 이전 경로를 확인한다. 사용자 소유
   파일은 제거 대상에 포함하지 않는다.
3. 교정 프로필의 새 배포 계획과 diff를 검토하고 적용·사용을 검증한다.
4. 실패 시 보존한 이전 정의/계획 컨텍스트와 백업으로 rollback을 검토한다.

이전 사용자 파일 보존과 신규 프로필의 공유 경로 발견을 회귀 테스트에 반영했다.
공유 파일 발견은 앱 설치나 runtime 지원의 증거가 아니다.

## 시험 파일 정리와 한계

전역 시험은 무작위 이름의 새 Skill만 허용한다. 모든 초기 operation이 CREATE인지 확인하고
공통 배포 서비스의 계획·적용·갱신·제거·rollback을 사용한다. finally에서 Kit 소유 파일을
제거하고 시험이 만든 빈 디렉터리만 정리한다. 동시 생성된 사용자 파일은 보존한다.
Kit 전역 원장의 감사 이력·백업은 정상 배포 기록으로 남긴다. 사용자 설정·권한·인증
파일은 쓰지 않는다. 강제 종료/SIGKILL에 대한 별도 crash-recovery 보장은 추가하지 않았다.

Antigravity child ID로 새 public turn을 보내는 [대조 시험](ca04-6-antigravity-child-resume-evidence.json)은
정확한 표식이 반환되지 않아 성공으로 인정하지 않았다. 이 실험용 실행 경로는 정식
검증기에 남기지 않았다. 부모 응답만으로 직접 child 완료를 대체하지 않는다.

## 재현

```sh
npm run verify:client-agents -- --client codex \
  --codex /absolute/path/to/codex --codex-transport app-server \
  --output /tmp/codex-agent-lifecycle.json
npm run verify:global-skills -- --native-global temporary-fixtures \
  --client all --codex /absolute/path/to/codex --antigravity /absolute/path/to/agy \
  --output /tmp/global-skills.json
```

전역 명령은 native HOME에 임시 Skill을 쓰므로 명시적 opt-in 옵션이 필요하다.
기존 문서 경로 대조는 `--client antigravity --antigravity-skill-root documented-cli`로 수행한다.
CA04 전체 범위는 여전히 미완료이므로 명령 종료 코드 2 및 `complete: false`를 유지한다.
남은 범위는 Antigravity child 완료 직접 확인, 전역 Agent/지침/MCP 모델 사용, 앱/IDE,
검증된 capability의 지원 활성화 검토, 데몬 자원 배포다.

## 회귀 검증

`npm test`: 226 tests 통과. `git diff --check` 통과. 잘못된 role/parent/child,
실패 turn, child 최종 메시지와 완료 이벤트의 상관관계, 응답/이벤트가 같은 청크에
도착하는 구독 순서, 다중 파일 Skill 정리와 동시 사용자 파일 보존을 검사했다.
