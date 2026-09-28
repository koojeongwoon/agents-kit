# LM2-2 — IAM 기기 신원 구현 및 로컬 검증

2026-09-25. **IAM 구현과 격리 환경 검증 완료. 다음 단계는 LM2-3 데몬의
보호 키·OAuth/DPoP 어댑터다.** 실제 데몬/Gateway 연동, G-1A/G-2와 운영 배포는
완료로 표시하지 않는다.

## 구현

- IAM의 기존 `user_devices` 접속 이력과 분리한 기기 공개키·도전·상태·버전 저장소.
  등록 완료는 트랜잭션으로 도전을 소비하며, 회수는 관련 code/refresh를 함께 무효화한다.
- native client의 Code+PKCE S256, 제한된 loopback callback, IAM 동의 화면의
  조직 선택. 여러 조직의 사용자는 관리 토큰에서도 등록 때 동의한 조직을 유지한다.
- 등록용/관리용/서버 조회용 resource와 scope, 등록 키 DPoP 및 기기 claim.
  PostgreSQL nonce·재생 검사, 잘못된 키가 정상 refresh를 소비하지 못하는 사전 검사.
- 300초 access token, 관리 refresh 회전·8시간 idle/24시간 절대 만료,
  재사용 시 family 회수. 기존 일반 발급/교환으로 기기 인증을 우회하지 못하도록 제한.
- 기존 점진 적용 설정과 무관한 사용자·조직·두 서비스의 ACTIVE 권한 검사.
  Gateway reader는 지정 테넌트/resource 조회만 가능하며 기기 변경 권한이 없다.
- 소유자/동일 조직 ORG_ADMIN 회수, 브라우저 CSRF·최근 인증 검사와 등록/회수 감사.
  등록 도전은 사용자별 시간당 20회로 제한한다.

소스: `/Users/jw/__dev/iam-server`. 상세 사용·배포 조건은 해당 저장소의
`docs/DEVICE_IDENTITY_V1.md`, additive SQL은
`docs/migrations/2026-09-25-device-identity.sql`에 있다.

## 검증과 적용 증거

[기계 판독 증거](lm2-2-iam-evidence.json)에 테스트 집계와 적용 파일 SHA-256을 저장했다.

| 모듈 | 테스트 | 실패/건너뜀 |
|---|---:|---:|
| auth-common | 7 | 0 |
| auth-domain | 50 | 0 |
| auth-infra | 184 | 0 |
| auth-app | 687 | 0 |
| auth-batch | 23 | 0 |
| 합계 | **951** | **0** |

`./gradlew test :auth-app:bootJar --offline --console=plain` 통과. 전용 PostgreSQL
1개와 Redis 2개로 구성한 전용 환경에서 시험했으며 운영/기존 로컬 데이터베이스를
사용하지 않았다. 검증 후 임시 컨테이너 3개를 모두 종료했다.
기기 HTTP 시험 14개, proof 시험 12개, 기존 교환 시험에 추가한 5개 경계 사례를 포함한다.
전체 회귀에는 기존 일반 로그인·MCP·갱신·회수와 패키지 의존성 검사도 포함된다.

등록→발급→갱신→reader 조회→회수→갱신 거부를 실제 SAS HTTP/DB 경로로 확인했다.
새 Spring 서버 컨텍스트와 실제 loopback HTTP에서도 저장된 grant의 키/사용자/resource
바인딩을 유지하며 갱신했다. 이는 **서버 객체 그래프의 재생성 시험**이며 OS 프로세스
재시작이나 운영 KMS/JWKS 지속성 시험으로 확대 해석하지 않는다.

공통 서명 fixture를 IAM 테스트가 직접 소비한다. Gateway 관리 요청 M01~M30 전체의
검증은 LM2-4 소비자 게이트로 남는다. 검증한 변경 42개 파일은 원본 해시 확인·백업 후
실제 IAM 디렉터리에 적용하고 SHA-256 일치를 확인했다. 기존 IAM 문서 수정 및 다른
저장소의 미완료 작업은 덮어쓰지 않았다. 적용 후 실제 IAM 디렉터리에서도
`./gradlew :auth-app:bootJar --offline --console=plain`이 통과했다. Git commit/push는 하지 않았다.

## 남은 통합 조건

- 운영 OAuth client/entitlement 생성과 기기 등록은 실행하지 않았다.
- 최근 재인증 증거는 현재 IAM form-login 어댑터에서 기록한다. 고객 IdP 로그인은
  해당 어댑터의 검증된 재인증 시각을 연결하고 실제 E2E를 통과하기 전에는 이 회수
  경로의 지원 완료로 간주하지 않는다. 증거가 없거나 만료되면 거부한다.
- 운영에서는 기존 persistent tenant signing key를 사용해야 한다. 새로운 감사
  action을 읽는 batch/consumer 버전도 배포 순서에서 맞춰야 한다.
- 다음 LM2-3은 실제 OS 보호 키, HTTP/TLS, 로그인 callback, DPoP nonce 처리,
  안전한 토큰 보관/갱신·재시작을 구현한다. LM2-4에서 Gateway의 회수 지연과 중앙
  상태 수신·표시를 실측한 뒤에야 G-1A를 완료한다.
