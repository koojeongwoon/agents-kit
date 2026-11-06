# 검증기 결과 분리와 기록 기반 회귀 검증

후속 실기: [Antigravity MCP 적용·복원과 Agent 완료 증거 조사](phase-antigravity-native-mcp.md).
아래는 분리 구현 시점의 기록이다.

2026-11-05. 배포·복원, 클라이언트 인식, 모델 응답을 분리하고 기록된 실패로 TDD를
진행했다. 기존 설정과 ego-browser 링크는 보존하고 실제 검증은 읽기 전용 조회로 한정했다.

## 변경

- [결과 계약](../contracts/verification-evidence-v1.md), 순수 도메인 판정과 공개 이벤트
  adapter를 추가했다. model-use·Agent·Codex Agent RPC 수집기를 adapter로 옮기고 기존
  script export와 reasoning 사전 필터는 유지했다.
- `verify-client-use`, `verify-client-agents`, `verify-global-skills`,
  `verify-client-resources`에 같은 결과 계약과 배포 관측기를 연결했다. 사전 인식 검사는
  자원별 결과를 추가하고 선택된 client definition에서 native 경로를 구한다. API가
  지침 출처를 주지 않으면 미관측으로 기록한다.
- 상위 `complete`를 요청 범위와 정리 결과에서 계산한다. 단일 단계 성공을 다섯 단계
  수명주기로 승격하지 않는다. 기존 CLI/GUI 배포 서비스와 runtime 지원 gate는 유지했다.
- 프로젝트 시험은 역순 rollback으로 원래 바이트까지 복원한다. 지침 블록 제거 뒤
  남는 빈 줄이나 pending journal/lock을 복원 성공으로 오인하지 않는다. 동시 수정
  충돌 시 원본을 보존하고 시험 폴더와 복구 근거도 남긴다.
- `replay-client-verification.mjs` / `npm run verify:replay`로 원래 실패 영수증을
  변경하지 않고 새 판정만 별도 파일에 생성한다.

## 기록된 실패의 재현과 결과

실제 영수증을 시험 입력으로 사용하고 누락된 판정의 실패부터 확인한 뒤 구현했다.
배포·정리 결함은 격리 홈, 실제 공통 배포 서비스와 로컬 CLI 프로토콜 시뮬레이터로
재현했다. 이 시뮬레이터는 실제 모델이나 provider를 실행하지 않는다.

| 입력 | 분리 결과 | 새 재생 기록 |
|---|---|---|
| Antigravity MCP 최종 JSON 불일치 | native 호출 통과 / 모델 응답 실패. 과거 단계의 배포 증거는 미시험 유지 | [MCP](verifier-separation-mcp-replay-20261105.json) |
| Antigravity Agent 역할 호출·부모 표식만 있음 | 역할 호출 확인 / child 완료 미관측 / 모델 응답 통과 | [Agent](verifier-separation-agent-replay-20261105.json) |
| 응답 진단 콜백 오류 | `PROBE_OBSERVATION_FAILED`, 누락 단계와 복원 사실 구별 | [관측 오류](verifier-separation-observer-replay-20261105.json) |
| Codex native RPC MCP | 전송 증거 유지 / 모델 응답 미시험 | [native RPC](verifier-separation-native-rpc-replay-20261105.json) |
| 과거 인식 검사 | 자원별 발견·미관측·명시적 불일치 구별 / 모델 실행 미시험 | [탐색](verifier-separation-discovery-replay-20261105.json) |

추가 회귀: 잘못된/미관측 응답 구별, native 성공 후 프로세스 실패, 실행 파일 교체,
허용하지 않은 도구, 단일·누락 단계, 정리 실패, 소유권·권한 변경, pending journal/lock,
동시 수정 rollback 거절, 외부 링크 identity 보존, 정확한 role/parent/child 완료 연계.
기존 실패 기록과 활성화 영수증은 덮어쓰지 않았다.

## 필요한 실제 검증

기존 공개 사실을 분리해서 판정하는 변경이므로 실제 모델 수명주기를 반복하지 않았다.
Codex `0.166.0-alpha.6`의 기존 `node_repl` 등록 조회만 한 번 실행하고 전후 binary
hash를 대조했다. 인식과 실행 무결성은 통과했고, 배포·모델 응답은 이번 조회에서
시험하지 않았다고 기록했다.

[실제 읽기 전용 조회](verifier-separation-native-recognition-20261105.json):
등록 목록 조회 1회, 버전 조회 별도, 모델 turn 0회, provider 도구 호출 0회,
클라이언트 설정 쓰기 0회. 원시 설정 내용은 저장하지 않았다.

Antigravity Agent의 child 완료는 계속 미검증이며 MCP 응답 실패도 성공으로 다시
이름 붙이지 않았다. 지원 활성화 추가, 원본 `tools`의 `url`→`serverUrl` 변경,
외부 ego 업데이트는 수행하지 않았다.

## 보존과 최종 검사

작업 시작 시점의 27개 경로 snapshot과 종료 상태를 대조했다. 기존 파일의 내용·권한과
mtime/inode에 차이가 없다. 외부 ego-browser 링크 세 개의 문자열·mtime·identity와
연결 대상도 그대로다. [기존 관리 상태 재확인](verifier-separation-management-checkpoint-20261105.json).
기존 자원 네 개의 등록과 파일 세 개의 소유권을 유지했고 배포·source pending journal/lock은 없다.

루트 351 tests, HTTP 26 tests, GUI 50 tests 통과. TypeScript 검사,
desktop frontend/backend build, Cargo check와 diff 검사 통과. 신규 29개 시험은
기록 재생·배포 관측·복원·네 검증기 CLI 흐름을 다룬다. 실제 client 사용 성공 증거와
구별하며, 이번 실제 검증 범위는 위 읽기 전용 조회로 제한했다.
