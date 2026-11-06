# Deployment installation prediction v1

2026-11-06. PR10의 새/변경 client 파일·소유 기록·scoped 영수증 revision 예측이다.
[v3 readonly compiler](scoped-deployment-compilation-v1.md)에 연결한다. 예측 자체는 실행 권한이
아니며 [공개 v3 서비스](scoped-deployment-execution-v1.md)가 관측/잠금/등록과 결합한다.
기존 v1/v2 [선택적 전역 변경·rollback](global-dependency-mutation-v1.md)도 같은 예측을 사용한다.
실제 client 발견·Tool 사용·모델 응답이나 C07의 client별 Skill 의미 호환성을 증명하지 않는다.

## 계산과 소유권

- 기존 준비된 copy/merge/physical resource/shared snapshot 작업의 내용과 before image를
  읽는다. scalar after image와 관리 기록 계산은 실제 파일/트리 적용 엔진과 공유한다.
  예측 과정에서 파일·snapshot·원장·잠금·journal을 만들지 않는다.
- bounded/no-follow 가상 읽기 계층이 변경 target을 after image로 대체한다. Skill 사본은
  기존 tree와 예정 파일을 합성하되 미관리 잔여 파일을 숨기지 않는다. 중첩 target·내부 링크·
  특수 파일·한도 초과는 거절한다. 기존 권한과 새 디렉터리/파일의 실제 생성 권한을 계산하고
  경로 정렬은 실제 filesystem image reader와 동일하게 유지한다.
- 준비된 immutable snapshot은 아직 게시되지 않았어도 그 descriptor/tree로 예측한다.
  실행 엔진은 여전히 원본을 재검사하고 실제 게시 결과·연결·snapshot을 확인해야 한다.
  예측된 존재를 현재 실제 설치 소유권이나 native 발견 증거로 돌려주지 않는다.
- 임시 transaction anchor를 가진 새 소유 기록과 locator 증거를 메모리에서 합성한다.
  실제 영수증 생성기를 같은 읽기 port에 연결하여 local provider부터 consumer 순서로
  [v4 선언/snapshot](scoped-installation-receipts-v4.md)을 계산한다. semantic revision은
  transaction ID를 제외하므로 실제 적용 ID와 달라도 revision이 일치해야 한다.
- 전역 전제는 현재 전역 원장의 실제 영수증/소유 관측에서만 가져온다. local/global
  동명 자원을 구별하고, 없거나 미확인인 installable dependency를 pinned로 승격하지 않는다.
  client 원형 전용 설치와 과거 경로 이관의 새 예측은 지원하지 않으며 별도 gate로 남긴다.

## 실행 전/후 대조

예측 결과는 receipts·consumer reference·target fingerprint와 digest를 반환한다.
compiler의 공개 응답에는 본문/접속 값 없이 asset/kind·revision/locator digest만 추가한다.
공개 clone과 반환한 예측 객체는 실행 권한이 아니다. private plan-array identity에만
검토한 작업·descriptor digest, 생성 권한, 예상 영수증과 target fingerprint를 보관한다.
JSON 복사로 이 seal이나 두 원장 coordinator session을 만들 수 없다.

실행 전 private 계획이나 생성 권한이 달라지면 잠금/파일 쓰기 전에
`STALE_INSTALLATION_PREDICTION`으로 거절한다. 파일/트리 엔진은 실제 쓰기 후 같은
영수증 생성기로 계산하고 state commit 전에 예상 revision·전체 after image와 대조한다.
불일치는 `INSTALLATION_PREDICTION_MISMATCH`로 거절하며 기존 트랜잭션 복원을 따른다.
동시 수동 변경 때문에 안전하게 복원할 수 없으면 기존 reviewed recovery 경계를 유지한다.
예측 seal이 없는 기존 v1/v2 적용은 기존 흐름을 유지한다.

전역 및 [프로젝트 의존성 rollback](scoped-deployment-rollback-v1.md)은 별도 private rollback-plan identity에 seal을 보관한다. 공통 rollback 명령의
백업 after image·정확한 이전 managed map과 원래 apply의 rolled-back 상태를 계산한다.
기존 영수증 선택 규칙으로 다시 드러나는 설치 revision을 관측하며, 실제 rollback의 전체
managed map·원래 transaction 상태와 관계·client after image를 commit 전에 대조한다.

## 검증과 남은 gate

`test/scoped-deployment-compiler.test.js`는 새 Skill/Agent, local/global 전이 의존성,
MCP·지침·Skill 갱신, 사용자 설정/권한, unpublished snapshot과 혼합 파일 적용,
umask 077, 대소문자 디렉터리 순서, 계획 변경/미관리 파일/증거 누락과 복원을 검증한다.
내부 coordinator 시험의 native port는 합성 fixture이며 제품 지원 근거가 아니다.

native 원형/이관의 global mutation 예측, 전역 설정의 native 문맥 전환 및 필요한 실제
교차 scope consumer 적용·복원은 후속이다. 이 계약으로 현재 client 지원 조합을 늘리지 않는다.
