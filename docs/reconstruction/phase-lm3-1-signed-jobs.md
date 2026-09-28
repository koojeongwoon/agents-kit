# LM3-1 서명 관리 작업 검증·계획 — 2026-09-25

**LM3-1 완료. LM3 전체 정책·회수 집행은 아직 미완료다.**
Gateway와 Rust 데몬에 `managed_worker.revoke`의 서명 검증기와 순수 계획 함수를 추가했다.
[관리 작업 v1 계약](../architecture/daemon-management-jobs-v1.md)과
[공개 증거](lm3-1-signed-jobs-evidence.json)를 따른다.

## 구현

- Gateway `src/daemonManagement/jobs/contract.ts`: 고정 JWS 헤더·pinned Ed25519 키,
  엄격한 본문, 승인 참조·tenant/조직/기기/소유자/키·자원 버전/해시·시간 검증.
- 데몬 `src/management_jobs/mod.rs`: 같은 계약을 Rust에서 독립 검증한다.
  기존 binary의 모듈로 추가했으며 관리 IPC·기존 워커 정책 집행 경로는 변경하지 않았다.
- 두 구현은 설치 정책 revision과 자원의 기대 상태 버전을 검사하고 순수 `prepare_revoke`
  계획을 반환한다. 같은 원장 기록은 `already_recorded`, 같은 ID의 다른 내용은 충돌이다.
  서명·계획 통과나 중복 기록을 집행 성공으로 반환하지 않는다.
- Gateway 생성기로 실제 서명한 공통 fixture 58개를 세 저장소에 동일하게 배치했다.
  키는 생성 중에만 사용하고 개인키를 파일에 저장하지 않았다.

## 검증

| 검증 | 결과 |
|---|---|
| Gateway 전체 TypeScript build | 통과. 기존 strict 설정 유지 |
| Gateway 전체 Vitest | 321 passed / 8 skipped |
| Rust `cargo test --offline --all-targets` | 85 passed. 그중 한 시험에서 공통 58개 사례 수행 |
| Rust fmt / Clippy `-D warnings` | 통과 |
| Kit `npm test` | 106 passed. 새 fixture 무결성·서명·중복 기록 시험 3개 포함 |
| 원본 반영 | Gateway 5개 + 데몬 5개 파일. 기존 파일 해시 확인 후 반영 및 결과 해시 대조 |
| 공통 fixture | Kit/Gateway/Daemon 세 사본 SHA-256 일치 |

변조 서명, 다른 키·JOSE 헤더, 기기·조직 바인딩 불일치, 미지원 작업/임의 경로/효과,
오래된 승인, 만료, 검증 후 만료·시계 후퇴, 다른 자원 버전/해시, 정책·상태 경합,
중복/충돌, 비정규 JSON·base64url·공개키 표현을 거부하는 사례가 포함된다.
현재 상태 객체를 바꾸지 않는 것도 Gateway 시험에서 확인했다.

서비스 시험은 현재 원본의 복사본에서 수행하고 테스트한 파일을 원본에 해시 대조로 반영했다.
Gateway에서 제외한 8개는 기존 외부 PostgreSQL/Redis 통합 시험이다.
이번 단계에서는 LM2의 실 IAM/DB 연동 시험이나 실제 프로세스 회수 E2E를 다시 실행하지 않았다.
운영 배포·설치·commit/push는 하지 않았다.

## 다음 단계

Gateway 세션에는 현재 조직 관리자 권한 정보가 없으므로 작업 발행 API를 열지 않았다.
**다음은 LM3-2: 조직 관리자 인가·승인 감사·서명 키 관리·작업 발행/영속 저장/전달 권한이다.**
이후 LM3-3에서 데몬 수령·원장/CAS·기존 실행 차단/종료 경계·결과 보고를 연결하고,
LM3-4에서 실제 채널·중복·단절·재시작·경합과 신규 실행 거부/진행 중 종료를 각각 검증한다.
