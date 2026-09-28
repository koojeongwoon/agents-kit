# LM3-3 데몬 수령·중복 방지·회수 집행 — 2026-09-26

**LM3-3의 macOS native worker 로컬 프로필 구현·검증 완료. 운영 배포는 하지 않았다.**
[공개 증거](lm3-3-daemon-execution-evidence.json)와
[데몬 설정·복구 계약](/Users/jw/__dev/tools-daemon/docs/daemon-management-jobs-v1.md)을 따른다.

## 구현

- `management-jobs --config`가 추가 jobs scope·GET DPoP·별도 Gateway nonce로 작업을 받는다.
  `management-watch`는 jobs 설정이 있을 때 기존 30초 보고 주기마다 먼저 작업을 수령한다.
  보고 전용 grant는 자동 승격하지 않으며 추가 scope는 새 로그인이 필요하다.
- 보호된 로컬 서명 정책의 자원 ID/version/hash·기기 바인딩과 실제 실행 파일 해시로
  레지스트리를 초기화한다. 수신 본문으로 자원을 등록하거나 실행 경로를 결정하지 않는다.
- 원장 intent/digest와 자원 상태 CAS를 한 보호 snapshot으로 원자 저장한다. 동일 작업은
  재실행하지 않고, ID 충돌·기대 버전 불일치·다른 기기·만료를 거부한다. 누락·손상된 원장은
  자동 초기화하지 않는다. 기존 사용자 변경은 해시 대조 후 보존한다.
- 신규 실행과 기존 워커의 100ms 재검증이 같은 회수 상태를 확인한다. 회수 시 기존 supervisor
  lease를 닫고 워커를 kill/reap한다. 디스크 PID를 신뢰해 신호를 보내지 않는다.
- 실행 intent는 spawn 전에 저장한다. 회수 시 신규 차단과 종료 확인을 구분하고, 프로세스
  크래시로 확인을 잃으면 재시작해도 `unknown`을 보존하며 새 실행을 차단한다.
- `status.job_results`를 기존 LM2 durable 보고에 추가했다. Gateway는 제한된 결과 스키마를
  받아 기존 저장/본인 기기 조회 경로로 전달한다. 보고 영수증만으로 issuer queue를 삭제하거나
  작업 완료로 바꾸지 않는다. 결과 유실 시 같은 report ID/sequence/content를 재전송한다.

## 검증

| 항목 | 결과 |
|---|---|
| Rust 전체 | 96 passed / 0 failed / 0 skipped |
| Rust fmt / clippy / build | 모두 통과, clippy `-D warnings`, binary/examples 빌드 |
| 공통 계약 fixture | Kit 10개 시험, Rust 안의 공통 서명 벡터 58개 유지 |
| Gateway 전체 build / 시험 | TypeScript 통과, 339 passed / 13 skipped |
| 실제 macOS native worker | 신규 호출 거부, 진행 중 프로세스 reap, 재시작 후 차단 유지 |
| 실제 TLS 데몬 어댑터 | 다른 기기 작업 거부, 중복 2회 전달에서 상태 증가/원장 1회 |
| 보고 유실/재전송 | 동일 봉투 재전송과 confirmed 결과 수신 확인 |
| 크래시 별도 프로세스 시험 | 워커 owner 종료 후 재시작해도 unknown 보존·신규 호출 거부 |
| OS 제한 실측 | sandbox 워커의 레지스트리 읽기·보호 디렉터리 쓰기·자식 실행·네트워크 거부 |

정상 시험의 수령 실행 시작부터 reap 관측까지는 **133ms**였다. 30초 polling, IAM 인가·토큰
발급, 운영 네트워크를 포함한 회수 SLA가 아니다. 크래시 시험의 물리적 종료 관측을 데몬의
확인 성공으로 바꾸지 않았다.

초기 Rust의 소켓/콜백 시험 3개는 sandbox EPERM으로 실패했고, 허용된 로컬 시험 환경에서
전체를 다시 실행해 통과했다. macOS 실측 중 회수는 되었지만 출력 파이프를 먼저 닫아 종료
확인이 유실되는 문제를 발견해 수정한 뒤 정상/크래시 경로를 재검증했다.

Gateway에서 제외한 13개는 기존 PostgreSQL 관리 작업 5개·보고 4개와 DB/Redis lifecycle 4개다.
이번에는 DB/migration을 변경하지 않았다. Gateway 라우트 시험은 실제 JWS/DPoP 검증을 사용하며
인가·저장소는 시험 입력이다. macOS HTTPS 시험 역시 **IAM credentials와 Gateway 인가/발행을
fixture로 제공**한다. 실제 세 서비스 통합 E2E 완료 기록이 아니다.

## 남은 범위

- LM3-4: 실제 IAM→Gateway→데몬 통합, 장애·만료·회수 전파, 중앙 작업 결과 대조/UI.
- 별도 UID v4 executor: 기존 lease 취소는 연결되지만 정상 응답을 확인하지 못한 취소는
  `unknown`이다. 이 실행 프로필의 종료 확인과 실제 별도 계정 시험은 추가 검증 대상이다.
- 운영: IAM 추가 scope 등록, 공개키/서명 정책 배포, 보호 저장소 설치, migration/배포.
- 자원 재활성화·정책 revision 변경·unknown 해소는 명시적 후속 복구/배포 절차가 필요하다.
  기존 회수 상태를 초기화해 자동 복구하지 않는다. OS 전체 실행 통제나 G-2 증거도 아니다.

검증은 격리 복사본에서 수행했고 데몬 18개·Gateway 2개 파일을 변경 전 해시 대조·백업 후 원본에 반영했다. 반영 후 20개 파일의 해시 일치도 확인했다. commit/push,
운영 서비스 재시작, 실제 조직 정책 회수는 하지 않았다.
