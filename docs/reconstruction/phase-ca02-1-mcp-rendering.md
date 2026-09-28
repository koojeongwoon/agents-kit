# CA02-1: 공통 MCP 원본 → Codex·Antigravity 변환

2026-09-27. 상태: **MCP 변환·미리보기·기존 적용 경로 연결 완료. CA02 전체 및 실기는 미완료.**

## 결과

- Manifest schema 1에 명시적으로 선택하는 versioned MCP definition/bindings 추가.
- 같은 논리 원본 → Codex TOML, Antigravity JSON. 실행물·endpoint는 논리 ID로 참조.
- 원본 파일이 없는 typed MCP도 기존 merge/백업/적용/롤백 경로에서 처리.
- CLI·GUI 계획에 생성할 설정 조각, 대상, 변경 selector/hash, 충돌을 표시.
  현재 사용자 설정 원문은 노출하지 않음.
- CA01의 실기 미검증 차단을 유지하면서 변환 결과는 검토 가능.
- 비밀은 환경 변수 이름 참조 또는 네이티브 OAuth로만 처리. Antigravity에서
  미확인 환경 변수 참조를 plaintext로 대체하지 않고 차단.
- 미관리 동명 서버 인수, JSON 구조 충돌, 안전하게 해석할 수 없는 TOML,
  기존 키 제거가 필요한 JSON 갱신은 차단하고 CA03의 이관/제거 계획으로 남김.

[계약·호환성·공식 근거](../contracts/mcp-definition-v1.md) ·
[실행 가능한 원본 예제](../examples/mcp-common.yaml)

## 검증

| 항목 | 결과 |
|---|---|
| `npm test` | 128 tests 통과 |
| `npm --prefix gui run test:server` | 14 tests 통과 |
| GUI deployment panel + API tests | 7 tests 통과 |
| `npm --prefix gui run typecheck` | 통과 |
| `npm --prefix gui run build:desktop` | frontend/backend bundle 통과 |
| 독립 Python `tomllib` 파서 | 예제의 생성된 두 MCP TOML table 파싱·값 확인 |
| `git diff --check` | 통과 |

같은 원본의 두 출력, 비밀 참조/거부, unknown schema/필드/ID 거부,
미검증 apply 거부·파일 미생성, 합성 프로필 apply/멱등성/rollback,
외부 수정 stale 거부, 사용자 값 보존·응답 비노출, CLI와 HTTP 미리보기를 확인했다.
테스트의 `0.0.1-test` 프로필은 임시 fixture이며 실제 제품 지원 증거가 아니다.
HTTP 검사는 기존 sandbox 포트 제한 때문에 허용된 실행 환경을 사용했다.

## 다음 작업

CA02의 남은 범위: targets의 enabled/선택/의존성 규칙, 공통 Agent 변환과
논리 도구·권한 바인딩, 지침·Skill 원본의 공통 의미 검증. 이후 CA03의 공유
소유권·제거·이관을 거쳐 CA04/05 실기에 진입한다. 이번 작업으로 사용자
클라이언트 설정, 데몬의 revoke-only 작업 계약, 실제 지원 프로필은 변경하지 않았다.
