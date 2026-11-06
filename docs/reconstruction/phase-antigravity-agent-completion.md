# Antigravity Agent 전역·프로젝트 실제 자식 완료 검증

2026-11-06. 새 기능 확장 없이 남아 있던 기본 Agent 두 scope의 실제 적용·인식·복원을
마무리했다. Antigravity CLI `1.5.1`, macOS arm64, SHA-256
`5ce7fbe126eb9abdc78634332a0a1bdd428327fba37ef7d1aeba7553eec55f3f`만 지원 근거로 추가했다.

## 실패 원인과 TDD

이전 기록은 정확한 역할 호출과 부모 응답을 확인했지만 자식 완료 상태를 읽지 못했다.
`manage_subagents`의 공개 응답은 JSON 앞에 다음 안내 문장을 붙인다.

```text
You have 1 active subagent(s):
[{"conversationId":"<fixture-child>","state":"idle"}]
```

기존 수집기는 전체 JSON 또는 같은 줄의 `status: completed`만 해석했다. 고정된 안내문과
배열 개수를 검증한 뒤, 이번 실행에서 관측한 정확한 자식 ID의 상태만 추출하도록 고쳤다.
실제 응답에서 식별자·역할·경로를 치환한 회귀 테스트가 먼저 실패함을 확인했다.
다른 자식, 실행/실패 상태, error, private 필드, 잘못된 개수와 임의 안내문은 통과하지 않는다.

과거 실패 영수증으로 전달된 표식만으로도 완료 판정이 가능했던 조건도 재현·수정했다.
부모 최종 응답이 맞더라도 자식 상태가 없으면 최대 두 번의 제한된 후속 확인을 유지한다.
최종 성공은 아래 근거가 모두 있어야 한다.

1. 실제 custom subagent의 `type_name`과 이번 호출의 자식 ID가 일치한다.
2. 읽기 전용 `manage_subagents(Action=list)`에서 같은 자식이 `idle` 등 완료 상태다.
3. 같은 자식의 ACP `session/load` 공개 응답이 해당 revision의 비공개 표식과 일치한다.
4. 부모 최종 응답, 프로세스 성공, 바이너리 무변경, 허용한 도구와 배포 관측이 통과한다.

ACP 재생 완료만으로 자식 완료를 인정하지 않는다. ACP 조회에는 새 `session/prompt`를
보내지 않으며 native history 파일이나 숨은 추론을 읽거나 저장하지 않는다.

## 실제 결과

| scope | 변경 전 | 적용 | 수정 | 제거 | 제거 rollback | 최종 원상 복원 |
|---|---|---|---|---|---|---|
| 프로젝트 | 통과 | 자식 완료 | 자식 완료 | 통과 | 자식 완료 | 통과 |
| 전역 | 통과 | 자식 완료 | 자식 완료 | 통과 | 자식 완료 | 통과 |

[프로젝트 증거](antigravity-agent-project-completion-20261106.json)와
[전역 증거](antigravity-agent-global-completion-20261106.json)는 각 다섯 단계의 배포,
native 인식, 모델 응답, 실행 무결성을 별도로 기록한다. 적용·수정·rollback에서 총 6개의
실제 자식 완료를 확인했고, 변경 전·제거 후에는 자식이 생성되지 않았다.
수명주기마다 새 부모 세션 5개를 사용했다. 부모 모델은 기존 사용자 선택과 같은
`gemini-3.8-flash-medium`을 세션 플래그로 지정했고 Agent 정의의 모델은 덮어쓰지 않았다.

전역은 임시 HOME 안의 `~/.gemini/config/agents/{assetId}.md`, 프로젝트는 임시 프로젝트의
`.agents/agents/{assetId}.md`를 실제 CLI가 읽었다. 공식
[Subagents](https://antigravity.google/docs/subagents/)와
[ACP](https://antigravity.google/docs/cli/acp/) 계약도 대조했다.
CLI/GUI 공통 배포 서비스의 계획·apply·제거·rollback을 사용했다.

## 격리와 기존 환경 보존

`--isolated-antigravity-home true`는 새 HOME·Kit·원장을 만든다. 인증은 유효 기간이
10분 이상 남은 접근 토큰 사본만 사용하고 refresh token을 제외한다. 원본 인증 파일은
읽기만 하고 전후 hash를 비교한다. 만료 시 원본을 갱신하지 않고 모델 호출 전에 차단한다.
임시 HOME·인증과 검증 자원은 완료 후 삭제했다. 실제 사용자 원장에는 이력을 추가하지 않았다.

초기 진단에서 CLI 자체 updater가 실행 파일을 `1.5.2`로 바꿔 검증기가 중단했다.
자동 생성된 원본 백업의 hash를 대조해 설치된 실행 파일을 정확히 원래 `1.5.1`로 복원했다.
검증 세션은 `AGY_CLI_DISABLE_AUTO_UPDATE=true`로 차단한다. 문자열 `1`은 차단되지 않았고,
`true`는 모델 호출 없는 빈 입력 검사에서 바이너리 무변경을 확인한 뒤 사용했다.
설정 파일에 영구 업데이트 정책을 기록하지 않았다. `1.5.2` 진단을 지원 증거로 쓰지 않았다.
[초기 진단과 차단 확인](antigravity-agent-diagnostics-20261106.json)을 실패 기록으로 남겼다.

[보존 기록](antigravity-agent-preservation-20261106.json): 기존 설정·인증 30개 경로의
내용·권한, ego-browser 링크 3개의 대상·identity를 유지했다. Codex config의 내용과 권한은
같고 수정 시각만 달라 원복하지 않았다. 원장 schema 6 / 이력 145 / 소유 파일 3 / 소유권 4와
hash가 그대로이고 pending은 0이다. 기존 `node-repl` drift도 동일하며 덮어쓰지 않았다.

## 활성화와 재현

`clients/antigravity.yaml`에는 검증한 CLI의 `agent-role-basic-v1` 두 scope만 추가했다.
새 버전/hash, 다른 OS/arch, desktop/IDE, 추가 권한·sandbox 옵션은 계속 차단한다.
기본 CLI 행렬의 남은 두 칸을 채워 검증한 빌드의 기본 범위는 16/16이 되었다.
추가 클라이언트·Agent 런타임·memory 등 확장은 진행하지 않았다.

```sh
node scripts/verify-client-agents.mjs --client antigravity \
  --antigravity "$HOME/.local/bin/agy" --antigravity-model gemini-3.8-flash-medium \
  --isolated-antigravity-home true --scope project --stop-on-failure true \
  --output /private/tmp/antigravity-agent-project.json
```

전역은 `--scope global --native-global temporary-fixtures`로 바꾼다. 모든 단계는 기존
지원 gate의 임시 bootstrap과 독립적인 실제 native 관측이 함께 통과해야 한다.
검증기 자체가 원본 정의의 지원 gate를 자동 승격하지 않는다.

## 최종 회귀 검사

`npm test` 858개, HTTP 서버 회귀 54개가 모두 통과했다. 실제 모델을 사용하지 않는
프로토콜 시뮬레이터는 두 scope의 완료 증거 결합·접근 토큰 격리·만료 시 무갱신 차단·
원본 원장 보존을 확인한다. 정확한 바이너리·scope·profile만 활성화하고 다른 조건은
계속 차단하는 지원 gate도 검증했다. `git diff --check`를 통과했다.
HTTP의 첫 샌드박스 실행은 임시 localhost bind의 `EPERM`으로 실패했고,
해당 포트 권한을 허용한 같은 테스트의 재실행에서 54개 모두 통과했다.
