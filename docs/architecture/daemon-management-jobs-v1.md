# 데몬 관리 작업 v1 — LM3-1

2026-09-25. Gateway와 Rust 데몬의 서명 검증·순수 회수 계획 함수 및 공통 시험을 구현했다.
**LM3-2에서 IAM 조직 권한 조회·Gateway 발행/승인 저장·DPoP 전달을 추가했다.**
[LM3-2 기록](../reconstruction/phase-lm3-2-job-issuance.md)을 따른다. LM3-3의 데몬 원장/CAS·native worker 회수·결과 보고는 [로컬 검증 기록](../reconstruction/phase-lm3-3-daemon-execution.md)을 따른다. 실제 채널 통합과 중앙 결과 대조는 [LM3-4 기록](../reconstruction/phase-lm3-4-integration.md)을 따른다.
기존 LM2 상태 보고와 조회 권한으로 관리 변경을 허용하지 않는다.

## 소유권과 신뢰 입력

IAM은 사용자·기기의 등록과 회수를 소유한다. Gateway는 조직의 관리 권한·승인 기록과
작업 발행을 소유하고, 데몬은 검증된 작업을 로컬 집행 경계에 연결한다. Kit은 계약 문서와
공통 fixture를 보관하며 작업 실행 서버나 별도 기기 등록부를 만들지 않는다.

검증기는 외부에서 신뢰한 Gateway 공개키와 다음 바인딩을 받는다: Gateway 관리 자원 URL,
IAM tenant issuer, tenant, organization, 소유자 subject, device ID/version, 기기 키 thumbprint.
이를 작업 본문에서 가져와 검증의 기준으로 삼으면 안 된다. 후속 전달 어댑터는 IAM의 현재
기기·사용자·서비스 접근 상태 및 등록 키에 결합된 요청 증명을 다시 확인해야 한다.
LM2의 보고 scope는 작업 발행·수령·집행 권한이 아니다. 작업 수령은 별도 `gateway:daemon:jobs:read` scope와 GET DPoP를 요구한다.
IAM에서 보고 전용·수령 전용·둘을 결합한 scope 집합을 명시적으로 요청할 수 있다.

Gateway 세션에 조직 역할을 신뢰 가능한 플래그로 복제하지 않는다. LM3-2에서는 SSO의
subject로 IAM의 현재 조직 `ORG_ADMIN`·사용자/서비스/조직 상태를 조회한 뒤 작업을 발행한다. `approved_by`는 실제 조직 인가를 수행한 서버가 남긴 승인 기록을
참조해야 한다. 필드 존재·서명 검증만으로 승인자의 현재 권한이 입증되지는 않는다.

## 서명과 직렬화

[JWS Compact Serialization](https://www.rfc-editor.org/rfc/rfc7515.html)과
[EdDSA/Ed25519 JOSE 정의](https://www.rfc-editor.org/rfc/rfc8037.html)를 사용한다.
작업 payload와 아래 제한 프로필은 서비스 자체 계약이다. OIDC 표준 claim으로 취급하지 않는다.

- 헤더는 정확히 `alg: EdDSA`, `typ: lynply-daemon-job+jws`, 설정된 `kid`만 받는다.
- 수신 문서의 JWK, key URL, 추가 JOSE 헤더는 거부한다. 외부 설정의 공개키는 padding 없는
  canonical base64url로 인코딩한 32바이트 Ed25519 키다. 서명은 64바이트다.
- Gateway 작업 서명 키는 IAM 토큰 키, 단말 P-256 등록 키, 기존 로컬 정책 서명 키와
  별도 신뢰 용도다. Gateway는 소유자 전용 권한의 고정 JWK 파일을 읽고 현재 `kid`만 전달한다.
  새 `kid`로 교체하면 기존 작업을 재서명하지 않는다. 데몬 신뢰 키 설치 자동화는 남아 있다.
- 최대 compact 크기는 16,384바이트다. 각 segment는 canonical base64url이다.
- 헤더·본문 JSON은 스키마가 허용한 ASCII 문자열과 안전한 정수, 정렬된 객체 키,
  공백 없는 표현만 허용한다. 중복 키·미지 필드·다른 표현은 거부한다.
  **범용 RFC 8785 구현이 아니다.** 정수 상한은 `9007199254740991`이다.
- digest는 디코딩한 canonical payload 바이트의 SHA-256 소문자 hex다.

## 본문과 최초 작업

모든 필드는 필수이며 추가 필드를 허용하지 않는다. 실제 예제·실패 사례는
[공통 fixture](../contracts/daemon-jobs-v1/README.md)에 있다.

| 필드 | 의미 |
|---|---|
| `schema_version`, `job_id` | `1`, 발행자가 부여한 작업 ID |
| `iss`, `aud` | Gateway HTTPS 관리 자원, 고정 `urn:lynply:tools-daemon:management-jobs:v1` |
| `identity_issuer`, `tenant_id`, `organization_id`, `subject` | IAM tenant issuer와 대상 기기의 tenant·조직·소유자 |
| `device_id`, `device_version`, `key_jkt` | IAM 기기 등록 ID·버전·공개키 thumbprint |
| `approved_by` | `subject`, `authorization_id`, `approved_at` 승인자·영속 인가 기록·승인 시각 |
| `operation` | v1은 `managed_worker.revoke`만 허용 |
| `resource` | 승인된 논리 자원 `id`, 양의 정수 `version`, SHA-256 `sha256` |
| `policy_revision`, `expected_state_version` | 설치 정책 revision과 로컬 자원 상태의 기대 버전 |
| `iat`, `exp` | 초 단위 NumericDate. 수명 최대 300초, `exp > iat` |

ID는 ASCII 영숫자로 시작하는 1~128자의 영숫자·`.`·`_`·`:`·`-`다. URL은 canonical HTTPS이며
사용자 정보·query·fragment를 허용하지 않는다. 버전은 양의 안전한 정수다.
승인 시각은 발행 시각 이하이고 최대 300초 전이다. 미래 발행 허용 오차는 5초이며,
`exp <= now`는 거부한다. 계획 시점에 만료와 검증 이후 시계 후퇴를 다시 검사한다.

논리 자원 ID를 실행 파일·임의 경로·URL로 해석하지 않는다. 설치된 보호 자원 레지스트리의
ID/version/hash가 모두 일치해야 한다. `policy.apply`, 설치, shell, 임의 효과는 미지원이다.
`expected_state_version`은 향후 영속 자원 상태의 버전이며 IAM `device_version`이나
LM2 보고 순번과 다르다.

## 순수 계획 결과와 집행 전제

`verify`는 서명·스키마·바인딩·시간을 확인한 객체를 반환한다. `plan`은 신뢰한 현재 자원 상태와
작업 원장의 이전 기록을 받아 다음 중 하나를 반환하며, 상태나 프로세스를 변경하지 않는다.

- `prepare_revoke`: 자원·정책·상태 버전 일치, 현재 `active`. 기대 버전과 다음 버전을 반환한다.
- `already_recorded`: 원장에 같은 `job_id`와 digest가 있다. 재실행하지 않고 저장된 진행 상태를
  조회할 근거일 뿐, 성공·차단·종료 완료를 의미하지 않는다. 만료된 중복도 거부한다.
- 거부: 잘못된 문서/키/서명/바인딩/시간, 다른 자원, 오래된 버전, 이미 회수된 자원,
  같은 ID의 다른 내용, 잘못된 현재 상태 또는 버전 증가 한도 초과.

원장 입력은 tenant·device·job ID로 조회한 보호된 저장소에서 와야 한다. 요청자가 제공한
과거 결과를 신뢰하면 안 된다. `plan` 통과는 경쟁 실행을 막지 않는다. 실제 어댑터는 동일
자원의 변경을 직렬화하고 **원장 intent 저장과 상태 버전 비교·갱신(CAS)을 원자적으로** 처리한
뒤 집행해야 한다. 원장 기록만 남고 집행이 불명인 경우 재시작 후 실제 상태와 대조해야 한다.

신규 실행 거부와 진행 중 프로세스 종료를 별도로 수행·관측·기록해야 한다. 수신 확인,
계획 승인, 차단 반영, 종료 확인, 실패/상태 불명을 하나의 성공값으로 합치지 않는다.
실제 결과 상태 머신·복구·재전송은 LM3-3~4에서 구현·시험한다.

## 단계와 검증 범위

- LM3-1 완료: 두 런타임의 검증기와 순수 계획, 공통 서명/오류 fixture 58개.
- LM3-2 완료: IAM 현재 ORG_ADMIN 확인, Gateway 키 파일 검증·발행/승인 원자 저장·전달 scope/DPoP, 권한 회수 재확인.
- LM3-3 로컬 완료: 추가 scope/GET DPoP 수령, 보호 원장·자원 CAS, native worker 차단/회수, unknown 복구, durable 결과 보고. 별도 UID 취소 확인과 운영은 미검증.
- LM3-4 native 로컬 검증 완료: 실제 IAM/Gateway E2E, 중복·단절·재시작·경합·회수 실측과 중앙 결과 대조/UI. 별도 UID 회수·비sandbox 파일 접근 거부 실측도 완료. 운영 배포는 미완료.

LM3-1은 IAM/Gateway 운영 배포, 실제 기기 회수, 프로세스 종료, OS 전체 프로그램 통제나
Codex→Gateway 원격 MCP 기기 결합의 증거가 아니다.

## LM3-3 결과 메타데이터와 복구

보호된 설치 정책의 자원/기기 바인딩으로 레지스트리를 초기화한다. 원장 intent와 자원 상태
CAS를 한 snapshot으로 커밋하며, 등록된 한 native worker의 재활성화는 v1에 없다.
실행 시작도 먼저 기록한다. 신규 차단과 종료 확인을 분리해 기존 LM2 보고의 선택 필드
`status.job_results`에 `job_id`, payload `digest`, `resource_id`, `state_version`,
`admission: blocked`, `termination: confirmed|unknown`을 보낸다. 최대 20개이며 미지 필드는 거부한다.

confirmed는 native owner의 정상 종료 및 워커 reap 확인을 뜻한다. owner 크래시·확인 유실은
unknown으로 보존하고 재시작 후 새 호출을 차단한다. 별도 UID executor의 확인 없는 lease
취소도 unknown이다. 보고 수신은 관측 상태일 뿐 조직 승인, 큐 삭제, 중앙 작업 완료 확정이
아니다. LM3-4는 발행 작업과 엄격히 대조한 결과만 중앙에 표시하고 confirmed 결과의 pending 재전달을 중단한다. 이는 마지막 관측이며 오래되면 현재 상태는 미확인이다. [설정과 검증 경계](../reconstruction/phase-lm3-3-daemon-execution.md)를 따른다.

## LM3-4 중앙 결과와 종료 확인

Gateway migration 15는 report/receipt와 같은 트랜잭션에 작업 결과를 저장한다. 미발행 작업,
다른 기기/자원/버전/digest, 중복 결과 ID는 보고 전체를 거부한다. 본인 조회와 현재 IAM
ORG_ADMIN 조직 조회를 제공하며, 만료·unknown·과거 종료 관측·90초 stale을 분리한다.
별도 UID executor는 reap 뒤 cleanup 프레임을 전송한다. 프레임 없는 EOF/취소는 unknown이다.
이 프로토콜은 구현·단위 검증과 실제 별도 UID OS 시험을 통과했다. UID 4294967294에서 원장·기기 키·세션 읽기/쓰기 6개 거부와 회수 137ms를 관측했다. 운영 배포는 별도다.
