# CA03-3: Agent/MCP 소유 항목 제거

2026-09-27. 상태: **typed Agent/MCP 제거·의존성 검사·rollback의 로컬 구현과 합성 검증 완료.**

## 구현

- typed Agent 파일·MCP 소유 단위에 Kit/client/configStore/scope/format/의존성 기록.
- schema 4와 계획의 전환 표시로 구 reader가 새 소유권을 버리는 동작 차단.
- Agent 파일 제거, Codex MCP 섹션 제거, Antigravity MCP 서버 항목 제거.
- 사용자 설정·다른 MCP 서버 보존, 중복 키·외부 수정·추가 미소유 필드·미지원 문법 거부.
- 기존 공유 자원 제거와 같은 계획에 합산, 배포 원장의 의존관계로 단독 공급자 제거 차단.
- CLI·HTTP·GUI의 기존 제거 계획→승인→적용·rollback 경로 연결.

[계약과 제한](../contracts/typed-resource-removal-v1.md).

## 검증

임시 프로젝트/홈에서 Codex·Antigravity 각각 Agent/MCP 혼합 제거와 정확한 바이트·원장 rollback,
다른 설정 보존, Manifest 변경 후에도 남는 의존성 차단, 명시적 전체 제거 집합을 확인했다.
Kit 불일치·legacy 기록·미지원 surface·외부 수정·stale·symlink·중복 JSON 키·잘못된 UTF-8·
검증/원장 저장 실패를 검사했다. CLI는 dry-run→remove→rollback, HTTP는 같은 배포 트랜잭션,
GUI는 selector 표시와 명시적 승인 흐름을 확인했다.

| 항목 | 결과 |
| --- | --- |
| npm test | 190 tests 통과 |
| HTTP 통합 테스트 | 20 tests 통과 |
| GUI deployment panel + API | 14 tests 통과 |
| typecheck / build:desktop | 통과 (frontend/backend bundle) |
| diff whitespace check | 통과 |

실제 사용자 설정 파일은 변경하지 않았다. production runtimeEvidence는 비어 있으며,
합성 profile 테스트와 frontend/backend bundle 빌드를 실제 클라이언트·Tauri 앱·daemon 검증으로 간주하지 않는다.

## 남은 범위

후속 지속 계획·digest 및 재시작/중단 복구는 [CA03-4 기록](phase-ca03-4-persistent-deployment.md)을 따른다.
Kit 식별자가 없는 legacy Agent/MCP 이관, 일반 native source-only 자원 제거,
일반 TOML 편집 범위 확대는 별도다. CA04~06의 실제 클라이언트 인식과 daemon 집행 검증도 남아 있다.
