# CA03-4: 저장 계획·digest·중단 복구

2026-09-27. 상태: **일반 파일 계획의 저장/재개와 프로세스 중단 후 검토 복구 구현 완료.**

## 구현

- 공유 application service의 저장 계획 저장소, 24시간 만료, digest 검증, 실행 claim과 고정 트랜잭션 ID.
- 재시작 후 현재 원본·대상·소유권·지원 정의로 계획 재구성, 변경 시 차단.
- 프로젝트/전역 파일 트랜잭션 journal, PID/token 소유권, 변경 전/commit 상태 판정.
- 전체 대상·백업 검증 후 검토 복구, commit 이후 완료 표시 전 중단 시 재실행 없는 결과 정리.
- CLI·HTTP·GUI의 저장/조회/재개/복구 계획/승인 경로.

[저장 형식, 인터페이스, 복구 범위와 제한](../contracts/persistent-deployment-v1.md).

## 검증

임시 홈·프로젝트에서 별도 Node 프로세스를 SIGKILL하여 파일 변경 도중, 원장 commit 이후,
잠금 정리 후 저장 결과 기록 이전의 종료를 확인했다. 적용·제거·rollback, 전역/프로젝트,
원본 바이트·권한 복원, commit 보존, 중복 실행 방지를 검사했다. 외부 수정, 범위 변경,
백업 손상, 활성 PID, stale 검토와 복수 대상 사전 검사도 포함한다.

CLI는 별도 프로세스 저장 → 목록 → digest 재개 → 멱등 결과를 검증했다.
HTTP는 앱 재생성 후 재개 및 실제 child SIGKILL 후 복구, 토큰/경로 검사를 검증했다.
GUI는 저장만으로 적용하지 않음, 목록 로드만으로 실행하지 않음, 재개/복구의 명시적 승인을 검증했다.

| 항목 | 결과 |
| --- | --- |
| npm test | 203 tests 통과 (저장/복구 12개 포함) |
| HTTP 통합 테스트 | 21 tests 통과 |
| GUI deployment panel + API | 16 tests 통과 |
| typecheck / build:desktop | 통과 (frontend/backend bundle) |
| diff whitespace check | 통과 |

실제 사용자 홈 설정·production runtimeEvidence는 변경하지 않았다. 합성 버전의 테스트와
frontend/backend bundle 빌드는 실제 클라이언트 인식이나 Tauri/daemon 실행 검증이 아니다.

## 다음 범위

CA04는 Codex CLI와 Antigravity CLI의 자원별 실제 인식/사용/갱신/제거/rollback 증거다.
CA05는 앱·IDE별 증거, CA06은 불변 묶음/승인/daemon 집행이다.
CA03의 legacy Agent/MCP 식별자 이관, link와 다중 원장 이관의 crash 복구는 별도 확장으로 남긴다.
