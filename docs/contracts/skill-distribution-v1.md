# Skill 대상·호환성·variant 계약 v1

2026-11-06, C07/T27/AK-SR38. **공통 variant와 검증된 Codex native UI metadata profile의
shared 배포·선택 영수증·적용/복원을 구현했다. 다른 native 형식과 exclusive 배포는 차단한다.**
Manifest v1/v2/v3의 Skill `definition.schemaVersion: 3`이 이 계약을 사용한다.
Manifest 자체의 schemaVersion과 별개이며 기존 Skill definition v1/v2를 자동 변경하지 않는다.

## 선언과 선택

definition은 기존 `format: agent-skills`, source v2와 같은 `deployment`와
`distribution: {schemaVersion: 1, exposure, selection, variants}`를 갖는다.
variant별 관리 source는 [원본 수명주기 계약](skill-variant-sources-v1.md)의 distribution 2를 사용한다.
문자열 경로의 기존 의미는 유지하며 managed source만 명시적으로 Kit 기준으로 해석한다.

- `exposure`는 `shared` 또는 `exclusive-client`다. shared는 추가 독자에게 노출될 수 있음을
  명시적으로 허용한다. 현재 모든 exclusive-client 배포는 격리 미확인으로 차단한다.
- `selection`은 `{clientId, surface, variantId}` 배열이다. client/surface별 선택은 하나다.
- `variants`는 `{id, source, format, compatibility}` 배열이다. source는 asset.source 안의
  상대 디렉터리다. 빈 문자열은 전체 bundle 하나를 의미하며 다른 variant와 공존할 수 없다.
  최대 8개, 중첩·대소문자/Unicode 별칭·예약 관리 디렉터리·범위 밖 경로를 거절한다.
- format은 `common` 또는 `native`다. native는 기본적으로 원형 보존만 제공하며, 명시적인
  `native: {schemaVersion: 1, clientId, profile}`과 [검증된 format profile](native-skill-interface-v1.md)이
  일치할 때만 배포한다. common은 기존 name/description frontmatter와 본문 검사를 적용한다.
- implicit root 선택은 client/surface 선택을 따른다. 명시적인 target assetIds나 scoped 선택,
  의존성이 요구한 Skill은 제거하지 않는다. 해당 자원에 대한 차단 사유를 계속 보여 준다.

## 호환성 검토와 원본

compatibility 항목은 `{clientId, surface, versions, status, review?}`다. versions는 최대 16개의
정확한 SemVer 문자열이며 wildcard/범위와 비정규 숫자를 거절한다. status는
`compatible`, `incompatible`, `unknown`이다. `compatible`만 다음 review를 요구한다.

```json
{
  "schemaVersion": 1,
  "basis": "author-review",
  "treeDigest": "<Skill snapshot descriptor의 SHA-256>",
  "declarationDigest": "<논리 선언의 SHA-256>"
}
```

이는 작성자가 검토한 내용에 묶인 선언이다. native 발견이나 모델의 지시 준수를 증명하지 않는다.
treeDigest는 선택한 bundle의 경로·바이트 해시·크기·파일 권한을 포함한다. declarationDigest는
안정적인 asset ID·scope·dependsOn·requires·uses·policies를 canonical JSON으로 해시한다.
Tool 요구는 asset 수준에서 공통이며 variant가 Tool/provider 관계를 별도로 덮어쓰지 않는다.
형식·registry·capability 검사는 계속 별개다.

원본 검사는 bundle당 기존 8MiB/256파일 등의 bounded reader와 snapshot descriptor를 사용한다.
variant 경로의 symlink·특수 파일·빈 하위 디렉터리·인식 가능한 credential literal은 거절한다.
native의 `agents/openai.yaml` 같은 파일은 삭제하거나 변환하지 않고 바이트와 모드를 읽는다.
선택 결과를 source resolver에 넘기는 내부 호출은 현재 선언과의 일치 및 treeDigest를 재검사한다.
위조된 source·누락된 variant·원본 내용/모드 변화는 선택을 무효화한다.

## 배포·설치 선택 증거

pure selector의 `status: selected`는 작성자 검토와 선택이 유효하다는 뜻이다.
`nativeUseState: unverified`, `fulfilled: false`를 유지한다. 기존 client/surface/version/binary/
strategy 검증을 통과한 common/shared와 별도의 native format 증거가 일치한 profile만 배포한다.
unknown/명시적 비호환/미검증 native는 각각 별도의 진단으로 차단하고 exclusive는
`SKILL_EXCLUSIVE_ISOLATION_UNVERIFIED`로 차단한다.
일반 및 scoped apply는 같은 selector와 원본 검사·공유 배포 서비스를 사용한다.

source resolver는 선택한 하위 bundle만 넘긴다. copy는 bounded reader가 한 번 캡처한 바이트와
모드로 산출물을 만들고 snapshot은 실제 준비한 descriptor를 작성자 검토와 대조한다.
따라서 원본 검사 이후 재읽기 사이의 변경을 다른 내용의 양성 증거로 기록하지 않는다.
copy는 새 형식의 파일 모드를 반영하며 모드만 바뀐 갱신도 기존 소비자 동의와 rollback을 따른다.
같은 물리 target에 연결하는 bundle은 전체 파일 집합·내용·모드가 같아야 한다. 파일 목록이
서로 다를 때 합집합으로 배포하지 않는다. 서로 다른 target은 다른 variant를 유지할 수 있다.

기존 설치 영수증의 버전/의미를 바꾸지 않고 apply transaction에 `skillSelections`를 추가한다.
각 항목은 `{schemaVersion: 1|2, receiptDigest, definitionDigest, selection}`이다. receiptDigest는
같은 transaction의 실제 Skill 설치 영수증 전체에, definitionDigest는 v1에서 source definition 전체에,
v2에서 선택한 variant와 해당 대상의 정책에,
selection은 client/surface/version·variant·작성자 검토에 연결된다. 원장 reader는 형식·중복·
영수증 연결을 검사한다. requested 선택의 영수증을 만들지 못하면 적용을 실패시키고 복원한다.
native 선택은 selection 3으로 native 선언·보조 증거 digest·sourceBase와 managed revision을
포함한다. common 선택 1/2와 설치 receipt schema는 유지한다.

바이트가 같은 variant 전환도 별도 transaction에 선택을 기록한다. 롤백된 apply의 기록은
현재 선택으로 읽지 않으며 기존 정상 선택으로 돌아간다. 다른 writer가 같은 revision의
영수증을 보존할 때만 선택을 함께 보존한다. 대응되는 선택 기록 없는 새 영수증에서 과거
선택을 추정하지 않는다. 이 기록은 runtime 발견·모델 사용·의미 호환성을 자동 승격하지 않는다.

기존 설치 영수증은 source v3의 선택·호환성·노출을 증명하지 않는다. 프로젝트가 기존 전역
설치를 전제로 삼더라도 해당 영수증의 선택 기록과 현재 definition·client 버전별 작성자 검토가
일치해야 한다. 그렇지 않으면 `SKILL_DISTRIBUTION_INSTALLATION_UNVERIFIED`로 차단하고 실제
클라이언트 관측을 시작하지 않는다. 일치해도 기존 native prerequisite 관측 절차를 따로 거친다.
기존 설치 파일·원장·외부 링크와 definition v1/v2의 배포는 유지한다.

계획의 `skillDistributions`는 선택한 variant와 설치 위치, client definitions의 capability/
inventory/discovery 경로에서 알려진 추가 독자를 표시한다. `coverage: known-roots-only`,
`additionalDiscoveryState: unverified`, `isolationState: unverified`다. 사용자의 추가 설정이나
실제 로딩을 전부 관측했다는 뜻이 아니며 다른 client 설정을 비활성화하지 않는다.

CLI/HTTP와 GUI preview는 같은 계획을 읽는다. 저장 계획 본문/목록에도 이 검토가 남고
재개 시 원본과 선언을 다시 계획한다. 일반 배포는 선택한 source와 private 설치 metadata를
preflight/before-commit에 재검사하며 scoped 배포는 기존 context/source/prediction seal을 따른다.
원본/모드·Manifest·client definition·Tool binding 변화와 검증 중 metadata 교체를 그대로
승인한 계획으로 처리하지 않는다.

## 남은 작업

variant별 원본 편집/재가져오기/병합/revision은 [별도 계약](skill-variant-sources-v1.md)으로 연결했다.
Codex UI metadata 외의 native adapter와 명시적 variant 관리 해제/retirement는 추가 연결이 필요하다.
알려진 경로 외의 실제 discovery 설정과 exclusive 격리, 각 client/surface의 실제 발견·사용
증거도 별도 작업이다. Codex 현재 실행 파일의 전역 common copy/snapshot 왕복은 격리 native
metadata probe로 확인하며 모델 사용까지 확인한 것으로 합산하지 않는다.
Claude 경로 정의나 작성자 검토만으로 공통 Claude 배포 지원을 추가하지 않는다.

검증 파일: `test/skill-distribution.test.js`, `test/skill-distribution-selection.test.js`,
`test/skill-distribution-deployment.test.js`, `test/skill-distribution-installation.test.js`,
`test/skill-distribution-cli.test.js`와 HTTP·GUI 시험이다. 실제 metadata probe는
`scripts/client-verification/skill-distribution-fixture.mjs --binary <검증된 절대 경로>`다.
