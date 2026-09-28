# CA03-1: 프로젝트 공유 지침·Skill 수명주기

2026-09-27. 상태: **프로젝트 공통 자원 소비자·공동 갱신·제거·rollback 완료. CA03 전체와 실기는 미완료.**

## 구현

- 프로젝트 공통 지침/Skill을 `(kitId, assetId)`로 식별하고 client/surface 소비자를 기록.
- 다중 client 계획에서 같은 공유 파일을 한 번만 처리. 모든 소비자가 참여하는 갱신과 Skill 삭제 파일 정리.
- 소비자 등록/해제 시 파일 바이트 유지. 마지막 소비자만 파일/소유 블록 제거.
- 원장 hash 대조와 배타 잠금으로 파일이 같은 소유권 경쟁도 차단.
- 삭제 및 원장만 바꾸는 작업의 rollback, 검증/원장 저장 실패 복구.
- CLI targets/remove, HTTP removal-plan, GUI 공동 대상·버전·제거 ID·소비자 표시 연결.
- 원장 schema 2 전환을 계획에 표시. 구 단일 소유권 기록은 추정 이관하지 않고 차단.

[계약·호환성·명령](../contracts/shared-project-ownership-v1.md)

## 검증

합성 client profile과 임시 프로젝트에서 두 제품의 공동 적용, 순차 등록, 한쪽/마지막 제거,
기존 사용자 본문 보존, 삭제 rollback, 외부 수정·중복 marker·다른 Kit 거부,
같은 바이트의 stale 원장/rollback 계획 거부, 잠금 충돌, validation 및 state commit 실패 복원을 확인했다.
HTTP에서 batch→apply→첫 소비자 제거→마지막 제거를 확인하고 CLI의 runtime gate도 유지했다.

| 항목 | 결과 |
| --- | --- |
| npm test | 163 tests 통과 |
| HTTP 통합 테스트 | 17 tests 통과 |
| GUI deployment panel + API | 10 tests 통과 |
| typecheck / build:desktop | 통과 (frontend/backend bundle) |
| diff whitespace check | 통과 |

테스트의 `0.0.1-test`는 실제 지원 버전이 아니다. production runtimeEvidence는 변경하지 않았다.
frontend/backend bundle은 Tauri native 앱 실행 검증을 뜻하지 않는다.

## 다음

CA03의 전역 통합 원장·기존 소유권 명시적 이관, Agent/MCP 제거, 지속 계획/digest와 crash recovery가 남았다.
실제 Codex·Antigravity 인식·사용과 daemon 자원 배포 작업은 CA04~06에서 검증한다.
