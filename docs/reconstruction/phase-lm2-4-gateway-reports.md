# LM2-4 — Gateway 관리 수신과 중앙 표시

2026-09-25. **기능 구현·로컬 통합 검증 완료. G-1A의 관리 채널은 기존 macOS
네이티브 워커 프로필에서 통과했다. 운영 배포·설치·고객 IdP 브라우저 검증은 아니다.**
LM2-4 검증 당시 Gateway 원본의 JEV TypeScript 오류 10개가 전체 빌드를 막았다.
같은 날 [후속 수정](phase-jev-typecheck-fix.md)으로 해결해 전체 빌드가 통과했다.
아래 표의 baseline 오류 기록은 최초 LM2-4 실행 시점의 결과다. 운영 출시 판단은 별도다.

## 구현

- Gateway 별도 `POST /api/v1/daemon-management/reports`: IAM RS256 관리 토큰,
  device scope/claim, 등록 키와 ES256 DPoP, ath/메서드/고정 HTTPS 대상, nonce,
  원자적 proof 재생 차단. Bearer·API key·SSO 쿠키로 보고할 수 없다.
- 제한된 IAM reader 조회는 token-derived 신원·조직·키·기기/user/service 버전을
  대조한다. ACTIVE 캐시는 monotonic 조회 시작부터 최대 15초이며 실패 후 오래된
  허용 상태를 재사용하지 않는다. 기존 서비스의 enforcement 플래그는 바꾸지 않았다.
- PostgreSQL migration 13은 nonce/proof와 보고 receipt/head를 추가한다. 같은
  보고의 재전송은 최초 receipt를 반환하고 변경 중복·이전 순번은 409다. 인가를
  통과한 뒤 중복을 처리한다. replica 간 proof 경쟁은 하나만 허용한다.
- 데몬 `management-report`와 30초 주기의 foreground `management-watch`를 추가했다.
  고정 로컬 IPC의 정책/실행/최근 이벤트 메타데이터만 투영한다. 보호된 단일 pending
  큐를 먼저 저장하고 새 proof로 재시도한다. Gateway nonce는 IAM nonce와 분리한다.
- Gateway SSO 대시보드의 ‘내 등록 기기’는 동일 tenant/subject의 보고만 표시한다.
  IAM 허용/거부/확인 불가와 보고 최신/지연을 분리한다. 90초 뒤 stale이며 오래된
  관측을 늦게 수신해도 fresh로 승격하지 않는다. 5초 조회, 실패 시 이전 표시 제거.
  첫 보고가 없는 IAM 등록 기기는 목록에 없으며 조직 관리자 조회는 아직 없다.

구체 설정·스키마는 Gateway `docs/daemon-management-v1.md`, 데몬
`docs/evidence/management-report-2026-09-25.md`, 재현은 데몬
`experiments/management-report/README.md`에 있다. Kit 런타임에는 중앙 인가를 넣지 않았다.

## 실행 증거

| 확인 | 결과 |
|---|---|
| Gateway 전체 회귀 + 실 PostgreSQL | 258 passed / 4 existing optional skipped, 이후 추가 UI 시험 1 passed; 합계 259 |
| 공개 서명 fixture + M01–M30 | 31 passed; fixture 기대값만 세는 시험이 아니라 실제 verifier/reader 실행 |
| 새 관리 모듈·시험 TypeScript | `tsconfig.daemon-management.json` 통과 |
| Gateway 전체 TypeScript | 원본 baseline과 동일한 JEV 관련 진단 10개; 이번 변경 경로 오류 없음 |
| 데몬 Rust | 84 passed; fmt/clippy `-D warnings` 통과 |
| 실제 IAM HTTPS/PG/Redis → 데몬 → Gateway HTTPS/PG | 13 checks, Gradle 통합 시험 1 passed |
| 회수 지연 | revoke 응답 후 15.1초 대기한 신규 요청 거부; 완료 시점 15.287초 |
| 응답 유실·재시작 | DB commit 후 소켓 단절 → 같은 보고와 최초 receipt 재사용; Gateway 재시작 후 유지 |
| 실제 시간 stale | 90초 초과 보고 중단 → 중앙 API stale; DOM 렌더링도 지연/거부를 별도로 표시 |

원시 로그 대신 [공개 증거 JSON](lm2-4-gateway-evidence.json)을 보존한다.
샌드박스의 로컬 TCP/Unix 소켓 EPERM은 허용된 환경에서 재실행해 통과했다.
실 IAM 로그인/동의는 합성 사용자의 HTTP 브라우저 드라이버가 수행했다.
대시보드 세션은 Redis 합성 레코드로 준비하고 실제 OAuthSessionStore로 해석했다.
신규 UI는 DOM 시험으로 검증했으며 실제 브라우저 시각 검수·고객 IdP 로그인은 미검증이다.
IAM 구현은 이번 단계에서 수정하지 않았다. 기존 LM2-2의 일반 인증 회귀 증거를 유지한다.

## 남은 단계

LM3은 조직 인가를 거친 고정 서명 관리 작업과 데몬 집행/결과 대조다. 아직 시작하지
않았다. 직접 `/mcp` 요청의 기기 결합 G-2, 전용 UID 설치, 코드 서명, 운영 provisioning,
운영 부하/보관 정책은 별도 게이트다. 전체 저장소 빌드는 후속 수정으로 복구했다. heartbeat나 소프트웨어
키 소유를 기기 전체 무결성·원격 호출 허용·진행 중 작업 종료의 증거로 쓰지 않는다.

검증된 Gateway/데몬 변경 36개 파일을 원본 저장소에 해시 대조 후 반영했다.
기존 변경은 보존했고 commit/push는 하지 않았다. 시험용 PostgreSQL/Redis 3개와
임시 TLS/기기 키·토큰·outbox, 주입한 IAM 시험 파일을 정리했다.
