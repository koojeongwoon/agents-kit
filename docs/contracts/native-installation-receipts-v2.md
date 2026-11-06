# Native installation receipts v2

기존 설정 편입 후 생성한 `nativeSource` 소유 기록의 설치 영수증이다. 일반 generated
자원의 [v1 영수증](installation-receipts-v1.md)과 원래 native ID·baseline 증거를 구분한다.
Manifest 참조는 Kit의 stable ID를 계속 사용하고 기존 파일/서버 이름을 바꾸지 않는다.
후속 [schema 3](installed-dependency-revisions-v1.md)도 이 native locator/owner/baseline
검증을 그대로 사용하고 dependency revision과 명시적 Tool 이름을 추가한다. 기존 schema 2
이력은 자동 변경하지 않는다. 아래는 최초 schema 2의 계약과 검증 기록이다.

## 증거 형식과 범위

영수증 schema 2의 locator는 schema 1, `type: native-installation`, `strategy: native-source`다.
Kit ID/asset ID/kind·scope·client/surface/configStore와 definition digest/capability/pathTemplate,
실제 targetBase·원래 nativeId·format을 가진다. generated deployment locator 검증에는
통과하지 않으며, generated locator의 소유권·경로 이관 권한으로 대신 사용할 수 없다.

각 proof는 현재 소유 transaction anchor, mode, 소유 내용 hash와 nativeOwnerDigest를
기록한다. native owner가 current managed 기록과 committed apply 영수증에 일치하고,
sourceRoot·원래 nativeId·targetBase·relative가 해당 자원과 맞아야 한다. Kit의 검증된
lastApplied snapshot 파일을 nofollow/bounded reader로 읽고 저장된 sha/mode를 대조한다.
현재 Kit 수정본이나 동명 파일은 과거 설치 증거가 아니다.
legacy 소유 기록의 첫 영수증은 관리 등록 시 명시적으로 검토한 논리 metadata를 함께
기록한다. 원래 적용 당시 없던 Tool/binding 이력을 현재 Kit으로 복원했다고 주장하지
않는다. native body hash와 논리 선언의 연결만으로 실제 provider binding을 충족시키지 않는다.

| 자원 | 현재 내용 대조 |
|---|---|
| 지침/Agent | 원래 파일 전체 bytes/mode와 lastApplied snapshot |
| Skill | 원래 디렉터리의 소유 파일·mode와 전체 bundle 집합/디렉터리 mode |
| MCP | 원래 nativeId의 서버 단위와 nested 설정만 기존 MCP adapter로 정규화 |

MCP의 다른 서버·사용자 설정·비소유 credential을 복사하거나 기록하지 않는다. 실제
읽기 buffer와 선택 단위 값은 영수증에 저장하지 않고 hash만 남긴다. 다른 MCP owner의
변경 시 동일한 소유 영역과 원래 baseline이 유지되는 영수증만 같은 revision으로
anchor를 갱신한다. 외부 링크·hard-linked baseline·변조 snapshot은 긍정 판정하지 않는다.

## 명시적 metadata-only 갱신

기존 adopt/apply 계획의 선택적 installationEvidence에 원래 nativeId/target과 새 기록의
필요 여부를 표시한다. 공개 검토 metadata와 내부 descriptor는 복사로 분리한다.
이미 native 소유 기록은 있지만 영수증이 없으면, 검토한 계획의 명시적 적용으로
client 파일 작업 없이 audit transaction을 만들 수 있다. 같은 기록을 다시 관리 등록하면
unchanged를 반환하며 원장도 추가로 쓰지 않는다. 단순 조회로 영수증을 생성하지 않는다.

영수증을 기록할 수 없는 기존 profile이나 baseline은 unverified로 남긴다. adoption
metadata와 native runtime gate를 구분하며, apply의 기존 scope·dependency·client version/
binary/resource profile 검사를 완화하지 않는다. native model/Tool 프로세스를 시작하지 않는다.

기존 파일·mode·소유권·source journal·transaction backup/rollback은 그대로 사용한다.
영수증은 같은 state commit/journal에 들어간다. metadata-only 적용의 결과는 별도
metadataOnly로 표시하고 GUI도 client 파일 갱신과 구분한다. source-only 편집은 기존
설치 revision을 바꾸지 않고, 실제 client apply/rollback 때 설치 기록을 갱신/복원한다.

조회는 기존 catalog installation inspection을 사용한다. ownership-observed는 원래
소유 파일/서버 영역을 확인했다는 뜻이며 native 발견·Tool binding·모델 행동의 증거가
아니다. fulfilled false와 Manifest v3 자동 적용 차단을 유지한다.

## 호환성과 검증

v1 generated 영수증은 계속 읽는다. v1 영수증만 검증하는 중간 버전은 native v2를
거절하므로 현재 reader로 갱신해야 한다. 기존 client 설정이나 Manifest source의
이름/경로 migration은 필요 없다. 영수증을 모르는 오래된 writer의 새 소유 기록에는
일치하지 않는 옛 transaction anchor를 전용하지 않는다. 실제 교차 scope 집행을 열기
전 구버전 writer 차단·상태 승격·역참조·잠금/복구가 여전히 필요하다.

네 자원의 adoption, alias, JSON/TOML MCP 단위 보존, source edit/apply/rollback,
legacy metadata-only 갱신·반복 등록, baseline 변조/hard link·외부 링크·소유 해제,
다른 MCP owner와 공개 metadata 격리를 fixture로 검증한다. 실제 사용자 환경에서는
기존 MCP 3개·지침 1개의 audit 적용→복원→유지를 확인했으며 client 파일 작업은 0건이다.
이는 실제 Skill/Agent 모델 실행이나 native capability 확대 증거가 아니다.
