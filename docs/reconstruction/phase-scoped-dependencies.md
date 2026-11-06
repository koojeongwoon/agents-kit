# PR10 교차 scope 의존성 — 계약과 선행 입력 검증

2026-11-06. 구현 계약과 provider ID 교정 후 qualified 참조·순수 resolver·읽기 전용
CLI/HTTP/GUI를 연결했다. 설치 당시 선언·소유 영역 revision 관측도 추가했다. native/
provider 전제·역참조·교차 scope 잠금/복구·자동 적용은 아직 미구현이다.
PR07의 Agent blocker나 PR09의 미확인 client 문맥을 완료로 간주하지 않는다.

## 계약

[scoped-dependencies-v1](../contracts/scoped-dependencies-v1.md)에 예정된 Manifest v3의
qualified asset/provider 참조와 bare ID 호환성, 실제 checkout/Kit origin 식별,
전역 설치 revision·논리 Tool binding 전제, 역참조 보호와 전역→프로젝트 잠금 순서를
명시했다. 저장 계획·두 원장 metadata의 중단 복구·등록부 손상·이동·경합 시험이 모두
완성되기 전에는 현재 교차 scope 적용 차단을 유지한다.

## 기록된 실패와 최소 교정

기존 Tool 선언 검증은 providerId를 검사하지 않았다. resolver는 객체 providerId를
문자열로 강제 변환하므로 optional 요구에서는 미지원 참조가 단순 미해결 provider로
누락될 수 있었다. workflow의 Agent step에 붙은 providerId도 무시할 수 있었다.

Manifest v1/v2의 optional Tool에 qualified 객체·null·빈 값·경로·숫자를 전달하고,
workflow의 잘못된 provider selector를 검사하는 두 테스트가 실패함을 기록했다.
`manifest-contracts`의 기존 경계에서 문자열 stable asset ID와 Tool step만 허용하도록
교정했다. 이 변경으로 새로운 scoped 참조를 지원하거나 implicit provider 선택 범위를
넓히지 않는다. 정상 bare provider ID의 기존 closure/binding도 함께 확인했다.

- Red: `/private/tmp/kit-pr10-provider-reference-red.log` — 11개 중 신규 2개 실패.
- Green: `/private/tmp/kit-pr10-provider-reference-green.log` — reference/domain/loader 25개 통과.

전체 루트 524개, HTTP 40개, 기존 GUI 64개와 typecheck, desktop frontend/backend 및
Cargo 검사가 통과했다. 관련 로그와 source hash는
[입력 검증 체크포인트](scoped-dependency-reference-validation-20261106.json)에 기록한다.

첫 전체 HTTP 실행에서는 기존 이력 GET 시험 한 건이 403을 반환했다. 원문 응답이
기록되지 않아 원인은 확정하지 못했다. 기대 상태를 완화하지 않고 실패 시 code/error/
content-type/server를 표시하도록 시험 진단을 보완했다. 해당 시험 단독 및 전체 HTTP
재검사는 통과했다. 미재현인 이 관측을 provider 검증 결함이나 해결된 제품 버그로
단정하지 않으며 반복 실환경 호출로 확대하지 않았다.

추가 native/model/Tool 실행과 사용자 설정 쓰기는 없었다. 고정 baseline과 대조한 기존
27개 경로 내용·mode와 외부 링크는 보존됐고 전역 원장은 v6/133 transactions/3 files/
4 owners, 활성 hash 일치, lock/journal 없음으로 유지됐다.

## Qualified 참조와 catalog 조회 후속

Manifest v3와 schema 1의 qualified asset/provider 참조를 읽기 전용으로 추가했다.
stable ID·종류·scope·version·추가 필드·경로/숫자 강제 변환을 검사한다. v1/v2의
qualified 객체는 계속 거절한다. 일반 loader, deployment selector와 직접 client plan은
v3를 SCOPED_DEPLOYMENT_NOT_ENABLED로 차단하며 catalog만 source 해석 없이 읽는다.

순수 resolver는 같은 Manifest의 bare ID와 명시적 전역 참조를 구분한다. global→project,
다른 project·물리 Kit를 거절하고 동일 global origin 후보의 모호성·접근 불가·missing·
kind mismatch·cycle·provider 모호성·정책 거절을 표시한다. qualified 노드 key로 동명 ID를
분리하고 전이 global Skill/MCP/policy 선언과 논리 Tool binding을 반환한다. global
prerequisite의 실제 설치는 전혀 확정하지 않는다. 먼저 다른 root에서 방문한 공유 Skill도
Agent의 deny를 잃지 않도록 edge를 따라 정책을 합성하는 실패를 TDD로 보완했다.

공통 catalog의 includeDependencies, CLI `catalog --dependencies [--assets a,b]`, HTTP
catalog view의 `dependencies=true`, GUI가 같은 resolver를 사용한다. native 조회 후에도
같은 graph를 유지한다. GUI는 선언 확인과 실제 전역 설치 미확인을 구분하고 v3 행의
편집·배포·설치 작업을 열지 않는다. 불완전한 graph를 전역 의존성 부재로 표시하지 않는다.
실제 다른 checkout의 key는 다르고, 동일 Kit의 symlink 별칭은 canonical scopeRoot로 같은
물리 dependency origin이다. 기본 catalog의 기존 자원 ID와 응답 선택은 유지한다.

| 기록된 실패 | 수정/검증 |
|---|---|
| 순수 scoped module/서비스/GUI 부재 | scoped domain/service/GUI red 후 공통 구현 |
| 숫자 reference ID 및 공유 Skill의 inherited policy 누락 | `/private/tmp/kit-pr10-scoped-policy-{red,green}.log` |
| Kit 별칭이 다른 dependency origin으로 계산됨 | `/private/tmp/kit-pr10-scoped-alias-{red,green}.log` |
| invalid graph를 전역 의존성 부재로 표시 | `/private/tmp/kit-pr10-scoped-gui-unresolved-red.log`, GUI 전체 회귀 |
| native route의 새 read-only graph 옵션 기대 불일치 | 실행 옵션·evidence 주입 차단은 유지하고 명시적 includeDependencies 계약 갱신 |

[사용자 Kit 읽기](native-live-scoped-catalog-20261106.json)는 기존 global v2/project v1의
선언 조회만 확인했다. 그래프 valid는 실제 설치 증거가 아니며 native process/model/Tool을
실행하지 않았다. 최종 alias 교정은 격리 fixture에서 검증했다. 기존 설정·외부 링크는
고정 27개 baseline 및 원장 대조로 보존했다.

브라우저 QA는 기존 ego 작업 공간 23이 task-space-not-found여서 진행하지 않았다.
새 공간을 만들어 우회하지 않았고 임시 서버 PID 71771/fixture는 정리했다. native port
호출은 0이었다. 이번 UI 증거는 실제 브라우저 확인이 아닌 React component/App 회귀와
TypeScript/desktop build다. 설치 전제·validate/doctor 전체 resolver 전환·역참조·잠금·
journal 및 실제 교차 scope 적용/복원은 계속 남아 있다.

| 최종 검사 | 결과 |
|---|---|
| 루트 | 538 passed, `/private/tmp/kit-pr10-scoped-root-verified.log` |
| HTTP | 41 passed, `/private/tmp/kit-pr10-scoped-http-final-verified.log` |
| GUI | 66 passed, `/private/tmp/kit-pr10-scoped-gui-verified.log` |
| TypeScript | 통과, `/private/tmp/kit-pr10-scoped-typecheck-verified.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-scoped-build-final-verified.log` |
| Cargo | 통과, `/private/tmp/kit-pr10-scoped-cargo-verified.log` |

[Scoped catalog 체크포인트](scoped-dependency-catalog-checkpoint-20261106.json)에 최종 source/log
hash·원장·보존 및 미구현 범위를 기록했다. native 배포 gate나 runtime evidence는 확대하지 않았다.

## 설치 당시 선언·소유 영역 영수증 후속

[installation-receipts-v1](../contracts/installation-receipts-v1.md)의 domain 값, application
생성/관측과 catalog 대조를 추가했다. 검토한 sourceRoot·적용 locator·client/surface,
논리 참조/Tool 선언과 당시 binding, 소유 파일/selector hash·mode를 body 없이 기록한다.
일반 apply, shared snapshot, 경로 이관의 기존 transaction/journal 안에서 commit한다.
기존 상태 schema에 더하는 audit metadata이며 실제 역참조 보호의 상태 승격은 후속이다.

source만 편집하면 기존 설치 revision은 유지한다. 명시적 apply 시 Tool 선언만 바뀌어
생성 파일이 같아도 새 revision을 기록한다. 다른 MCP owner를 바꾸면 의미와 소유 영역이
그대로인 자원만 같은 revision으로 새 transaction anchor에 전달한다. rollback은 이전
committed 증거로 돌아간다. JSON/TOML/Markdown selector와 copy Skill 전체 파일 집합,
Kit immutable snapshot을 관측하며 외부 링크 대상은 읽지 않는다.

CLI `catalog --inspect-installations --client codex --surface cli`, catalog HTTP view의
`installations=true`, GUI의 명시적 설치 소유 정보 버튼이 같은 application service를
사용한다. 현재 파일 일치는 ownership-observed이고 native 발견·binding 충족은 별도
unverified/fulfilled false다. 원장·설정·잠금을 쓰거나 native/model/Tool을 요청하지 않는다.
과거 영수증 없는 owner, native installation 전용 owner와 미확인 target/profile은
현재 Kit/source로 추측하지 않는다. 전이 설치 및 provider revision/native Tool name
전제 해석과 native-owned 자원 adapter 연결은 계속 남아 있다.

TDD는 신규 영수증 module/조회 부재, 경로/숫자 ID 검증, 공개 계획의 내부 선언 alias,
느린 조회의 최신 응답 덮어쓰기와 끊긴 pending 링크의 부재 판정을 기록했다. GUI는
같은 문맥에서도 더 늦게 요청한 결과만 채택한다. 실제 child를 before-state와
state-committed에서 SIGKILL한 시험은 pending 중 긍정 관측을 막고 검토 복구 뒤 파일과
영수증 revision의 일치를 확인했다. 별도 global→project 원자성 시험으로 확대하지 않는다.

| 최종 검사 | 결과 |
|---|---|
| 루트 | 554 passed, `/private/tmp/kit-pr10-installed-root-verified.log` |
| HTTP | 42 passed, `/private/tmp/kit-pr10-installed-http-verified.log` |
| GUI | 68 passed, `/private/tmp/kit-pr10-installed-gui-first.log` |
| TypeScript | 통과, `/private/tmp/kit-pr10-installed-typecheck-first.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-installed-build-verified.log` |
| Cargo | 통과, `/private/tmp/kit-pr10-installed-cargo-final.log` |
| 소유/설치 핵심 회귀 | 16 passed, `/private/tmp/kit-pr10-installed-evidence-green.log` |

[사용자 Kit 읽기](native-live-installed-catalog-20261106.json)는 현재 프로젝트에 전역
참조가 없고 기존 원장의 영수증도 0개였다. 이 실행은 read path 호환성과 보존 증거이며
사용자 전역 의존성을 실제로 충족했다는 증거가 아니다. 원장 bytes, 기존 27개 경로
내용·mode·외부 링크 identity를 보존했다. 기존 config inode/mtime 변경 1건도 동일하다.
브라우저 공간 부재는 이전 기록과 같아 새 공간이나 다른 브라우저로 우회하지 않았다.
이번 GUI 증거는 component/App·HTTP 회귀와 build이며 실제 브라우저 실기는 미완료다.

[설치 소유 증거 체크포인트](installed-resource-evidence-checkpoint-20261106.json)에
source/log hash·원장·보존을 기록했다. native gate·runtime evidence는 확대하지 않았고,
v3 집행·native-owned 자원·provider 설치 revision·역참조·교차 scope 잠금/journal·saved
plan 전제·validate/doctor 통합 및 실제 교차 scope 적용/복원은 계속 남아 있다.

## 기존 native 소유 기록·baseline 영수증 후속

[native-installation-receipts-v2](../contracts/native-installation-receipts-v2.md)의 별도 native
locator와 schema 2 영수증을 추가했다. stable Kit asset ID와 원래 native ID/경로를
분리하고, current managed owner·committed transaction·lastApplied snapshot의 sha/mode를
대조한다. generated locator 검증에는 통과하지 않으며 generic 경로 이관/소유권의
증거로 빌려 쓰지 않는다. 네 종류의 파일 관측, JSON/TOML MCP selected-server 보존,
source-only 편집과 실제 적용/rollback, 다른 native owner의 anchor 갱신을 검증했다.

이미 native 소유 기록이 있으나 audit 영수증이 없으면 검토한 adopt 계획이 metadata-only
transaction으로 기록을 보완한다. client 파일 작업이 0건인 경우도 명시적으로 검토·적용하며
두 번째 같은 관리 등록은 unchanged이고 원장도 쓰지 않는다. public 선언 metadata는
private descriptor와 복사로 분리한다. GUI도 기존 이름·소유 기록 갱신·파일 유지와
native 인식/Tool 사용 미확인을 구별한다. 기존 runtime/profile gate를 완화하지 않았다.

legacy adoption의 논리 metadata는 그 관리 등록에서 검토한 선언이다. 원래 적용 때
기록되지 않은 과거 Tool/binding 이력을 복원한 증거가 아니다. 설치된 전이/provider
revision·native Tool alias 및 실제 발견 전제는 계속 미확인이며 fulfilled false다.

새 fixture helper는 기존 native 설치 회귀의 setup을 옮겨 재사용한다. 네 종류 adoption,
native MCP/Skill alias, baseline 변조·hard link·외부 링크·해제, legacy audit·반복 등록,
다른 MCP owner·공개 metadata 격리·미지원 Agent runtime 차단·catalog/API/GUI를 포함한다.
기존 helper의 기본 경로와 동작은 유지하고 새 검증만 canonical Kit layout을 선택한다.

| 검사 | 결과 |
|---|---|
| 루트 | 563 passed, `/private/tmp/kit-pr10-native-root-first.log` |
| HTTP | 43 passed, `/private/tmp/kit-pr10-native-http-final.log` |
| GUI | 69 passed, `/private/tmp/kit-pr10-native-gui-first.log` |
| TypeScript | 통과, `/private/tmp/kit-pr10-native-typecheck-first.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-native-build-final.log` |
| Cargo | 통과, `/private/tmp/kit-pr10-native-cargo-final.log` |
| 최초 red | `/private/tmp/kit-pr10-native-receipts-red.log`, 5개 모두 실패 |
| baseline hard link red | `/private/tmp/kit-pr10-native-baseline-link-red.log` |
| metadata-only 결과/GUI red | `/private/tmp/kit-pr10-native-metadata-result-red.log`, `/private/tmp/kit-pr10-native-gui-red.log` |

### 실환경 metadata-only 적용·복원

[실환경 기록](native-owned-audit-roundtrip-20261106.json)은 기존 canva·node-repl·tools MCP와
codex-instructions 지침 네 자원이다. 사전 계획 모두 client 파일 작업이 0건임을 확인한
뒤 각 audit을 적용→rollback→다시 적용해 유지했다. 실제 Skill/Agent 모델 실행 시험이 아니다.

- canva/tools의 원래 AGY MCP 파일과 node_repl의 원래 Codex 서버 이름을 유지했다.
- 기존 managed 3 files/4 owners와 133개 과거 transaction은 그대로다.
- 의도한 metadata 이력만 12개 늘어 145 transactions, 활성 native audit 4개가 됐다.
- Kit Manifest hash, 기존 27개 경로 내용·mode 및 외부 링크 identity를 보존했다.
- 과거 Codex config의 inode/mtime 변경 1건은 동일하며 이번 client 파일 쓰기는 없었다.
- native/model/MCP/Tool 실행은 0이며 native gate와 runtime evidence는 확대하지 않았다.

[native 감사 체크포인트](native-owned-evidence-checkpoint-20261106.json)에 최종 source/log
hash·소유 영역 재관측·원장·보존을 기록한다. 브라우저 실기는 기존 공간 부재로 여전히
미실시다. 설치된 provider/native Tool binding·native 발견·역참조·교차 scope 잠금/journal·
saved plan 전제·validate/doctor 통합과 PR07/09/11의 남은 범위는 계속 진행해야 한다.

## 설치된 전이/provider revision·native Tool 이름 고정

[installed dependency 계약](../contracts/installed-dependency-revisions-v1.md)은 새 적용의
영수증 schema 3 / declaration schema 2 / dependencySnapshot schema 1을 추가한다.
이는 Manifest v3 집행 지원과 별개다. 같은 Manifest의 전이 closure·논리 선언 digest와
실제 소유를 관측한 dependency의 receipt/locator digest를 기록한다. provider부터
처리하므로 locator 순서와 무관하게 같은 transaction의 최종 provider revision을 pin한다.
native 자원은 기존 원래 ID·native owner·lastApplied baseline 검증을 그대로 사용한다.

명시한 native Tool alias를 provider의 설치 선언에 보관하며 logical ID에서 추측하지 않는다.
설치된 provider의 논리 선언이 새 consumer 계획의 선언과 다르면 unverified를 기록한다.
누락된 pin을 이후 provider로 채우지 않는다. legacy schema 1/2도 읽지만 당시 없던
전이 revision·alias는 현재 source로 보완하지 않는다. source-only 수정은 기존 pin과
Tool 이름을 그대로 두고 provider의 적용/metadata 변경만 dependency drift로 판정한다.
provider rollback이 원래 revision을 복원하면 다시 revision-observed가 된다.

소비자의 ownership-observed와 dependencyState를 분리했다. provider의 bytes·소유 anchor·
경로·revision과 전이 snapshot을 재관측하고 다른 MCP owner의 anchor 갱신은 semantic
revision을 바꾸지 않는다. snapshot/선언의 dependency를 함께 지워도 필수 Tool binding이나
직접 참조가 남으면 영수증을 거절한다. public plan metadata 격리와 v3 자동 적용 차단은 유지한다.

CLI/HTTP/GUI의 동일 catalog service가 의존성 상태·기록된 서버 원래 이름/Tool alias와
provider revision을 반환한다. GUI는 파일 소유·의존성 변경·설치 당시 이름·native 발견/실행
미확인을 구분하고 요약에서 쓰기 동작을 제공하지 않는다. 실제 native Tool 제공과
binding은 계속 미확인이며 fulfilled false다. snapshot은 audit 시점의 기록이고
교차 scope 배포 계획의 사전 고정·잠금/경합 방지를 대신하지 않는다.

| 검사 | 결과 |
|---|---|
| 최초 red | `/private/tmp/kit-pr10-dependency-revisions-red.log`, 6개 모두 실패 |
| declaration/snapshot 동시 삭제 red | `/private/tmp/kit-pr10-dependency-erased-red.log`, 1개 실패 후 검증 보완 |
| GUI 상태/alias red | `/private/tmp/kit-pr10-dependency-gui-red.log`, 새 1개 실패 후 표시 연결 |
| 루트 | 572 passed, `/private/tmp/kit-pr10-dependency-root-final.log` |
| HTTP | 43 passed, `/private/tmp/kit-pr10-dependency-http-final.log` |
| GUI | 70 passed, `/private/tmp/kit-pr10-dependency-gui.log` |
| TypeScript | 통과, `/private/tmp/kit-pr10-dependency-typecheck.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-dependency-build.log` |

격리 인수 시험은 같은 transaction의 provider 선행 기록, 전이 Skill, source-only alias
변경, provider 적용/rollback, bytes/소유 변경, 다른 owner anchor, 누락/모호함/다른 surface,
미관측 alias, 과거 영수증, 재해시한 잘못된 snapshot을 포함한다. native MCP의 Kit 별칭과
원래 서버 이름을 분리한 Skill adoption도 실제 파일 bytes/inode/mtime 보존을 검증했다.

[실환경 호환 관측](installed-dependency-live-compatibility-20261106.json)은 기존 원장
145 transactions / 3 managed files / 4 owners와 schema 2 영수증 4개를 읽기 전용으로
대조했다. 네 자원의 소유 영역은 일치하고 없던 dependency snapshot은 미확인이다.
원장 bytes·기존 27개 경로 내용/mode·ego-browser 링크 identity를 유지했다. 기존 Codex
config inode/mtime 변경 1건도 동일하다. 사용자 환경의 새 metadata 적용이나 native/
MCP/Tool/model 실행은 0건이다. native gate/runtime evidence를 확대하지 않았다.

[이 단계 체크포인트](installed-dependency-revision-checkpoint-20261106.json)에 source/log
hash와 검증/보존을 고정한다. 브라우저 공간이 없는 기존 상태에서 재시도/새 공간 생성은
하지 않았다. 실제 브라우저 GUI 증거는 이번에도 추가하지 않았다. 다음은 native 발견/
실제 Tool 전제, 배포 계획 전제 고정/재검사, 역참조·교차 scope 잠금/journal·saved plan·
validate/doctor 통합이며 PR07/09/11의 미완료 범위도 그대로 남아 있다.

## 역참조 모델·양쪽 원장 대조·기존 writer 차단

[dependency reverse index v1](../contracts/dependency-reverse-index-v1.md)의 global index와
project registration을 deployment state 8에 추가했다. project 물리 origin으로 registration을
식별하고 consumer는 stable prerequisite ID로 해당 전제를 참조한다. client/surface/
configStore가 다르거나 누락/중복/미사용 참조인 경우 거절한다. 프로젝트 등록 generation,
index 기록 generation과 transaction ID를 보관하며 과거 state에 새 필드를 숨겨 넣지 못한다.

읽기 전용 application service는 등록된 실제 sourceRoot/targetRoot만 사용한다. 프로젝트
state는 bounded/nofollow snapshot으로 읽어 같은 state validator에 전달한다. 원래 consumer
영수증·현재 소유 영역과 전역의 정확한 revision/locator/binding을 대조하고 전후 fingerprint,
lock/journal도 확인한다. 프로젝트 state 누락·이동·손상·link/hard link·권한/용량 실패와
consumer/provider drift, reserved/releasing 및 복구 대기는 등록을 그대로 남기고 미확인이다.
index가 없다는 사실도 전체 native 소비자가 없다는 뜻으로 사용하지 않는다.

순수 영향 계산은 다음 설치 digest와 등록을 대조하며, 실제 바뀐 prerequisite ID를 쓰는
consumer만 영향 목록에 넣는다. source-only/no-op·다른 물리 origin은 구분한다. 정상
사용 중인 revision 교체에는 프로젝트 의존 자원 제거→전역 변경→프로젝트 재배포를
안내한다. 미관측/pending 등록은 검토를 요구한다. 이 결과는 write authorization이 아니다.

coordinator가 아직 없으므로 등록된 schema 8을 기존 writer가 수정하거나 downgrade하지
못하도록 막았다. 일반 apply/rollback은 lock 진입 전과 획득 후 검사하고 commit에서도
등록 변경/삭제를 거절한다. direct copy/merge·tree transaction/recovery 경로도 집행 전에
차단한다. 빈 global index는 그대로 보존하면서 기존 배포를 허용한다. 실제 사용자 원장은
자동 승격하지 않았으며 공개 등록/해제·선택적인 전역 변경 허용·source 삭제/등록 해제의
보호는 후속 coordinator 작업이다. 이를 완료하기 전에 cross-scope 집행을 열지 않는다.

CLI `catalog --inspect-dependents`, HTTP catalog의 `dependents=true`, GUI 명시적 조회를
같은 service에 연결했다. HTTP bool 입력을 엄격하게 검사하며 미지원 writer 차단은 409다.
GUI는 읽기만 제공하고 누락된 프로젝트도 경로·사용 자원·전역 전제와 함께 남긴다.
공유 inventory request 번호로 느린 역참조 응답이 최신 installation/native 응답을
덮어쓰지 않는다. 기존 두 관측을 다시 요청할 때 이미 선택한 역참조 조회도 갱신한다.

| 검사 | 결과 |
|---|---|
| 행동 red | `/private/tmp/kit-pr10-reverse-index-behavior-red.log`, domain 모델 1개 통과·서비스/state 6개 실패 |
| profile 연결 red | `/private/tmp/kit-pr10-reverse-profile-red.log`, 다른 client consumer 연결 1개 실패 후 검증 보완 |
| 과거 원장 pending red | `/private/tmp/kit-pr10-reverse-pending-red.log`, dangling lock을 not-enabled로 단정한 1개 실패 후 보완 |
| GUI red | `/private/tmp/kit-pr10-reverse-gui-red.log`, 새 2개 실패 후 표시 연결 |
| 루트 | 583 passed, `/private/tmp/kit-pr10-reverse-root-final.log` |
| HTTP | 44 passed, `/private/tmp/kit-pr10-reverse-http-final.log` |
| GUI | 74 passed, `/private/tmp/kit-pr10-reverse-gui-first.log` |
| TypeScript | 통과, `/private/tmp/kit-pr10-reverse-typecheck-first.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-reverse-build-final.log` |

격리 인수 시험은 물리 origin 분리·schema 8/downgrade·양쪽 generation/consumer 증거·
프로젝트 누락·pending/lock/link/hard link·내용 drift·consumer별 영향·source/no-op·다른
origin·client 불일치·ordinary apply/rollback 무쓰기 차단·빈 index 호환·CLI/API/GUI를 포함한다.
Rust 소스와 Cargo 의존성이 바뀌지 않아 이번에는 Cargo를 반복하지 않았다.

[실환경 CLI 관측](dependency-reverse-index-live-inspection-20261106.json)은 기존 사용자
Kit에서 새 조회를 한 번 실행했다. index가 아직 활성화되지 않았다는 사실을 반환했고,
원장 schema 6 / 145 transactions / 3 managed files / 4 owners와 bytes를 그대로 유지했다.
등록이나 원장 승격은 없으며 client/native/model/Tool 실행도 없다. 기존 27개 경로의
내용·mode 및 ego-browser 링크 identity도 보존했다. 과거 Codex config inode/mtime 변경
1건은 동일하다. 실제 등록된 교차 scope 프로젝트의 적용/복원을 확인한 것은 아니다.

[체크포인트](dependency-reverse-index-checkpoint-20261106.json)에 source/log hash와 보존을
고정한다. native gate/runtime evidence와 브라우저 실기 증거는 확대하지 않았다. 다음은
native/Tool 전제 및 계획 고정, 등록/해제 coordinator, 전역→프로젝트 잠금과 예약/활성/해제
두 원장 journal·SIGKILL 복구, 모든 쓰기/소스 삭제/경로 이관의 영향 연결이다. PR07/09/11의
남은 범위와 Manifest v3 편집·배포 차단도 그대로다.

## 내부 등록/해제 coordinator·두 scope transaction/복구

[dependency coordination v1](../contracts/dependency-coordination-v1.md)의 순수 등록 변화와
내부 application engine을 추가했다. upsert/부분 해제 시 다른 consumer/프로젝트의 pin을
보존하며, 마지막 실제 consumer 제거에는 project-only released tombstone을 남긴다.
global index generation은 예약/완료에서 증가하고 project 등록 generation은 한 번 증가한다.
동명 ID를 추정하거나 사용 중인 설치 revision을 다른 consumer의 새 요청으로 교체하지 않는다.
반환한 review 객체를 고쳐도 입력 index나 다른 프로젝트는 바뀌지 않는다.

계획은 무쓰기/무잠금이며 설치/native proof·두 원장 bytes/mode·client before/after image를
고정한다. 실행은 재계획 대조 뒤 global→project 순서로 잠그고 private session에 store
instance/실제 inode/nonce를 묶는다. client 첫 변경 전에 mutable target 집합과 예정 image를
검토 데이터에 대조한다. 추가/누락/다른 내용, global client 파일 쓰기, 외부 ego-browser
link target, 미지원 저수준 engine/rollback 우회는 집행 전에 거절한다.

global metadata backup과 schema 4 coordination journal → reserved/releasing index →
journaled project client 변경 및 최종 등록 포함 state commit → active/해제 index →
완료 marker/lock 정리 순서다. child journal의 expected state에도 최종 등록이 포함된다.
metadata-only 해제는 실제 client resource/block/selector/server 제거 proof를 대신할 수 없다.
순수 제거는 새 provider를 활성화하지 않으므로 upstream이 변경됐어도 새 native proof를
강요하지 않고 consumer 제거를 수행한다. source/MCP 접속 값이나 credential을 journal에
넣지 않으며 backup의 원래 metadata bytes/hash/mode와 안전한 오류 코드만 사용한다.

수동 원장/formatting 변경은 예약/commit 전 대조에서 보존한다. child 실패 중 사용자가
고친 client target은 자동 rollback으로 지우지 않고 두 journal/lock을 남긴다. 일반 쓰기
차단과 검증된 기존 단일 원장 복구를 분리해 legacy SIGKILL 복구도 유지했다. 정상 반환된
실패는 종료 lease marker로 구별하므로 daemon PID를 죽이지 않고 복구할 수 있다. 실행 중인
owner는 회수하지 않으며 SIGKILL은 PID 사망과 기록한 lock inode/nonce를 요구한다.

복구는 검토 hash와 backup/등록 변화 재계산·파일 증거에 따라 결정한다. project 미commit은
child before image와 원본 project state를 확인해 global metadata bytes/mode를 복원한다.
project commit 후에는 최종 index를 완료한다. 완료 marker와 실제 최종 digest를 대조해
lock 정리 중 중단도 재개한다. 예약만 있는 상태를 cleanup-complete로 바꿀 수 없다.
복구 자체가 중단되면 죽은 guard의 inode를 확인하고 atomic no-replace archive로 보존한
뒤 재획득한다. 살아 있는 guard나 바뀐 target/backup/lock은 자동으로 지우지 않는다.

| 검사 | 결과 |
|---|---|
| 최초 행동 red | `/private/tmp/kit-pr10-coordination-behavior-red.log`, domain 2개 통과·coordinator 5개 실패 |
| 수동 원장/client 편집 red | `/private/tmp/kit-pr10-coordination-concurrent-red.log`, 2개 실패 후 보존 보완 |
| terminal lease/formatting red | `/private/tmp/kit-pr10-coordination-terminal-red.log` |
| completed marker 위장 red | `/private/tmp/kit-pr10-coordination-cleanup-red.log` |
| recovery guard 재중단 red | `/private/tmp/kit-pr10-coordination-recovery-guard-red.log` |
| 외부 링크/입력 alias red | `/private/tmp/kit-pr10-coordination-external-link-red.log`, `/private/tmp/kit-pr10-coordination-alias-red.log` |
| 미검토 child 쓰기 red | `/private/tmp/kit-pr10-coordination-unreviewed-red.log`, project/global target 사전 검증 보완 |
| legacy 복구 회귀 red | `/private/tmp/kit-pr10-coordination-root-first.log`, 일반 pending 검사에 기존 복구 16개 차단 → 복구 진입점 분리 |
| 루트 최종 | 602 passed, `/private/tmp/kit-pr10-coordination-root-verified.log` |
| HTTP | 44 passed, `/private/tmp/kit-pr10-coordination-http-mutations-final.log` |
| GUI | 74 passed, `/private/tmp/kit-pr10-coordination-gui-final.log` |
| TypeScript | 통과, `/private/tmp/kit-pr10-coordination-typecheck-final.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-coordination-build-mutations-final.log` |

격리 시험은 실제 임시 client Agent 파일 변경·명시적 제거·global/project 원장 commit을
사용한다. journal 준비/예약/child state 전/project commit/final index/완료 marker/각 lock
해제의 9개 SIGKILL 경계와 복구 중 SIGKILL, 수동 편집, 변조 backup/lock, live owner/guard,
가짜 completed marker, source와 반환 데이터 격리, 외부 링크·미검토 쓰기를 포함한다.
native prerequisite port는 synthetic fixture이며 실제 client/profile 지원 증거가 아니다.
Rust/Cargo 소스가 바뀌지 않아 Cargo 검사를 반복하지 않았다.

[실환경 호환 관측](dependency-coordination-live-compatibility-20261106.json)은 기존 사용자
원장 schema 6 / 145 transactions / 3 managed files / 4 owners와 schema 2 영수증 4개를
읽었다. 네 자원의 현재 소유 영역이 일치하고 원장 bytes·기존 27개 경로 내용/mode 및
ego-browser 링크 identity를 보존했다. 과거 Codex config inode/mtime 변경 1건은 동일하다.
사용자 원장 승격·새 등록·client/native/MCP/Tool/model 실행은 하지 않았다.

[이 단계 체크포인트](dependency-coordination-checkpoint-20261106.json)에 source/log hash와
보존을 고정한다. 공개 v3 집행을 열거나 실제 교차 scope native 적용/복원을 완료한 것은
아니다. 다음은 실제 native/Tool proof adapter, v3 local/global 계획·설치 선언/adapter,
전역 mutation·source 삭제/등록 해제·rollback/경로 이관의 공통 영향 검사, 저장 계획과
공개 복구 dispatch·validate/doctor 연결이다. PR07/09/11의 남은 범위도 유지한다.

## Codex CLI native 전제 관측·private coordinator verifier

[native prerequisite observation v1](../contracts/native-prerequisite-observation-v1.md)의
domain 보조 정의·client adapter·bounded RPC/파일 문맥 reader·application service를 연결했다.
기존 client YAML digest/runtimeEvidence를 바꾸지 않도록 discovery 증거는 별도 보조 정의에
둔다. public observation JSON은 private verifier를 만들지 못하며 미확인/만료 결과는 차단한다.

설치 schema 3의 실제 소유·전이 revision/locator/binding을 먼저 대조하고 현재 실행 파일과
전역/전체 상위 프로젝트·Git 경계·시스템 설정 문맥을 고정한다. Skill은 정확한 native
user-scope 경로와 enabled 상태를 요구한다. 명확히 다른 외부 Skill 오류는 분리하지만
선택/상위/불명확한 오류는 미확인으로 남긴다. MCP는 원래 native server ID의 소유 전역
single-source와 실행/연결/Tool filter 필드 출처, frozen 논리 Tool 별칭·정책을 확인한다.

기본 metadata 관측에는 provider 연결이 없다. 명시한 provider discovery만 config/Skill과
문맥 대조 뒤 시작하고 선택 서버의 초기화된 Tool 목록만 읽는다. native runtimeStatus null의
정상 global/no-thread discovery와 실제 thread 연결·Tool 사용을 구분한다. command/env/headers,
Tool 설명/schema, 오류 본문이나 외부 Skill 항목은 public 결과/캐시에 보관하지 않는다.

private verifier는 동일 project/pin·실행 파일·정의·설정과 설치 증거를 동기로 재확인한다.
이를 내부 coordinator에 연결해 실제 임시 Agent 파일 변경과 양쪽 원장 transaction을
검증했다. 관측 중/후 설정 변화, 새 상위 설정/Git 경계, 정의/실행 파일/소유 변경, public
위장·만료·다른 프로젝트 재사용, opaque layer/profile/custom marker와 설정 link/hard link를 차단한다.

| 검사 | 증거 |
|---|---|
| 전송 red | `/private/tmp/kit-pr10-native-proof-transport-red.log`, 3개 실패 후 선택 서버/metadata 사전 승인 전송 구현 |
| adapter red | `/private/tmp/kit-pr10-native-proof-adapter-red.log`, 2개 실패 후 외부 오류 분리·thread 상태 투영 보완 |
| service red | `/private/tmp/kit-pr10-native-proof-service-red.log`, service 부재 실패 후 sealed verifier 구현 |
| source origin red | `/private/tmp/kit-pr10-native-proof-origins-red.log`, 한 필드 출처만으로 나머지 실행/filter 출처를 추정한 사례 차단 |
| domain/adapter/transport/service | 19 passed, `/private/tmp/kit-pr10-native-prerequisite-focused-final.log` |
| 루트 전체 회귀 | 621 passed, `/private/tmp/kit-pr10-native-prerequisite-root-final.log` |
| 실제 현재 Codex CLI | [격리 적용·관측·복원](codex-native-prerequisite-service-roundtrip-20261106.json) |

실제 검증은 `scripts/client-verification/native-prerequisite-fixture.mjs --binary /absolute/codex`
를 사용한다. metadata-only에서 어떤 provider도 시작되지 않았고 명시한 fixture MCP만
initialize·tools/list를 수행했다. 다른 MCP는 시작되지 않았다. Skill·필요 Tool 발견과
verifier 수용, 새 프로젝트 설정 시 무효화를 확인했다. 관측 전후 원장/설정 bytes·mode가
같고 설치 rollback이 원래 설정·ego-browser 모양의 외부 링크 inode/mtime/text를 보존했다.
모델/thread/Tool 실행 요청은 0이며 사용자의 실제 HOME/원장에 쓰지 않았다.

[사용자 기존 원장 읽기](native-prerequisite-live-compatibility-20261106.json)는 schema 6,
145 transactions, 3 managed files, 4 owners와 원장 SHA/bytes가 같고 pending이 없음을 확인했다.
기존 schema 2 영수증 4개의 ownership만 관측하고 새 전제 관측으로 승격하지 않았다.
기존 27개 경로 내용/mode·ego-browser 링크 identity는 그대로다. 과거 Codex config의
inode/mtime 변경 1건은 이전 단계와 동일하다. 이번 변경은 내부 native/metadata 계층이므로
HTTP/GUI/TypeScript/desktop/Cargo와 브라우저 검증을 새로 실행하거나 증거를 확대하지 않았다.
[체크포인트](native-prerequisite-checkpoint-20261106.json)에 이번 source/log/native/보존 증거를 고정한다.

예정 프로젝트 설정 변경은 현재 verifier를 무효화한다. 공개 v3 compiler에서 필요한
제한된 before/after 전환을 아직 허용하지 않았으며 다른 client/surface native 문맥도
추정하지 않는다. 공개 v3 계획/집행·모든 global mutation/source 삭제/관리 해제 보호·
저장 계획/공개 복구 dispatch·validate/doctor와 실제 교차 scope consumer 적용/복원이
남아 있다. `fulfilled: false`와 기존 deployment runtime gate를 유지한다.

## Scoped v3 local/global 변경 계획·공통 CLI/HTTP/GUI 미리보기

[scoped compilation v1](../contracts/scoped-deployment-compilation-v1.md)의 순수 선택과 별도
capability compiler, 설치 전제 대조·파일 준비를 연결했다. catalog의 scope read port를
재사용하며 native discovery/모델을 실행하지 않는다. 프로젝트/전역 동명 ID를 origin별로
유지하고 로컬 `dependencyIds`와 consumer별 global closure를 분리한다. 전역 자원을
프로젝트로 복사하거나 가짜 ID로 변환하지 않는다.

원래 asset을 기존 renderer와 binary/version/surface gate에 전달하므로 미지원 Skill
활성·Tool 제한·모델 필드를 없애 통과시키지 않는다. target enablement/allowlist·물리
projectName·정책/참조를 확인한다. object 상속 property는 target이 아니며 각 closure의
256개 한도를 per-consumer reachability 계산 전에 검사한다.

실제 global schema 3 설치 영수증과 현재 소유/전이 revision·locator·binding·논리 선언이
일치하는 경우만 pin을 만든다. source 본문 편집은 현재 설치 pin을 바꾸지 않는다.
논리 선언/alias 변경·다른 profile·소유 drift·과거 증거 부족은 미확인으로 남긴다.
현재 전역 v3 선언의 설치 호환은 다음 scoped 영수증 계약에서 연결할 부분이다.

기존 copy/merge/common/snapshot/physical planner로 target before/after image와 source/
정의/원장/runtime 문맥 digest를 만든다. 기존 설정/MCP의 다른 서버·지침 사용자 본문·
mode, 미관리 Agent/native 소유·경로 충돌·외부 링크 보호를 유지한다. public review에는
본문/접속 값을 넣지 않고 별도 clone을 사용해 private pin/target alias도 차단한다.

공통 deployment service `plan`은 표준 Kit의 한 client/surface v3 요청을 `scoped-preview`로
반환한다. CLI `apply --dry-run`·기존 HTTP plan·GUI 배포 계획이 같은 서비스를 사용한다.
private entry의 별도 apply gate와 saved-plan 거절을 유지한다. JSON flag를 바꿔도
실행되지 않는다. GUI는 전역 설치 파일 확인과 client 발견 미확인을 구분하고 잘못된
automatic true에도 scoped 적용/저장을 제공하지 않는다.

| 검사 | 결과/증거 |
|---|---|
| selection/compiler red | `/private/tmp/kit-pr10-scoped-compiler-domain-red.log`, 새 domain module 부재에서 시작 |
| application red | `/private/tmp/kit-pr10-scoped-compiler-application-red.log`, source/설치/파일 compiler 부재에서 시작 |
| 공개/private alias red | `/private/tmp/kit-pr10-scoped-compiler-preservation-red.log`, public pin/target 수정의 private 영향 차단 |
| 공통 service red | `/private/tmp/kit-pr10-scoped-compiler-service-red.log`, 읽기 전용 계획 및 실제 실행 거절 연결 |
| target 상속/closure 한도 red | `/private/tmp/kit-pr10-scoped-compiler-target-red.log`, `/private/tmp/kit-pr10-scoped-compiler-bounds-red.log` |
| HTTP status red | `/private/tmp/kit-pr10-scoped-compiler-http-status-red.log`, 잘못된 요청과 문맥 충돌 구분 |
| GUI red | `/private/tmp/kit-pr10-scoped-compiler-gui-red.log`, 새 전제 표시/readonly gate 1개 실패 후 연결 |
| 루트 전체 회귀 | 641 passed, `/private/tmp/kit-pr10-scoped-compiler-root-final.log` |
| HTTP | 44 passed, `/private/tmp/kit-pr10-scoped-compiler-http-final.log` |
| GUI | 75 passed, `/private/tmp/kit-pr10-scoped-compiler-gui.log` |
| TypeScript | 통과, `/private/tmp/kit-pr10-scoped-compiler-typecheck.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-scoped-compiler-build-final.log` |

scope reader 추출 중 catalog의 원래 origin 참조가 누락된 오류는 기존 회귀 시험이 잡았고
원래 scope/discovery 상태를 그대로 돌려주도록 수정했다. 초기 synthetic profile은 global
capability만 있어 project 파일 계획이 비어 있었다. fixture를 두 scope 증거로 고치고
실제 2개 로컬 operation·target을 명시적으로 요구해 빈 결과로 통과하지 못하게 했다.
이 synthetic 증거는 native 지원으로 승격하지 않는다.

[사용자 Kit 읽기 호환](scoped-compiler-live-compatibility-20261106.json)은 실제 기본 Kit의
catalog/의존성/설치 대조를 읽었다. 기존 schema 6·145 transactions·3 managed files와
원장 SHA/bytes를 유지하고 native/MCP/model/Tool 실행은 0이었다. 기존 27개 경로의
내용/mode·ego-browser 링크 identity도 보존했다. 과거 Codex config inode/mtime 변경
1건은 이전 단계와 같다. 사용자 index 활성화나 v3 consumer 실제 배포는 하지 않았다.

[체크포인트](scoped-compiler-checkpoint-20261106.json)에 source/log/보존 hash를 고정한다.
Rust/Cargo 변경이 없어 Cargo를 반복하지 않았고 새 브라우저/native evidence도 만들지 않았다.
다음은 scoped 설치 선언/영수증·실제 consumer revision 예측과 coordinator 등록/해제,
예정 설정 변경의 안전한 native 문맥 전환/재관측, 모든 전역 mutation/source 삭제/관리
해제 보호와 저장 계획/공개 복구 dispatch·validate/doctor다. 이 gate와 필요한 실제 교차
scope 적용/복원이 끝날 때까지 v3 자동 적용을 차단한다. PR07/09/11의 남은 범위도 유지한다.

## Scoped 설치 영수증 v4·기존 owned 파일 metadata 등록/복구

[scoped receipts v4](../contracts/scoped-installation-receipts-v4.md)의 순수 선언/validator와
capture/inspection, application projection·공통 engine·native prerequisite reader를 연결했다.
receipt v4 / declaration v3 / dependency snapshot v2는 Deployment State 번호와 별개다.
기존 v1/v2/v3는 자동 변환하거나 기록을 채우지 않고 그대로 읽는다.

origin ID는 kitId·canonical sourceRoot/targetRoot·scope/projectName으로 정한다. 관계는
originId·assetId·kind이며 동명 local/global, 다른 checkout을 구별한다. native alias는 원래
locator nativeId·경로·baseline을 유지한다. 논리 선언·전이 dependency의 header와 실제
revision/locator/binding을 기록하며 본문·접속 값은 저장하지 않는다. 숫자 ID/alias coercion,
duplicate/알 수 없는 origin, 빠진 mandatory pin·binding, 다른 scope 참조는 거절한다.

과거 v3 선언은 기대 origin과 실제 path template가 맞을 때만 읽기 투영한다. v3 Manifest의
단순 설치 closure도 비교하되 과거 digest로 증명할 수 없는 policy/harness metadata는
명시적 v4 audit가 필요하다. 미확인 snapshot은 provider가 나중에 생겨도 자동 승격하지 않는다.
자식 전이 provider를 부모에서 누락한 경우도 검사한다. 이 검사로 새/upsert v4 consumer의
소유만 보고 불완전 closure를 commit하던 회귀를 재현하고 차단했다. 순수 해제는 upstream
변경 때문에 막지 않는다.

scoped compiler의 private plan에 descriptor를 붙이고 journaled file/snapshot/path engine이
같은 application service로 영수증을 기록한다. 외부 origin descriptor는 실제 두 scope
잠금과 store-instance 세션이 있어야 하며 JSON flag/preview 제거로 권한을 만들지 못한다.
global 관측은 세션의 원장을 읽는다. public 계획/저장/적용 차단은 그대로 유지한다.

격리 시험은 기존 client 파일 bytes/mode를 유지한 metadata-only v4 등록과 index commit을
검증한다. 불완전 closure는 project commit 전에 거절한 뒤 reserved metadata를 복원한다.
v4 project commit 뒤 의도적으로 중단한 경우는 영수증·파일·pin을 검토해 active index를
완료하며 `unverified-after-recovery`/fulfilled false를 반환한다. 다른 MCP owner의 정상
변경은 provider anchor만 갱신하고 v4 semantic revision·consumer snapshot을 보존한다.

| 검사 | 결과/증거 |
|---|---|
| domain red | `/private/tmp/kit-pr10-scoped-receipts-domain-red.log`, 새 scoped module 부재 |
| type/shape red | `/private/tmp/kit-pr10-scoped-receipts-types-red.log`, 숫자 Tool ID/alias 및 malformed 입력 보완 |
| application red | `/private/tmp/kit-pr10-scoped-receipts-application-red.log`, 외부 원장 관측·private descriptor 연결 전 실패 |
| commit guard red | `/private/tmp/kit-pr10-scoped-receipts-coordination-red.log`, 불완전 closure가 commit된 사례 후 거절/복구 보완 |
| v4 native/global 호환 red | `/private/tmp/kit-pr10-scoped-receipts-native-v4-red.log`, 과거 버전 전용 reader/비교 보완 |
| Kit alias red | `/private/tmp/kit-pr10-scoped-receipts-alias-red.log`, `/private/tmp/kit-pr10-scoped-receipts-descriptor-alias-red.log` |
| v4 전용·기존 소유/복구 | 15 passed, `/private/tmp/kit-pr10-scoped-receipts-recovery-final.log` |
| 루트 전체 회귀 | 657 passed, `/private/tmp/kit-pr10-scoped-receipts-root-verified.log` |
| HTTP | 44 passed, `/private/tmp/kit-pr10-scoped-receipts-http.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr10-scoped-receipts-build.log` |

이전 source/target 별칭이 원래 origin으로 정규화되지 않던 사례는 compiler read port와
descriptor boundary 양쪽에서 canonicalize해 수정했다. 테스트는 선언·origin ID·pin의
동일성과 alias link inode 보존까지 확인한다. GUI/TypeScript/Rust/Cargo 소스는 바뀌지 않아
해당 test/typecheck/Cargo를 반복하지 않았으며 frontend/backend package build만 확인했다.

[실제 Codex 격리 왕복](codex-scoped-receipt-native-roundtrip-20261106.json)은 정확한 현재
binary SHA로 v4 metadata audit→Skill·선택 MCP Tool 목록→private verifier→설정 변경
무효화→원래 설정/외부 링크 복원을 확인했다. audit는 client bytes/mode를 바꾸지 않았고
선택하지 않은 provider는 시작하지 않았다. metadata-only에서 provider 시작 0, 모델/thread/
Tool 실행 요청 0이며 사용자 HOME/원장에 쓰지 않았다. 새 native capability를 승격하지 않는다.

[사용자 과거 영수증 읽기](scoped-receipts-live-compatibility-20261106.json)는 기존 schema 6,
145 transactions, 3 managed files/4 owners와 schema 2 영수증 4개의 소유 관측·원장 bytes를
유지했다. 기존 27개 경로 내용/mode·ego-browser 링크 identity를 보존했다. 과거 Codex
config inode/mtime 변경 1건은 이전과 동일하다.

[체크포인트](scoped-receipts-checkpoint-20261106.json)에 source/log/native/보존 증거를 고정한다.
이번 등록 시험은 기존 owned 파일의 metadata 경로다. 다음은 새/변경 consumer의 전체
after image/ownership state와 revision 예측, 공개 coordinator 등록/해제, 예정 설정 native
문맥 전환/재관측, 모든 global mutation/source 삭제/관리 해제 보호, saved plan·공개 복구/
validate/doctor다. 필요한 실제 교차 scope consumer 적용/복원과 PR07/09/11도 남아 있다.
공개 v3 적용과 저장은 이 gate를 모두 충족할 때까지 차단한다.

## 새·변경 설치 결과 예측과 실제 commit 전 대조 (2026-11-06)

[설치 예측 계약](../contracts/deployment-installation-prediction-v1.md)을 추가했다. readonly
compiler는 공통 Skill·지침과 typed Agent/MCP의 예정 파일·소유 기록·local/global 전이
pin을 메모리에서 합성한다. 같은 영수증 생성기를 bounded/no-follow 가상 읽기에 연결해
실제 적용 전에 새 consumer revision과 역참조 reference를 계산한다. 실제 파일/트리
엔진도 내용·after image·관리 기록 계산을 공유하고 commit 전에 semantic revision과
전체 target fingerprint를 대조한다. 공개 응답에는 본문 없이 revision/locator digest만 추가한다.

새 provider/consumer, MCP·지침·Skill 갱신, unpublished snapshot과 혼합 파일 적용을
내부 coordinator/임시 client 환경에서 확인했다. fixture의 native verifier는 합성이며 실제
client 지원이나 모델 사용 증거가 아니다. 실제 사용자 환경에서는 읽기만 수행했다.

TDD에서 예측 부재, umask 변경 전에 잠금이 생성되던 사례, 가상/실제 Skill 디렉터리
정렬 차이를 실패로 기록하고 보완했다. private 계획/생성 권한 변경은 쓰기 전에 거절하고,
검증 callback 중 선언이 달라지면 commit을 거절하며 새 파일을 복원한다. 미관리 Skill
잔여 파일과 local 설치 증거 누락은 양성 예측을 차단한다. public clone은 private seal과
분리되며 기존 v1/v2 적용에는 새 bounded image 읽기를 강제하지 않는다.

| 검사 | 결과/증거 |
|---|---|
| 초기 red | `/private/tmp/kit-pr10-prediction-red.log` |
| 생성 권한/잠금 red | `/private/tmp/kit-pr10-prediction-boundaries.log` |
| 디렉터리 순서 red | `/private/tmp/kit-pr10-prediction-directory-order-red.log` |
| compiler 집중 | 20 passed, `/private/tmp/kit-pr10-prediction-compiler-sealed.log` |
| 영수증/coordinator/snapshot/기존 서비스 회귀 | 76 passed, `/private/tmp/kit-pr10-prediction-regression.log` |
| 최종 루트 회귀 | 666 passed, `/private/tmp/kit-pr10-prediction-root-final.log` |
| 최종 HTTP | 44 passed, `/private/tmp/kit-pr10-prediction-http-final.log` |
| 최종 desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-prediction-build-final.log` |

GUI/TypeScript/Rust 소스는 바꾸지 않아 GUI test/typecheck/Cargo는 반복하지 않았다.
[사용자 읽기 호환 검사](deployment-prediction-live-compatibility-20261106.json)는 기존 schema 6,
145 transactions, managed 3/owners 4, active schema 2 영수증 4개의 소유 관측과 원장 hash를
유지한다. 27개 경로의 내용/권한·ego-browser 링크 identity를 보존하며, 기존 Codex config의
inode/mtime 차이 1건은 이전 체크포인트와 같다. client/native/model/Tool 호출은 0이다.

[체크포인트](deployment-prediction-checkpoint-20261106.json)에 최종 source/log/보존 증거를
고정한다. 공개 v3 실행/저장, native 원형/과거 경로 이관의 예측, 모든 mutation의 영향 보호,
예정 설정 native 문맥 전환/재관측, 공개 등록/해제·저장 계획·복구·validate/doctor와 필요한
실제 교차 scope consumer 적용/복원은 남아 있다. PR07/09/11과 추가 C07 Skill 호환성 요구도
별도로 추적하며 이 내부 예측의 성공을 전체 계획 완료로 합산하지 않는다.

## 원본 제거/등록 경합 보호·기존 writer 회귀·v4 역참조 (2026-11-06)

[원본 의존성 보호 계약](../contracts/source-dependency-guards-v1.md)을 연결했다. 순수 domain은
전역 asset의 before/after identity 제거를 계산하고 application은 canonical sourceRoot·Kit ID·
kind/asset ID와 전역 index pin을 대조한다. 일반 Manifest 삭제/범위 이동과 imported native 원본
관리 해제는 계획/적용 양쪽에서 거절하며 관련 없는 원본은 계속 삭제할 수 있다. 본문 편집과
출처 갱신을 설치 제거로 간주하지 않는다.

Kit source lock을 잡은 writer는 전역 deployment lock/journal과 최신 index를 재검사한다.
coordinator도 전역 lock 안에서 필수 pin의 현재 전역 선언과 Kit source lock/journal을
확인한다. 두 잠금 순서를 실제 임시 파일에서 시험했다. source lock을 먼저 잡거나 전역
lock을 먼저 잡는 경우 모두 충돌을 거절한다. 계획 후 등록/원본 삭제, 적용 중 수동 삭제도
검사하며 수동 원본 변경은 보존하고 client 변경·reserved metadata만 기존 복구로 되돌린다.

역참조 조회의 schema 3 전용 조건을 v3/v4로 고쳤다. 새 writer 권한은 만들지 않았고
기존 state 8 차단을 removal·saved execution·resource path migration·snapshot 변경과
native apply/ownership detach에서도 확인했다. 현재는 무관한 전역 client 변경도 일반
writer로 실행할 수 없으며 선택적 영향 조정과 공개 dispatch는 후속이다.

| 검사 | 결과/증거 |
|---|---|
| v4 역참조 reader red | `/private/tmp/kit-pr10-mutation-v4-reader-verified-red.log` |
| 원본 삭제/등록 경합 red | `/private/tmp/kit-pr10-source-mutation-red.log`, 네 사례에서 예외 누락 |
| native 원본 detach/API 상태 red | `/private/tmp/kit-pr10-source-detach-http-red.log` |
| 사라진 sourceRoot의 안정적 오류 red | `/private/tmp/kit-pr10-source-missing-origin-red.log` |
| 집중 회귀 | 90 passed, `/private/tmp/kit-pr10-source-mutation-guards-final-focused.log` |
| 최종 루트 회귀 | 679 passed, `/private/tmp/kit-pr10-source-guards-root-final.log` |
| 최종 HTTP | 45 passed, `/private/tmp/kit-pr10-source-guards-http-final.log` |
| 최종 desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-source-guards-build-final.log` |

[사용자 원장 읽기](source-guards-live-compatibility-20261106.json)는 schema 6·145 transactions·
managed 3/owners 4와 active schema 2 영수증 4개의 소유 관측을 유지한다. 내용/권한·ego-browser
링크를 포함한 27개 경로를 보존했다. 이전 Codex config inode/mtime 차이 1건은 동일하며
이번 단계의 실제 native/model/Tool 호출과 사용자 파일 쓰기는 0이다. GUI/TypeScript/Rust
소스를 바꾸지 않아 GUI test/typecheck/Cargo는 반복하지 않았다.

[최종 체크포인트](source-guards-checkpoint-20261106.json)에 source/log/보존 증거를 고정한다.
공개 v3 실행/저장·등록/해제, 선택적 global mutation 조정, 예정 native 설정 문맥/재관측,
native 원형/이관 예측, 공개 저장 계획·복구·validate/doctor와 실제 교차 scope consumer 왕복은
남아 있다. PR07/09/11과 C07 Skill 호환성 작업도 별도이며 전체 계획을 완료로 표시하지 않는다.

## Pin을 보존하는 선택적 전역 변경 내부 집행·검토 복구 (2026-11-06)

[전역 변경 내부 계약](../contracts/global-dependency-mutation-v1.md)을 추가했다. 실제 index의
모든 pin·프로젝트 원장/consumer 소유권과 native 설정 문맥을 읽고, 공통 after-state 예측과
impact evaluator로 영향 여부를 계산한다. 관련 없는 전역 지침과 snapshot 전환은 내부
session에서 허용하고 pin 변경/미확인 프로젝트와 native 설정 문맥 전환은 계속 차단한다.
프로젝트 원장·index를 쓰거나 원래 provider의 이름/원형/baseline을 바꾸지 않는다.

실행 전 locked 재계산과 commit 직전 재관측을 연결했다. 임의 nextState commit·검토하지
않은 target을 허용하지 않으며 기존 runtime preflight/beforeCommit도 실행한다. native pin은
실제 locator/revision을 기준으로 찾는다. 다른 layout의 미소유 영수증 때문에 원래 pin을
놓치거나 더 새로운 definition의 다른 설치로 문맥 검사를 대신하지 않도록 교정했다.

scalar/tree journal에 index/project/context guard를 보관하고 private 검토 복구에서 같은
검사를 적용한다. scalar에는 검토한 권한과 배타적으로 생성한 새 파일의 inode도 기록한다.
수동 프로젝트 변경·권한 변경·동일 내용 다른 inode의 새 파일 교체·native 설정 변경은 보존한다.
기록 확정 전/후 SIGKILL과 복구 자체의 재중단, 동일 host에서 실패한 owner의 검토 복구를
확인했다. 살아 있는 정상 owner는 JSON flag로 복구 권한을 만들 수 없다.

| 검사 | 결과/증거 |
|---|---|
| 초기 경로 red | `/private/tmp/kit-pr10-global-mutation-red.log` |
| 권한/기존 runtime hook red | `/private/tmp/kit-pr10-global-mutation-modes-hooks-red.log` |
| layout/definition 구분 red | `/private/tmp/kit-pr10-global-mutation-profile-borrow-red.log`, `/private/tmp/kit-pr10-global-mutation-pin-layout-red.log` |
| stale ownership 계획 red | `/private/tmp/kit-pr10-global-mutation-stale-red.log` |
| global/기존 coordinator·snapshot·saved 회귀 | 105 passed, `/private/tmp/kit-pr10-global-mutation-final-regression.log` |
| 최종 루트 회귀 | 697 passed, `/private/tmp/kit-pr10-global-mutation-root-final.log` |
| 최종 HTTP | 45 passed, `/private/tmp/kit-pr10-global-mutation-http-final.log` |
| 최종 desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-global-mutation-build-final.log` |

새 global test 18개는 임시 filesystem의 실제 적용/복원과 합성 등록 데이터를 사용한다.
실제 native/model/Tool 호출은 하지 않았으며 기존 native 지원 조합을 승격하지 않는다.
GUI/TypeScript/Rust 소스 변경이 없어 GUI test/typecheck/Cargo는 반복하지 않았다.
[사용자 읽기 호환 검사](global-mutation-live-compatibility-20261106.json)는 기존 schema 6·
145 transactions·managed 3/owners 4·active schema 2 영수증 4개의 소유 관측을 유지했다.
27개 경로의 내용/권한과 ego-browser 링크 identity를 보존했고 이전 Codex config inode/mtime
차이 1건도 동일하다. 사용자 환경에는 새 index/등록/설치 쓰기를 하지 않았다.

[최종 체크포인트](global-mutation-checkpoint-20261106.json)에 source/log/보존 증거를 고정한다.
이 모듈은 공개 dispatch에 연결하지 않았으므로 기존 일반 state 8 writer와 Manifest v3
공개 적용/저장은 계속 차단된다. 공개 global/scoped 적용·등록/해제·saved/복구,
global rollback/이관 영향과 native 원형 예측, 예정 native 설정 문맥의 실제 전환/재관측,
validate/doctor·실제 교차 scope consumer 왕복과 PR07/09/11·C07은 남아 있다.

## 기존 전역 계획의 공개 집행·저장 재개·rollback·복구 연결 (2026-11-06)

위 내부 집행의 후속으로 [전역 변경 계약](../contracts/global-dependency-mutation-v1.md)을
기존 Manifest v1/v2 공통 서비스에 연결했다. 전역 apply/remove와 정상 rollback도 pin·
전체 프로젝트 원장·native 설정 문맥을 대조한다. pin 제거/교체·미확인 프로젝트·native
설정 전환·과거 경로/연결/공유 소유권 이관은 계획에서 차단한다. HTTP 409와 GUI의
`dependencyProtection` 표시/승인 차단도 같은 application 결과를 사용한다.

저장 계획 schema 4는 global mutation digest를 보관하고 재시작 후 원본·설치·소유권·
모든 프로젝트 문맥과 보조 native 정의까지 다시 계산한다. 기존 저장 schema 1/2/3의
digest를 바꾸지 않는다. rollback은 백업 파일/tree·정확한 이전 managed map·원래 apply의
rolled-back 상태를 예측하고 실제 transaction 관계까지 commit 전에 대조한다.
보호된 scalar 적용 이력의 권한도 기록하여 수동 chmod를 정상 rollback이 덮어쓰지 않는다.

공개 복구는 실제 global journal의 guard가 있으면 같은 private 검증 경로를 사용한다.
일반 적용과 저장 실행, scalar/tree rollback 각각 commit 전/후 SIGKILL을 검증했다.
복원된 저장 시도는 재승인이 필요하고 이미 확정된 결과 재조회는 다시 쓰지 않는다.
실제 CLI도 임시 HOME·합성 profile에서 dry-run→저장→다른 process의 재개→rollback을
실행했다. CLI fixture의 정의 디렉터리 링크는 기존 no-follow 보호로 차단되어 실제 파일
사본으로 교정했다. 제품의 링크/경로 보호를 완화하지 않았다.

| 검사 | 결과/증거 |
|---|---|
| 저장/정상 rollback/복구 연결 red | `/private/tmp/kit-pr10-global-dispatch-work1.log` |
| GUI 상태/오류 응답 red | `/private/tmp/kit-pr10-global-dispatch-gui-red.log`, `/private/tmp/kit-pr10-global-dispatch-errors-red.log`, `/private/tmp/kit-pr10-global-dispatch-http-red.log` |
| 최초 focused 회귀 | 109 passed, `/private/tmp/kit-pr10-global-dispatch-focused1.log` |
| 최종 루트 회귀 | 718 passed, `/private/tmp/kit-pr10-global-dispatch-root-verified.log` (새 공개 경로 20개 포함) |
| 최종 HTTP | 48 passed, `/private/tmp/kit-pr10-global-dispatch-http-final.log` |
| 최종 GUI | 77 passed, `/private/tmp/kit-pr10-global-dispatch-gui-final.log` |
| 최종 TypeScript·desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-global-dispatch-typecheck-final.log`, `/private/tmp/kit-pr10-global-dispatch-build-final.log` |

Rust 소스는 바꾸지 않아 Cargo를 반복하지 않았다. 실제 사용자 환경의 native/model/Tool
호출과 client 파일 쓰기도 0회다. [사용자 읽기 호환 검사](global-dispatch-live-compatibility-20261106.json)는
schema 6/145 transactions·managed 3/owners 4·기존 native 영수증 4개의 소유 관측을 유지한다.
기존 27개 경로의 내용/권한과 ego-browser 링크 identity를 보존했으며 앞선 Codex config의
내용/권한이 같은 inode/mtime 차이 1건도 동일하다. 사용자 원장을 승격하지 않았다.

[체크포인트](global-dispatch-checkpoint-20261106.json)에 source/log/보존 증거를 고정한다.
공개 v3/scoped 집행/저장·등록/해제·두 scope 복구, native 원형/이관 예측·예정 native 문맥
전환/재관측·validate/doctor 전환과 실제 consumer 왕복은 남아 있다. PR07/09/11과
C07의 Skill 대상·호환성·variant는 별도 미완료다.

## 예정 프로젝트 설정의 native 재관측과 async 내부 집행 (2026-11-06)

[문맥 전환 계약](../contracts/native-context-transition-v1.md)을 추가했다. 현재 positive 관측을
private target before/after 검토에 연결하고 실제 프로젝트 변경 후 config/Skill/선택 MCP를
다시 관측해야 after verifier가 통과한다. 그 사이 native 문맥·실행 파일·정의/보조 정의·
pin 또는 계획하지 않은 파일이 달라지면 거절한다. no-op는 기존 proof를 재사용한다.
동명 활성 Skill이 다른 경로에 나타나면 global pin의 가림 가능성을 차단한다.

동기와 async apply/tree/coordinator가 같은 generator workflow를 공유한다. async validation을
기다리는 동안 global→project 잠금과 WeakMap session이 유지되며 최종 commit에서 native after
proof를 확인한다. sync API에 Promise를 주면 거절한다. 대기 중 lock 교체는 journal과 새 owner를
보존하고, 수동 원장 편집은 보존하며 안전한 client 변경만 되돌린다. async 경로 이관은 차단한다.

실제 Codex 격리 검증은 첫 시도에서 적용/재관측/등록까지 통과했으나 제거 검증 스크립트의
`plans` 인자 누락으로 끝났다. 이를 교정한 두 번째 시도에서 등록 해제와 설정값/권한 복원은
통과했지만 프로젝트 파일에 생성된 빈 줄이 남았다. 회귀 테스트로 고정하고 최초 설치의 파일이
그대로이며 이전 소유 항목이 없고 백업/사용자 내용이 같은 경우에만 원래 표현을 복원하도록
보완했다. 수동 편집이나 갱신 이력의 과거 설정을 임의로 덮어쓰지 않는다.

세 번째 [실제 왕복 증거](codex-native-context-transition-roundtrip-20261106.json)는 Codex
0.166.0-alpha.6에서 v4 global Skill·선택 MCP 발견→프로젝트 Agent/별도 MCP 파일 적용→
global 전제 재발견→등록 해제→프로젝트 바이트·권한과 global 설정/외부 링크 복원을 확인한다.
선택 MCP의 initialize/tools/list만 수행했다. 다른 provider 시작·모델/thread 요청·Tool 실행은
0회이며 consumer 활성/Agent 자식 완료를 주장하지 않는다. 공개 v3 gate는 계속 닫혀 있다.

| 검사 | 결과/증거 |
|---|---|
| transition API red | 4개 실패, `/private/tmp/kit-pr10-native-transition-red.log` |
| 동명 Skill 가림 red | `/private/tmp/kit-pr10-native-transition-shadow-red.log` |
| 잠금 교체·수동 원장 편집 red | `/private/tmp/kit-pr10-native-transition-lease-red.log`, `/private/tmp/kit-pr10-native-transition-ledger-red.log` |
| 최초 제거 후 표현 차이 red | `/private/tmp/kit-pr10-native-transition-exact-removal-red.log` |
| native transition/제거/전역 공개 경로 회귀 | 59 passed, `/private/tmp/kit-pr10-native-transition-restoration-focused2.log` |
| 최종 루트 | 733 passed, `/private/tmp/kit-pr10-native-transition-root-verified.log` |
| 최종 HTTP | 48 passed, `/private/tmp/kit-pr10-native-transition-http-verified.log` |
| 최종 desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-native-transition-build-verified.log` |

첫 HTTP 실행의 기존 native 설치 시험 1건은 ETIMEDOUT이었다. 다른 검사 종료 후 같은 전체
시험이 48/48 통과했으며 이 timeout을 이유로 제품 로직이나 timeout을 완화하지 않았다.
frontend/TypeScript/Rust 소스를 바꾸지 않아 GUI/typecheck/Cargo는 반복하지 않았다.
새 native 관련 시험 13개와 최초 제거 시험 2개가 최종 root에 포함된다. 실제 native 관측은
세 시도 합계 7회(3+2+2)이고 모델/Tool 실행은 없다. 사용자 HOME/client 쓰기는 0회다.

[사용자 읽기 호환 검사](native-transition-live-compatibility-20261106.json)는 schema 6/145 이력·
managed 3/owners 4와 기존 native 영수증 4개를 유지한다. 27개 경로의 내용/권한과 외부 링크
identity를 보존했고, 이전부터 있던 Codex config의 내용/권한이 같은 inode/mtime 차이도 동일하다.
[체크포인트](native-transition-checkpoint-20261106.json)에 source/log/실제 관측 증거를 고정한다.

공개 v3 집행/저장·관측 선택·등록/해제/두 scope 복구·validate/doctor와 모든 native/과거 경로
writer의 영향 예측, 전역 설정 변경 후 각 등록 프로젝트 문맥 전환은 후속이다. PR07/09/11과
C07의 Skill client 호환성·variant, 실제 consumer 활성/모델 응답도 별도로 남아 있다.

## 공개 v3 계획·관측·저장 재개·적용/제거와 두 scope 복구 (2026-11-06)

[공개 실행 계약](../contracts/scoped-deployment-execution-v1.md)을 추가하고 기존 서비스에
`scoped-apply`/execution 상태를 연결했다. 전역은 기존 global 보호, 프로젝트는 필요한 전역
전제가 있으면 coordinator를 사용한다. CLI/HTTP/GUI가 같은 private 준비물과 관측을 사용한다.
known unsupported gate를 제거하거나 JSON의 positive flag로 집행하지 않는다.

선택한 변경 외에도 기존 등록 consumer와 frozen global Tool binding을 유지한다. 로컬
설정만 바꿔도 기존 전제를 다시 관측하며 unselected consumer 파일은 재배포하지 않는다.
직접 Agent Tool 제한은 기존 `AGENT_POLICY_MAPPING_UNSUPPORTED` gate를 유지한다. 그 경계를
우회하지 않고 Skill의 논리 Tool 요구→global provider binding으로 retained 회귀를 검증했다.
선언에서 전역 참조를 뺀 활성 consumer와 의존성 전환이 없는 일반 프로젝트 rollback은
계획에서 차단한다. 실제 consumer 제거를 증명한 v3 제거는 관계도 함께 해제한다.

저장 계획 v5는 재시작 후 원본/target/원장/origin을 재계산하고 새 native 관측과 안정된
문맥 review digest를 대조한다. schema 1~4의 기존 reader를 유지하되 v3 replay를 오래된
저장 계약으로 위장하는 요청은 거절한다. claim의 PID/nonce/inode를 async 실행이 끝날
때까지 보유하며 교체/만료/수동 편집을 commit 전에 확인한다. 새 claim owner를 지우지 않는다.

공개 프로젝트 복구는 실제 global schema 4 journal과 요청 origin을 대조한다. 저장 실행의
project state 확정 전/후 SIGKILL에서 복원/확정 유지와 completed/recovered receipt를 확인했다.
이미 완료된 같은 saved digest는 재실행하지 않는다. HTTP는 async 결과를 기다리며 mutation
session을 유지한다. GUI는 native 확인과 MCP Tool metadata 조회를 명시적으로 선택하고,
실행 verdict가 없거나 미확인인 scoped 응답은 automatic flag와 무관하게 승인/저장을 막는다.

| 검사 | 결과/증거 |
|---|---|
| 공개 서비스 red | `/private/tmp/kit-pr10-scoped-public-red.log` |
| 저장/복구 red | `/private/tmp/kit-pr10-scoped-public-save-recovery-red.log` |
| claim 교체·저장 계약 위장 red | `/private/tmp/kit-pr10-scoped-public-claim-red.log`, `/private/tmp/kit-pr10-scoped-public-contract-red.log` |
| 미지원 rollback 사전 차단 red | `/private/tmp/kit-pr10-scoped-public-rollback-gate-red.log` |
| GUI verdict 누락 red | `/private/tmp/kit-pr10-scoped-public-verdict-red.log` |
| scoped/기존 저장/전역/역참조 focused | 65 passed, `/private/tmp/kit-pr10-scoped-public-final-focused.log` |
| 최종 루트 | 748 passed, `/private/tmp/kit-pr10-scoped-public-root-final.log` |
| 최종 HTTP | 49 passed, `/private/tmp/kit-pr10-scoped-public-http-final.log` |
| 최종 GUI | 80 passed, `/private/tmp/kit-pr10-scoped-public-gui-verified.log` |
| 최종 typecheck·desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-scoped-public-typecheck-verified.log`, `/private/tmp/kit-pr10-scoped-public-build-verified.log` |

새 공개 서비스 시험 15개는 저장·retained provider·제거와 source/context 변경, claim 교체,
일반 rollback gate, 구버전 위장 및 두 SIGKILL 경계를 포함한다. 기존 기본 v1/v2 동작과
CLI/GUI 호환을 유지하며 Rust 소스 변경이 없어 Cargo는 반복하지 않았다.

[실제 공개 CLI 왕복](scoped-public-codex-cli-roundtrip-20261106.json)은 Codex 0.166.0-alpha.6과
격리 HOME에서 공개 전역 v3 감사→프로젝트 계획/관측→저장 v5→다른 process 재개/재관측→
중복 실행 방지→등록 해제와 정확한 프로젝트/전역 설정 바이트·권한·외부 링크 복원을 확인했다.
private gate 제거 없이 실행했으며 이번 실제 native 전제 관측은 3회다. 선택한 mock MCP의
initialize/tools/list만 수행했고 미선택 provider 시작·model/thread·Tool 실행은 0회다.

[사용자 읽기 호환 검사](scoped-public-live-compatibility-20261106.json)는 schema 6/145 이력·
managed 3/owners 4와 기존 native 영수증 4개, pending 0과 원장 hash를 유지한다. 원래 27개
보존 기준 중 `.gemini/config/config.json` 1개는 내용 hash가 달라졌다. 파일 mode/크기는 같고
mtime은 02:09:40 UTC이며 Antigravity 앱 시작(02:09:37 UTC) 직후다. 이번 첫 테스트(02:11)
및 실제 CLI 검증(02:33)보다 앞선다. [읽기 전용 관측 기록](scoped-public-external-settings-observation-20261106.json)에
이를 남겼다. 작성 프로세스는 입증하지 못했으며 앱 시작 관련 변경이라는 판단은 추론이다.
현재 값을 덮어쓰거나 원래 baseline을 갱신하지 않았다. 나머지 26개 기준과 외부 링크 identity,
Kit 관리 파일은 유지했고 이전 Codex config의 내용/권한이 같은 inode/mtime 차이도 동일하다.

[체크포인트](scoped-public-checkpoint-20261106.json)는 이 보존 차이를 성공으로 숨기지 않고
별도로 기록한다. 사용자 HOME의 index 승격/client 쓰기는 하지 않았다. 프로젝트 의존성
rollback/참조 해제 전환 확장, native 원형/과거 경로 이관·전역 설정 문맥 전환·v3 진단/원본
편집, PR07/09/11·C07와 별도 consumer 활성/모델 응답 검증은 남아 있다.


## 공개 프로젝트 rollback·참조 해제·소유 snapshot 전환 (2026-11-06)

이전 공개 단계가 막았던 정상 rollback을 [별도 계약](../contracts/scoped-deployment-rollback-v1.md)으로
연결했다. 현재 editable Manifest 대신 복원 후 유효해질 v4 설치 영수증의 frozen closure와
현재 전역 설치 revision/locator/binding을 사용한다. 등록이 released인 제거 rollback도
원래 consumer를 재등록하며, 복원 provider가 drift/미확인이면 계획을 차단한다.

전역 참조를 없앤 새 local 설치 선언은 실제 v4 영수증과 예측 대조를 통과한 경우 파일을
유지하고 관계만 해제한다. source 수정이나 owner 삭제를 제거 증거로 대신하지 않는다.
public dependencyTransition에 해제할 consumer와 변경 후 관계 수를 표시하고 GUI에서도
승인 전에 보여 준다. 마지막 관계 해제에는 불필요한 native 관측을 추가하지 않는다.

file/tree rollback은 기존 동기 API와 같은 generator 단계를 공유하고 async 실행만 native
재관측을 기다린다. private session의 rollbackTransactionId, 원래 apply 상태/rolledBackBy,
예측한 전체 managed map·after image와 실제 commit을 대조한다. 외부 링크는 계속 거절하고,
이미 Kit 소유인 snapshot 링크는 원장·v4 영수증·immutable snapshot을 증명한 경우에만
전환한다. before verifier는 그 소유 기록과 snapshot을 다시 검사한다.

saved schema 5에 rollback/planRollback을 추가해 재시작 때 현재 예측과 fresh native proof를
재생성한다. 기존 schema 1–4와 일반 rollback 오류 코드는 유지한다. HTTP rollback도 같은
Promise 결과/오류를 기다린다. GUI는 의존성 전환에 execution verdict가 없으면 승인을 막는다.

검증은 아래 기록으로 구분한다. 합성 profile은 production 지원 근거로 승격하지 않는다.

| 검증 | 결과/기록 |
|---|---|
| 초기 구현 red | `/private/tmp/kit-pr10-scoped-rollback-red.log`, 첫 4개 행동 모두 실패 |
| 선언만 해제 red | `/private/tmp/kit-pr10-scoped-release-red.log`, 기존 release gate 재현 |
| 소유 snapshot·동시 편집 경계 | `/private/tmp/kit-pr10-scoped-rollback-work3.log`, 외부 링크와 소유 링크 구분 보완 |
| GUI 관계 표시·verdict 누락 red | `/private/tmp/kit-pr10-scoped-rollback-gui-red.log`, `/private/tmp/kit-pr10-scoped-rollback-verdict-red.log` |
| 기존 rollback 오류 코드 회귀 | `/private/tmp/kit-pr10-scoped-rollback-root-work1.log`, 기존 `ROLLBACK_PLAN_BLOCKED` 보존으로 교정 |
| 최종 루트 | 761 passed, `/private/tmp/kit-pr10-scoped-rollback-root-final.log` |
| 최종 HTTP | 50 passed, `/private/tmp/kit-pr10-scoped-rollback-http-final.log` |
| 최종 GUI | 83 passed, `/private/tmp/kit-pr10-scoped-rollback-gui-final.log` |
| 최종 typecheck·desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-scoped-rollback-typecheck-final.log`, `/private/tmp/kit-pr10-scoped-rollback-build-final.log` |

새 rollback 시험 13개는 첫 설치 정확한 복원, 이전 revision, 제거 복원, 저장 재시작/중복
실행 방지, local 선언 전환·참조 해제, frozen Tool 요구와 명시적 MCP 조회, after 관측 실패,
await 중 양쪽 잠금·수동 설정 보존, project-state-prepared/project-committed의 실제 SIGKILL
복구, 소유 snapshot 링크와 drift provider의 미등록 consumer 복원 차단을 검증한다.
HTTP 첫 sandbox 실행의 local listen EPERM은 제품 실패와 구분했고, 인가된 로컬 테스트
포트 환경에서 전체 50개 시험을 다시 통과했다. CLI 도움말도 rollback 관측 옵션을 표시한다.

[실제 공개 CLI 왕복](scoped-rollback-codex-cli-roundtrip-20261106.json)은 검토된 Codex
0.166.0-alpha.6, SHA `508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44`와
격리 HOME에서 한 번 성공했다. 최초 적용/제거 후 rollback 계획·저장 v5·다른 process의
재개/재관측·중복 재개와 최초 설치 rollback까지 수행했다. native 관측과 선택된 로컬
fixture MCP 시작/목록 조회는 각 6회다. 미선택 provider 시작·모델/thread 요청·Tool 실행은
0회이며 client 지원 행렬이나 consumer/Agent 활성 증거를 확장하지 않는다.

[사용자 읽기 호환 검사](scoped-rollback-live-compatibility-20261106.json)는 schema 6,
145 이력·3개 파일·4개 owner와 이전 원장 hash를 유지했고 pending 0, 관리 내용 일치를
확인했다. 원래 27개 baseline에서는 이전 단계의 Antigravity 설정 차이 1건만 남는다.
그 파일은 이전 읽기 관측의 hash/권한을 유지하며 현재 값은 쓰거나 복원하지 않았다.
기존 Codex config inode/mtime 차이도 그대로 기록하고 다른 26개 경로·외부 링크 identity와
원래 baseline을 보존했다. 이 단계의 사용자 client 파일/원장 쓰기는 0이다.

[체크포인트](scoped-rollback-checkpoint-20261106.json)는 완료된 공개 rollback 범위와 남은
native 원형/이관 영향 예측, 전역 설정의 프로젝트별 문맥 전환, v3 진단/원본 편집,
PR07/09/11·C07, 별도 consumer 활성/모델 응답 증거를 분리한다. 전체 계획은 진행 중이다.


## Source 문맥의 v3 검증·읽기 전용 진단·일반 선언 CRUD (2026-11-06)

[원본 관리 계약](../contracts/scoped-manifest-management-v1.md)을 구현했다. source-only
문맥은 실제 checkout/targetRoot를 만들지 않고 전역·프로젝트 참조를 검증한다. 이전 single
scope reader와 저수준 v3 기본 차단은 유지하며 공통 서비스가 명시적으로 v3를 읽는다.
일반 registry/resource/dependency 조회도 연결했고 external node는 origin별 key를 유지한다.

validate는 기존 pure graph의 참조·Tool provider·scope·정책·cycle과 closure의 안전한
source를 대조한다. source 검증이 설치·native 발견을 의미하지 않도록 deploymentReady와
fulfilled는 false다. doctor는 기존 버전도 쓰기 시험을 제거하고 접근 권한만 확인한다.
v3 client 선택 시 같은 공개 planner로 검사한 뒤 임시 계획을 폐기하며 native 관측이나
MCP/model/Tool 실행을 자동으로 시작하지 않는다.

원본 mutation batch의 최종 graph를 검증하며 동일 ID 교체의 client 대상 선택을 보존한다.
최종 원본에서 사라진 ID만 targets에서 해제하고 신규 자원을 임의로 client에 활성화하지
않는다. 구버전 전역 source도 알려진 미설치 v3 프로젝트 선언에 새 오류를 만들 수 없다.
같은 선언 검사를 공통 source guard에 연결해 native import detach의 우회를 차단한다.
설치 index가 있는 identity 제거는 기존 GLOBAL_SOURCE_IN_USE 보호를 우선한다.

peer 원본의 hash/mode/inode와 문맥 집합을 고정하고, companion lock과 선택 source
transaction 안에서 쓰기 전후 검증한다. 원본/잠금 교체는 선택 source를 안전하게 복원하고
다른 owner의 lock은 유지한다. 자기 lock을 잃어 복원이 증명되지 않으면 journal을 남긴다.
공개/입력 mutation alias를 private command와 분리하고 source planId의 배포 사용도 막는다.

CLI에는 manifest-edit --mutations <json-file> [--dry-run]을 추가했다. HTTP mutation
session과 기존 endpoints를 유지하며 GUI는 v3 전체 JSON·named scope·qualified 참조를
보존한다. 일반 선언의 지원과 이미 편입된 native source의 미지원 v3 사본/갱신·설치 흐름을
분리하며 후자의 gate는 유지한다. 실제 브라우저 통합 검증을 구성요소 시험으로 대신하지 않는다.

| 검증 | 결과/기록 |
|---|---|
| 첫 source/진단/편집 red | `/private/tmp/kit-pr10-scoped-management-red.log`, 최초 6개 실패 |
| source lock 교체 red | `/private/tmp/kit-pr10-scoped-management-lock-red.log` |
| 구버전 전역 선언 보호 red | `/private/tmp/kit-pr10-scoped-management-legacy-global-red.log` |
| GUI JSON·CLI 명령 red | `/private/tmp/kit-pr10-scoped-management-gui-red.log`, `/private/tmp/kit-pr10-scoped-management-cli-red.log` |
| 동일 ID target/최종 batch red | `/private/tmp/kit-pr10-scoped-management-target-preservation-red.log`, `/private/tmp/kit-pr10-scoped-management-final-batch-red.log` |
| 쓰기 중 companion lease 교체 red | `/private/tmp/kit-pr10-scoped-management-companion-lease-red.log` |
| 최종 집중 source 시험 | 20 passed, `/private/tmp/kit-pr10-scoped-management-focused-complete.log` |
| 최종 루트 | 781 passed, `/private/tmp/kit-pr10-scoped-management-root-complete.log` |
| 최종 HTTP | 51 passed, `/private/tmp/kit-pr10-scoped-management-http-complete.log` |
| 최종 GUI | 86 passed, `/private/tmp/kit-pr10-scoped-management-gui-work2.log` |
| 타입 검사·desktop frontend/backend build | 통과, `/private/tmp/kit-pr10-scoped-management-typecheck-work2.log`, `/private/tmp/kit-pr10-scoped-management-build-complete.log` |

source 시험은 source-only/qualified/bare 동명·checkout 없는 검증, 무쓰기 doctor,
선언 CRUD·일괄 삭제와 동일 ID target 유지, metadata alias/배포 권한 분리, peer 원본·잠금
교체 전/후와 journal/현재 값 보존, 기존 native detach의 미설치 참조 보호, 실제 CLI
validate/doctor/manifest-edit의 source 변경과 client 무변경을 확인한다. 기존 경로 이관
시험은 동작 검사를 통과했지만 cleanup 시 이미 없는 임시 디렉터리의 ENOENT가 발생해
fixture cleanup을 멱등으로 보완했다. 다른 filesystem 오류와 실제 동작 검사는 유지한다.

[실제 기본 Kit 읽기 진단](scoped-management-existing-kit-diagnostics-20261106.json)은
원본 validation과 OS 권한 기준 doctor를 통과했고 CLIENT_NOT_SELECTED는 warning으로
남겼다. sandbox 안의 첫 조회는 TARGET_PATH_READ_ONLY였으며 실제 OS 권한을 읽는
승인된 읽기 전용 실행과 구분했다. 두 실행 모두 원본/원장/metadata 존재를 유지했고
binary/native/model/Tool 호출 0이다. client 사용/지원 승격의 증거로 사용하지 않는다.

[사용자 읽기 호환 검사](scoped-management-live-compatibility-20261106.json)는 schema 6,
145 이력·3개 파일·4개 owner와 원장 hash를 유지했고 pending 0·관리 파일 내용 일치를
확인했다. 원래 27개 baseline과 비교한 차이는 기존 Antigravity 설정 1건뿐이며 그 현재
hash/권한과 ego-browser 링크 identity를 유지했다. 원래 baseline을 바꾸거나 외부 설정을
복원하지 않았다. [체크포인트](scoped-management-checkpoint-20261106.json)에 원본/시험/log
hash와 이 보존 한계를 분리했다.

남은 PR10 범위는 native 원형/과거 경로 writer 및 편입된 원본의 v3 수명주기와 전역 설정
변경 후 각 등록 프로젝트의 실제 native 전환이다. PR07/09/11·C07 호환성/variant와 실제
consumer 활성·모델 응답 증거도 남아 있으며 전체 계획을 완료로 표시하지 않는다.
