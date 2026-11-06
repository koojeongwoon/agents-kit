# Scoped deployment compilation v1 — read-only review

2026-11-06. PR10의 origin별 v3 배포 선택·클라이언트 변환·파일 변경 미리보기다. 실행을
허용하는 계약은 아니다. [scoped 영수증 v4](scoped-installation-receipts-v4.md)의 descriptor와
기존 owned 파일 metadata 등록과 [공통/typed 새·변경 설치 예측](deployment-installation-prediction-v1.md)을
연결했다. compiler 자체는 `automatic: false`, `fulfilled: false`를 유지한다.
공개 실행 여부는 [별도 집행 서비스](scoped-deployment-execution-v1.md)가 native proof·
변경 보호·coordinator를 연결해 판정한다. compiler 결과만으로 실행 권한을 만들지 않는다.

## 입력과 도메인 선택

application은 선택한 Kit의 `global`과 `projects/<projectName>`만 읽는다. catalog와 같은
scope reader·physical origin key를 사용하고 client discovery/초기화를 실행하지 않는다.
프로젝트 target의 filesystem authorization과 self-target 방지, source의 Kit 범위를 확인한다.
공개 요청은 표준 Kit 배치와 한 client/surface를 요구한다. 다중 대상 조합은 후속 gate다.

`selectScopedManifestDeployment`는 client target의 enablement/asset allowlist·projectName을
검사한다. 상속된 object property를 target으로 취급하지 않는다. v3 scoped resolver로
missing/kind/scope/cycle/provider/정책을 확인하고 local closure와 global prerequisite를
구분한다. 각 범위 최대 256개로 등록 모델의 한도와 맞춘 뒤 consumer별 전이 집합을 계산한다.

로컬 기록의 `dependencyIds`에는 같은 origin의 로컬 ID만 쓴다. 전역 의존성은 origin을
포함하는 key로 별도 유지한다. 전역과 프로젝트에 `review`가 각각 있어도 하나의 방문 집합·
파일 경로·소유 기록으로 합치지 않는다. 전역 자원을 로컬 사본이나 가짜 ID로 변환하지 않는다.

`planScopedClientDeployment`는 원래 asset을 그대로 common capability planner/adapter에
전달한다. 별도 private planning core만 재사용하며 일반 v1/v2 entry의 v3 차단은 유지한다.
`uses.skills`, Agent Tool 제한/모델/sandbox 등 미지원 필드를 지워서 통과시키지 않는다.
선택 client/surface/version·실제 binary SHA gate도 기존 verified planner와 같다.

## 설치 전제와 원본의 구분

전역 source 존재를 설치로 간주하지 않는다. 같은 Kit/sourceRoot·asset/kind·client/surface/
configStore·현재 definition의 schema 3/4 설치 영수증과 소유/전이 revision을 대조한다.
설치 당시 논리 선언·Tool 별칭/binding이 source의 요구와 일치해야 pin을 만든다. native
영수증의 원래 server ID/locator를 유지한다. 미설치·다른 profile·모호한 소유·drift·과거
영수증/선언 부족은 미확인으로 남긴다.

source 본문만 편집된 경우 실제 설치 revision을 바꾸거나 프로젝트로 복사하지 않는다.
Tool 선언/alias·의존성/정책의 논리 변경은 새 계획에서 별도 검토를 요구한다. v4는 v3 scoped
선언 전체를 비교하고 과거 v3의 단순 설치 자원 closure는 origin/header·실제 전이 일관성으로
대조한다. 증명할 수 없는 비설치 metadata는 명시적 v4 audit가 필요하며 과거 기록을 자동으로 채우지 않는다.

consumer마다 global closure의 실제 prerequisite ID를 묶고 필요한 논리 Tool을 별도로
수집한다. private native verifier가 없거나 실패하면 native 전제는 미확인이다. 계획을
만드는 것만으로 native/MCP/모델/Tool을 실행하지 않는다. 전역 전제가 없으면 native
상태는 `not-required`이며 native 관측 성공을 주장하지 않는다.

## 준비한 변경과 공개 응답

기존 copy/merge/link·공통 자원·snapshot·physical composition planner를 사용한다. 미관리
파일/native 소유·중복 target·경로 변경·외부 링크 충돌을 유지하고 기존 사용자 block/selector/
내용과 mode를 보존한 변경을 계산한다. 원래 위치가 외부 링크면 쓰기 권한을 인수하지 않는다.

예정 target의 before/after image fingerprint, 소스·정의·선언·원장/runtime/native 문맥의
digest를 검토 자료에 포함한다. 공개 응답은 안전한 자원 ID·상태·target·operation·hash·
mode와 차단 이유다. Agent/Skill/지침 본문·MCP 실행 인자/접속 값은 노출하지 않는다.
공개 응답을 바꿔도 private pin·target·prepared operation은 바뀌지 않는다.

공통 deployment service의 `plan`이 v3를 이 compiler로 보낸다. 기본 loader/직접 planner·
native 원형/이관의 gate를 풀지 않는다. 일반 source 선언 편집은
[원본 관리 계약](scoped-manifest-management-v1.md)으로 분리한다. compiler의 `kind: scoped-preview`를
그대로 실행하지 않으며, 공개 서비스는 별도 `scoped-apply`/execution 상태와 private 준비물을
사용한다. CLI/HTTP/GUI는 전역 소유 파일과 native 발견을 구분하고 ready인 계획만 적용한다.
native 관측·저장 v5·재개/제거·검토 복구는 [실행 계약](scoped-deployment-execution-v1.md)을 따른다.

## 검증과 남은 집행 gate

[PR10 기록](../reconstruction/phase-scoped-dependencies.md)에 pure graph/capability와 실제
임시 파일·원장/설정·외부 링크·CLI/HTTP/GUI 검증을 남긴다. 기존 사용자 Kit에서는 catalog와
설치 대조만 읽으며 원장 승격·새 등록·client 파일 작업을 하지 않는다.

공통/typed 파일과 snapshot의 새·변경 revision 예측은 내부 적용 결과와 대조한다.
[프로젝트 의존성 rollback/참조 해제](scoped-deployment-rollback-v1.md)도 설치 예측과 같은
집행 경계를 사용한다. native 원형/과거 경로 이관의 예측, 전역 설정 변경 후 각 등록
프로젝트 문맥의 재관측과 미지원 native 원본의 source/설치 수명주기는 남아 있다.
공개 실행의 검증 범위와 compiler 단독 읽기 결과를 구분하며 미검증 client/전략을 승격하지 않는다.
