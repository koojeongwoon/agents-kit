# 기존 MCP·Agent·지침 관리와 검증 지연 진단

후속: [검증기 분리 구현과 기록 기반 회귀 검증](phase-verifier-separation.md).
아래는 진단 시점의 기록이며 후속 구현·증거와 구별한다.

기준일: 2026-11-05. 범위: 기본 Kit, macOS arm64의 Codex CLI
`0.166.0-alpha.6`, Antigravity CLI `1.5.1`. 사용자 요청에 따라 실제 클라이언트
재시도를 중단하고, 아래 상태를 읽기 전용으로 재확인했다. 전체 요청을 완료로
표시하지 않는다. Antigravity의 현재 버전 Agent·MCP 활성화는 미완료다.

## 현재 남아 있는 관리 상태

기존 자원 네 개를 기본 Kit에 등록하고 현재 위치의 설치 소유권을 메타데이터로
인수했다. 등록 자체는 클라이언트 파일을 쓰지 않았다. 원본과 Kit 사본의 현재
차이는 없고, 검증용 자원은 모두 해제·정리했다.

| Kit 자원 | 원래 자원 | 현재 상태 |
|---|---|---|
| `codex-instructions` | `~/.codex/AGENTS.md` | 기존 빈 파일 등록·관리, 실제 지침 변경·사용·복원 검증 |
| `node-repl` | `~/.codex/config.toml`의 `node_repl` | native 이름 보존, 기존 선택 서버 수정·인식·복원 검증 |
| `canva` | `~/.gemini/config/mcp_config.json`의 `canva` | 등록·관리 완료, 현재 버전 적용은 `CLIENT_PROFILE_UNVERIFIED`로 차단 |
| `tools` | 같은 파일의 `tools` | native 원형 등록·보존, 현재 버전 적용 차단 |

기존 전역 Agent 파일은 없어서 사용자의 기존 Agent를 가져왔다는 결과는 없다.
별도 임시 Agent로 Codex의 관리·적용·실제 child 실행·복원을 검증했다.
Antigravity 지침도 기존 파일이 없어 가져온 자원이 없다.

[등록 영수증](native-existing-registration-20261105.json),
[진단 시점 재확인](native-existing-management-checkpoint-20261105.json).
배포 원장에는 실제 파일 세 개에 대한 자원 네 개의 소유권만 남아 있다.
파일 전체 해시는 원장과 일치하고 배포·source 잠금과 미완료 journal은 없다.

## 무엇을 실제로 확인했는가

| 대상 | 확보한 증거 | 판정과 한계 |
|---|---|---|
| Codex 전역 Agent | baseline·적용·갱신·제거·rollback, 정확한 role/parent와 공개 child 완료 결과 | 해당 CLI 빌드의 기본 Agent 활성화. [실행 기록](native-global-codex-agent-runtime-recheck-20261105.json), [기본 Kit 설치·복원](native-global-codex-agent-installation-20261105.json) |
| Codex 전역 지침 | 기존 빈 파일을 바탕으로 다섯 단계 실제 모델 응답 대조, 원래 내용·권한 복원 | 해당 CLI 빌드 활성화. [실행 기록](native-global-codex-instructions-runtime-20261105.json) |
| Codex 전역 native stdio MCP | 실제 App Server RPC의 서버 인식·고정 도구 호출·환경 전달, 다섯 단계 및 설정 복원 | `mcp-native-stdio-options-v1`만 활성화. 모델의 도구 선택·최종 응답 정확도 증거와 구별. [기록](native-global-codex-mcp-runtime-20261105.json) |
| 기존 `node_repl` | Kit의 선택 TOML 주석 수정→적용→실제 CLI 등록 조회→rollback→재조회 | 원래 전체 설정·권한 복원, 실제 provider 작업 호출은 하지 않음. [기록](native-existing-node-repl-roundtrip-20261105.json) |
| Antigravity 전역 MCP | 적용·갱신·rollback에서 실제 고정 도구 호출과 표식 수신 | 최종 모델 JSON의 값이 기대한 단일 표식과 달라 종전 전체 판정 실패. [원래 결과](native-global-antigravity-mcp-runtime-recheck-20261105.json) |
| Antigravity MCP 응답 진단 | 공개 응답 형태 확인 후 schema에 표식 형태를 제한한 단일 적용 시험 통과 | 원인 축소 증거만 확보. 수정된 조건의 다섯 단계 재시험은 수행하지 않았고 지원은 미승격. [형태 진단](native-global-antigravity-mcp-response-inspection-20261105.json), [단일 성공](native-global-antigravity-mcp-response-pattern-20261105.json) |
| Antigravity 전역 Agent | 갱신·rollback에서 정확한 역할 호출과 부모의 표식 응답 | 직접 child 완료 결과 미노출, 적용 단계 timeout도 발생. 원인을 공개 이벤트만으로 확정할 수 없어 미승격. [기록](native-global-antigravity-agent-runtime-20261105.json) |

Agent 스크립트의 최상위 `complete:false`는 이전 CA04 전체 단계 미완료를 고정
표시하는 필드다. Codex 개별 `fullLifecycleConfirmed:true`와 서로 다른 범위다.
이 보고서 형식 자체가 혼동을 만들고 있어 후속 계약 교정 대상이다. 기존 실패
기록이나 최상위 결과를 성공으로 덮어쓰지 않는다.

## 지연의 원인

1. **서로 다른 성공 조건을 하나로 묶었다.** 설정 적용·복원, 클라이언트의
   인식·도구 전송, 모델의 최종 JSON을 모두 만족해야 한 판정을 통과하도록 했다.
   MCP 호출이 이미 성공한 경우에도 마지막 문자열 표현 때문에 전체를 다시
   실행했다. 모델 응답 실패가 설정 배포 실패처럼 보이게 했다.
2. **요청 범위가 지원 행렬 전체 활성화로 커졌다.** 기존 자원을 보존하며 관리하는
   작업에 버전별 Agent 실행·모든 lifecycle의 모델 정확도까지 결합했다.
   정확한 버전·실행 파일 hash 제한은 필요한 경계지만, 그 경계 안에서도 검증
   증거를 단계별로 재사용할 단위와 중단 기준이 부족했다.
3. **검증기의 클라이언트별 공개 이벤트 해석이 충분히 안정적이지 않았다.** Codex의
   ephemeral child 조회 방식, Antigravity의 도구 결과 감싼 문자열과 child 결과
   가시성이 달랐다. 부모 표식 응답을 직접 child 증거로 대체할 수는 없다.
4. **실제 구현 결함도 있었다.** 빈 IDE 경로가 현재 디렉터리로 해석되는 탐색,
   logical/native MCP ID 불일치, 공유 파일 소유권 해제 시 오래된 해시,
   다른 소유자의 해시 갱신으로 의존 provider 변경을 놓치는 검사가 발견되어
   회귀 시험 후 수정했다. 외부 클라이언트 탓으로만 돌릴 상황은 아니다.
5. **진단 콜백 예외가 정리 경계를 빠져나갔다.** 응답 형태를 관찰하던 콜백 오류로
   한 번 시험 설정이 남았다. 검토한 stock rollback으로 원본을 복구했고, runner가
   `PROBE_OBSERVATION_FAILED`로 종료해 정리 경로를 실행하도록 시험·수정했다.
   [실패와 복구 기록](native-global-antigravity-mcp-response-probe-20261105.json).

## 공식 위치와 실제 지원 범위

기본 파일 경로와 scope는 client YAML에 있고 변환·선택 교체는 adapter가 담당한다.
다음은 이번 작업에서 대조한 기본 위치다. 위치가 맞다는 사실과 현재 버전의
전체 기능이 검증됐다는 주장은 구별한다.

| 자원 | Codex 전역 / 프로젝트 | Antigravity CLI 전역 / 프로젝트 |
|---|---|---|
| 지침 | `~/.codex/AGENTS.md` / `AGENTS.md` | `~/.gemini/GEMINI.md` / `AGENTS.md` |
| MCP | `~/.codex/config.toml` / `.codex/config.toml` | `~/.gemini/config/mcp_config.json` / `.agents/mcp_config.json` |
| Agent | `~/.codex/agents/*.toml` / `.codex/agents/*.toml` | `~/.gemini/config/agents/*.md` / `.agents/agents/*.md` |

Codex 전역 `AGENTS.override.md`, Antigravity 전역의 추가 AGENTS/GEMINI 파일은
탐색을 보완했다. native 설치 반영은 검증한 canonical 원래 경로만 허용한다.
override·추가 루트의 쓰기, 프로젝트 상위 디렉터리 순회와 우선순위의 완전한
해석, 중첩 Agent 정의, 임의 `CODEX_HOME`, 앱/IDE와 현재 버전 프로젝트 runtime
지원은 이번 결과로 완료되지 않는다. Codex 프로젝트 MCP에는 trust 조건도 있다.
[Codex 지침](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[MCP](https://learn.chatgpt.com/docs/extend/mcp),
[Agent](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[Antigravity 탐색](https://antigravity.google/docs/customization-discovery?tab=cli),
[지침](https://antigravity.google/docs/rules/),
[MCP](https://antigravity.google/docs/mcp?tab=cli).

기존 `tools`의 remote `url`은 현재 Antigravity 공식 MCP의 `serverUrl` 계약과
다르다. 현재 설치본의 호환 동작은 미검증이다. 사용자의 원본을 임의 마이그레이션하지
않고 Kit에 그대로 보관했으며 remote HTTP 지원을 stdio 시험으로 활성화하지 않았다.

## 아키텍처 원칙 점검

Manifest·소유권·baseline/revision·설치 L/D/K의 도메인 개념, 공통 application service,
client adapter, transaction/state/backup 경계는 유지했다. 병합·형식 분류와 정책
판정은 순수 함수로 두고 실제 파일·프로세스 작업은 외곽에서 실행한다. state/backup은
책임을 가진 객체로 다루며 클래스 개수를 늘리는 것으로 OOP를 대신하지 않는다.

다만 완전한 헥사고날 구조라고 할 수 없다. application service에 직접 `fs` 조회와
concrete infrastructure 생성이 남아 있고, verifier에는 lifecycle 실행·공개 이벤트
해석·지원 판정 책임이 함께 있다. 이번 중요 결함은 실패 시험→수정→회귀 검증으로
처리했지만 전체 기존 코드의 TDD 이력을 증명하는 것은 아니다. 지금은 전면 재작성보다
검증 결과 계약과 프로토콜 해석 경계를 먼저 분리하는 것이 적절하다.

## 다음 변경의 제한된 순서와 완료 조건

1. `deployment`(계획·바이트·모드·소유권·복원), `nativeRecognition`(인식·호출·결과),
   `modelBehavior`(최종 응답)를 각각 기록하는 versioned 검증 결과 계약을 먼저 정한다.
   실패·미관측·미시험을 구분하고 capability별 필수 증거를 명시한다. 현재 지원 gate를
   낮추거나 종전 실패 영수증을 다시 해석해 자동 승격하지 않는다.
2. 순수 판정 함수와 client별 공개 이벤트 adapter를 분리한다. 비밀값·hidden reasoning을
   담지 않은 최소 회귀 fixture로 MCP 감싼 결과, 관측 예외, Agent child 누락,
   버전/hash 불일치, 다섯 단계 누락을 먼저 재현한다.
3. 기록 fixture와 가짜 홈의 결정적 시험에서 판정을 고친 뒤, 필요한 단일 native smoke만
   실행한다. 같은 실패가 반복되면 원인·증거 변화 없이 전체 E2E를 다시 돌리지 않는다.
   Antigravity Agent는 직접 child 완료를 증명할 공개 신호가 확보될 때까지 차단한다.
4. 그 다음 수정된 MCP 계약으로 필요한 전체 수명주기를 한 번 확인한다. stdio 결과와
   기존 `canva` 등록·복원, remote `tools` 호환성은 각자 별도 판정한다. 추가 경로·프로젝트
   우선순위는 별도 범위로 남겨 기존 자원 관리 완료 기준과 섞지 않는다.

## 보존 및 회귀 검증

기존 경로 27개에서 파일 내용·권한·존재 상태를 대조했고 차이는 없다. 실제 적용·복원한
파일 세 개의 mtime/inode는 바뀌었으므로 물리적 파일 identity까지 불변이라고 주장하지
않는다. ego-browser 링크 세 개는 링크 문자열·mtime·identity까지 그대로다. 외부
원본을 Kit에 복사하거나 업데이트하지 않았다. 인증 값과 원시 모델 대화는 이 기록에 없다.

최종 제품 변경 뒤 루트 322 tests, HTTP 26 tests 통과. GUI 50 tests와 타입 검사는
앞선 동일 GUI 코드에서 통과했고, desktop frontend/backend build와 Cargo check도
통과했다. HTTP 첫 실행은 sandbox `listen EPERM`으로 시작되지 않아, 로컬 서버 권한을
허용한 동일 시험으로 재확인했다. 이 진단 단계에서는 실제 모델·도구 재시도를 하지 않았다.
