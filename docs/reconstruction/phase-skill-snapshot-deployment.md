# PR06: Skill 링크 집행·이관·복구 (2026-11-06)

구현·검증 완료. 활성화한 native 조합은 **Codex CLI 전역 Skill,
0.166.0-alpha.6, macOS arm64, 기록된 SHA-256 실행 파일** 하나다.
Antigravity 링크 읽기는 미관측이라 승격하지 않았다. 기존 copy 범위와 외부 관리
링크의 관측 전용 원칙을 유지한다. [실행 계약](../contracts/skill-snapshot-deployment-v1.md).

## 구현

- 공통 source v2의 snapshot-link를 실제 immutable store와 연결한다. Kit 원본만
  편집하면 설치본은 바뀌지 않으며, 검토한 갱신만 새 snapshot으로 연결한다.
- 한 물리 경로의 모든 소비자가 갱신에 참여해야 한다. 일부 소비자 해제는 링크를
  유지하고 마지막 해제만 링크를 제거한다. snapshot은 계속 보존한다.
- 일반 copy 디렉터리의 링크 전환은 별도 `skill-strategy` 이관 계획을 요구한다.
  파일별 기존 소유권·소비자·hash를 증명하고 추가 파일/빈 디렉터리/누락 파일은 차단한다.
  link→copy 및 rollback은 파일·디렉터리 권한과 소유권 지도를 복원한다.
- 원자적 exclusive rename/exchange adapter를 분리했다. Python 3 격리 bridge로
  OS primitive를 호출하며, 기존 디렉터리는 private backup stage에 그대로 보존한다.
  도구/파일시스템 미지원은 차단하고 copy/delete 대체를 하지 않는다.
- snapshot·일반 파일이 섞인 계획도 한 tree transaction으로 처리한다. Manifest·정의·
  원본·실행 파일·state·대상 변화를 재검증하며 journal v3, saved body v2, backup image,
  transaction artifact index와 state v6를 CLI/HTTP/GUI 공통 서비스에 연결했다.
- 일반 실패 rollback은 원래 inode를 보존한다. 명시적 rollback은 검증한 backup image로
  내용·권한·소유권을 복원한다. snapshot 변조·외부 편집·소유권 교체는 차단한다.
- 배포와 rollback뿐 아니라 recovery 자체가 SIGKILL된 경우도 남은 journal로 다시
  검토한다. snapshot·실패 stage·원래 tree·이력·abandoned recovery guard는 삭제하지 않는다.
- copy runtime 증거와 link 전략 증거를 분리했다. 기존 copy 증거로 link 실행을
  열 수 없으며 source v2·CLI/HTTP payload만 바꿔 gate를 우회할 수 없다.

## 기록된 실패와 TDD

- 다른 작업이 교체한 lock을 종료 정리가 지우는 실패를 먼저 재현했다. 파일 identity와
  owner token이 모두 일치할 때만 자기 lock을 해제하도록 고쳤다.
- CLI migrate가 batch `--targets`를 전달하지 못하는 실패를 재현했다. 각 client의
  정확한 version을 공통 migration service에 함께 전달하도록 고쳤다.
- 공개 connection 미리보기 객체 변경이 내부 준비 계획에도 영향을 주는 실패를
  재현했다. 공개 DTO에 복사본을 전달해 내부 소유권·snapshot 계획을 분리했다.
- [첫 native 기록](native-global-snapshot-skills-attempt1-20261106.json)의 Codex 실패는
  app-server가 받지 않는 옵션 때문이었다. 잘못된 옵션을 거절하는 가짜 client로
  발견→세 revision 읽기→복원 전체를 회귀 검증한 후 Codex 실기만 다시 수행했다.
- Antigravity 첫 실기는 배포/복원을 통과했지만 permission notice와 빈 public 결과만
  남겼다. 읽기 권한이 원인일 가능성은 있으나 특정 경로의 거절을 직접 관측한 것은
  아니다. 모델 응답·native 읽기가 미관측인 상태를 성공으로 바꾸지 않았고 재시도나
  권한 설정 변경으로 통과시키지 않았다.

## 검증

- `npm test`: **423 passed**, skipped 0.
- `npm --prefix gui run test:server`: **30 passed**, skipped 0.
- `npm --prefix gui test`: **54 passed**.
- GUI typecheck, desktop frontend/backend build, `git diff --check` 통과.
- 일반/저장 계획 적용·재시작 재개·명시적 copy↔link 이관·consumer 등록/해제·mixed
  instruction merge·rollback·metadata 경로 이탈·backup 충돌·stale Manifest/source/정의·
  retained snapshot 변조·helper 부재를 확인했다.
- 실제 자식 프로세스를 SIGKILL해 publication stage/완료, stage 준비, exchange,
  state commit 전후, rollback 도중과 recovery 도중을 시험했다. 외부 편집이 있으면
  원래 tree와 외부 내용을 함께 남기며 무변경/차단하는 경우도 확인했다.
- native 승격 검사에서 16개 기존/신규 runtime slice의 해당 증거를 읽고 각 scope·
  surface·version·binary·resource/strategy 일치를 검사한다. 합성 fixture의 통과는
  native 지원으로 세지 않는다.

## 필요한 실제 검증

[Codex native 기록](native-global-codex-snapshot-skills-20261106.json)은 세 번의 모델
호출로 적용본·갱신본·rollback 원본을 읽었다. 각 단계에서 배포·native 인식·모델 응답·
실행 무결성이 각각 passed다. `skills/list`로 baseline/적용/원본만 편집/갱신/복원/제거를
독립 확인했다. 설치 링크 또는 기록된 snapshot 경로에서 성공적으로 marker를 읽어야
통과하며, 편집 가능한 Kit source를 직접 읽는 것은 증거가 아니다.

처음 배포한 snapshot은 원본 편집 뒤에도 그대로였고, 실제 갱신은 다른 snapshot을
사용했다. 이전 snapshot은 갱신·제거 뒤에도 남았다. 검증용 설치는 공통 rollback
서비스로 해제했다. 검증기가 production 정의를 자동 변경하지 않으며, 기록을 검토한
뒤 Codex 전역 CLI의 전략별 evidence만 수동으로 추가했다.

[보존 체크포인트](skill-snapshot-deployment-preservation-20261106.json)에서 기존
27개 경로의 내용·권한·identity·mtime과 ego-browser 링크 3개가 PR06 실기 전후 동일하다.
실제 활성 관리 자원은 기존 3개 물리 파일/4개 owner이고 hash가 모두 일치하며, 임시
snapshot 연결·lock·pending journal은 없다. 전역 원장은 v6으로 올라갔으며 119개 이력과
snapshot/backup/stage를 보존했다. PR05 baseline과 비교하면 이 턴 실기 전부터 있던
config.toml의 mtime 차이 한 건이 있으나 내용·권한·identity는 같고 PR06 동안에는 불변이다.

PR07의 같은 저장소 typed 자원 합산·기본 전역/프로젝트 행렬, PR08 경로 이관,
PR09 통합 조회, PR10 교차 scope 의존성과 PR11의 독립 전략/전송/surface 검증은
이 완료 범위에 포함하지 않는다.
