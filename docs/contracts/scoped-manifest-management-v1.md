# Scoped Manifest management v1

2026-11-06. Manifest v3의 source 검증·진단과 일반 자원 선언의 create/update/delete를
공통 application service에 연결한다. source가 유효하다는 사실과 설치·native 발견·
consumer 활성은 구분한다. 이 기능은 클라이언트 설정이나 설치 영수증을 변경하지 않는다.

## 원본 검증과 조회

source-only 문맥은 canonical `kit/global`·`kit/projects/<name>`을 읽는다. 선택 checkout이
없어도 프로젝트 원본을 검사하며 없는 client targetRoot를 만들어 넣지 않는다. 배포 문맥의
영수증/관측과 식별자를 섞지 않는다. 전역·프로젝트의 동명 자원은 origin과 stable ID로
분리하고 bare ID를 전역 자원의 fallback으로 사용하지 않는다.

`validate({scopeRoot})`는 v3의 qualified 참조·논리 Tool provider·정책·scope·cycle을
기존 pure resolver로 검사하고 참조 closure의 source 경로/형식/경계를 확인한다.
외부 원본으로 탈출하는 링크와 누락·미확인 문맥은 진단에 남긴다. 결과는 readOnly이며
`deploymentReady: false`, `fulfilled: false`다. 본문/credential 값은 진단에 포함하지 않는다.

일반 registry/resource 조회는 v3를 명시적으로 읽으며 기존 단일 scope 반환을 유지한다.
registry view는 manifestSchemaVersion도 반환하므로 빈 v3 원본도 편집 형식을 알 수 있다.
의존성 projection은 기존 nodes/links 형태와 local ID를 유지하고 external node는 origin별
key를 사용한다. GUI는 전역/프로젝트·Kit 이름을 표시하며 동명 자원을 합치지 않는다.
공개 조회나 planId를 복사해 배포 실행 권한을 만들 수 없다.

## 읽기 전용 doctor

doctor는 `.agent-kit`나 쓰기 시험 파일을 만들지 않는다. 기존 reader와 권한 조회를 사용한다.
v3 client를 선택하면 동일한 공개 deployment planner로 실제 source·설치 pin·capability·
runtime/정의·ownership/target gate를 검사하고 임시 계획을 폐기한다. native inventory,
MCP 시작·Tool 목록·모델 요청을 자동으로 실행하지 않는다.

native 전제가 미확인이면 별도 warning과 상태를 반환한다. 선언이 정상인 healthy 결과도
적용 승인·native 성공이 아니다. client 미선택 경고와 차단된 실제 계획을 구별하며
deploymentReady/fulfilled는 false로 유지한다. 권한은 실행 환경 기준이므로 sandbox의
write 제한과 실제 OS 권한 조회 결과는 별도 증거로 기록한다.

## 일반 선언 편집과 참조 보호

하나의 원본에 대한 mutation batch의 최종 상태를 검증한다. update는 전체 자원 정의를
보존하며 qualified 참조를 문자열로 평탄화하지 않는다. create는 기존 client 대상 선택을
자동으로 늘리지 않는다. delete는 최종 원본에서 사라진 ID만 targets.assetIds에서 해제한다.
같은 stable ID의 delete/create 교체는 기존 대상 선택을 보존한다.

v3 원본은 선택한 source graph를 검증한다. 전역 원본 변경은 구버전 Manifest여도 알려진
v3 프로젝트 선언에 새 오류를 만들 수 없다. 현재 Kit의 project source를 제한된 범위로
읽고, 미확인 문맥을 참조 해제로 간주하지 않는다. global source identity 제거는 기존
설치 역참조 보호를 우선 유지한다. 공통 source guard에도 선언 보호를 연결하여 import
detach 같은 다른 writer가 미설치 프로젝트 참조를 지우는 우회를 막는다.

편집 계획은 peer source의 내용 hash·권한·inode·문맥 집합을 고정한다. 적용 때 peer lock을
fail-fast로 확보하고 기존 선택 source transaction 안에서 전·후 재검사한다. 검토 후
peer가 바뀌면 STALE_EDIT_CONTEXT로 중단한다. source 계획/반환 mutation의 alias는 private
command를 변경할 수 없으며 source planId는 deployment planId로 사용할 수 없다.

source lock은 PID/token·파일 identity에 묶는다. 바뀐 owner lock을 삭제하지 않으며 자기
권한을 잃은 경우 journal을 보존한다. peer 권한 변경이 manifest write 중 확인되면 선택
source는 기존 안전한 transaction 복원을 따르고 peer의 변경은 유지한다. 수동 수정으로
복원이 증명되지 않으면 자동으로 덮어쓰지 않고 reviewed recovery를 요구한다.

## CLI·HTTP·GUI와 호환성

- CLI validate/doctor는 같은 v3 source 서비스를 사용한다. `manifest-edit --mutations
  <json-file> [--dry-run]`은 같은 planEdit/applyEdit를 호출한다. source mutation은 deployment
  saved plan으로 저장하지 않으며 --save-plan을 명시적으로 거절한다.
- HTTP의 기존 validate/doctor·registry/resource/dependencies·edit plan/apply와 mutation
  session을 유지한다. 새 credential/native 실행 입력을 추가하지 않는다.
- GUI는 v3의 전체 JSON 정의와 named scope를 보존하여 생성/편집한다. 원본 저장과 client
  설치 검토를 구분한다. 일반 v3 원본은 편집/배포 검토를 제공한다. 편입된 native source는
  같은 원본 서비스에서 편입/편집/갱신/복원/해제를 지원하되, v3 native 설치 경로와 해당
  GUI 설치 작업은 계속 차단한다.

기존 Manifest v1/v2의 loader·CLI/API 형태와 저수준 v3 기본 차단은 유지한다. 일반 v3
원본 사본 관리 성공을 native 설치 수명주기 전체의 지원으로 합산하지 않는다. native
원형/과거 경로 writer의 배포 영향 예측·조정은 별도이며 현재 핵심 흐름 수리 범위에서 제외한다.

## 증거와 남은 범위

[진행 기록](../reconstruction/phase-scoped-dependencies.md)과
[체크포인트](../reconstruction/scoped-management-checkpoint-20261106.json)에 TDD·CLI/HTTP/GUI,
원래 Kit의 읽기 전용 진단과 설정/원장/외부 링크 보존을 기록한다. source-only 단계이므로
실제 native client·Tool·모델을 재호출하지 않았고 client 지원 행렬을 늘리지 않았다.

native 원형/과거 경로 이관의 영향 예측·조정, 전역 설정 변경 후 모든 등록 프로젝트의
native 전환, PR07/09/11·C07 Skill 대상/호환성·variant와 별도 consumer 활성 증거는 남아 있다.
