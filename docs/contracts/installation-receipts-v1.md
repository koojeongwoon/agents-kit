# Installation ownership receipts v1/v2/v3/v4

PR10의 설치 전제 중 **설치 당시 선언·현재 소유 영역 관측** 계약이다. native 발견,
활성화, 실제 Tool 제공, 역참조·교차 scope 잠금은 별도다.
이 영수증으로 교차 scope 배포를 활성화하지 않는다.
[schema 3 후속](installed-dependency-revisions-v1.md)은 설치 dependency revision과
명시적 native Tool 이름을 추가하며 기존 v1/v2를 읽는다. 아래는 초기 v1/v2의 소유 계약이다.
[scoped v4 후속](scoped-installation-receipts-v4.md)은 physical origin ID·scoped 선언/snapshot을
추가한다. 기존 기록을 자동 변환하지 않는다. 공개 교차 scope 적용은
[별도 실행 계약](scoped-deployment-execution-v1.md)의 private 검증·등록 경계를 따른다.

## 적용 시 기록

공통 source 및 typed 자원의 검토한 계획은 `installationEvidence.mode: audit-only`와
자원별 공개 선언 metadata를 반환한다. private prepared descriptor와 공개 응답은
복사로 분리하며 반환된 계획 객체를 수정해 실제 기록을 바꿀 수 없다.

적용 transaction의 선택적 `installationReceipts`는 generated schema 1,
[native schema 2](native-installation-receipts-v2.md), 후속 schema 3 영수증 배열이다.
기존 상태 schema를 변경하지 않는 추가 감사 metadata다. 과거 reader가 이 필드를
모르는 상태에서 쓴 새 소유 기록에는 이전 긍정 증거를 전용하지 않는다. 실제 역참조
보호를 활성화할 때에는 구버전 writer 차단과 별도 상태 승격이 필요하다.

| 항목 | 기록하는 정보 |
|---|---|
| identity | canonical sourceRoot, Kit/asset/kind, scope, client/surface/configStore |
| locator | 적용된 경로·capability·전략·format·client definition digest |
| declaration | stable 참조, 요구/제공 논리 Tool ID, 당시 provider binding, deny capability |
| proofs | 소유 파일/selector hash·mode, 해당 소유 기록의 transaction anchor |
| directories | copy Skill bundle의 상대 디렉터리·mode |
| revisionDigest | 위 설치 metadata와 소유 영역으로 계산한 SHA-256 |

Agent 지침·Skill 본문·MCP command/args/env/header 값·credential·raw client output은
영수증에 저장하지 않는다. selector·파일 내용은 hash로만 기록한다. revisionDigest는
소유 transaction anchor를 제외하므로 다른 MCP owner의 변경으로 파일 전체 transaction이
바뀌어도 동일한 자원의 revision을 유지할 수 있다.

영수증은 client 파일·원장과 같은 기존 journal 안에서 commit한다. 일반 copy/merge,
shared snapshot 및 명시적 경로 이관 실행기를 사용한다. rollback은 이전 managed 기록과
committed transaction으로 복원하며 rolled-back 영수증을 최신 증거로 사용하지 않는다.
같은 물리 자원·client/surface의 최신 committed 영수증만 후보로 삼는다.

Kit source 편집은 영수증을 바꾸지 않는다. 논리 Tool 선언만 바뀌어 생성 파일이 같아도
명시적 apply가 새 선언 revision을 기록한다. 다른 owner를 변경할 때에는 이전 소유
영역과 의미가 그대로인 영수증만 새 anchor로 전달한다. metadata를 현재 Kit 선언으로
추측해서 보충하거나 실제 변경된 자원의 옛 선언을 새 내용에 붙이지 않는다.

## 현재 파일과의 대조

현재 committed 소유 기록과 적용 locator, target 범위, mode, 선택 selector/file hash를
대조한다. 구조화 설정은 기존 merge와 같은 JSON/TOML/Markdown 정규화를 사용한다.
다른 사용자 설정의 변경을 Kit 소유 영역의 변경으로 혼동하지 않는다. copy Skill은
전체 bundle의 파일 집합·디렉터리 mode도 대조하며 미등록 추가 파일이나 링크가 있으면
완전한 소유 관측으로 처리하지 않는다.

snapshot 링크는 Kit 소유 connection과 정확한 link 문자열을 확인하고 기존 immutable
store의 descriptor/tree를 검증한다. 일반 링크나 ego-browser의 대상을 읽는 권한으로
확대하지 않는다. audit 생성이 불가능한 일반 설치는 기존 적용 동작을 유지하면서
영수증 실패 code만 기록하고, 조회에서는 긍정 증거를 만들지 않는다.

sourceRoot·Kit·asset·client·surface·configStore·definition digest가 일치해야 한다.
같은 이름의 다른 물리 Kit, 다른 surface의 소유 기록, 다른 client의 native 지원,
단순 파일 존재는 대신 사용할 수 없다. 과거 영수증 없는 소유권은 조회만으로 추측하지
않는다. native-owned 자원은 별도 native locator·현재 owner·lastApplied baseline을
검증하는 v2를 사용한다. 기존 소유 기록은 명시적 metadata-only 계획으로 보완할 수
있으며 generated locator로 우회하지 않는다.

## 조회와 판정

- Service: `catalog({...context, includeInstallations: true, clientId, surface})`.
- CLI: `catalog --project /checkout --client codex --surface cli --inspect-installations`.
- HTTP: catalog view에 `installations=true`, clientId, surface. `includeOtherClients=true`는
  설치 대상만 선택하면서 다른 client의 목록을 보존한다.
- GUI: **CLI 설치 소유 정보 확인**을 명시적으로 선택한다. native 프로세스를 실행하지
  않으며 원장·설정·잠금을 쓰지 않는다. 이전 조회 응답이 더 최신 요청을 덮지 않는다.

`installationPrerequisites.checks[].status`는 `ownership-observed`, `drift`, `unverified`다.
`consistency: observed`는 읽는 동안 전역 원장이 같았다는 관측이다. native 발견과
provider binding의 충족은 `unverified`, `fulfilled`는 항상 false다. 기존 declaration
graph의 `valid`와 v3 `deploymentReady: false`도 별도로 유지한다.

lock·journal·migration pending은 metadata로 존재부터 확인한다. 끊긴 링크도 부재로
처리하지 않고 보존·차단한다. 읽기 전후 원장 digest 또는 pending이 바뀌면 긍정 관측을
폐기한다. 이 읽기 전용 대조를 실제 global→project 잠금이나 동시성 보장으로 부르지 않는다.

## 검증 범위와 남은 집행 조건

시험은 source-only 편집, 명시적 metadata-only 적용, 내용 갱신·rollback, 다른 MCP owner
변경, JSON/TOML selector·copy/snapshot Skill, 추가 파일·외부 링크·mode drift, anchor 변경,
잘못된 ID/경로·공개 계획 alias를 포함한다. 실제 하위 프로세스를 commit 직전/직후
SIGKILL하고 pending 중 긍정 판정을 막은 뒤 검토 복구로 파일·영수증 일치를 확인한다.

이후 전이 revision·역참조·두 scope 잠금/journal과 [공개 v3 실행](scoped-deployment-execution-v1.md),
[의존성 rollback](scoped-deployment-rollback-v1.md), [원본 검증/진단/편집](scoped-manifest-management-v1.md)을
연결했다. 미지원 native 원형/과거 경로 writer와 전역 설정의 전체 프로젝트 문맥 전환,
추가 client/surface·consumer 활성 증거는 남아 있다.
