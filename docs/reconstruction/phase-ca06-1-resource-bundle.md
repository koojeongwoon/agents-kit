# CA06-1 — 불변 묶음과 Kit 측 고정 실행 helper

작성: 2026-09-27, 최종 검증: 2026-09-28. **Kit 측 구현·로컬 검증 완료. Gateway 서명 발급과 실제
tools-daemon 작업 수신 연결은 미구현이며 중앙 배포 완료가 아니다.**

## 결과

- CLI `bundle`로 typed 지침·Skill·Agent·MCP와 UTF-8 부속 파일을 고정한다.
  원본 경로는 묶음 내부 상대 경로로 바뀌고 전체 바이트/파일별 SHA-256을 검증한다.
  작성자가 원본을 수정·삭제해도 준비된 실행은 해당 스냅샷을 사용한다.
- `resource-bundle-helper.js`는 같은 사용자 프로세스의 단일 JSON
  `prepare/apply` 인터페이스다. 임의 대상 경로·명령·URL·클라이언트 정의를
  요청에서 받지 않는다. root 실행을 거부하고 로컬 UID·0600 설정·0700 저장소를
  검사한다. MCP 실행 정의는 로컬 허용 digest와 일치해야 한다.
- prepare가 기존 공통 배포 서비스를 호출해 계획과 최대 5분의 검토 receipt를
  만든다. 차단된 계획에는 실행 receipt가 없다. apply는 bundle/receipt digest,
  로컬 binding, 스냅샷, 대상 파일, 원장, 정의, 현재 CLI 실행 파일을 재검사한다.
- 별도 배포 엔진을 만들지 않고 기존 저장 계획·백업·공유 소유권·트랜잭션·복구를
  재사용한다. 중복 요청은 기존 트랜잭션 결과를 반환한다. 적용 결과는
  `files-applied`, 클라이언트 인식은 `unverified`다.

계약·제한·실행 예시는 [resource-bundle-v1](../contracts/resource-bundle-v1.md)을
따른다. 실제 전송 가능한 불변 묶음과 로컬 경로를 담은 저장 계획을 구분한다.

## 검증

`test/resource-bundle.test.js`는 정식 `npm test`에 포함된다.

- 결정적인 canonical bytes, 한국어 부속 파일, 공개 digest fixture.
- 원본 변경·삭제 후 스냅샷 적용, project/global 두 CLI 선택, 네 종류 자원 출력.
- 경로 탈출·symlink·크기 초과·case alias·누락/추가 파일·본문 변조·인코딩·
  자격증명 패턴·의존성 누락·native 자원 거부.
- 대상 파일/원장/정의/실행 파일/로컬 binding/digest가 바뀌면 거부.
- 임의 실행 요청·URL·preview·desktop·미허용 MCP·사설 저장소 경로 우회 거부.
- prepare/apply를 다른 실제 Node 프로세스에서 실행. 중복 적용 시 원장
  트랜잭션 한 개. 사용자 본문 보존, 원본 없이 apply 가능.
- 실제 SIGKILL: 파일 쓰기 도중 종료는 기존 journal 복구 검토가 필요하며
  복구 후 같은 승인으로 재실행하지 않는다. commit 후 receipt 기록 전 종료는
  저장된 트랜잭션을 대조해 중복 없이 결과를 복구한다.
- 현재 설치된 Codex 0.145.0 / Antigravity 1.2.12의 검토된 native binary hash를
  실제 관측해, 실제 helper 프로세스에서 두 CLI 프로젝트 자원과 전역 Skill을
  임시 홈/프로젝트에 적용했다. Codex는 지침/Skill/stdio MCP/기본 Agent,
  Antigravity는 지침/Skill/stdio MCP다. 모델 호출이나 앱 인식 시험은 아니다.

검증 중 crash 복구 테스트가 원래 Kit 저장소를 찾는 문제를 확인했다.
helper의 inner plan을 `<workRoot>/.deployment-plans`로 통일해 기존 복구 서비스와
CLI가 같은 저장소를 지정할 수 있게 했다. 최종 테스트 수와 실행 결과는
[증거 JSON](ca06-1-resource-bundle-evidence.json)에 기록한다.

## 다음 게이트

CA06-2는 Gateway 승인과 별도 서명 배포 작업, 데몬의 대상·정책·만료·재생 검사,
보호 서비스에서 올바른 사용자 helper를 실행하는 연결이다. 아직 이 helper를
원격 queue나 IPC에 노출하지 않았다. 기존 revoke 전용 v1 job 및 종료 확인 결과를
배포 계약으로 확대 해석하지 않는다. 조직 권한/서명은 receipt digest로 대체할
수 없다. 중앙 배포의 클라이언트 인식, 두 단말 부분 실패, 운영 설치는 후속 증거다.
