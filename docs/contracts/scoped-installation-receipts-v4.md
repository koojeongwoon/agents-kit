# Scoped installation receipts v4

2026-11-06. PR10의 scoped 설치 선언·snapshot 및 기존 소유 파일의 metadata 등록 계약이다.
기존 receipt v1/v2/v3를 그대로 읽는다. 공통/typed 설치 예측은 별도 계약으로 연결했다.
native 원형/이관 예측·공개 coordinator 집행·모든 mutation 영향 보호는 미완료이며
이 영수증만으로 실행 권한을 만들지 않으며 v3 공개 적용/저장은
[실행 서비스](scoped-deployment-execution-v1.md)의 관측·등록/복구 경계를 따른다.

## 버전과 식별

receipt v4는 declaration v3와 dependency snapshot v2를 사용한다. Deployment State의
schema 번호와 별개다. source/target 파일 본문·MCP 접속/실행 값·credential은 영수증에
넣지 않는다. 소유 file/unit/link proof와 mode·native owner baseline은 기존 계약을 유지한다.

declaration의 `origins`에는 kitId·canonical sourceRoot/targetRoot·global/projectName을
기록한다. 이 값의 hash가 `origin-<sha256>` ID다. `subject`, reference/binding의 target과
dependency는 originId·assetId·assetKind로 관계를 표현한다. 관계 안에 파일 경로나 Markdown
문자열을 넣지 않는다. 같은 `review`라도 전역/프로젝트 또는 다른 checkout이면 다르다.
Kit 별칭은 application의 canonicalization을 거쳐 같은 physical origin을 만든다.

현재 허용 방향은 같은 origin 또는 project→같은 catalog의 global이다. 다른 프로젝트,
global→project, 중복/불명확한 origin, 주체와 locator의 불일치를 거절한다. 선언당 최대 두
origin과 511개 전이 dependency를 허용하며 중복·누락된 mandatory Tool binding과 유효하지
않은 ID/alias를 검사한다. 숫자를 Tool ID/alias로 강제 변환하지 않는다.

## 선언과 snapshot

원래 Manifest의 scoped graph를 검증한 뒤 reference·요구/제공 논리 Tool·명시적 native 이름·
deny와 binding을 기록한다. 원래 asset/renderer/capability gate를 바꾸지 않는다.
`scopedDeclarationDigest`는 origin ID로 해석된 logical header를 고정한다. 전이 목록에는
각 target과 그 header digest를 기록하고 receipt revision은 이 전체 선언·snapshot·소유
proof를 포함한다. managed transaction anchor만 semantic revision 계산에서 제외한다.

snapshot v2는 실제 설치 가능한 전이 자원마다 target·declaration digest와 현재의
revision/locator/binding digest를 pin한다. source의 존재나 본문으로 설치를 추정하지 않는다.
같은 profile/definition과 정확한 origin·소유가 맞아야 한다. 미설치/모호함·과거 증거 부족은
`unverified`로 기록하며 나중에 provider가 생겨도 이 기록을 자동으로 pin으로 바꾸지 않는다.

검사는 현재 provider revision·소유·선언뿐 아니라 자식의 전체 전이 closure도 대조한다.
부모 목록에서 전이 provider를 빼거나 이름이 같은 로컬 자원으로 대체할 수 없다. Tool
binding 결과에는 원래 native server ID와 native Tool 이름 및 consumer/provider origin ID를
함께 반환한다. `revision-observed`/`recorded`는 consistency이며 native 발견·Tool 사용·
모델 응답과 다르다. `fulfilled: false`를 유지한다.

## 과거 영수증과 원래 native ID

v3 receipt의 같은 Manifest 선언은 기대한 origin과 locator의 실제 path template가 맞을 때만
scoped header로 읽기 투영한다. 원본 기록은 변경하지 않는다. 프로젝트의 같은 source를
사용하는 다른 checkout이나 projectName으로 pin을 빌리지 않는다. nativeId가 Kit asset ID와
달라도 locator의 원래 nativeId·경로·owned baseline을 유지한다.

v1/v2 Manifest와 v3 receipt의 기존 strict 비교를 유지한다. v3 Manifest와 과거 v3 receipt의
단순 설치 자원 closure도 origin/header·실제 전이 설치 일관성이 맞을 때 비교할 수 있다.
과거 digest로 증명할 수 없는 비설치 policy/harness metadata는 명시적 v4 audit가 필요하며
미확인 상태를 추정해 풀지 않는다. v4와 v3 Manifest는 전체 scoped 선언을 직접 대조한다.

포맷 전환으로 revision이 달라지므로 사용 중인 pin을 자동으로 재작성하지 않는다. 기존
source/runtime/config/link를 바꾸거나 사용자 원장을 자동 승격하는 migration은 없다.

## application과 coordinator

scoped compiler의 private plans에 v4 설치 descriptor를 붙인다. 공통 journaled apply,
snapshot/경로 engine은 기록 직전에 같은 projection/snapshot 서비스를 사용한다. 다른 MCP
owner의 변경으로 transaction anchor만 바뀌면 기존 v4 snapshot과 semantic revision을
유지한 영수증을 carry한다. 실제 파일/unit·mode가 다르면 carry하지 않는다.

외부 origin이 있는 descriptor는 global→project 잠금을 가진 private store-instance 세션을
요구한다. JSON의 허용 flag나 preview 차단 제거로 이 세션을 만들 수 없다. 선택 project
store와 global home 문맥이 맞지 않으면 client 파일 변경 전에 거절한다. global 관측 자료는
실제 세션의 global ledger에서 가져오고 직렬화한 계획에서 권한으로 받아들이지 않는다.

새/upsert v4 consumer commit에서는 소유와 dependency revision·binding을 모두 재확인한다.
불완전한 closure면 project commit을 거절하고 검토 복구로 reserved metadata를 되돌린다.
순수 consumer 제거는 변경된 upstream 때문에 막지 않는다. v4 project commit 뒤 중단되면
영수증/파일과 pin을 다시 검사해 index를 완료하며 native 실행 성공으로 표시하지 않는다.

## 증거와 남은 gate

[실제 Codex 격리 검증](../reconstruction/codex-scoped-receipt-native-roundtrip-20261106.json)은
client bytes/mode를 바꾸지 않은 v4 metadata audit 뒤 Skill·선택 MCP Tool 목록과 private
verifier·설정 변경 무효화·원래 설정/외부 링크 복원을 확인한다. metadata-only 관측은 어떤
provider도 시작하지 않았고 선택하지 않은 서버·모델/thread/Tool 실행 요청은 0이다.
`scripts/client-verification/native-prerequisite-fixture.mjs --binary /absolute/codex --scoped-receipts`
로 재현하며 실제 사용자 HOME/원장에는 쓰지 않는다.

격리 application 시험은 기존 owned 파일의 metadata-only v4 등록과 reverse index commit,
완전성 거절/복구 및 commit 후 중단 복구를 검증한다. 새/변경 consumer의 모든 file/tree
after image와 ownership state의 [공통/typed 예측](deployment-installation-prediction-v1.md)을 추가했다.
이후 [공개 실행/저장/복구](scoped-deployment-execution-v1.md),
[의존성 rollback](scoped-deployment-rollback-v1.md),
[일반 v3 원본 관리](scoped-manifest-management-v1.md)와 source 보호를 연결했다.
native 원형/과거 경로 writer의 영향 예측, 전역 설정 변경 후 각 프로젝트의 전체 native
문맥 전환과 별도 consumer 활성 증거는 남아 있다.
