# Antigravity MCP 실제 적용·복원과 Agent 완료 증거 조사

후속 완료: [Agent 전역·프로젝트 실제 자식 완료 검증](phase-antigravity-agent-completion.md).
아래 Agent 미관측 결과는 2026-11-05 조사 당시의 기록으로 보존한다.

2026-11-05, macOS arm64, Antigravity CLI `1.5.1`의 정확한 실행 파일 SHA-256으로
확인했다. 기존 설정·외부 링크를 보존하면서 분리된 검증기로 전역 MCP를 확인했다.

## MCP 결과

[실제 수명주기 영수증](antigravity-native-mcp-separated-runtime-20261105.json).

| 단계 | 배포·복원 관측 | 클라이언트 인식/호출 | 모델 응답 | 실행 무결성 |
|---|---|---|---|---|
| baseline | 통과 | 예상 밖 호출 없음 | ABSENT 일치 | 통과 |
| applied | 통과 | 고정 도구 호출·결과 일치 | 표식 일치 | 통과 |
| updated | Kit 갱신의 실제 반영 통과 | 새 표식 반환 | 새 표식 일치 | 통과 |
| removed | 선택 시험 서버 부재 확인 | 예상 밖 호출 없음 | ABSENT 일치 | 통과 |
| rollback | 이전 설치 내용 복원 통과 | 이전 표식 반환 | 이전 표식 일치 | 통과 |

새 `verify-antigravity-mcp.mjs`는 전역 쓰기를 명시적으로 opt-in해야 한다.
선택된 client definition에서 전역 경로를 구하며, `ca04-marker`가 이미 있으면
모델 호출 전 차단한다. 새 논리 asset ID를 사용해 시험 서버만 등록·편입하고 Kit
수정본을 반영한다. seed/부재 control도 공통 배포 엔진의 계획·원장·백업·모드·journal을
사용하고, 역순 stock rollback으로 원래 전체 파일과 기존 소유권을 복원한다.

실제 클라이언트는 고정된 읽기 전용 로컬 도구만 호출했다. 임시 per-process 권한은
그 도구 하나만 허용하며 전역 권한 파일을 변경하지 않았다. 검증 프롬프트는 단계별
한 번씩 다섯 번 실행했다. 숨긴 표식을 프롬프트/schema에 노출하거나 실패한 모델
응답을 느슨하게 재해석하지 않았다. 원시 대화·도구 출력·인증 값은 저장하지 않았다.

검증기는 지원 설정을 자동 승격하지 않는다. 결과를 검토한 후 `clients/antigravity.yaml`에
현재 정확한 버전·binary hash·전역 `mcp-stdio-basic-v1`만 별도로 활성화했다.
프로젝트/current Agent·환경 전달·직접 HTTP·알 수 없는 native 옵션은 함께 활성화하지 않았다.

### 기존 canva

[기존 자원 실제 왕복](antigravity-existing-canva-separated-roundtrip-20261105.json).
기존 `canva` Kit 사본의 JSON 속성 순서만 바꾸어 실제 설치에 반영했다. 명령·인수의
의미는 유지했다. 적용 전·후·rollback 후 CLI 등록 조회에서 `canva`와 기존 `tools`를
확인했다. 전체 client 파일·권한, Kit 사본과 기존 소유권까지 복원했다.
Canva 외부 API 도구를 호출하거나 인증을 바꾼 결과는 아니다.

`tools`의 원래 `url` 정의는 보존하고 source 관리 상태를 유지했다. 이번 stdio
검증으로 그 HTTP 설정을 변환하거나 활성화하지 않았다.

## Agent: 공개 응답은 확보, 완료 상태는 미확정

공식 [Antigravity ACP 안내](https://antigravity.google/docs/ide/extensions/acp/)와
[ACP 세션 계약](https://agentclientprotocol.com/protocol/v1/session-setup)을 대조했다.
실제 initialize에서 protocol 1, load/resume/list/close 지원을 확인했다.
[capability 영수증](antigravity-acp-capabilities-20261105.json)은 세션·모델 요청 없이 얻었다.

`session/load`는 공개 대화를 재생한다. 그 응답은 재생이 끝났다는 뜻이며, 원래 자식
turn의 성공 완료를 대신하지 않는다. 자식 공개 응답과 원래 실행 상태는 따로 확인한다.

| 조사 | 관측 | 판정 |
|---|---|---|
| 최초 사전 검사 | `mainAgent:false` 역할이 `agy agents` 목록에 없어 검사에서 중단. 모델 요청 0회, 파일 복원 | [원래 기록](antigravity-child-public-evidence-probe-20261105.json) 유지 |
| 실제 역할 호출 + ACP 자식 조회 | 정확한 역할 호출, 부모 응답 일치, 같은 자식 ID의 공개 메시지 1개와 표식 직접 일치 | [공개 자식 응답 확보](antigravity-child-public-evidence-recheck-20261105.json). 이 단계의 `manage_subagents`는 이전 허용 목록에 없어 실행 판정 실패 |
| 읽기 전용 관리 도구 분류 보완 후 상태 조사 | 실행·부모 응답 통과. 관리 결과는 텍스트이며 현재 수집기가 자식별 완료 상태를 확정하지 못함. 이 자식의 ACP 재생은 성공했으나 공개 메시지는 0개 | [상태 조사](antigravity-child-completion-state-probe-20261105.json). 완료 증거 미관측 |

주 세션 목록에 없는 역할을 실제로 호출했으므로, 범위가 불명확한 Agent 목록의
부재를 호출 불가로 단정하지 않도록 수정했다. `coversSubagents`가 확인되지 않은
목록의 음성 결과는 미관측으로 남긴다. 기존 영수증을 변경하거나 성공으로 승격하지 않는다.

현재 CLI의 관리 도구는 [공식 도구 계약](https://antigravity.google/docs/hooks?pubdate=20251210)의
`manage_subagents`이다. 검증기에는 읽기 전용 `Action: list`만 허용했다.
`kill`, `kill_all` 및 알 수 없는 동작은 계속 예상 밖 도구로 차단한다.
상태 수집은 관측한 자식 ID와 연결되는 자료만 다루고, 공개 응답과 성공 상태가
함께 확인돼야 완료로 결합한다. 부모의 표식이나 ACP 재생 완료만으로는 충분하지 않다.

실제 Agent 조사는 격리 프로젝트의 부모 프롬프트 두 번과 각 임시 자식 하나로
제한했다. ACP 조회는 해당 호출에서 얻은 자식 ID만 사용하고 새 프롬프트를 보내지
않았다. 다른 사용자 대화 검색·native 이력 파일/비공개 추론 읽기는 하지 않았다.
thought frame은 JSON decoding 전에 폐기했다. 모든 시험 파일을 rollback했다.

따라서 자식의 공개 응답을 얻는 경로는 확인했지만, 현재 자료로 완료 상태를 안정적으로
확정하지 못했다. 텍스트 상태 형식 해석과 재생 결과 차이의 원인을 확정하지 않았으며,
실제 시험을 더 반복하지 않고 Agent 지원은 미검증 상태로 유지했다.

## 보존과 회귀 검증

[종료 체크포인트](antigravity-native-final-checkpoint-20261105.json): 기존 자원 네 개,
관리 파일 세 개의 내용과 소유권 일치, Kit pending/drift 없음, 배포/source 잠금·journal 없음.
Codex 지침·node-repl, Antigravity canva의 적용 gate는 유지/활성 상태이고 `tools`는
미검증 resource profile로 차단한다.

시작 시점의 27개 경로와 대조해 기존 내용·권한을 보존했다. ego-browser 링크 세 개의
문자열·mtime·identity와 연결 대상도 그대로다. MCP 파일의 mtime/inode는 원자적 적용·복원으로
변경됐다. Codex config도 내용·권한·inode가 같은 상태에서 mtime 차이가 관측됐다.
mtime을 되돌리거나 기존 파일을 재작성하지 않았다.

라이브 실행 뒤 동시 수정 보호를 더 엄격하게 했다. control 직전과 각 관측 후에
기존 바이트·모드·소유권·복구 상태가 달라지면 중단한다. 격리 시험에서 외부 편집을
주입해 새 사용자 설정을 덮어쓰지 않는 것을 확인했다. 정상 경로의 요청·변환은 같아
모델 수명주기를 다시 실행하지 않았다. 충돌 시 원본을 강제로 복원하지 않고 복구 근거를 남긴다.

실패→수정→통과로 MCP 수명주기/응답 불일치/occupied 경로/동시 수정,
ACP 공개 응답·세션 상관관계·미지원 loader·binary 교체,
읽기 전용 관리 상태와 공개 응답 결합, 부분 Agent 목록을 검증했다.
루트 362, HTTP 26, GUI 50 tests 통과. 타입 검사·desktop frontend/backend build·Cargo check 통과.
