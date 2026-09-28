# CA02-2: 대상 선택과 공통 Agent 변환

2026-09-27. 상태: **targets 선택·의존성 배포·최소 공통 Agent 변환 완료. CA02 전체와 실기 검증은 미완료.**

## 구현

- Manifest targets의 enabled/assetIds/projectName을 검증하고 plan과 doctor에서 동일하게 적용.
- 선택 자원의 참조 및 논리 tool 공급자를 실제 배포 목록에 포함. 공급자의 자체 의존성도 재귀적으로 검증.
- 프로젝트별 scope 분리. global 의존성은 교차 scope 소유권을 자동 인수하지 않고 명시적으로 차단.
- 선택된 의존성 파일만 읽기. 미선택 source가 없어도 plan 가능하며 전체 validate는 엄격한 기존 검사 유지.
- Agent v1의 이름·설명·지침을 Codex TOML / Antigravity Markdown으로 변환.
- 기존 copy/transaction/backup/rollback에 생성 바이트 연결. 사용자 파일 자동 인수, 외부 수정, 다른 자원 소유 차단.
- production profile 미검증 상태에서 CLI/HTTP/GUI 공통 미리보기 제공. preview 및 복제된 operation 적용 차단.

[계약 및 공식 근거](../contracts/agent-definition-v1.md) · [예제](../examples/agent-common.yaml)

## 검증

| 항목 | 결과 |
| --- | --- |
| `npm test` | 138 tests 통과 |
| `npm --prefix gui run test:server` | 15 tests 통과 |
| GUI deployment panel + API tests | 7 tests 통과 |
| `npm --prefix gui run typecheck` | 통과 |
| `npm --prefix gui run build:desktop` | frontend/backend bundle 통과 (Tauri native 빌드 아님) |
| Python 3.12 `tomllib` | 생성 Agent의 Unicode·개행·인용부호·역슬래시 정확한 round-trip |
| `git diff --check` | 통과 |

두 클라이언트의 합성 profile에서 Agent+Skill+MCP 적용, 동일 계획 SKIP, rollback,
validation 실패 복원, stale 거부, 미관리 동일 파일 충돌과 다른 소유자 충돌을 검증했다.
잘못된 targets, 비활성 client, provider 의존성 순환, 교차 scope 차단도 검증했다.
CLI 및 HTTP에서 실제 production definition은 차단된 채 생성 결과만 반환한다.
`0.0.1-test`는 임시 fixture이며 클라이언트 실행 증거가 아니다.
HTTP 테스트는 로컬 포트 바인딩이 허용된 실행 환경을 사용했다.

## 남은 범위

- CA02: Agent의 논리 도구·권한·모델·Skill 활성화 mapping, 지침/Skill 공통 의미 검증.
  현재 Agent는 명시적인 client-default 권한만 허용한다. 정책을 prompt로 대신하지 않는다.
- CA03: 공유 경로 소유권, 제거/이관, 교차 scope dependency 증거와 지속 가능한 계획/digest.
- CA04/05: 설치된 Codex·Antigravity 각 surface/버전에서 discovery와 사용 확인.
- 이후 승인된 자원 배포용 daemon job 연결. 이번에는 실제 홈 설정과 revoke-only daemon 계약을 변경하지 않았다.
