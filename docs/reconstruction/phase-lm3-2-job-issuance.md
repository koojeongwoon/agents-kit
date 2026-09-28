# LM3-2 조직 인가·작업 발행/저장/전달 — 2026-09-25

**LM3-2 구현·로컬 검증 완료. 다음은 LM3-3 데몬 수령·회수 집행이다.**
IAM의 현재 조직 권한을 확인한 Gateway가 관리 작업을 서명하고, 승인 근거와 함께 저장한 뒤
등록 기기에 결합된 DPoP 요청에만 전달한다. `queued`는 단말 집행 완료를 의미하지 않는다.

[공개 증거](lm3-2-job-issuance-evidence.json),
[공통 서명 계약](../architecture/daemon-management-jobs-v1.md),
[Gateway 설정·API 계약](/Users/jw/__dev/tools-gateway/docs/daemon-management-jobs-v1.md),
[IAM 권한·scope 계약](/Users/jw/__dev/iam-server/docs/daemon-management-jobs-v1.md)을 따른다.

## 구현 결과

1. **IAM 현재 조직 권한:** 기존 기기 상태 reader M2M 인증으로 조직 관리자 신원을 조회한다.
   정확한 tenant·조직의 `ORG_ADMIN`, 활성 사용자/조직, Gateway 서비스 접근과 명시적 조직
   entitlement를 검사한다. `ORG_MANAGER`, 일반 멤버, 다른 조직, 서비스 접근 중지·역할 회수를 거부한다.
   조직 역할을 Gateway 로그인 세션의 플래그로 복제하지 않는다.
2. **Gateway 발행:** POST `/api/v1/daemon-management/jobs`는 SSO 주체·정확한 Origin과
   요청 헤더를 검사한다. 관리자가 승인한 논리 자원 ID/version/hash·정책 revision·기대 상태를
   고정 `managed_worker.revoke`에 결합한다. 승인 주체·시간·인가 기록 ID는 서버가 결정한다.
   대상은 같은 조직의 최신 보고와 현재 IAM 기기 상태로 확인한다.
3. **서명 키:** 소유자 전용 권한의 regular JWK 파일을 검증해 읽는다. 심볼릭 링크·잘못된 권한·
   잘못된 키를 거부하며 자동 키 생성이나 비밀키 응답은 없다. 새 `kid` 교체 후 기존 요청을
   재서명하지 않고 현재 키의 작업만 전달한다. 키 설정이 없으면 작업 API를 열지 않는다.
4. **원자 저장:** migration 14의 작업 레코드에 승인 근거와 서명 문서를 함께 저장한다.
   PostgreSQL transaction/advisory lock으로 같은 조직·요청 ID의 동시 요청을 직렬화한다.
   동일 재시도는 원본 작업/서명을 반환하고 다른 내용·주체/바인딩은 충돌이다. 만료된 요청은 재발급하지 않는다.
5. **기기 전달:** GET `/api/v1/daemon-management/jobs/pending`은 별도
   `gateway:daemon:jobs:read` scope와 GET/정확한 URL/ath/nonce/등록 키를 결합한 DPoP를 요구한다.
   전달마다 기기와 승인자의 현재 권한·버전을 다시 확인한다. 보고 토큰만으로 수령할 수 없다.
   보고 전용·수령 전용·결합 scope 요청을 지원하며 기존 grant는 자동 승격하지 않는다.

작업은 최대 300초 유효하고 한 번에 최대 20개를 반복 전달한다. destructive dequeue나 완료
확인으로 처리하지 않는다. 데몬은 다음 단계에서 자체 보호 원장과 자원 상태 CAS로 중복·경합을
처리해야 한다. LM2 보고에는 자원별 상태/해시가 없으므로 관리자가 제출한 기대 상태가 실제
설치 상태와 일치하는지도 그때 데몬의 보호 레지스트리에서 검사한다.

## 검증

| 검증 | 결과 |
|---|---|
| IAM 전체 Gradle | 953 passed / 0 skipped / 0 failures |
| IAM 기기 HTTP·DPoP 시험 | 위 전체 중 28개. 실제 OAuth 발급/갱신·권한 조회/회수 포함 |
| Gateway 전체 TypeScript build | 통과. 엄격한 타입 설정 유지 |
| Gateway 전체 Vitest | 347 passed / 4 skipped |
| Gateway 실제 PostgreSQL | 새 작업 시험 5개 + 기존 보고 시험 4개 통과 |
| 동시 발행 | 12개 서비스 인스턴스 요청에서 서명 1회, 작업·승인 레코드 1개 |
| 재시작/재시도 | 새 저장소/서비스 인스턴스에서 원본 작업과 서명 반환 |
| 기존 서명 계약 | Gateway 공통 58개 사례 그대로 통과. Rust 소스·fixture 변경 없음 |
| 원본 반영 | Gateway 13개 + IAM 9개 파일, 변경 전·후 해시 대조 및 기존 파일 백업 |

Gateway의 제외한 4개는 별도 DB/Redis 설정을 요구하는 기존 lifecycle 통합 시험이다.
새 DB 시험은 전용 PostgreSQL 안의 임시 스키마에서 실행했다. IAM도 전용 PostgreSQL·Redis에서
실행했고 다른 개발/운영 저장소를 수정하지 않았다. 테스트용 키 파일은 각 시험 종료 시 삭제했다.

시험 경계: IAM은 실제 Spring Security/OAuth와 DB를 사용하는 MockMvc HTTP 시험이다.
Gateway는 실제 PostgreSQL·JWS·DPoP·HTTP 라우트를 시험하되 세션과 IAM 권한 응답을 통제한
입력으로 제공했다. **실행 중인 두 서버 사이의 HTTPS E2E나 실제 프로세스 회수는 이번 증거가 아니다.**

## 남은 단계

- LM3-3: 데몬의 추가 scope 인증·작업 수령, 신뢰 키 로딩, 보호된 원장/자원 상태 CAS,
  기존 워커의 신규 실행 차단·진행 중 종료, 결과 보고.
- LM3-4: 실제 IAM→Gateway→데몬 채널, 단절·재시작·경합·회수 전파와 중앙 결과 표시.
- 운영 적용: 서명 키 및 데몬 공개키 신뢰 배포, IAM 클라이언트의 추가 scope 등록, migration·배포.
  이번 작업에서 운영 설정·등록·배포 또는 commit/push는 하지 않았다.
