# Skill variant별 원본 편집·재가져오기·병합 계약 v1

2026-11-06, C07/T27/AK-SR38. 기존 source revision 엔진의 bounded 파일 검사·B/K/U 병합·
immutable revision·scope lock·journal·중단 복구를 variant 단위로 재사용한다. 원본과 설치 파일은
이 트랜잭션의 쓰기 대상이 아니다. [배포 대상 계약](skill-distribution-v1.md)을 함께 따른다.

## 버전과 식별

| 구조 | 의미 |
|---|---|
| Skill definition 3 / distribution 1 | 기존 asset.source 안의 문자열 source들을 그대로 읽는다 |
| Skill definition 3 / distribution 2 | 문자열 source와 versioned managed source를 함께 읽는다 |
| managed source 1 | `{schemaVersion: 1, type: managed, record: …}` |
| source record 2/3 | 별도 Kit 수정본·accepted baseline·origin·history. 3은 pinned upstream 연결도 보존 |
| source checkpoint 3 | `{schemaVersion: 3, subject: {assetId, variantId}, state: …}` |
| selected source 2 | Kit 기준 경로와 `{id, revisionId}` sourceRevision을 배포 선택에 연결 |
| installation skillSelections 2 | 같은 transaction의 설치 영수증과 선택한 variant의 해당 대상 정책에 연결 |

Manifest v1/v2/v3와 기존 definition v1/v2를 유지한다. distribution 1을 관리 등록할 때만
distribution 2로 명시적으로 바꾼다. 이전 reader는 새 distribution/선택 영수증을 거절하며
다른 경로를 조용히 읽지 않는다. 안정적인 assetId·variantId가 논리 식별자다. 파일 저장 namespace는
그 두 ID에서 유도한 `variant-<SHA-256 앞 56자리>`이며 다른 variant의 공간을 재사용하지 않는다.

record.source는 `assets/revisions/<namespace>/<contentId>` 아래, baseline과 checkpoint는 기존
`.kit-sources/baselines/<namespace>/…`, `.kit-sources/revisions/<namespace>/…` 아래에 보관한다.
관리 이력의 revisionId는 바인딩·기준 사본만 바뀌어도 새로 생긴다. 내용이 같으면 이전 contentId의
디렉터리를 재사용할 수 있으며 두 ID가 같다고 가정하지 않는다. source checkpoint 3은 두 논리 ID와
state의 namespace를 함께 검사한다. 다른 variant의 checkpoint로 복원할 수 없다.

## 등록과 출처

`planVariantRegistration`은 이미 선언된 asset/variant만 받는다. caller의 임의 경로로 가져오지
않는다. Kit의 현재 bundle K를 별도 immutable source로 복사하고 baseline B도 생성한다.
기존 origin 파일·다른 variant·현재 설치·배포 원장은 이동하거나 변경하지 않는다. 같은 등록은
검증 후 SKIP하며 새 candidate로 조용히 바인딩을 교체하지 않는다.

- candidateId가 없으면 origin은 `{type: kit, path: …}`다. 등록 당시 Kit의 원래 경로가 B이며
  이후 로컬 refresh는 그 경로를 읽는다. 실제 클라이언트의 설치를 추적한다고 표시하지 않는다.
- 명시적인 client/surface/scope/candidateId가 있으면 기존 discovery/import port로 다시 찾아
  원본 U를 읽고 그것을 B로 잡는다. 현재 Kit 수정본 K가 B와 달라도 유지한다. 이후 재가져오기에서
  등록 전부터 있던 Kit 수정도 덮어쓰지 않는다. local locator·linkHash 재확인과 Kit-owned 설치를
  독립 upstream으로 쓰지 못하는 기존 gate를 적용한다.
- Git/npm 연결은 기존 `planRefresh`의 명시적 upstream 입력과 비교·병합으로 연결한다. 정확한
  commit/version/integrity를 검토하며 apply에서 다시 다운로드하거나 원본 코드를 실행하지 않는다.
- ego-browser 같은 external manager candidate는 payload를 열기 전에 거절한다. 외부 updater나
  앱 관리 사본을 가져오거나 링크를 교체하지 않는다.

원본, 현재 source, baseline 및 새 내용은 같은 파일 수/크기/깊이·secret scan·symlink·portable
snapshot 규칙을 따른다. native의 metadata·지원 파일·binary·모드는 선택하지 않은 파일까지
보존한다. native variant를 관리할 수 있다는 사실은 다른 client 배포 지원을 뜻하지 않는다.

## 편집·갱신·복원

기존 `source`, `planSourceEdit`, `checkUpstream`, `planRefresh`, `planSourceRollback`에 variantId를
추가한다. variantId가 없으면 기존 imported resource 흐름이다. variantId가 있으면 정확한
variant의 record만 변경한다. v3 Manifest에서 이 예외로 ordinary native import 수명주기를
활성화하지 않는다.

편집은 조회 revision token을, 충돌 해결은 B/K/U에 묶인 reviewHash를 요구한다. 기준 사본은
수용한 파일만 전진하며 keep/defer 파일의 기준은 유지한다. 이력 복원은 Kit 내용·baseline·
보류·upstream pin을 새 source transaction으로 복원한다. 원본 U와 실제 설치는 되돌리지 않는다.
관리 source의 바이트/권한/파일 집합이나 원본/link가 바뀌면 stale/artifact 검사로 차단한다.

기존 journal 2가 같은 namespace 경로와 생성 identity를 기록한다. source/Manifest commit 전후
SIGKILL 후에는 읽기를 차단하고 reviewed recovery로 정확한 생성 파일을 제거하거나 완료 결과를
보존한다. 이전 revision·baseline을 자동 수거하지 않는다. generic Manifest CRUD로 관리 record의
origin·baseline·source/history를 덮어쓰거나 관리 variant를 삭제할 수 없다. 작성자 호환성 검토와
대상 선언은 해당 record를 그대로 보존하는 일반 편집으로 바꿀 수 있다. 별도의 관리 해제/retirement
흐름은 아직 없으며 ordinary delete로 이력을 버리는 경로는 차단한다.

## 배포와 독립성

관리 source는 명시적인 Kit 기준 경로로 해석하고 asset.source 상대 경로와 혼동하지 않는다.
실제 배포는 새 source 내용·모드에 맞는 작성자 검토와 기존 실행 profile 검증을 따로 요구한다.
source 편집·refresh·rollback은 클라이언트에 자동 적용하지 않는다. 선택 기록에는 정확한 관리
head revision과 source 경로를 담으며 기존 저장 계획은 Manifest/source 변경 시 재검토한다.

선택 영수증 2의 definitionDigest는 asset/scope·배포 정책·노출 정책·해당 대상 선택과 **선택한
variant의 source record/형식/버전별 검토**를 묶는다. A의 초안이나 출처 변경만으로 B의 기존
설치 증거/프로젝트 전제를 무효화하지 않는다. 선택 영수증 1의 전체 definition digest 의미는
그대로 유지한다. 과거 record를 추정으로 v2로 변환하지 않으며 필요한 경우 검토한 apply가
동일 파일에 대한 metadata-only 선택 기록을 남긴다. 기존 설치 receipt 버전은 바꾸지 않는다.

## CLI·HTTP·GUI

CLI는 `variant-register --asset <id> --variant <id>`를 계획/적용한다. `source`, `source-edit`,
`updates`, `refresh`, `source-rollback`에 같은 `--variant`를 전달한다. `--dry-run`은 무쓰기다.
명시적 local origin은 등록 시 기존 `--client/--surface/--candidate/--source-scope`를 사용한다.
HTTP에는 `/api/manifest/variant-register/{plan,apply}`를 추가하고 기존 source endpoint에
variantId를 전달한다. apply는 동일한 single-use planId만 받으며 기존 mutation 인증을 유지한다.

GUI는 catalog의 variant 목록에서 관리할 variant를 고르고, 등록 계획을 검토한 뒤 기존 편집/
업데이트/이력 화면을 재사용한다. 기본 Kit origin과 실제 local 설치 origin의 표시를 구별한다.
CLI/HTTP/GUI는 같은 application services를 실행한다. component/build 검증은 실제 브라우저
통합 검증과 구분한다.
