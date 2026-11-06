# PR08 과거 설치 경로 이관 (2026-11-06)

**명시적 경로 이관과 양쪽 위치의 rollback·중단 복구를 공통 service, CLI·HTTP·GUI에
구현했다.** [이관 계약](../contracts/resource-path-migration-v1.md). PR07의 미관측
Antigravity Agent를 활성화하지 않으며, 기존 제거 API의 현재 경로 검사를 해제하지 않는다.
제공하는 client definition의 경로나 native 지원 범위를 확대하지 않는다.

## 첫 안전 검사 단계의 재현과 수정

client definition의 네 기본 자원 경로를 바꾼 뒤 일반 계획을 만들면 기존 소유 설치를
남긴 채 새 위치를 자동 생성할 수 있었다. 전역·프로젝트 fixture에서 이 실패를 먼저
기록했다. `deploymentPathDriftBlocks`는 실제 state의 공유 consumer, typed v1,
physical v2 reader와 새 정의의 경로를 대조하고 `RESOURCE_PATH_MIGRATION_REQUIRED`와
과거 target 목록을 반환한다. 일반 apply는 전체 차단되므로 어떤 파일도 쓰지 않는다.

Skill copy의 보조 파일은 같은 bundle root 아래면 경로 변경으로 보지 않는다.
다른 Kit·다른 surface의 공유 consumer는 합치지 않는다. 식별 정보가 불완전한 과거
같은 client/asset의 기록도 새 위치 자동 생성 권한으로 추정하지 않는다.
native import/install 수명주기는 별도 계획을 유지한다.

기존 공통·typed 일반 계획에도 Manifest/정의 context precondition을 적용했다.
적용 직전과 validation 후 commit 직전에 정의를 다시 대조한다. 중간에 정의가 바뀌면
파일을 복원하고 원장을 commit하지 않는다. 저장 계획은 기존 definition digest 검사로
재개를 거절한다. 이 검사들은 CLI와 HTTP/GUI의 같은 application service에 있다.

`test/deployment-path-drift.test.js`는 두 scope·네 자원, 재시작, 미확인 과거 기록,
shared consumer/Kit 분리, physical reader, 일반 제거의 기존 차단, 검토 후 및 commit
직전 정의 변경을 검사한다. HTTP 회귀는 새 경로/과거 target 표시와 두 종류의 apply
거부를 확인한다. 실제 HOME과 외부 링크는 이 단계에서 쓰지 않는다.

GUI에는 기존 위치와 새 위치, 별도 이관이 필요하다는 설명을 함께 표시하고 적용/저장을
차단한다. 쓰기 전 `preflight`와 commit 전 context 검사는 별도 callback으로 유지한다.
native 설치의 쓰기 전 계획 재생성은 아직 쓰기 전이라는 전제를 가지므로 commit 검사에
재사용하지 않는다. 기존 native import/adopt/apply/rollback 회귀도 함께 검사한다.

루트 **470 passed**, HTTP **32 passed**, GUI **56 passed**, skipped 0이다. typecheck·
desktop frontend/backend build·diff 검사가 통과했다.
[보존 체크포인트](resource-path-guard-preservation-20261106.json)에 코드/검사 log hash를
남겼다. 이 단계의 실제 모델 호출은 0회다. 실제 원장의 schema 6·133개 이력·3개 파일/
4개 owner는 그대로이며 hash가 일치하고 lock/journal이 없다. 기존 27개 경로의 내용·
mode와 ego-browser 링크 identity를 다시 확인했다. 앞선 MCP 복원으로 생긴 Codex config의
inode/mtime 차이도 그대로 구분해 기록했다.

## 명시적 이관의 계약

`planMigration`과 CLI `migrate --migration resource-path --assets ...`는 다음 계약을 따른다.

1. 적용 당시 definition/locator와 committed transaction의 소유 hash를 버전이 있는
   증거로 보존한다. 새 위치를 과거 위치로 간주하거나 과거 typed record의 누락 필드를
   현재 정의로 소급 채우지 않는다. 증거가 부족한 설치는 별도 검토/편입 절차가 필요하다.
2. 명시적으로 선택한 자원의 과거 target·소유 selector/파일·consumer와 현재 정의의
   새 target을 대응한다. 다른 reader가 과거 위치를 계속 쓰면 전부 이동하거나 기존
   연결을 유지하는 영향을 계획에 표시한다. 미확인 Agent 등록 섹션도 별도 충돌이다.
3. 새 위치의 미관리 파일/링크, selector 충돌, 과거 소유 내용의 외부 변경, 미검증 profile,
   scope 이동과 metadata/source 자기 대상 지정을 변경 전에 차단한다. 기존 native
   owner와 ego-browser 같은 외부 링크를 자동 편입하지 않는다.
4. 새 위치 생성→생성물 byte/mode 검증→과거 소유 항목 해제를 한 검토 계획에 넣는다.
   원자적 파일 쓰기·backup·journal·rollback을 재사용하며 양쪽 위치를 함께 복구한다.
   오래된 파일 전체를 지우거나 일반 제거의 mapping 검사만 우회하지 않는다.
5. 저장 계획 재개, 다중 reader와 selector 일부 이동, 충돌 무변경, stale 정의/원장,
   쓰기 실패·SIGKILL 전후 복구, 이관 후 제거와 rollback을 검사한 뒤 CLI/HTTP/GUI를
   연결한다. 기존 지원 범위를 바꾸지 않는 코드에는 불필요한 실제 모델 호출을 추가하지 않는다.

## 추가 구현과 TDD

새 committed receipt에 schema v1의 locator를 남긴다. stable Kit/asset/client/surface/
scope/store ID, 적용 당시 definition digest·capability·경로 template·실제 target base·
format·strategy를 기록한다. 감사 필드는 기존 소유권 schema를 바꾸지 않는다. 다른 MCP만
갱신해도 원래 reader의 증거를 유지하며 rollback은 과거 record와 receipt 참조를 복원한다.
증거가 없는 과거 typed/native 설치는 현재 정의로 추정하지 않고 차단한다.

shared 지침/Skill은 consumer 일부만 이동하고 나머지가 과거 위치를 유지하거나 뒤에
합류할 수 있다. physical Agent/MCP는 모든 기록된 reader가 같은 새 위치로 이동해야 한다.
MCP는 선택한 selector만 옮기고 나머지 server·사용자 설정은 남긴다. 과거 별도 Agent 등록은
정의의 설정 위치와 adapter로 검사해 충돌로 처리한다.

PR06 tree transaction을 재사용해 새 위치를 검증한 뒤 과거 소유 항목을 해제한다.
소유 파일·디렉터리 mode를 유지하며, 새 위치의 미관리 파일·링크·빈 폴더는 교체하지 않는다.
과거 Skill의 사용자 메모는 원래 위치에 남는다. snapshot은 immutable store를 유지하고
Kit 소유 링크만 옮긴다. 저장 계획도 과거/새 위치·reader 영향·남는 consumer를 보존한다.
source/정의/binary/state 전제를 적용 전·중간·commit 전에 검사하고 양쪽 위치를 함께 복원한다.
tree state는 최소 v6, physical은 v7이며 계획에 전환 버전을 표시하고 schema를 내리지 않는다.

- `test/deployment-locators.test.js`: committed 소유권과 locator 결합, 다른 MCP의 증거
  보존, rollback과 malformed locator 거절.
- `test/resource-path-migration.test.js`: 두 adapter × 두 scope × 네 자원, consumer 일부
  이동·합류, physical reader 전체 참여, selector 일부 이동, mode·source/정의/state stale,
  미관리 파일·링크·빈 폴더와 과거 메모, Agent 등록, snapshot과 validation 실패를 검사한다.
  이관 후 일반 제거→제거 rollback→이관 rollback도 확인한다.
- 같은 테스트는 apply의 stage-ready/path-swapped/before-state/state-committed와 rollback의
  path-swapped/state-committed에서 실제 SIGKILL 후 공통 recovery를 확인한다.
- `test/resource-path-cli.test.js`: 격리 정의로 실제 CLI dry-run·저장·재개·rollback.
  HTTP는 인증과 같은 수명주기, GUI는 명시적 선택·두 위치·남는 consumer 표시와 승인 전
  무집행을 검사한다.

혼합 snapshot 계획에서 일반 typed MCP의 UTF-8 문자열을 base64 image로 잘못 취급하던
공백도 새 테스트로 재현해 Buffer 변환으로 고쳤다. 디렉터리 image 순서는 기존 reader와
같게 고정한다. 검증의 임의 경로는 synthetic 설정 fixture이며 native 로딩 증거가 아니다.
이번 단계의 새 native 사용/모델 검증은 0회이며 현재 지원 14/16과 AGY Agent 차단을 유지한다.

## 최종 체크포인트

루트 **489 passed**, HTTP **33 passed**, GUI **57 passed**, skipped 0이다. typecheck·
desktop frontend/backend build·diff 검사가 통과했다.
[최종 보존 기록](resource-path-migration-preservation-20261106.json)에 코드/검사 log hash를
남겼다. 실제 원장은 여전히 schema 6·133개 이력·3개 파일/4개 owner이며 active hash가
일치하고 lock/journal이 없다. client definition 파일도 PR07 행렬 이후 바뀌지 않았다.
기존 27개 경로의 내용·mode와 ego-browser 링크 identity를 유지했다. Codex config의
inode/mtime 차이는 앞선 MCP 복원에서 생긴 기존 차이이며 추가 변경은 없다.
