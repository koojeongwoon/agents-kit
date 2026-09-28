# LM2-1 — 데몬 관리 채널 인증 v1

결정일: 2026-09-25. 상태: **계약 확정, LM2-2 IAM, LM2-3 데몬 및 LM2-4 Gateway 관리 채널 로컬 검증 완료. 운영 배포는 별도다.** [IAM 완료 기록](../reconstruction/phase-lm2-2-iam-device-identity.md)을 따른다. 상위 결정은 [IAM 기기 신원 계약](iam-device-identity-contract.md), 기계 판독 값은 [profile.json](../contracts/daemon-management-v1/profile.json), 요청 예시는 [examples.json](../contracts/daemon-management-v1/examples.json)을 따른다. 이 단계에서 운영 클라이언트·기기·키를 생성하지 않는다.

## 1. 적용 범위와 선택

IAM은 기기 등록·공개키·회수를 소유한다. 데몬은 보호된 키로 IAM 및 Gateway 관리 API에 요청한다. Gateway는 IAM 신원과 서비스 권한을 검증하고 상태 보고를 저장한다. Kit은 안내·표시를 담당한다. 독립형 Kit, 기존 일반 서비스 로그인, 직접 `/mcp`는 이 프로파일의 적용 대상이 아니다. 직접 MCP의 기기 결합은 G-2에서 별도 시험한다.

관리 채널의 요청 증명은 **DPoP, ES256/P-256**으로 선택한다. 등록 키와 DPoP 키를 동일하게 사용하며 v1은 위임된 하위 키를 허용하지 않는다. IAM JWT 서명은 기존 RS256/JWKS를 사용한다. 데몬의 기존 Ed25519 정책 검증 키는 별개다. LM2-3에서 macOS UID·파일 권한으로 보호한 소프트웨어 P-256 저장소와 HTTP/TLS·OAuth 어댑터를 추가했다. Keychain/Secure Enclave 구현은 아니며 전용 계정 설치의 보호 조건은 별도 검증한다. 소프트웨어 키 소유를 하드웨어 증명이나 단말 무결성으로 표시하지 않는다.

DPoP는 애플리케이션에서 토큰 결합을 검증할 수 있어 첫 관리 채널에 채택한다. mTLS는 인증서 발급·갱신과 TLS 종단 신뢰 설정을 추가로 요구하므로 v1에서 지원하지 않는다. DPoP 시험 실패 시 Bearer로 강등하지 않고 출시를 보류한다. 근거: [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html), [RFC 8705](https://www.rfc-editor.org/rfc/rfc8705.html).

## 2. 클라이언트·자원·scope

`I`는 등록 테넌트 issuer(`https://<iam>/t/<tenant>`), `G`는 허용된 Gateway HTTPS origin이다. 서버 등록 설정이 값을 결정하며 요청 본문이나 토큰의 URL로 discovery/키 조회를 수행하지 않는다. 표의 client ID는 **신규 등록할 논리 ID**다. 실제 배포 시 테넌트별 등록 ID로 대응시키고 계약 시험에도 같은 매핑을 넣는다.

| 구분 | OAuth client / audience | scope 및 용도 |
|---|---|---|
| 등록 시작 | public `tools-daemon-management` / `I/api/v1/device-enrollment` | `openid iam:device:enroll`; 아직 등록 기기 claim은 없음. 검증된 DPoP 키만 `cnf.jkt`로 결합 |
| 중앙 상태 보고 | 같은 public client / `G/api/v1/daemon-management` | `openid device:identity gateway:daemon:report`; 등록된 기기 claim 필수 |
| IAM 상태 조회 | confidential `tools-gateway-device-reader` / `I/api/v1/device-status` | `iam:device-status:read`; 서버 간 client_credentials. 데몬에 자격 증명을 배포하지 않음 |

관리 API는 `POST G/api/v1/daemon-management/reports`다. 관리 토큰으로 `/mcp`, 등록 API 또는 다른 서비스에 접근할 수 없다. 등록/조회 토큰도 관리 보고에 사용할 수 없다. reader 경로는 confidential client의 `client_secret_basic` 인증으로 발급한 최대 300초 Bearer 액세스 토큰을 사용하고 refresh를 발급하지 않는다. audience·tenant·client·scope를 검증하며 이 예외는 서버 간 조회 API에만 적용한다. 데몬의 등록/관리 DPoP 필수 조건을 낮추지 않는다. 토큰은 자원 하나에만 발급하며, 여러 `resource`나 알 수 없는 조합은 `invalid_target`, 미허용 scope는 `invalid_scope`로 거부한다. scope 생략은 기기 검증 생략을 뜻하지 않는다. 다른 서비스의 일반 토큰에는 기기 claim을 추가하지 않는다.

서비스 권한의 키는 OAuth client ID이며 resource URL이 아니다. 관리 프로파일은 서버 등록 설정으로 `tools-daemon-management`와 기존 Gateway 서비스 client(기본 `tools-gateway-service`)를 연결한다. 사용자·조직의 두 서비스 이용 권한과 등록 권한을 IAM이 검사한다. 새 client ID 등록만으로 기존 Gateway 권한을 자동 부여하지 않는다. 기존 서비스 접근의 점진 적용 플래그와 관계없이 **이 신규 프로파일은 ACTIVE 권한이 없으면 거부**한다. 일반 서비스의 enforcement 설정을 바꾸지 않는다.

`device:identity` 등 scope와 기기 claim은 우리 확장이다. `resource`는 [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)의 파라미터이며, public client는 외부 브라우저·Authorization Code + PKCE S256 흐름을 사용한다([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)). 데몬에 client secret을 넣지 않는다.

## 3. 등록과 발급 순서

1. 데몬 보호 서비스가 P-256 키를 생성한다. 브라우저 로그인 요청에 `state`, PKCE S256, `dpop_jkt`, 등록 resource/scope를 넣는다. 키·PKCE verifier·토큰은 보호 서비스만 보유한다. Kit에는 로그인 URL과 진행 상태만 전달한다. 브라우저의 반환 code는 `http://127.0.0.1:{port}/oauth/callback` loopback listener와 일회성 state로 회수한다. 데몬이 포트를 먼저 bind한 뒤 브라우저를 열고 grant에 사용한 redirect URI를 token 요청에도 그대로 사용한다. IAM은 이 client에만 RFC 8252 loopback 포트 예외를 구현하고 다른 redirect의 정확 일치 검사를 유지한다.
2. IAM은 사용자·테넌트·조직·등록 권한을 확인하고 동의받는다. 조직은 인증된 IAM 화면에서 선택·검증한 값으로 grant에 저장한다. 토큰 요청은 `dpop_jkt`와 일치하는 키의 DPoP를 요구한다. 등록 액세스 토큰은 300초, refresh 미발급이다. 등록 권한은 임의 무인 등록 권한이 아니다.
3. `POST I/api/v1/device-enrollment/challenges`, body `{}`. 등록 토큰과 DPoP로 인증한다. IAM은 grant의 사용자/조직, client, `cnf.jkt`에 묶인 256비트 난수 `challenge_id`와 `expires_at`을 반환한다(201). 공개키는 검증된 DPoP의 JWK에서 얻고 본문의 사용자·조직·키 재정의를 거부한다. 도전은 300초 유효하며 등록 권한을 다시 검사한다.
4. `POST I/api/v1/device-enrollment/challenges/{challenge_id}/complete`, body `{}`. 동일 grant 주체·조직·키에 결합된 토큰 및 새 DPoP proof/nonce로 완료한다. IAM은 도전의 만료·미사용·키·주체를 검사하고 원자적으로 소비하여 ACTIVE 기기를 만든다. 별도 독자 서명 형식을 만들지 않는다. 응답은 `device_id`, `device_version: 1`, `status: ACTIVE`, `key_jkt`(201)다.
5. `GET I/api/v1/device-enrollment/current`는 같은 등록 토큰의 주체·조직·키로만 조회한다. 완료 응답 유실 시 복구 경로다. 미등록은 404, 회수는 403이다. 같은 테넌트/키의 재등록은 중복 기기를 만들지 않으며 회수 키를 재활성화하지 않는다. 완료 도전 재사용은 409다.
6. 관리 resource/scope로 별도의 code+PKCE 승인을 받는다(브라우저 SSO 재사용 가능). IAM은 검증된 토큰 요청 키로 등록부를 조회하여 기기 claim을 **서버에서** 구성한다. client가 보낸 `device_id`로 신원을 정하지 않는다. 주체·조직·기기·서비스 접근을 모두 재확인한 뒤 관리 DPoP 토큰과 refresh를 발급한다.

등록 API의 잘못된/알 수 없는 도전은 400 `invalid_enrollment`; 다른 주체의 도전도 같은 응답으로 숨긴다. 자신의 소비된 도전은 409 `enrollment_already_used`. 토큰·DPoP 오류는 아래 인증 오류 규칙이 우선한다. 등록 변경에는 사용자 의사 확인·감사·속도 제한을 적용한다. IAM의 기존 `user_devices` 접속 지문을 등록 공개키로 승격하지 않는다.

## 4. 액세스 토큰 스키마

관리 토큰은 JWT access-token 프로파일([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html))을 신규 경로에 적용한다. 기존 IAM의 모든 토큰이 이 프로파일을 구현했다는 의미는 아니다.

| 항목 | v1 규칙 |
|---|---|
| JOSE header | `typ: at+jwt`, `alg: RS256`, IAM tenant JWKS의 `kid` |
| `iss`, `aud` | 설정된 tenant issuer 정확 일치, 관리 resource 문자열 또는 단일 원소 배열 |
| `sub`, `client_id`, `tenant_id` | 실제 IAM 사용자 subject, 등록 daemon client, route/설정 tenant. 기기 ID를 사용자 `sub`로 바꾸지 않음 |
| `active_organization_id` | IAM grant에 저장된 조직. 등록부 관계와 정확 일치 |
| `iat`, `exp`, `jti` | 정수 NumericDate, `iat <= now+5`, `now < exp <= iat+300`, 토큰별 유일 ID |
| `scope` | 공백 구분 문자열. `device:identity gateway:daemon:report` 필수 |
| `cnf.jkt` | 등록된 기기 공개키의 SHA-256 JWK thumbprint([RFC 7638](https://www.rfc-editor.org/rfc/rfc7638.html)) |
| `https://lynply.com/claims/device` | 객체 `{ "v": 1, "id": "<opaque-id>", "version": 1 }`. 버전은 양의 정수. 미지원 v 거부 |
| `user_version`, `service_access_version` | 기존 IAM 형식에 맞춘 양의 십진 문자열. 후자는 **daemon client**의 접근 버전 |

기기 ID는 IAM 난수 식별자이며 일련번호/MAC/접속 지문이 아니다. v1에서는 등록과 관리 audience에만 공개한다. 다른 서비스 도입 시 서비스 간 상관관계 노출 여부를 다시 결정한다. 토큰에 private JWK·정책·원문 이벤트·하드웨어 식별자를 넣지 않는다. email/name은 관리 인증에 필요하지 않다. `device.version`은 IAM의 신원·키 상태 변경 버전이고 로컬 정책 버전과 별개다. Gateway의 서비스 권한은 별도 IAM 상태 조회에서 검사하며 daemon client의 `service_access_version`을 Gateway 서비스 버전으로 오해하지 않는다.

## 5. DPoP와 거부 규칙

토큰 응답은 `token_type: DPoP`, `expires_in`은 최대 300초의 남은 수명(SAS 응답은 299일 수 있음), `Cache-Control: no-store`. API는 `Authorization: DPoP <access-token>`과 `DPoP: <proof-jwt>`를 요구한다. ID Token, Bearer, API key, 웹 세션 쿠키로 이 API에 접근할 수 없다.

- proof는 `typ: dpop+jwt`, `alg: ES256`, 공개 P-256 `jwk`를 포함한다. private JWK, 원격 키 URL, 미지원 `crit`/알고리즘을 거부한다. `jti`는 새 난수, `htm`은 실제 대문자 메서드, `htu`는 query/fragment를 제외한 외부 HTTPS URI다. canonical origin은 서버 설정으로 고정하고 임의 Host/Forwarded를 신뢰하지 않는다. 경로·메서드가 다른 proof는 거부한다.
- API proof의 `ath`는 전송된 액세스 토큰의 SHA-256 base64url 해시이며 token endpoint proof에는 없다. 요청 키·토큰 `cnf.jkt`·등록부 `key_jkt`가 모두 같아야 한다. 등록 전에는 등록부 검사만 제외되고 나머지 증명 검사는 동일하다.
- IAM과 Gateway는 각각 별도 nonce를 발행한다(60초). nonce는 발행 서버·proof key에 결합한다. 같은 nonce의 동시 요청은 허용하되 `(verifier, jkt, jti)` 재생 키를 원자적으로 저장하여 중복 proof를 거부한다. proof 허용 시간은 `now-60 <= iat <= now+5`, replay 기록은 수신부터 120초다. 저장소 장애 시 거부한다. nonce는 도전 ID와 별개의 개념이다.
- nonce 없음/만료: token endpoint는 400 `use_dpop_nonce`, 자원 서버는 401 `WWW-Authenticate: DPoP error="use_dpop_nonce"`, 모두 `DPoP-Nonce` 제공. 같은 요청을 새 proof로 제한적으로 재시도한다. 형식/서명/결합/재생 오류: token endpoint 400 `invalid_dpop_proof`, 자원 서버 401 `invalid_dpop_proof`. 잘못된 토큰은 401 `invalid_token`, scope 부족은 403 `insufficient_scope`다.
- 회수/미등록/다른 소유자는 외부에 403 `device_not_authorized`로 통일한다. 유효한 권한을 확인할 수 없는 조회/재생 저장소 장애는 503 `authorization_state_unavailable`이다. 자세한 내부 사유는 안전한 감사 코드로만 남긴다. 응답/로그에 토큰·proof·개인키를 넣지 않는다.

DPoP는 HTTP body의 서명이 아니다. TLS가 전송 본문을 보호하고 Gateway가 보고 스키마·크기·기기 소유·중복을 검사한다. 본문 변경을 DPoP 서명만으로 검출한다고 주장하지 않는다. LM2-4 보고 봉투는 `schema_version`, `report_id`, 기기별 내구성 `sequence`, `observed_at`, 허용된 상태 메타데이터를 사용한다. 정상 수신은 202와 `{report_id, sequence, received_at}` 영수증을 반환한다. 같은 report_id/sequence와 같은 내용은 새 proof로 재전송 시 동일 수신 결과를 반환하고, 같은 ID/순번의 다른 내용은 409로 거부한다. 보고 내용·heartbeat로 기기 ACTIVE/권한을 복구할 수 없다. 세부 상태 payload와 중앙 조회 UI는 LM2-4 산출물이다.

## 6. 갱신·회수·조회

관리 refresh는 동일 client/tenant/user/org/device/key/resource/scope에 바인딩하며 매번 회전한다. 절대 수명 24시간, idle 8시간을 v1 시험 기준으로 둔다. 성공적으로 소비한 refresh의 재사용은 해당 family를 회수한다. 동시 갱신은 데몬이 직렬화한다. 유실 후 복구는 재로그인으로 처리한다. 갱신에서 임의 키 교체·scope 확대·다른 audience·회수 복구를 금지한다. 현재 접근 권한/등록 상태를 발급할 때마다 확인한다. public client의 client_credentials 및 이 프로파일의 token exchange는 v1에서 허용하지 않는다. 기존 교환 경로도 기기 scope를 발급하거나 기기 토큰을 일반 토큰으로 바꾸지 못하도록 거부 시험한다.

회수 API는 IAM의 인증된 관리자/소유자 관리면에 `POST I/api/v1/devices/{device_id}/revoke`, body `{}`로 추가한다(소유자 또는 같은 조직의 기기 관리자 권한·최근 5분 내 재인증·브라우저 CSRF 보호). 일반 관리 보고 토큰에는 회수 권한이 없다. IAM은 ACTIVE→REVOKED와 version 증가, grant/refresh 무효화를 원자적으로 처리한다. 반복 회수는 현재 상태로 200이며 version을 계속 올리지 않는다. 새 로그인은 REVOKED를 되돌리지 않는다. 분실·키 교체는 **기존 기기를 회수하고 새 키로 재등록**한다. v1에는 동일 기기 ID의 무중단 key rotation을 제공하지 않는다. 등록 키 하나는 테넌트 내에서 재사용하지 않는다.

Gateway는 `POST I/api/v1/device-status/check`에 `{device_id, subject, client_id, resource}`를 보내며 **이 값들은 이미 검증한 관리 토큰에서만** 추출한다. reader client는 IAM 등록 설정으로 허용 tenant/resource에 제한한다. 응답은 `device_id`, `subject`, `tenant_id`, `organization_id`, `device_version`, `key_jkt`, `status`, `authorized`, `user_version`, `service_access_version`, `checked_at`이다. IAM은 기기와 사용자 ACTIVE, 두 서비스 접근·조직 entitlement·현재 버전을 함께 검사한다. `authorized`는 IAM 서버 판정 결과이며 요청 플래그가 아니다. reader는 기기 목록 전체 조회/변경 권한이 없다.

v1은 이벤트 기반 무효화에 의존하지 않고 이 제한된 온라인 조회를 먼저 구현한다. 캐시 키는 issuer/tenant/subject/organization/client/resource/device/version/key 및 user/service 버전 전체를 포함한다. 성공 캐시는 최대 15초, 요청 시작 monotonic 시각부터 계산하고 응답 지연도 차감한다. 토큰의 identity/version과 응답이 다르면 거부한다. 상태 불명·15초 초과·IAM 장애 후 만료된 ACTIVE를 재사용하지 않는다. **회수 commit 후 15초를 넘겨 시작한 신규 관리 요청은 거부**하는 것을 LM2-4 시험 기준으로 삼는다. 이는 아직 측정된 운영 SLA가 아니며 진행 중 원격 작업 중지/G-2 보장이 아니다. 서버 시계 허용 오차와 별개로 캐시 경과 시간은 monotonic으로 재며 오류가 있으면 거부한다.

## 7. 구현 진입점과 완료 기준

아래 표는 **LM2-1 당시(2026-09-25) 구현 전 소스 조사**다. 이후 IAM 변경과 검증 결과는 [LM2-2 기록](../reconstruction/phase-lm2-2-iam-device-identity.md)에 있다. 배포 상태는 확인하지 않았다.

| 프로젝트 | 확인한 경로·현재 상태 | 필요한 변경 |
|---|---|---|
| IAM (`e70902e9`) | `auth-domain/.../user/UserDevice.java`는 지문/IP/접속 시각만 저장 | 별도 등록부·키/도전/grant 관계·회수 모델. 기존 접속 이력 보존 |
| IAM | `auth-app/.../security/oauth2/McpResourceIndicatorValidator.java`는 MCP 아닌 resource 거부; `config/TokenPolicyConfig.java`는 MCP audience만 특례 | 등록된 client/resource/scope 프로파일 검증과 audience 분기; 관리 claim·DPoP key 등록부 검증 |
| IAM | `CustomRegisteredClientRepository`는 PKCE·consent·정확 redirect 기반; `McpPublicClientRefreshTokenGenerator`/`McpPublicRefreshClientAuthentication*`는 MCP public refresh 전용 | 제한된 native 등록, loopback redirect 규칙, 관리 public refresh·family 회수, grant 바인딩의 DB 복원 시험 |
| IAM | `TenantDiscoveryController`의 수동 metadata에 새 scope/DPoP 광고 없음; `TokenPolicyConfig` SAS 경로에는 조직 claim 없음 | 조직 선택/권한을 grant에 저장, discovery에 구현된 scope/`dpop_signing_alg_values_supported`만 광고 |
| IAM | Boot 4.0.6, Spring Security Authorization Server 사용 | 프레임워크의 DPoP 지원을 우선 재사용하되 nonce·재생 저장·재시작 복원·등록 키 바인딩은 실측. 의존 버전만으로 지원 완료 판정 금지 |
| Gateway (`d346d56f`) | `src/api/mcpRoutes.ts`는 Bearer; `src/auth/mcpOAuthVerifier.ts`는 JWT/MCP scope/사용자·권한 확인. 관리 채널 없음 | 별도 관리 verifier/route, reader 조회·캐시, 보고 중복·stale 처리. 기존 MCP 라우트 편집으로 섞지 않음 |
| 데몬 (아직 HEAD 없음) | `Cargo.toml`에는 serde/toml/Ed25519/sha2; 로컬 worker IPC 구현 | 보호 P-256 키, HTTP/TLS, native OAuth, DPoP, 토큰 보관·갱신 어댑터 |

Spring Security 7.0의 [지원 기능](https://docs.spring.io/spring-security/reference/7.0/servlet/oauth2/authorization-server/index.html)에 DPoP가 포함된다. 현재 IAM의 custom validator/refresh/persistence까지 이 계약이 동작하는지는 LM2-2에서 검증한다. 데몬의 기존 `docs/evidence/codex-http-header-helper-device-binding-2026-09-24.md`는 합성 헤더 실험 기록이며 관리 채널/G-2 상호운용 완료 증거가 아니다.

- **LM2-1 완료:** 이름·프로파일·요청/응답·실패/수명주기 및 공통 fixture가 정의되고 fixture 자체의 형식·공개키 서명·해시가 검증됨.
- **LM2-2 완료 기준 (로컬 통과):** IAM 등록→토큰 발급→조회→회수→갱신 거부를 DB 포함 시험. [cases.json](../contracts/daemon-management-v1/cases.json)의 IAM 사례와 기존 일반 서비스/MCP 인증 회귀를 실제 구현에 연결한다. 문서의 기대 결과는 실행 통과 기록이 아니다.
- **LM2-3 로컬 검증:** 실제 IAM HTTPS 등록/갱신/회수, 별도 프로세스 재시작, macOS sandbox 및 다른 UID의 키/세션 읽기·쓰기 거부와 비노출 검증. [기록](../reconstruction/phase-lm2-3-daemon-auth.md)을 따른다. 전용 UID 설치 프로필은 미완료다.
- **LM2-4:** Gateway가 공통 token/proof fixture 및 실제 IAM/데몬 요청을 검증하고 신규 요청 회수 한계·보고 중복·stale·중앙 표시를 실측해야 G-1A 완료다.

공통 fixture는 `.invalid` 호스트와 합성 subject를 사용한다. 서명 샘플의 private key는 저장하지 않는다. Kit에 production 인증 verifier를 넣지 않으며 fixture 무결성 테스트를 서비스의 보안/통합 시험으로 집계하지 않는다.

## 8. LM2-4 보고·표시 확정 (2026-09-25)

구현·실측과 한계는 [LM2-4 기록](../reconstruction/phase-lm2-4-gateway-reports.md)을 따른다.
보고 v1은 `schema_version`, `report_id`, 양의 안전 정수 `sequence`, RFC3339
`observed_at`, strict `status`다. `status.connection`은 connected/unavailable이며
선택적 daemon_version, 고정 scope(native_mcp_worker), policy(state/revision),
execution(state), 최대 20개 recent_events(sequence/kind/timestamp/policy_revision)를
허용한다. kind는 denied/intent/completed/failed/interrupted뿐이다. 구체 스키마는
Gateway `src/daemonManagement/model.ts`다. 예시의 connection-only 보고도 유효하다.

데몬은 30초마다 보고할 수 있고 단일 pending 보고를 보호 파일에 원자적으로 보관한다.
수신 측은 16KiB 한도, 최초 receipt 유지, 동일 ID/순번의 다른 내용 및 이전 순번 거부를
적용한다. 오래된 보고도 수신할 수 있으나 관측/수신 중 이른 시각부터 90초 후 stale다.
+5초를 넘는 미래 관측은 거부한다. nonce/proof는 공유 PostgreSQL에 원자적으로 저장한다.
중앙 조회는 기존 SSO의 tenant/subject 본인 범위이며 첫 보고가 있어야 표시된다.
IAM 허용 상태와 보고 신선도는 별도 필드다. 조직 관리자 목록·원격 작업 집행은 추가 계약이다.

## LM3-2 추가 계약 (2026-09-25)

기존 보고 전용 scope·claim·fixture는 그대로 유지한다. 작업 수령은 등록된
`tools-daemon-management` 클라이언트가 `gateway:daemon:jobs:read`를 새로 요청해야 한다.
`openid device:identity`에 report 또는 jobs:read, 또는 둘을 함께 요청할 수 있다.
기존 grant/refresh에 수령 권한을 자동 추가하지 않으며 다른 서비스 클라이언트에는 허용하지 않는다.
Gateway는 GET `/api/v1/daemon-management/jobs/pending`의 scope·메서드·정확한 URL·ath·nonce·재생을 검증한다.

기존 기기 상태 reader M2M은 같은 status audience와 `iam:device-status:read`로
POST `/t/{tenant}/api/v1/device-status/management-authority`에서 현재 조직 관리자 신원을 읽을 수 있다.
이 읽기 기능은 reader에게 작업 승인 권한을 부여하지 않는다. Gateway가 인증한 SSO 주체로
조회하고 작업별 인가·승인 저장을 소유한다. [LM3-2 기록](../reconstruction/phase-lm3-2-job-issuance.md)을 따른다.
