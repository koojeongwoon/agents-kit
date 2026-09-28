# LM2-3 — 데몬 IAM 인증 로컬 구현·검증

2026-09-25. **데몬 인증 구현·실제 IAM 로컬 연동·macOS UID 격리 검증 완료.** 다음은
LM2-4 Gateway 관리 수신·중앙 상태 표시다. 운영 배포, 전용 서비스 설치, G-1A/G-2를
완료로 표시하지 않는다.

## 반영 범위

`/Users/jw/__dev/tools-daemon`에 별도 `management_auth` 모듈과 `auth-enroll`,
`auth-login`, `auth-refresh`, `auth-status` CLI를 추가했다. 기존 Kit 배포/GUI,
데몬 worker 경로 및 Gateway 소스는 변경하지 않았다.

- macOS 서비스 UID의 `0700` 디렉터리와 `0600` 키·토큰 저장소. 링크/잘못된 소유·권한,
  키 분실·잘못된 저장 신원은 거부한다. Keychain/Secure Enclave가 아닌 소프트웨어 키다.
- 실제 P-256/ES256 DPoP, 브라우저 Code+PKCE S256, state·loopback callback,
  IAM nonce 제한 재시도와 RS256/JWKS·scope·사용자/조직/기기 결합 검증.
- HTTPS 인증서·호스트 검사, 리다이렉트 거부, 고정 issuer 경로 및 응답 크기 제한.
- 프로세스 간 잠금과 원자적 세션 저장. 갱신 요청 전에 기존 토큰을 제거하여 응답 유실·
  중단 뒤 이전 refresh를 재사용하지 않는다. 실패 시 재로그인으로 복구한다.
- 토큰을 출력·export하거나 워커에 넘기는 경로가 없다. 로컬 상태는
  `credentials_present`와 `authorization: not_checked`를 사용하며 중앙 연결/인가로
  오해하지 않도록 한다.

검증한 25개 파일을 원본 해시 확인·백업 후 실제 데몬 저장소에 반영하고 SHA-256을
대조했다. 적용 디렉터리의 `cargo build --offline`도 통과했다.
[기계 판독 증거](lm2-3-daemon-evidence.json)에 파일 해시와 점검 결과를 남겼다.

## 검증

- **Rust 80개 통과**, 실패·건너뜀 0. 기존 65개 회귀와 신규 15개 포함.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` 통과.
- 실제 LM2-2 IAM + HTTPS + 격리 PostgreSQL/Redis에서 **12개 연동 점검 통과**.
  등록/관리 2회 승인 → 발급 → 다른 OS 프로세스에서 같은 키로 refresh 회전 →
  IAM 소유자·CSRF 회수 → 갱신 거부·토큰 제거 → 재시작 시 `login_required`를 확인했다.
- TLS 신뢰/호스트 오류·리다이렉트·외부 callback·동시 인증을 거부했다.
  macOS sandbox의 키/세션 읽기 거부 및 로그·CLI 비노출을 실측했다.
- 공통 공개 token/proof fixture를 그대로 복사하고 두 서명을 실제 검증했다.

실제 IAM 응답에서 발견한 상호운용 조건도 계약에 반영했다. 단일 `aud`는 문자열 또는
원소 하나인 배열을 허용하며 여러 audience는 거부한다. `expires_in`은 남은 수명
1~300초로 검사하고 JWT 자체 수명 300초 제한은 별도로 유지한다.

## 남은 조건

- 관리자 인증 후 sandbox 없는 다른 UID(`nobody`)에서 키와 세션 파일의 읽기·쓰기가
  모두 EACCES로 거부됨을 확인했다. 시험 서비스 UID의 등록·갱신은 허용 사례다.
  계정·서비스 설치 변경은 없으며, 실제 전용 서비스의 설치 완료로 확대하지 않는다.
- 보호 설치에는 전용 데몬 UID, 다른 사용자/worker UID, 신뢰된 실행 파일·설정 및
  worker 작업 영역 밖의 credential store가 필요하다. 설치·코드 서명은 후속 출시 게이트다.
- 브라우저 부분은 합성 계정의 실제 IAM 폼을 HTTP 드라이버가 수행했다. 고객 IdP 및
  사람이 조작하는 브라우저 E2E, 운영 등록/배포는 하지 않았다.
- Gateway 관리 요청/회수 지연·보고 중복/stale/중앙 UI는 LM2-4, 직접 MCP 결합은 G-2다.

데몬 상세 기록은 `docs/evidence/management-auth-2026-09-25.md`, 재현 fixture는
`experiments/management-auth/README.md`에 있다. Git commit/push는 하지 않았다.

임시 DB·Redis 3개를 종료했고, 시험용 TLS 인증서·개인키·기기 키·토큰 저장소를 삭제했다.
공개 점검 결과와 소스만 보존했다.
