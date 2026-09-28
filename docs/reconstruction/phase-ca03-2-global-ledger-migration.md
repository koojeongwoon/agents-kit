# CA03-2: 전역 통합 원장·명시적 소유권 이관

2026-09-27. 상태: **로컬 구현·합성 통합 검증 완료. CA03 전체 및 실제 클라이언트/daemon 실기는 미완료.**

## 완료

- 홈별 통합 원장과 전역 공동 계획·공유 제거·rollback.
- legacy 원장 원문/백업/이력 보존, 구 원장 사용 중지, 기존 배포 rollback 유지.
- 계획·적용 시 원장/파일/백업/경로 대조, 다중 원장 잠금, 예외 시 복원, 중단 표식 감지.
- 공통 지침·Skill의 client/asset/source/이력 증명 후 소유권만 전환하는 별도 계획.
- Codex CLI·앱의 같은 경로 공동 소비자와 Antigravity 실행 화면별 독립 저장소 처리.
- CLI migrate, HTTP migration-plan, GUI 이관 계획/승인 및 전역 공동 대상·제거 연결.

[계약과 운영 경계](../contracts/global-ledger-migration-v1.md).

## 검증

임시 홈/프로젝트와 합성 client profile에서 global batch, Codex cli/desktop 공동 갱신,
독립 저장소 보존, 기존 backup 복사와 역사적 rollback, 불완전 이관·외부 변경·중복 소유권 거부,
원장 재등장·잠금·중단 표식·stale 계획·symlink 거부, 검증 및 최종 상태 쓰기 실패 복원을 확인했다.
프로젝트/전역 소유권 이관은 파일 내용 유지와 rollback을 확인했다.
CLI는 실제 production profile로 이관 후에도 runtime 미검증 배포가 차단됨을 확인했다.
HTTP는 전역 legacy→통합→공유 소유권→제거 경로 및 토큰/프로젝트 범위 검사를 검증했다.

| 항목 | 결과 |
| --- | --- |
| npm test | 177 tests 통과 |
| HTTP 통합 테스트 | 19 tests 통과 |
| GUI deployment panel + API | 13 tests 통과 |
| typecheck / build:desktop | 통과 (frontend/backend bundle) |
| diff whitespace check | 통과 |

실제 사용자 홈의 설정/원장은 이관하지 않았다. production runtimeEvidence도 변경하지 않았다.
frontend/backend bundle 빌드는 Tauri native 앱 실행 검증을 의미하지 않는다.

## 남은 CA03

Agent/MCP 구조적 필드 제거, 지속 가능한 계획/digest, 자동 crash recovery가 남았다.
legacy managed link 이관·통합 완료 후 추가 legacy 병합·원장 구조 역이관은 자동 지원하지 않으며,
충돌/불완전 원장은 검토 없이 합치지 않는다. 실제 클라이언트 로딩·실행과 daemon 집행은 CA04~06에서 검증한다.
