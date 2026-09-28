# LM3-4 실제 채널 통합·중앙 결과 대조 — 2026-09-26

**macOS native worker의 실제 IAM→Gateway→데몬 통합과 중앙 결과 대조/UI를 구현·검증했다. 별도 UID 회수와 비sandbox 파일 접근 거부 실측까지 완료했으며, 운영 배포는 하지 않았다.**
[공개 증거](lm3-4-integration-evidence.json)를 따른다. LM3-4 로컬 검증 게이트를 완료한다. 운영·모든 실행 프로필 완료로 확대하지 않는다.

## 결과

Gateway migration 15는 발행 작업과 결과를 연결한다. 보고 수신 트랜잭션 안에서 작업 ID,
발행 payload digest, issuer/tenant, 주체/조직/기기/version/key, 자원 ID와 결과 상태 버전을
대조한 뒤 보고·영수증·작업 결과를 함께 커밋한다. 위조/다른 작업의 결과와 중복 ID는 전체
rollback한다. 같은 보고 재전송은 기존 영수증을 돌려주며 최신 결과를 과거 상태로 되돌리지 않는다.
확인된 종료 결과가 있는 작업은 pending 전달에서 제외한다. unknown은 기한 내 재전달하며
데몬의 원장/CAS가 중복 집행을 막는다. 발행 기한 뒤 도착한 결과도 과거 관측으로 보존한다.

`GET /api/v1/daemon-management/jobs`는 SSO 본인 작업을 조회한다. `organization_id`를
지정하면 매번 현재 IAM ORG_ADMIN 권한과 서비스/사용자 버전을 확인한다. 다른 소유자/조직의
정보와 서명·키·인가 내부 기록을 응답하지 않는다. 대시보드의 본인 작업 카드는 다음을 구분한다.

- 전달 대기: 실행 결과 없음.
- 회수 완료 관측: 신규 실행 차단과 종료 확인을 보고받음.
- 신규 실행 차단 · 종료 미확인: unknown을 성공으로 바꾸지 않음.
- 전달 기한 만료 · 집행 여부 미확인: 무응답/만료를 성공으로 바꾸지 않음.
- 90초보다 오래된 관측: 과거 완료 이력은 보존하되 현재 상태 미확인을 표시.

별도 UID v4 executor에는 supervisor가 실제 reap 뒤 보내는 엄격한 cleanup 확인 프레임을
추가했다. daemon은 lease를 닫은 뒤 최대 2초 동안 프레임을 읽는다. EOF/잘못된 프레임/응답
유실만으로 종료를 확인하지 않는다. 프로세스 크래시의 unknown과 재시작 후 신규 차단은 유지한다.
이 프로토콜의 단위시험·native 회귀와 사용자 sudo 실행의 실제 별도 UID OS 실측까지 통과했다.

실제 E2E 중 관리 작업 읽기와 실행 중 재검증의 lock 경합으로 정상 워커가 중단되는 결함을
발견했다. job 상태 읽기는 공유 잠금, 변경은 배타 잠금으로 분리하고 최대 200ms만 기다린 뒤
실패 시 실행을 거부하도록 고쳤다. 인증 저장소의 기존 배타·즉시 실패 동작은 유지했다.

## 검증

| 항목 | 결과 |
|---|---|
| Rust 전체 | 99 passed, fmt/clippy `-D warnings`/binary·examples build 통과 |
| Gateway 전체 | 351 passed / 기존 lifecycle 4 skipped, PostgreSQL 관리 보고/작업 시험 포함 |
| TypeScript | 전체 타입 검사 통과 |
| 실제 IAM HTTPS 통합 | JUnit 1개, 내부 검증 15개 통과 |
| UI | 실제 대시보드 HTML + 합성 응답의 표시 로직 시험 및 브라우저 육안 확인 |

통합 시험은 격리된 실제 IAM HTTPS/OAuth/PKCE/DPoP·PostgreSQL·Redis와 실제 Gateway
HTTPS/JWS/인가/저장소, macOS 데몬/워커를 실행했다. 로그인·기기 등록과 현재 IAM ORG_ADMIN
판정은 실제 경로다. **Gateway 대시보드 SSO 세션만 시험 Redis에 주입했다.** 브라우저 SSO
전체 사용자 여정이나 운영 환경 시험이라고 주장하지 않는다.

단절 후 작업 보존, 중복 단일 CAS, 실행 중 reap 및 신규 호출 거부, Gateway 재시작과 보고
응답 유실 후 같은 영수증 재수신, 데몬 재시작 후 회수 유지, 실제 91초 경과 뒤 stale 표시,
IAM 기기 폐기 뒤 작업/보고 거부를 검증했다. 회수 요청 실행 시작부터 reap까지 **510ms**,
기기 폐기 뒤 거부 관측은 **15.3초**였다. 30초 polling 포함 SLA나 warm-cache 최악 지연
상한의 실측은 아니다. 변경된 코드로 크래시 시험도 다시 통과해 unknown 유지·신규 차단·보고 재시도를 확인했다.

## 남은 게이트와 재현

별도 UID 시험은 [고정 fixture](/Users/jw/__dev/tools-daemon/experiments/management-jobs/run_split.py)가
기존 `nobody` 계정을 사용해 임시 executor/worker를 실행하고, sandbox 밖에서도 그 UID가
원장·기기 키·세션을 읽거나 쓰지 못하는지 확인한다. root는 임시 디렉터리 소유권 준비와
UID 전환에만 쓰고 모든 런타임은 비root다. 계정/launchd/운영 설정을 설치하지 않는다.
초기 sudo 인증 보류와 검사기 오류를 해결한 뒤 사용자 재실행 결과 파일을 확인해 통과를 기록했다.

[재현 안내](/Users/jw/__dev/tools-daemon/experiments/management-jobs/README.md)와
[Gateway 계약](/Users/jw/__dev/tools-gateway/docs/daemon-management-jobs-v1.md)을 따른다.
운영 migration 15, 서명 키/정책 배포, 보호 저장소/계정 설치, 추가 scope 등록과 실제 rollout은
별도 작업이다. 자원 재활성화/unknown 자동 해소, 일반 런타임 지원, G-2 원격 MCP 기기 결합,
OS 전체 실행 통제를 완료한 단계가 아니다.

검증한 데몬 15개·Gateway 11개 파일은 원본의 변경 전 해시를 대조하고 백업한 뒤 반영했다.
반영된 26개 파일 모두 격리 검증본과 SHA256 일치를 확인했다. IAM 운영 소스는 변경하지 않았다.

## 별도 UID 사용자 실행과 시험기 수정 (2026-09-26)

사용자 sudo 실행에서 별도 UID native worker의 회수·중복 CAS·재시작·보고 재시도가 통과했고
reap 관측은 151ms였다. 마지막 비sandbox 원장/키/세션 접근 검사에서 Python subprocess가
exit 1로 종료했다. 기존 시험기가 stderr를 보존하지 않아 정확한 OS/Python 원인은 미확정이다.
이를 권한 차단 성공이나 제품 회수 실패로 해석하지 않는다.

시험기를 실제 Python interpreter·`-I`·고정 `/private/tmp` cwd·최소 환경으로 실행하도록
수정하고 timeout/오류 출력/실제 UID/결과 형상을 확인한다. 최종 증거는 모든 검사가 통과한
뒤에만 발행한다. 접근 허용 거부, 실제 권한 거부, 파일 부재, 오류 stderr의 회귀 4개는 통과했다.
수정한 동일 sudo 명령을 사용자가 재실행했고, 결과 파일을 직접 읽어 아래 통과를 확인했다.

## 별도 UID 최종 실측과 게이트 판정

별도 UID `4294967294`에서 정상 회수·중복 방지·신규 차단·진행 중 reap·재시작 후 차단·
동일 보고 재전송이 통과했다. 회수부터 reap 관측까지 **137ms**다. sandbox를 적용하지 않은
동일 UID의 독립 검사에서도 원장·기기 키·세션 각각의 읽기/쓰기 **6개 모두 거부**됐다.
이는 전용 시스템 계정 설치가 아니라 기존 nobody를 사용한 일회성 OS 경계 시험이다.

`crash_remains_unknown: false`는 이번 실행이 정상 회수 변형이기 때문이다. 실패 건수가 아니며,
별도 native 크래시 회귀에서는 `crash_remains_unknown: true`와 신규 실행 차단을 확인했다.

**LM3-4 로컬 구현·검증 완료.** 실제 IAM/Gateway E2E는 같은 서비스 UID의 native sandbox,
별도 UID 시험은 합성 IAM credentials/Gateway authority를 쓰므로 두 검증 범위를 합쳐 하나의
별도 UID 실제 IAM E2E라고 주장하지 않는다. 운영 배포와 설치/지원 범위 확대는 별도다.
