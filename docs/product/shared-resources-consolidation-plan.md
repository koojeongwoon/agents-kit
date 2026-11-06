# Codex·Antigravity 공통 자원 관리 보완 계획

작성·재검토: 2026-11-06. 상태: **관측·등록·Kit 편집·로컬 및 고정 Git/npm 갱신/병합·설치 관리·복원·snapshot 공유 연결 집행·이관·중단 복구 구현. 검증한 빌드의 기본 CLI 전역/프로젝트 16조합 모두 검증, AGY Agent 2조합의 실제 자식 완료·복원까지 확인**.
검토 기준: HEAD `0fc5250`. 이번 재검토 시작 시 이 문서만 untracked였으며,
기존 본문의 방향을 유지하면서 현재 소스와 공식 계약을 다시 대조했다.
아래 구현 진행표의 완료 항목만 현재 제공한다. 나머지 신규 계약·서비스·API는 구현 제안이다.
사용자 목표 보완: Kit 관리로 선택한 기존 자원은 편입·재가져오기를 지원하고,
ego-browser 같은 외부 관리 링크는 존재·연결·관리 주체를 보여 주는 것으로 한정한다.

현재 요청으로 고정한 핵심 범위의 최종 결과는
[현재 Codex·GUI 핵심 검증](../reconstruction/current-codex-final-core-acceptance-20261106.md)을 따른다.
Codex CLI `0.167.0-alpha.3.2`의 MCP·Agent·지침은 전역·프로젝트 모두 실제 적용·인식·복원을
확인했다. GUI 대표 Skill 흐름도 편입→편집→업데이트 병합→설치 적용·복원을 확인했다.
후속 [Antigravity Agent 완료 검증](../reconstruction/phase-antigravity-agent-completion.md)에서
CLI `1.5.1`의 전역·프로젝트도 실제 자식 종료 상태·같은 자식의 공개 응답과 적용·복원을 확인했다.
아래 확장 계획의 미완료 항목을 이번 핵심 범위의 추가 작업으로 진행하지 않는다.

## 목표와 설계 기준

사용자는 스킬·MCP·서브에이전트·지침을 전역 또는 프로젝트 범위에서 한 번
정의하고, 선택한 Codex·Antigravity 환경에 적용한다. 원본, 설치 경로,
실제 클라이언트가 읽은 상태를 구별하면서도 관리 화면에서는 함께 확인한다.

**핵심 목표는 이미 사용 중인 설정·자원을 보존하면서 선택한 자원을 Kit 관리 대상으로
편입하고, 필요한 원본 업데이트를 다시 가져와 사용자의 수정과 함께 유지하는 것이다.** 신규 자원 작성과
기존 자원 편입은 동등한 기본 흐름이다. 기존 자원의 경로 이동이나 재설치는 편입의 필수
조건이 아니며, 첫 편입은 현재 동작을 유지하는 메타데이터 등록부터 시작할 수 있다.
공통 형식으로 변환할 수 없는 자원도 native 형태·출처·변경 이력을 보존하여 관리한다.

외부 설치 프로그램이 관리하는 ego-browser 링크는 **외부 관리 자원이 존재한다는 사실을
인지·표시**한다. Kit가 원본을 복사하거나 업데이트 확인·재가져오기·병합을 맡지 않는다.
외부 관리 항목에는 Kit 소유권·baseline·수정본을 만들지 않으며 현재 링크와 updater를
유지한다. 아래 편입·편집·재가져오기 수명주기는 사용자가 Kit 관리로 선택한 자원에 적용한다.

기존 versioned Manifest와 배포 서비스를 확장한다. 원본의 기본 위치는
`~/.agents-kit/kit/global` 및 `~/.agents-kit/kit/projects/<name>`를 유지한다.
`~/.agents`와 프로젝트의 `.agents`는 클라이언트가 읽는 설치 경로이며,
디렉터리가 존재한다는 이유로 Kit의 desired state 또는 소유 자원으로 삼지 않는다.
사용자 지정 Kit 경로도 기존 `--kit`와 `AGENTS_KIT_DIR`로 유지한다.

관리 흐름은 탐색 → 기존 상태 편입 → 원본/출처 추적 → 편집 또는 업데이트 가져오기 →
차이 비교·병합 → 대상별 계획 검토 → 적용 → 로딩 확인 → 관리 해제·제거·복원이다.
CLI와 GUI는 같은 application service를 쓴다. 편입과 재가져오기를 공유 링크보다 먼저 완성한다.

첫 실기 기준은 기존 지원과 같은 macOS arm64 로컬 환경이다. CLI를 먼저 채우고
desktop·IDE는 각각의 증거를 확보한 조합만 활성화한다. 다른 클라이언트의 기존
schema 1 동작과 기존 CLI/API 호출은 보존한다. 원격 실행, 임의 `CODEX_HOME`,
조직 배포·daemon/runtime/memory 확장은 이 작업의 선행 조건으로 넣지 않는다.

## 구현 진행 (2026-11-06)

현재 요청은 **추가 확장을 멈추고 기존 지원 경로의 편입→편집→업데이트 병합→적용·복원을
안정화하는 것**이다. [실패 7개 분류와 핵심 흐름 수리](../reconstruction/core-flow-repair-20261106.md)에
테스트 준비 오류, v3 원본 관리 교정 및 검증 제한을 기록한다. 아래 후속 PR 범위는 재개하지 않는다.
사용자가 별도로 요청한 [현재 Codex 실행 파일 검증](../reconstruction/current-codex-core-acceptance-20261106.md)은
기존 전역·프로젝트 copy Skill의 핵심 왕복과 이전 skip 실기 3개에 한정한다.

| 계획 항목 | 현재 상태 |
|---|---|
| S00 | [관측](../contracts/local-resource-observation-v1.md), [원본 등록](../contracts/resource-import-v1.md), [사본 revision·갱신](../contracts/source-revisions-v1.md), [원래 client 설치 관리 계약](../contracts/native-installation-v1.md) 구현 |
| S01-1 | 현재 Agent adapter의 무효 sandbox/MCP 기본값 차단 완료. 기본 역할·registry 바인딩 유지 |
| S02-1 | 정상/끊김/순환 링크 관측, 읽기 전용 Kit 경로 해석, 명시적 init, CLI/HTTP 연결 완료 |
| S02-2 | Codex/AGY 네 자원의 전역/선택 프로젝트·surface별 기본 경로와 AGY 추가 CLI Skill 루트 완료. 상위 디렉터리/discovery manifest 해석은 후속 |
| S06-1 일부 | 동명 자원의 분리, 외부 관리/연결/주체 표시, 지침 탭, 프로젝트 관측 및 Kit 부재 안내 완료 |
| S02-3 일부, S02-4 선행, S06-2 일부 | 선택 candidate 원본 등록·baseline·출처 추적·등록 해제·검토 복구의 CLI/HTTP/GUI 구현. native 원형·기존 설치·링크 보존, 기존 typed 편집 왕복 보존 및 stale/tmp 충돌 수정 |
| S02-3 사본 편집, S02-5 로컬 source 부분, S06-5 일부 | Kit 파일 추가/수정/삭제·권한, 로컬 B/K/U 비교·자동 병합·충돌 선택·부분 수용/보류, source/baseline 이력 복원과 CLI/HTTP/GUI 구현. 원래 설치·외부 링크 무변경 |
| S02-4 일반 파일/선택 MCP, S02-5 설치 연동, S06 일부 | metadata-only 설치 관리 등록·해제, 설치 L/D/K 대조, 설치 변경→Kit 병합, 검토한 Kit 반영, v5 원장·백업·모드·rollback·journal 복구를 CLI/HTTP/GUI에 연결. 원래 client/scope의 canonical 경로와 기존 검증 capability 범위만 지원 |
| S02-5 Git/package 첫 범위, PR04c, S06-5 일부 | 공개 HTTPS Git 전체 commit 및 npm 정확한 version/SHA-512 출처를 기존 관리 자원에 연결. 무실행 취득, B/K/U 병합·보류, 출처 포함 이력 복원, CLI/HTTP/GUI 완료. 버전 자동 탐색·private 인증·다른 registry/패키지 형식은 후속 |
| S03-1·2 계획, PR05, S06-3 일부 | 공통 Skill source v2의 명시적 전략·대상 override, immutable descriptor/store, 공유 연결·소비자·revision diff·보관 참조, state v6 읽기와 CLI/HTTP/GUI 미리보기 구현. 순수 계획은 무쓰기이며 집행은 아래 PR06 검증 조합만 허용 |
| S03-3·4, PR06, S06-3 일부 | immutable snapshot 링크 집행·명시적 copy↔link 이관·consumer 해제·saved plan·backup/rollback·SIGKILL 복구를 공통 서비스와 CLI/HTTP/GUI에 연결. Codex 현재 실행 파일의 전역 CLI Skill만 native 링크 evidence 추가. AGY 링크 읽기는 미관측이라 차단 유지 |
| S04-1·S04-2 기본 범위, PR07 기본 범위, S06-3 일부 | typed Agent/MCP의 같은 물리 저장소 합산·gate·state v7/resource v2·제거 영향·saved v3·rollback/중단 복구 구현. 검증한 빌드의 기본 CLI native 16/16 증거 확보. AGY Agent 두 scope의 실제 child 완료·적용·복원 확인 |
| S04-3, PR08, S06-3 일부 | 일반 경로 변경 차단·적용 locator 증거·명시적 새 위치 생성/검증/과거 해제·부분 consumer/selector 이동·mode 보존·양쪽 rollback·SIGKILL 복구를 CLI/HTTP/GUI에 구현·격리 검증. 무증거 과거 설치·Agent 등록 충돌·외부 링크는 이동 차단 |
| S05-1·S06-1 일부, PR09 일부 | 전역+선택 프로젝트 catalog·origin/실제 경로·부분 실패·행별 scope 작업, Codex CLI Skill native 활성/비활성·상위 경로, MCP 필드별 출처/합성/가림/ignored, Agent 선언 이름 및 지침 설정·문서 기준 선택 예상·CLI/HTTP/GUI 검증. Agent/지침 실제 로딩과 다른 client/surface 실효 문맥은 미확인 |
| S05-2·3 참조·설치/역참조·조정 일부, PR10 일부 | graph·정책·설치 revision·역참조·writer 보호, scoped v4 영수증·consumer 예측·두 scope 조정/복구 구현. pin 보존 전역 변경·공개 v3 apply/remove·의존성 rollback/참조 해제·저장 v5 재개·두 scope 복구와 일반 v3 검증/읽기 전용 진단/선언 CRUD를 CLI/HTTP/GUI에 연결. Kit 소유 snapshot·실제 격리 Codex 공개 CLI 왕복·사용자 Kit 무쓰기 진단 검증. native 원형/과거 경로 writer·편입된 원본의 v3 수명주기·전역 설정 전환은 미완료이며 해당 경로는 차단 |
| C07 common/shared·Codex native UI 배포·variant 원본 관리, PR11 일부 | 대상/variant·작성자 검토·bounded 원본·공통 copy/snapshot·선택 영수증·저장/재개·적용/복원·추가 노출 표시 구현. distribution v2의 variant별 원본 등록·편집·Kit/local 및 pinned Git/npm 재가져오기·B/K/U 병합/보류·기준/이력 복원·SIGKILL 복구를 CLI/HTTP/GUI에 연결. 영수증 v2로 다른 variant 초안과 설치/프로젝트 전제를 분리. Codex native UI profile은 client/format 선언·보조 binary/version/scope/strategy 증거와 선택 3으로 원형 배포. 관리 사본 편집/병합 후 실제 전역 copy·프로젝트 copy·전역 snapshot 인식/복원 및 전역 copy 브라우저 GUI 왕복 확인. 호출 정책·native Tool 의존성·다른 native 형식/client/surface·exclusive·추가 discovery 설정·명시적 관리 해제 및 전체 GUI 실기는 미완료. [배포 계약](../contracts/skill-distribution-v1.md), [원본 계약](../contracts/skill-variant-sources-v1.md), [native profile](../contracts/native-skill-interface-v1.md), [구현 기록](../reconstruction/phase-skill-distribution.md) |
| S02-4 기존 링크/추가 루트, S03-5·S04-2 추가 profile/4·S05 나머지, S06 나머지 | 남은 native 증거·실효 inventory 문맥·교차 scope 의존성·추가 discovery 전략은 후속. 외부 링크는 관측만 유지하고 일반 apply의 native 자동 편입은 차단 |

관측 단계 검증: 루트 251 passed/2 skipped, HTTP 22 passed/1 skipped, GUI 38 passed,
GUI 타입 검사·desktop build·Cargo check·diff 검사 통과. 실제 ego-browser 링크 조회
전후 readlink/mtime 불변 및 실제 GUI에서 외부 링크 작업 버튼 부재를 확인했다.
[구현·검증 상세](../reconstruction/phase-shared-resource-observation.md).

선택 원본 등록은 기존 설치를 변경하지 않고 Kit 사본과 기준 사본을 보관한다.
설치 파일/섹션 소유권을 인수한 것으로 표시하지 않는다. 관측 candidate ID로 출처만
연결하며, 관리 해제는 파일 삭제 없이 활성 자원과 대상 선택을 해제한다.
[후속 구현·검증 상세](../reconstruction/phase-shared-resource-import.md).

원본 등록 단계 포함 최종 검증: 루트 269 passed/2 skipped, HTTP 23 passed/1 skipped,
GUI 43 passed. 타입 검사·desktop build·Cargo check 통과. 격리된 임시 Skill의 실제 GUI
계획/편입/해제와 원본·Kit 사본·외부 링크 보존을 확인했다. 실제 사용자 자원은 편입하지 않았다.

이어진 [사본 편집·로컬 갱신 구현](../reconstruction/phase-source-revisions.md)은
원본 등록 관리 기록 v1을 최초 변경 시 v2로 전환한다. Kit 수정본과 수용 기준 사본을
분리하고, 보류한 파일의 기준은 유지한다. 이전 revision 복원은 Kit·기준·보류 상태만
복원하며 외부 원본·설치·링크는 되돌리지 않는다. 사용자 파일이나 클라이언트 설정을
직접 바꾸는 설치 권한 인수·배포 연결 완료로 표시하지 않는다.

사본 편집·로컬 갱신 포함 최종 검증: 루트 286 passed/2 skipped, HTTP 24 passed/1 skipped,
GUI 47 passed. 타입 검사·desktop frontend/backend build·Cargo check·문서/diff 검사 통과.
실제 GUI에서 편집·자동 병합·부분 수용/보류·직접 병합·이력 복원과 원본/링크 보존을 확인했다.

이어진 [원래 client 설치 반영 구현](../reconstruction/phase-native-installation.md)은
기존 파일을 변경하지 않는 설치 관리 등록 후, 별도 계획으로 Kit 수정본을 반영한다.
설치본 외부 수정은 기본 차단하고 L/K/D 병합으로 Kit에 먼저 수용할 수 있다. 선택하지 않은
MCP 설정과 인증 값, 사용자 파일, 링크는 보존한다. 배포 원장 v5와 모드·새 파일 생성 증거를
포함한 journal v2를 사용하며 기존 이력·rollback·중단 복구를 공유한다. 격리된 실제 파일과
GUI 흐름으로 확인했고, 테스트 fixture의 합성 검증 프로필을 실제 client 지원 근거로
승격하지 않았다. 이 구현 단계에서는 사용자 기본 Kit 부재를 확인했으며 사용자 홈의 설치는 변경하지 않았다.

이후 명시적 실환경 요청에 따라 [기본 Kit 초기화·실제 client 검증](../reconstruction/phase-native-installation-live.md)을
완료했다. Codex `0.166.0-alpha.6`와 Antigravity `1.5.1`의 전역 Skill만 현재 실행 파일
hash와 실제 사용 수명주기로 검증했다. 기본 Kit의 관리 등록→사본 편집→설치 반영→실제
읽기→rollback→복원본 읽기가 통과했고, 검증용 자원/소유권은 해제해 기존 상태로 정리했다.
기존 설정·자원 23개 항목과 ego-browser 링크 3개는 내용·권한·연결이 보존되었다. 원장
v5의 이력·백업은 유지하며, 다른 종류/scope/버전의 지원을 함께 확장하지 않았다.

이어진 [기존 MCP·Agent·지침 관리와 지연 진단](../reconstruction/phase-existing-native-management.md)에서
기존 `codex-instructions`·`node-repl`·`canva`·`tools`를 기본 Kit에 등록하고 현재 설치
소유권을 인수했다. Codex의 현재 정확한 CLI 빌드는 전역 지침·기본 Agent·제한된 native
stdio MCP의 적용·사용 또는 native 전송·복원을 각각 확인했다. 기존 Agent는 없어서
임시 Agent로 시험했다. Antigravity MCP는 실제 도구 호출은 성공했으나 응답 형식 문제로
전체 검증이 미완료이고, Agent는 직접 child 완료 결과가 미관측이라 지원을 승격하지 않았다.
응답 schema를 제한한 MCP 단일 진단은 성공했지만 전체 수명주기 증거로 쓰지 않는다.

사용자의 진단 요청으로 실제 재시도를 중단했다. 다음 작업은 배포·native 인식·모델
행동의 증거 계약과 verifier 책임 분리부터 진행하며 반복 E2E로 범위를 넓히지 않는다.
설정 27개 항목의 내용·권한과 외부 링크 3개는 보존되었고 남은 recovery journal은 없다.
[현재 체크포인트](../reconstruction/native-existing-management-checkpoint-20261105.json).

이후 [검증기 분리](../reconstruction/phase-verifier-separation.md)를 구현했다.
배포·복원, native 인식, 모델 응답과 실행 무결성을 개별 상태로 기록하며 네 실행/탐색
검증기가 같은 계약을 쓴다. 기록된 실패로 TDD와 격리 CLI 왕복을 확인했고, 실제 환경은
기존 Codex MCP 등록 조회만 한 번 실행했다. 모델 호출·설정 변경·지원 활성화는 추가하지
않았다. 외부 링크와 기존 관리 상태를 보존했고 Antigravity의 미관측 child 증거는 유지한다.

이후 [Antigravity MCP 실제 적용·복원](../reconstruction/phase-antigravity-native-mcp.md)에서
현재 `1.5.1` 정확한 실행 파일의 전역 기본 stdio를 다섯 단계로 검증·활성화했다.
기존 canva도 Kit 수정→실제 적용→등록 조회→rollback→Kit 복원을 통과했다.
Agent는 자식의 공개 응답을 ACP로 직접 확보했으나 완료 상태를 안정적으로 확정하지
못해 미검증을 유지한다. 기존 tools URL·설정·외부 링크는 보존했다.

이후 [고정 Git/npm 출처 연결](../reconstruction/phase-upstream-sources.md)을 추가했다.
원래 설치 origin과 갱신 upstream을 분리하고 관리 기록 v3로 출처 연결·버전 변경·로컬
복귀·이력 복원을 저장한다. 공개 yaml의 잠긴 npm 버전과 해당 Git 커밋을 실제로 읽었으며
패키지 설치·소스 실행·사용자 Kit 변경은 하지 않았다. 새 기록의 native 적용·rollback은
격리 fixture에서 검증했고 기존 클라이언트 지원 조합은 확장하지 않았다.

이후 [PR05 snapshot·공유 연결 계획](../reconstruction/phase-skill-snapshot-plan.md)을 구현했다.
source v2 전략·snapshot descriptor/store·state v6 연결 모델·전체 소비자 갱신/해제
계획·보관 참조를 기존 공통 배포와 연결했다. copy 회귀와 계획 무쓰기·적용 차단을
CLI/HTTP/GUI에서 검증했다. 실제 연결 집행과 디렉터리 이관·강제 종료 복구는 PR06의
조건이며, 기존 client 설정과 외부 링크는 바꾸지 않았다.

이후 [PR06 링크 집행·이관·복구](../reconstruction/phase-skill-snapshot-deployment.md)를
구현·검증했다. 원자적 디렉터리 exchange와 보존 backup, 전략별 runtime gate, saved
plan과 배포/rollback/recovery 도중 SIGKILL 복구를 연결했다. Codex 전역 CLI는 실제
적용/갱신/복원 snapshot 읽기와 독립 discovery가 통과해 해당 실행 파일만 활성화했다.
AGY는 배포/복원은 통과했으나 링크 읽기가 미관측이라 활성화하지 않았다. 최종 검사는
루트 423, HTTP 30, GUI 54 passed이며 기존 설정 27개 경로와 외부 링크 3개를 보존했다.

PR07의 [같은 Agent/MCP 저장소 합산](../reconstruction/phase-physical-resource-deployment.md)은
구현·격리 검증했다. typed 설정은 저장소 자체의 변경/제거이며 등록된 다른 실행 화면에도
미치는 영향을 계획과 저장 계획에 표시한다. 네 자원의 전역/프로젝트 합성 수명주기에서
기존 파일 mode 보존 누락도 고쳤다. 이후 [기본 CLI 실기](../reconstruction/phase-basic-cli-verification.md)에서
Codex 프로젝트 네 자원·전역 basic MCP, AGY 프로젝트 세 자원·전역 지침의 다섯 단계와
최종 원상 복원을 확인해 당시 gate가 14/16으로 늘었다. 첫 사전 행렬의 5/16은 과거 기록으로
보존한다. 이후 [AGY Agent 완료 검증](../reconstruction/phase-antigravity-agent-completion.md)으로
전역·프로젝트의 실제 child 완료와 복원까지 확보해 기본 범위는 16/16을 마쳤다.
기존 설정의 내용·mode와 외부 링크는 보존했고 Codex config의 inode/mtime 변경은 별도
기록했다. 루트 465, HTTP 31, GUI 55 passed다.

PR08의 [명시적 경로 이관](../reconstruction/phase-resource-path-migration.md)도 구현·격리
검증했다. 일반 중복 배포와 stale 정의 차단을 유지하며, committed locator 증거로 새 위치
생성/검증→과거 소유 항목 해제와 양쪽 복원·중단 복구를 실행한다. 부분 consumer/selector
이동, mode·사용자 항목 보존과 저장 계획을 CLI·HTTP·GUI에서 확인했다. locator가 없는
과거 설치는 추정하지 않고 차단한다. 루트 489, HTTP 33, GUI 57 passed이며 실제 설정
변경과 새 모델 호출은 없었다. 임의 경로의 native 지원 확대는 의미하지 않는다.

PR09의 [원본 통합 catalog](../reconstruction/phase-resource-catalog.md)는 구현·검증했다.
전역+선택 프로젝트의 실제 targetRoot·Kit scopeRoot를 분리하고, 부분 오류와 동일 이름을
보존한다. 사본·설치·편집 작업은 행의 원래 scope로 실행한다.
Codex CLI Skill의 native 목록·disabled·상위 추가 경로를 공통 서비스와
명시적 CLI/GUI 동작에 연결했다. 격리 서비스와 사용자 환경 한 번의 조회 모두
성공했고 모델 호출과 설정 변경 없이 기존 링크를 보존했다. 507/37/62 회귀가 통과했다.
다른 종류·AGY·다른 surface의 실효 문맥은 여전히 미확인이며 PR09 전체는 진행 중이다.
MCP 후속에서는 Codex 공개 config/read의 필드별 origins/layers로 단일/합성/가림/제외를
연결했다. 격리 환경의 실제 서비스 및 사용자 node_repl 설정 조회, GUI의 읽기 전용
요약을 확인했다. MCP 연결/Tool/model 호출과 사용자 설정 변경 없이 514/39/63 회귀가
통과했다. native deployment 지원은 확대하지 않았고 다른 kind/surface는 미확인이다.
Agent 후속은 파일 ID와 선언 이름을 분리했고 지침은 override·공백·상위 Git 문맥·fallback·
예산의 문서 기준 선택 예상을 연결했다. config/read만 사용하는 격리·실환경 조회를
확인했다. 실제 주입과 Agent child 완료는 미확인으로 유지하며 production thread 초기화를
추가하지 않았다. 없는 fallback을 shadowed로 표시하던 실패를 TDD로 고쳤다.

PR10의 [scoped dependency 구현 계약 초안](../contracts/scoped-dependencies-v1.md)은
versioned 참조·문맥 identity, 설치 revision 전제, 역참조, 전역→프로젝트 잠금,
두 원장 metadata의 journal/복구 및 진입점별 승격 기준을 정리했다. 아직 구현·집행
완료를 뜻하지 않으며 교차 scope 자동 적용은 계속 차단한다.
선행 교정으로 현재 Manifest v1/v2의 미지원 provider 객체가 optional Tool에서
무시되지 않도록 입력 검증을 보완했다. [PR10 진행 기록](../reconstruction/phase-scoped-dependencies.md).
후속으로 qualified 참조·origin별 순수 resolver·전이 정책과 CLI/HTTP/GUI 읽기 전용
graph를 구현했다. bare ID의 전역 fallback은 없으며 전역 설치 상태는 미확인이다.
일반 v3 loader·편집·배포는 계속 차단하고 실제 설치 전제·역참조·잠금/journal은 남겨 둔다.
이후 [설치 소유 영수증](../contracts/installation-receipts-v1.md)을 기존 적용 journal에
기록하고 source-only 편집·명시적 metadata 적용·다른 MCP owner 변경·rollback·snapshot·
SIGKILL 복구를 확인했다. CLI/HTTP/GUI 대조의 ownership-observed는 native 발견이나
provider 전제 충족이 아니며 fulfilled false다. 이 초기 범위에서는 과거/native-owned
설치의 영수증 부재를 그대로 표시했다. 554/42/68 및 typecheck·desktop·Cargo가 통과했다.
후속 [native v2 영수증](../contracts/native-installation-receipts-v2.md)은 원래 native ID와
소유 기록·lastApplied baseline을 별도로 검증한다. 네 종류 fixture와 실제 기존 MCP
3개·지침 1개의 metadata-only 적용→복원→유지를 확인했다. 기존 managed/source/config/
외부 링크는 유지하고 영수증 4개와 이력 12개만 추가했다. 563/43/69 및 전체 build 검사가
통과했다. native 발견·provider binding·역참조·교차 scope 집행은 여전히 미완료다.
이후 [설치 의존성 revision](../contracts/installed-dependency-revisions-v1.md)을 schema 3
영수증에 추가했다. 실제 provider revision·locator와 명시적 Tool alias를 고정하고,
source-only 수정·provider 적용·rollback·소유/내용 변경을 구분한다. 기존 schema 1/2를
읽되 없던 과거 의존성 기록을 추정하지 않는다. native Tool 발견과 교차 scope의
계획/역참조/잠금/journal을 완료한 것은 아니며 v3 Manifest 배포는 계속 차단한다.
후속 [역참조 모델/조회](../contracts/dependency-reverse-index-v1.md)는 state 8의 프로젝트
등록·consumer별 stable 전제 ID와 양쪽 원장 대조를 추가했다. 누락·이동·손상·pending을
해제로 간주하지 않고, 순수 영향 계산은 실제 설치 revision 교체와 source-only/no-op를
구분한다. 아직 coordinator가 없으므로 등록 state의 일반 배포/복원은 집행 전에 차단한다.
사용자 원장은 승격하지 않았고 공개 등록·모든 쓰기 진입점 조정·두 scope 복구는 남아 있다.
이후 [내부 coordinator](../contracts/dependency-coordination-v1.md)는 consumer별 등록/해제와
project tombstone, global→project 잠금, 검토 target 사전 검사, 두 원장 journal/복구를
구현했다. 임시 client 파일의 실제 apply/remove와 9개 SIGKILL 경계·복구 중 재중단·수동
편집 보존을 검증했다. 실제 native proof adapter와 공개 v3 pipeline/모든 mutation 보호는
아직 연결하지 않았으며 사용자 원장 schema 6/145 이력·영수증 4개와 기존 설정/링크는 유지했다.
후속 [native 전제 관측](../contracts/native-prerequisite-observation-v1.md)은 Codex CLI의
현재 실행 파일로 전역 Skill 발견·선택 MCP Tool 목록과 private verifier를 확인했다.
설치 revision·원본 출처·명시적 Tool 별칭·정책·문맥 변경/만료를 대조하며 모델/Tool 호출은 없다.
예정 프로젝트 설정 변경의 전환과 공개 v3 compiler/모든 mutation 보호는 남아 있으므로
교차 scope 자동 적용을 열지 않는다. 실제 검증은 격리 HOME이며 사용자 설정/원장은 바꾸지 않았다.
후속 [scoped 변경 계획](../contracts/scoped-deployment-compilation-v1.md)은 local/global origin별
선택·consumer 전이 전제·설치 pin과 기존 capability/변환·파일 planner를 연결했다. CLI/HTTP/GUI는
v3를 읽기 전용 계획으로 보여주며 source 본문/접속 값은 노출하지 않는다. 기존 파일·mode와
외부 링크를 보존하고 public flag로 실행/저장을 우회하지 못한다. scoped 설치 영수증·공개
coordinator 집행/복구·모든 mutation 영향 보호가 남아 있어 적용은 계속 차단한다.
이후 [scoped 영수증 v4](../contracts/scoped-installation-receipts-v4.md)는 전역/프로젝트·checkout별
origin ID, 전이 revision/locator/binding과 원래 native ID를 기록한다. 기존 owned 파일의
metadata 등록과 역참조를 함께 commit하고 불완전 closure 거절·commit 전/후 복구를 검증했다.
현재 Codex 격리 환경의 v4 metadata→Skill/선택 MCP 발견→원래 설정/링크 복원도 확인했다.
사용자 원장은 승격하지 않았다. 후속 [설치 결과 예측](../contracts/deployment-installation-prediction-v1.md)은
공통/typed 새·변경 파일과 snapshot의 소유 기록·v4 revision을 무쓰기로 계산하고 내부 실제
적용 결과와 대조한다. native 원형/이관 예측·공개 집행·모든 mutation 영향 보호는 남아 있다.
이어진 [원본 제거 보호](../contracts/source-dependency-guards-v1.md)는 등록된 전역 원본의
삭제/관리 해제와 새 등록 사이에 Kit source/deployment 잠금을 교차 확인한다. 관련 없는
원본 제거는 허용하고, 수동 원본 삭제는 적용 복원/예약 metadata 복구와 구별하여 보존한다.
일반 removal/saved/path/snapshot/native writer 차단과 v4 역참조 조회도 회귀 검증했다.
변경별 전역 client 영향 조정·예정 native 문맥·공개 교차 scope 집행/복구는 남아 있다.
후속 [선택적 전역 변경](../contracts/global-dependency-mutation-v1.md)은 공통 변경의 pin·
프로젝트 원장·native 문맥이 유지될 때만 내부 집행/검토 복구를 허용한다. 파일/tree의
commit 전/후 중단·복구 재중단·수동 권한/inode 변경과 native 원형의 이름/baseline 보존을
검증했다. 이어서 기존 v1/v2 전역 apply/remove·rollback·저장 계획 v4 재개·검토 복구를
공통 CLI/HTTP/GUI 서비스에 연결했다. 등록된 모든 프로젝트와 pin·native 문맥을 유지하는
작업만 허용하며 권한/수동 편집과 provider 최초 설치 rollback을 보호한다. 공개 v3 집행/저장·
등록/해제/두 scope 복구, 과거 경로 이관·native 문맥 전환과 실제 교차 scope 왕복은 남아 있다.
이후 [native 문맥 전환](../contracts/native-context-transition-v1.md)은 검토한 프로젝트 설정
적용 후 재관측을 기다리는 async 내부 집행을 연결했다. 실제 격리 Codex에서 v4 전역 Skill/
선택 MCP 발견→프로젝트 파일 적용→전제 재발견→등록 해제와 설정 바이트/권한·링크 복원을
확인했다. 공개 v3 집행/저장·전체 writer 영향 보호·공개 두 scope 복구/진단과 실제 consumer
활성 검증은 남아 있으며 다른 client/surface나 C07 호환성을 완료로 합산하지 않는다.
이후 [공개 v3 실행](../contracts/scoped-deployment-execution-v1.md)은 CLI/HTTP/GUI의 계획·명시적
전제 관측·적용/제거·저장 v5 재개·두 scope 검토 복구를 연결했다. 기존 consumer/Tool binding을
함께 보호하고 실행 claim 교체·강제 종료/재개·구버전 저장 계약 위장을 차단한다. 실제 Codex의
공개 CLI 저장→다른 process 재개/재관측→등록 해제와 정확한 설정/권한·링크 복원을 확인했다.
프로젝트 의존성 rollback·native 원형/과거 경로 이관·전역 설정 전환·v3 진단/원본 편집과
다른 조합/consumer 활성 검증은 남아 있다. 이번 사용자 보존 검사에서는 Antigravity 앱 시작
직후의 별도 설정 변경 1건을 감지하여 현재 값을 유지했으며, 원장·관리 파일·외부 링크는 보존했다.
이후 [프로젝트 의존성 rollback/참조 해제](../contracts/scoped-deployment-rollback-v1.md)는 복원될
frozen 설치 영수증·전역 pin을 예측하고 파일/tree 복원·재등록/해제·before/after native 관측을
같은 두 scope 집행에 연결했다. 현재 소스가 바뀌어도 설치 당시 closure를 복원하고, 전역
전제가 없어진 실제 설치 선언은 파일을 유지하며 참조만 해제한다. Kit 소유 snapshot 링크는
원장·영수증·snapshot 검사를 통과해야 한다. 공개 CLI 저장 v5 rollback의 process 재시작·
재관측·멱등 재개·최초 설치 복원과 두 commit 경계 SIGKILL 복구를 검증했다. 사용자 원장/
관리 파일·외부 링크는 유지하고 기존 Antigravity 설정 차이 외에 새 보존 차이는 없었다.
이후 [일반 v3 원본 검증·진단·편집](../contracts/scoped-manifest-management-v1.md)을 연결했다.
checkout 없는 source 문맥과 설치/배포 문맥을 분리하고 구버전 전역 Manifest의 변경도
미설치 v3 프로젝트 참조를 검사한다. doctor 쓰기 시험을 제거했으며 named scope·qualified
참조·동명 자원과 동일 ID 교체의 target 선택을 보존한다. peer 원본/잠금 변경은 쓰기 전후
확인하고 선택 원본의 안전한 복원을 유지한다. 루트 781·HTTP 51·GUI 86, 타입 검사·desktop
빌드가 통과했다. 실제 기본 Kit의 원본 검증·읽기 전용 진단과 파일/원장/링크 보존을 확인했으며
native/모델/Tool 호출은 없었다. 편입된 native source의 미지원 v3 사본/갱신·설치 흐름과
native/과거 경로 writer 조정·전역 설정 전환·PR07/09/11·C07은 남아 있다.

## 초기 검토 기준의 구현 상태와 공백

| 항목 | 구현 시작 전 소스에서 확인한 상태 | 필요한 보완 |
|---|---|---|
| 공통 원본 | `kit-paths.js`, Manifest, named project scope 구현 | 원본 위치와 설치 위치를 UI에서 구분 |
| MCP 변환 | `adapters/mcp`에서 TOML 및 JSON 생성·병합 | 전역/HTTP/인증 조합과 현재 설치본의 실제 사용 검증 |
| Agent 변환 | 공통 typed 정의를 Codex TOML·Antigravity Markdown으로 변환 | 전역·Antigravity·앱/IDE 검증 및 현재 native 계약 재대조 |
| 공통 Skill·지침 | 공통 소스 검사와 공유 소비자 소유권 구현 | 링크 배포와 안전한 기존 자원 등록 연결 |
| 링크 | 일반 link prepare/apply/rollback 구현 | 공통 Skill 계약은 copy로 고정되어 공유 링크 수명주기와 연결되지 않음 |
| 로컬 탐색 | 전역 MCP·Skill의 이름과 출처 탐색 | symlink Skill, Agent, 프로젝트 범위, 다중 탐색 위치 지원 |
| 다중 대상 | 한 scope에서 최대 8개 client surface 계획 지원. 공통 지침·Skill만 동일 경로 합산 | Agent/MCP의 같은 저장소 중복 경로와 surface별 지원을 별도로 해결 |
| 전역/프로젝트 | 별도 Manifest와 트랜잭션 지원 | 합쳐서 보는 조회, 충돌 설명, 전역 의존성 전제 검사 |
| 기존 설치 편입·갱신 | 탐색과 Kit 기존 소유권 이관은 있으나 외부 자원의 편입·upstream 추적·재가져오기 수명주기는 없음 | 현재 설치 유지 등록, 출처/baseline 기록, 업데이트 비교·병합·배포 |
| 현재 지원 증거 | Codex CLI 0.145.0·AGY CLI 1.2.12의 일부 기능만 버전·hash로 검증 | 현재 설치본과 실제 사용 표면별 새 증거 확보 |

초기 조사에서 읽기 전용으로 기존 `discoverLocalInstallations`를 실행해,
`~/.agents/skills/ego-browser`가 링크인 경우 `assets: []`와 `issues: []`를
반환하는 누락을 재현했다. `readDirectoryEntries`는 일반 디렉터리와 `.skill`
파일만 포함한다. 탐색 대상 kind도 `mcp`, `skills`로 제한되어 있다.
이번 재검토에서는 임시 홈에 정상 링크와 끊긴 링크를 만들어 같은 무응답 누락을
재현했고, 실제 ego-browser 경로가 유효한 symlink임을 `lstat`으로 확인했다.
원본이나 클라이언트 설치 파일은 수정하지 않았다.

과거 CA04-7 기록의 활성화 범위는 다음과 같다. 현재 CLI 빌드의 추가 검증은 위
실환경 기록을 따른다. 파일 변환 가능 범위 전체를
실제 사용이 검증된 지원 범위로 확대 해석하지 않는다.

- Codex CLI: 프로젝트 지침·Skill·기본 stdio MCP·기본 Agent, 전역 Skill.
- Antigravity CLI: 프로젝트 지침·Skill·기본 stdio MCP, 전역 Skill.
- 앱/IDE, 전역 MCP·Agent 등은 해당 범위의 실기 증거가 없다.

### 재검토에서 추가로 확인한 누락

우선순위는 해당 기능을 활성화하기 전 해소해야 할 순서다. 코드가 존재하거나
문서 계약이 있다는 사실만으로 현재 설치본의 사용 성공을 의미하지 않는다.

| ID | 우선순위 | 확인한 문제·누락 | 계획 반영 |
|---|---|---|---|
| G01 | P0 | 링크 항목을 건너뛰고 끊긴 링크에도 issue가 없음. discovery는 전역 MCP/Skill만 읽음 | S02-1에서 링크·오류 관측, S02-2에서 범위·kind 확장 |
| G02 | P0 | `ResourceWorkspace`가 `asset.id`만으로 합치고 `client.assets`만 표시. surface override 결과가 화면에 반영되지 않음 | 관측 ID와 관리 자원 ID 분리, S06-1에서 surface inventory 사용 |
| G03 | P0 | `ManifestEditor.saveEditMutation`이 자원을 재구성하면서 typed `definition`을 유지하지 않음. 원본 파일 편집도 현재 Manifest 편집과 별개임 | S02-3·S06-2에서 typed 왕복 보존과 원본 편집 트랜잭션 |
| G04 | P0 | 공통 Skill 계약은 copy 고정. 일반 link에는 공유 소비자 메타데이터가 없고, 저장 계획/journal은 link 제외. FileTransaction은 실제 디렉터리를 링크로 교체하지 못함 | S03을 snapshot·소유권·디렉터리 이관·복구 계약 변경으로 분리 |
| G05 | P0 | 최신 Codex에서 Agent 파일의 sandbox/MCP 설정은 부모를 덮어쓰지 않지만 현재 adapter는 이를 출력함 | S01에서 새 계약 차단/이관. 과거 evidence로 제한 성립을 표시하지 않음 |
| G06 | P1 | 같은 configStore의 Agent/MCP는 여러 surface가 같은 target을 요청하면 `DUPLICATE_DEPLOYMENT_TARGET` | S04-1에서 물리 저장소 단위 합산과 기존 제거 의미 유지 |
| G07 | P1 | 전역 의존성은 단일 Manifest의 bare ID만으로 식별. 별도 전역 Manifest를 읽는 catalog·역참조·동시 변경 계약 없음 | S05 조회와 실제 교차 scope 의존성 지원을 별도 단계로 분리 |
| G08 | P1 | 새 client path만 바꾸면 과거 설치본이 남고, typed 제거는 현재 capability path와 기록을 대조하므로 과거 경로 정리가 막힐 수 있음 | S01-3·S04-3에서 명시적 경로/소유권 이관 |
| G09 | P0 | snapshot 복사만으로 기존 설치를 계속 관리할 수 없음. 현재 위치 유지 등록과 쓰기 권한/소유 단위 인수 계약이 없음 | S02-4에서 현재 바이트 유지 편입과 관리 권한을 명시적으로 기록 |
| G10 | P1 | 기존 runtime evidence는 연결 전략·reload·가림/비활성 조건을 충분히 식별하지 못함 | S01-2에서 자원 프로필과 연결 전략별 증거 확장 |
| G11 | P1 | S04의 기존 완료 행렬에서 지침이 빠짐. 프로젝트 하위 작업 위치·동명 중복·지침 우선순위도 필요 | 네 자원 전체와 실효 로딩 시험을 검증표에 포함 |
| G12 | P1 | `test:all`은 GUI Vitest와 `typecheck`를 실행하지 않음 | 검증 명령과 GUI 회귀 기준 별도 명시 |
| G13 | P1 | CLI와 GUI context의 기본 `resolveKitRoot`가 starter Manifest를 자동 생성함. 조회 service만 순수해도 진입 경로가 쓸 수 있음 | 경로 해석과 기존 명시적 `init`을 분리하고 초기 사용 흐름 변경을 문서화 |
| G14 | P0 | 외부 출처·마지막 수용 원본·Kit 수정본을 분리하지 않아 upstream 업데이트를 다시 가져와 병합하는 계약이 빠짐 | C06·S02-5에서 출처 추적, 3-way 병합, 갱신 계획·이력 추가 |
| G15 | P0 | 공통 부분집합을 벗어난 자원을 native 전용으로 표시하는 것만으로는 기존 자원 관리 목표를 충족하지 못함 | native 원형 보존·동일 client 관리·재가져오기와 공통 배포 가능 여부를 분리 |

소스 근거: [discovery](../../lib/application/local-installation-discovery-service.js),
[자원 목록](../../gui/src/components/resources/ResourceWorkspace.tsx),
[편집기](../../gui/src/components/config/ManifestEditor.tsx),
[Agent adapter](../../lib/adapters/agents/index.js),
[배포 서비스](../../lib/application/manifest-deployment-service.js),
[journal](../../lib/infrastructure/deployment-journal.js),
[제거 검사](../../lib/application/prepare-resource-removal.js),
[파일 트랜잭션](../../lib/infrastructure/file-transaction.js),
[Kit 경로](../../lib/kit-paths.js), [GUI context](../../gui/server/context.js),
[검증 명령](../../package.json).

G05의 두 옵션은 현재 CA04-7 `agent-role-basic-v1`에서도 이미 제외된다.
따라서 production gate가 이를 통과시킨다는 발견은 아니다. adapter의 과거 의미를
교정하고 향후 evidence 확장 시 잘못 활성화하지 않도록 하는 작업이다.

## 공식 계약 재확인과 앞선 대화의 정정

아래 공식 문서는 2026-11-05 다시 조회했다. 문서 계약 확인과 로컬 실기 검증은
별개이며, 이번에는 새 runtime evidence를 발급하거나 capability를 활성화하지 않았다.

- 현재 Codex 문서는 개인 Agent를 `~/.codex/agents/*.toml`, 프로젝트 Agent를
  `.codex/agents/*.toml`에 정의한다. 앞선 대화의 “모든 역할을 반드시
  config.toml의 config_file로 등록” 설명을 일반 규칙으로 적용하지 않는다.
- 현재 Codex 문서는 Agent 파일의 `sandbox_mode`, `approval_policy`,
  `mcp_servers`가 부모 설정을 덮어쓰지 않는다고 명시한다. 기존 Kit의
  `sandboxDefault`·`mcpToolAccess` 렌더링은 과거 계약이므로 현재 버전에서
  의미가 유지되는지 재검토했다. 현재 adapter는 해당 두 옵션의 렌더링을 차단한다.
  적용되지 않는 설정을 출력한 뒤 제한이 성립한다고 표시하지 않는다.
- Codex Skill은 `~/.agents/skills` 및 작업 위치부터 저장소 루트까지의
  `.agents/skills`에서 발견하며 symlink를 지원한다. 같은 name의 Skill을 자동으로
  하나로 병합하지 않는다. Kit도 동명 자원을 단일 실효 자원으로 임의 축약하지 않는다.
- Antigravity의 개인 공통 탐색 루트는 `~/.gemini/config/`, 프로젝트 루트는
  `.agents/`다. `~/.agents/skills`가 두 클라이언트의 자동 공통 경로라고
  가정하지 않는다. 연결 또는 discovery manifest를 설정한 경우를 구별한다.
- Antigravity 문서는 `skills.json`·`agents.json`을 통한 외부 자원 탐색도
  제공한다. 기존 symlink와 함께 검토하되, Kit Manifest와 이 제품별 discovery
  manifest의 역할을 구별하고 실제 설치본에서 읽힌 경우에만 지원으로 승격한다.
- Antigravity discovery manifest는 기본 경로에 추가된다. `entries`뿐 아니라
  `inherits`, `include_only`, `exclude`와 경로 기준이 로딩 결과에 영향을 준다.
  파일을 만들었다는 이유로 기존 기본 경로의 동명 자원이 사라졌다고 판단하지 않는다.

공식 근거:

- [Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex Skills](https://learn.chatgpt.com/docs/build-skills)
- [Antigravity Customization discovery](https://antigravity.google/docs/customization-discovery)
- [Antigravity Custom subagents](https://antigravity.google/docs/subagents?tab=cli)

## 자원별 공통 관리 방식

| 자원 | 편집 원본 | 클라이언트 연결 |
|---|---|---|
| Skill | 가져온 bundle과 upstream baseline, Kit 수정본 | 기존 위치/링크 유지 편입부터 지원. 이후 검증된 copy·자원별 링크·discovery 참조 선택 |
| MCP | 가져온 native 설정 또는 typed definition과 endpoint/executable binding | 기존 서버의 선택 필드부터 편입. 인증·사용자 설정 보존, adapter로 변환 가능한 대상에 배포 |
| 서브에이전트 | 가져온 native Agent 또는 typed definition, 출처와 Kit 수정본 | 기존 파일 유지 관리. 모델·권한 등 의미가 다른 필드는 native variant에 보존하고 공통 배포 가능 범위 표시 |
| 지침 | 기존 Markdown과 Kit 수정본, 관리할 범위 | 사용자 본문 유지 편입. 선택한 파일/블록만 관리하고 클라이언트별 배포는 기존 병합 사용 |

Skill의 부속 `agents/` 메타데이터는 별도 서브에이전트 자원과 구별한다.
현재 공통 Skill 계약의 보수적 필드·디렉터리 제한을 임의로 해제하지 않고,
가져온 자원이 해당 계약을 벗어나면 native variant로 원형·출처를 보존한다.
native 관리/업데이트 추적과 다른 client로의 공통 변환 가능 여부를 따로 표시한다.
해석하지 못한 필드는 유지하며 해당 의미를 변경하는 자동 편집·배포만 차단한다.
MCP 인증 상태와 token 저장소는 클라이언트별이며, 원본 공유가 로그인 공유를
의미하지 않는다. manifest나 생성물에 literal credential을 복제하지 않는다.

## 구현 전에 고정할 변경 계약

### C01. 식별자와 상태를 분리한다

- 관리 자원은 `(kitId, scope.key, assetId)`로 식별한다. 기존 Manifest 안의 ID
  유일성 규칙은 유지하며 이름이나 hash를 자원 ID로 대신 사용하지 않는다.
- 발견 항목은 별도 `candidateId`와 `nativeName`, kind, scope, client/surface,
  configStore, 실제 파일/설정 selector의 locator를 가진다. 하나의 물리 자원이
  여러 화면에서 발견되면 관측 관계를 연결한다. 이름이 같다는 이유로 합치지 않는다.
- sourcePath는 현재처럼 표시용 경로로 유지하고, 가져오기에 필요한 실제 경로는
  서버가 재인가하는 locator로 관리한다. 요청자가 보낸 경로를 그대로 신뢰하지 않는다.
- 원본 revision, 배포 산출물 hash, 현재 대상 hash, 검증한 client/context를 따로
  기록한다. 같은 원본도 adapter·client definition 변경으로 출력이 달라질 수 있다.
- 관리 자원에는 출처 종류·locator, 추적할 버전/참조, 마지막 확인 버전/hash,
  마지막 수용 upstream baseline, Kit 수정 revision, 원래 설치 locator와 편입 시
  소유 단위, 현재 쓰기 주체를 연결한다. 출처가 불명이어도 기존 설치를 편입할 수
  있으며, 나중에 사용자가 출처를 연결하면 새 baseline 계획을 만든다.
- 외부 관리 관측 항목은 위치·링크 대상·연결 상태·관리 주체만 표시한다. Kit 관리
  revision이나 업데이트 상태를 요구하지 않으며 외부 항목이 바뀌어도 동기화 작업을 만들지 않는다.

| 상태 축 | 구분할 값·의미 |
|---|---|
| 등록 | 미등록 발견 / 외부 관리 관측 / 기존 위치 유지 편입 / Kit 관리 설치 / 등록 정보 불일치 |
| 소유권 | Kit 원장으로 입증 / 외부 관리자 근거 있음 / 미확인. 디렉터리·링크 존재는 소유권 증거가 아님 |
| 배포 | 미배포 / 계획됨 / 적용됨 / 외부 변경 / 제거됨 |
| 로딩 | 미확인 / 새 세션·reload 필요 / 관측됨 / 가려짐·비활성 / 실패 |
| 사용 | 미시험 / 지정한 시험 성공 / 실패. MCP 응답·Agent 완료·Skill 사용·지침 준수는 별도 관측 |
| 업데이트 | Kit 관리 자원에만 적용: 출처 미연결 / 최신 확인 / 새 upstream 있음 / Kit 수정 있음 / 병합 충돌 / 출처 접근 불가 |

로딩·사용 결과에는 시각, scope, 실행 위치, surface, client 빌드, 자원 revision을
묶는다. 자원·설정·클라이언트가 바뀌면 과거 결과를 현재 성공으로 표시하지 않는다.
`installed`, `supported` 등 기존 필드는 호환용 의미를 유지하고 새 상태를 덧붙인다.

### C02. 등록·편집·배포는 각각 검토 가능한 계획이다

1. 탐색은 파일과 원장을 읽기만 한다. 기본 Kit 초기화 함수도 호출하지 않는다.
   선택한 프로젝트와 검증된 상위 탐색 범위만 읽고 전체 홈/디스크를 재귀 검색하지 않는다.
   `resolveKitRoot`의 경로 해석을 bootstrap과 분리하고 CLI·GUI context도 읽기 전용
   해석을 사용한다. 빈 Kit의 생성은 기존 `init` 또는 명시적 GUI 초기화로 수행한다.
   기존 자동 생성에서 달라지는 최초 실행 흐름과 MANIFEST_REQUIRED 안내를 문서화한다.
2. 등록 계획은 candidate, 입력 hash, asset ID/scope, 기존 위치 유지 여부, 관리할
   파일/필드/블록, 출처·쓰기 주체, 복사/변환할 내용, Kit 원본·Manifest·원장 diff를
   보여 준다. 첫 편입의 기본은 현재 설치 내용과 경로를 유지하는 등록이다.
3. 등록 적용은 Manifest, baseline/Kit 원본, 선택한 관리 단위의 원장을 함께 반영한다. 일부만 남지 않도록
   잠금·고유 임시 경로·원자적 파일 쓰기·실패 복원을 사용하고 입력을 재검증한다.
   프로세스 중단은 pending 기록으로 감지하고 재편집/재등록을 막는다. 검토 복구로
   기존 원본·Manifest를 대조한 뒤 정리한다. 일반 예외 rollback을 crash recovery로
   설명하지 않으며 배포 journal의 기존 지원 범위를 자동 재사용했다고 주장하지 않는다.
4. 공통 Skill의 name이 asset ID와 다르면 조용히 변경하지 않는다. 기존 native 이름을
   보존하여 등록하고 공통 변환 시 필요한 변경을 별도 계획에 표시한다. `agents/`,
   확장 frontmatter, 내부 symlink, `.skill` 패키지는 native 원형을 유지한다.
   안전하게 해석할 수 없는 내용은 추적 대상으로 편입하고 변환·실행만 제한한다.
5. native Agent/MCP의 역변환은 명시적으로 지원한 필드만 처리한다. 변환하지 못한
   필드는 native variant에 보존한다. typed 변환이 불가능해도 동일 client의 자원으로
   등록·업데이트 비교를 지원하고, 다른 client 변환의 차단 사유를 따로 보여 준다.
   Markdown에서 논리 tool/provider 관계를 추측해 자동 등록하지 않는다.
6. 사용자가 선택한 기존 자원은 **명시적 편입 계획**으로 현재 위치에서 관리할 수 있다.
   편입 시 현재 hash와 선택한 소유 단위를 확정하고 기존 파일 바이트·모드·링크는
   유지한다. 동일 내용이라는 이유만으로 미선택 자원을 인수하지 않는다. 이미 다른 Kit나
   외부 설치 프로그램이 쓰는 위치는 외부 관리 항목으로 표시하고 해당 위치에 Kit
   관리 권한을 자동 부여하지 않는다. 외부 관리 자원의 인수는 현재 기본 흐름에 넣지 않는다.
7. 편집 계획은 기존 필드 전체를 보존한 상태에서 선택한 필드만 수정한다. Skill·지침의
   원본 본문/부속 파일 편집도 같은 서비스에서 source hash와 Manifest hash를 함께
   검사한다. native 확장 필드는 원형을 보존하고, 안전하게 보존할 수 없는 편집만
   막는다. 편집기를 열어 저장하는 것만으로 공통 부분집합으로 축약하지 않는다.
8. 원본 등록/편집은 클라이언트 배포가 아니다. 적용 대상은 별도 배포 계획에서 선택한다.
   관리 해제, 원본 파일 삭제, targets 비활성화, 설치 제거, 등록 삭제, rollback의 의미를 분리한다.
   기존 자원의 관리 해제는 등록·소유권만 해제하고 설치 내용은 유지하는 것이 기본이다.
   등록 삭제는 논리 tool/provider와 배포 중인 의존성까지 확인하며 자동 cascade하지 않는다.

새 API는 planId와 명시적 적용 요청을 사용한다. HTTP의 기존 세션 토큰/origin,
프로젝트 경로 인가, 공통 오류 매핑을 유지한다. CLI도 같은 서비스에서 계획을 출력한
뒤 적용한다. import 중 MCP 실행, Skill 스크립트 실행, 로그인·credential 변경은 하지 않는다.
비밀값은 diff·오류·로그·저장 계획·provenance로 유출하지 않는다. 환경 변수 참조는
변수 이름만 저장하고, 필수 binding이 없으면 자원 등록과 배포 준비 상태를 구별한다.

### C03. 연결 전략과 snapshot은 versioned 계약으로 추가한다

- v1의 기본 copy 의미는 유지한다. 선택 전략은 versioned Manifest/공통 source
  계약으로 선언하며 `copy`, `snapshot-link`, `discovery-reference`를 제안한다.
  현재 strict schema가 허용하지 않는 필드를 임의 삽입하지 않는다. S00에서 필드 위치와
  버전을 확정하고 구 reader가 새 의미를 무시하지 않고 거절하도록 한다.
- 전략은 client definition의 허용 능력과 교차 검사한다. 한쪽만 링크를 지원하면
  계획에 각 대상의 선택 전략을 표시한다. 링크 실패 시 copy로 조용히 바꾸지 않는다.
- snapshot은 클라이언트의 자동 탐색 루트 밖, 같은 사용자 전용 저장소에 보관한다.
  기본 후보는 `~/.agents-kit/snapshots/v1/<treeDigest>/`이며 사용자 지정 Kit도
  원본과 snapshot 저장소를 혼동하지 않는다. 생성 위치와 인가 루트는 S00에서 고정한다.
- tree digest는 정규화된 상대 경로·파일 바이트 hash·지원하는 권한 정보를 포함한다.
  파일/디렉터리 충돌, 대소문자 별칭, 제어 문자, 특수 파일, 내부 링크를 검사한다.
  최초 제안 상한은 전체 8 MiB, 파일당 1 MiB, 파일 256개, 깊이 16, 탐색 entry 512개로
  기존 bundle의 경계를 따른다. S00에서 fixture로 확정하며 큰 기존 자원은 기본 copy
  동작을 바꾸지 않고 새 연결 전략만 차단한다. snapshot은 바이트를 보존하지만 text
  전용 bundle v1과 허용 형식이 같다는 뜻은 아니다.
- plan은 예상 snapshot digest와 파일 diff만 계산한다. apply에서 검토한 바이트를
  재검증하고 임시 디렉터리 → 완성 snapshot → 대상 연결 순서로 반영한다.
  digest 경로에 기존 snapshot이 있으면 전체 내용도 일치해야 재사용한다.
- snapshot 경로는 자원/의존성 ID가 아니다. 원장은 자원 ID, revision, snapshot ID,
  대상 연결, 등록 소비자, 전이 의존성, rollback 참조를 기록한다. snapshot을 변경해서
  같은 경로를 재사용하지 않으며 원본 변경은 새 계획·새 snapshot으로 배포한다.
- 링크 자체의 문자열과 가리키는 snapshot의 내용 무결성을 모두 확인한다. 같은
  링크를 유지한 채 내용만 수정된 경우도 drift다. 사용자에 의한 로컬 변경을 OS가
  불가능하게 막는다는 보장은 하지 않는다.
- 원장 버전은 현재 1/2/4 읽기를 보존하고 새 의미를 기록할 때만 올린다. 3은 legacy
  전역 원장 표식이므로 재사용하지 않는다. 구버전으로 원장을 낮추지 않는다.

### C04. 공유 링크 수명주기와 복구

- 같은 프로젝트의 같은 Skill 경로는 한 연결과 여러 소비자를 기록한다. 같은 연결의
  revision 변경에는 현재 공유 계약처럼 모든 등록 소비자의 참여가 필요하다.
  서로 다른 물리 경로는 다른 revision을 유지할 수 있으며 부분 갱신 상태를 보여 준다.
- 기존 copy → link, link → copy는 명시적 이관 계획이다. 파일별 소유권과 hash를
  검증하고 미관리 추가 파일이 있으면 디렉터리를 교체하지 않는다. 과거 바이트·권한·
  연결 상태를 복구할 수 있게 보존한다. 외부 링크를 Kit 소유 링크로 추측하지 않는다.
  현재 FileTransaction의 directory 거절을 없애는 것만으로 구현하지 않는다. 제한된
  디렉터리 staging/rename·정확한 inventory backup·빈 디렉터리 처리와 충돌 검사를
  새 작업으로 정의한다. rename은 같은 파일시스템의 검토된 위치에서 수행하고 해당
  디렉터리 상태도 journal/rollback에 기록한다. 임의 재귀 삭제를 도입하지 않는다.
- 한 소비자 제거는 RELEASE, 마지막 소비자 제거는 연결만 해제한다. 원본 snapshot을
  동시에 지우지 않는다. typed Agent/MCP의 저장소 전체 설정 제거 의미는 이 규칙과 다르다.
- snapshot 생성, 연결 교체, 원장 commit 전후를 journal에 기록한다. 저장 계획 재개,
  backup, rollback, SIGKILL 후 검토 복구가 symlink/디렉터리 상태를 이해해야 한다.
  기존 일반 link 예외를 그대로 둔 채 공통 링크의 복구가 지원된다고 표시하지 않는다.
- snapshot 보관 참조는 활성 연결뿐 아니라 upstream baseline·병합 부모·보류한 갱신,
  저장 계획, journal, rollback 이력과 백업까지 포함한다. 첫 구현에서는 자동 GC하지 않는다. 향후 정리는 전체 참조와
  인가를 검증한 별도 계획에서만 수행하며 확인 불가 참조가 있으면 보존한다.
- 프로젝트 링크는 로컬 설치물이다. Git checkout 이동·홈 변경·다른 PC로의 복사를
  자동 지원으로 간주하지 않는다. 이동 후 재계획을 안내하고 portable 배포는 기존
  resource bundle의 바이트 입력을 사용한다. host 절대 경로를 bundle에 넣지 않는다.

### C05. 물리 저장소와 전역 의존성

- 같은 client/configStore·scope·실제 target·selector의 typed 산출물은 동일 자원과
  동일 바이트일 때 한 쓰기로 합산한다. configStore 이름만 같다고 합치지 않는다.
  다른 자원/Kit, 다른 출력, 겹치는 소유 selector는 충돌로 유지한다.
- 모든 요청 surface의 capability/runtime 검사를 먼저 통과해야 합산한다. 한 화면의
  파일 지원이나 검증 성공이 다른 화면의 gate를 대신하지 않는다. 같은 저장소를 읽는
  미선택 화면에도 파일 변경이 보일 수 있음을 계획에 표시한다.
- 통합 조회는 전역 Manifest와 선택 프로젝트 Manifest를 함께 읽되 각각의 source,
  scope, 동일 이름 충돌을 보존한다. 조회만 합치고 단일 desired state로 저장하지 않는다.
- 교차 scope 참조는 `(kitId, scope, assetId)`를 포함한 versioned 참조와 catalog가
  필요하다. 기존 bare ID는 기존 Manifest 안에서만 해석한다. global → project 및
  project A → project B 참조는 계속 거절한다. providerId도 scope까지 식별해야 한다.
- 프로젝트 적용은 전역 **클라이언트 파일**을 쓰지 않는다. 전역 자원의 설치 revision,
  hash, configStore, 논리 tool binding, client의 실제 발견 가능성을 전제로 확인한다.
  전역 source만 존재하거나 다른 surface에만 설치됐으면 충족으로 처리하지 않는다.
- apply 직전 재검사만으로 동시 전역 갱신을 막았다고 주장하지 않는다. 전역 → 프로젝트
  순서의 잠금, 적용 중 전역 전제 고정, 완료 후 역참조 기록의 일관성을 설계한다.
  메타데이터가 두 원장에 걸치면 해당 변경도 journal/복구 계약에 포함해야 한다.
- 전역 갱신·제거·rollback도 등록 프로젝트의 역참조를 검사한다. 의존 revision을
  무효화하면 선행 해제/재배포가 필요하며 자동 cascade하지 않는다. 알려진 프로젝트의
  등록부·원장에 접근할 수 없거나 중단 복구가 필요하면 안전을 증명할 때까지 차단한다.
- 역참조 등록부는 기존 전역 배포 메타데이터 아래에 두고 프로젝트 원장의 qualified
  참조와 대조한다. 인덱스가 추적하는 범위는 Kit에 등록된 프로젝트다. 미등록 native
  자원이나 사용자가 직접 바꾼 클라이언트 설정까지 안전하게 관리한다고 주장하지 않는다.
- S05-1 통합 조회는 먼저 제공할 수 있다. S05-2의 참조·역참조·잠금·복구가 완성되기
  전에는 교차 scope 의존성 자동 적용을 계속 차단한다. 여러 scope의 클라이언트 파일을
  한 번에 바꾸는 혼합 원자적 배포는 이 계획 범위 밖이다.

### C06. 외부 자원 관측과 Kit 관리 자원의 편입·재가져오기

#### 외부 관리 링크는 존재와 연결 상태를 표시한다

- ego-browser 같은 외부 관리 링크는 탐색 목록에서 이름, 링크 위치·연결 대상,
  연결 상태, 관리 주체를 표시한다. 주체를 입증하지 못하면 미확인으로 표시한다.
  symlink라는 이유만으로 모두 외부 관리로 분류하지 않으며 Kit 소유 링크와 구별한다.
- 표시를 위해 앱 내부 Skill 내용을 복사하거나 baseline·수정본을 생성하지 않는다.
  버전 조회·업데이트 검사·다운로드·재가져오기·병합·재배포·소유권 인수를 수행하지 않는다.
  외부 링크에는 해당 작업 버튼을 기본 제공하지 않고 API에서도 관리 모드를 검증한다.
- 현재 관측(2026-11-05)은 `~/.agents/skills/ego-browser` →
  `~/.local/share/ego/ego-skills` → 앱 내부 Skill이다. Kit는 이 연결을 보존한다.
  다시 탐색할 때 보이는 연결 상태만 갱신하며 외부 업데이트를 사용자 할 일로 만들지 않는다.
- 링크 표시를 위해 `/Applications` 전체 탐색이나 앱 내용 읽기 인가를 선행시키지 않는다.
  허용된 링크 metadata만 관측하고 확인할 수 없는 대상은 상태 확인 불가로 표시한다.

#### 처음 편입할 때

- 이 절부터는 사용자가 Kit 관리로 선택한 자원의 수명주기다. 위 외부 관리 관측만으로
  Manifest desired state·소유권·동기화 대상을 자동 생성하지 않는다.
- 사용자 설정 파일의 현재 이름·경로·내용·링크·권한을 보존한다. 선택한 자원을 Manifest에
  등록하고 기존 설치와 연결하며, 내용 변경이 없는 편입은 client 로딩/사용 성공을
  요구하지 않는다. 이후 해당 자원을 변경·재배포할 때 기존 capability gate를 적용한다.
- **기존 symlink는 symlink 상태 그대로 편입한다.** 최초 `lstat` 결과, `readlink`의
  링크 문자열(상대/절대 구분 포함), 인가 후 관측한 연결 사슬·최종 대상·내용 revision을
  별도로 기록한다. 편입·관리 해제·metadata rollback은 링크와 중간 연결을 쓰지 않는다.
  최종 `realpath`를 기존 링크의 새 대상으로 써서 특정 앱 버전에 고정하지 않는다.
- Kit의 baseline/수정본 확보와 다른 client용 snapshot 배포가 필요해도 기존 링크를
  복사 디렉터리나 Kit snapshot 링크로 자동 교체하지 않는다. Kit에서 이 자원을 수정할 때는
  원래 앱 내부로 따라가 쓰지 않고 별도 Kit 수정본에 반영한다. 기존 연결을 Kit 수정본으로
  바꾸는 경우에만 별도 전환 계획과 현재 쓰기 주체 검증을 수행한다.
- 지침은 전체 파일과 선택한 관리 범위를 구별한다. 기존 사용자 본문에 자동 marker를
  삽입하지 않고 처음에는 hash/범위 기반 기록으로 편입한다. 변경 시 범위를 안전하게
  식별하지 못하면 구체적인 블록 이관 계획을 보여 준다. MCP는 선택한 서버/필드만,
  Skill·Agent는 선택한 bundle/파일만 관리하고 같은 디렉터리의 다른 자원을 보존한다.
- source는 Manifest의 versioned upstream 계약으로 선언하고 accepted baseline과
  조회 이력을 저장한다. locator는 출처를 찾기 위한 인가된 참조이며 논리 자원/tool
  관계를 대신하지 않는다. 기존 `source`의 Kit 내부 상대 경로 제약은 유지한다.
- 로컬 설치 경로, 사용자가 지정한 원본 디렉터리, Git의 repository/ref/subpath,
  설치 프로그램의 package ID/version 등 출처 종류를 구별한다. 첫 구현은 로컬 출처부터
  완성하고 Git·패키지 source adapter를 같은 계약으로 추가한다. 출처를 모르면 현재
  설치본을 최초 baseline으로 편입하고 나중에 출처를 연결할 수 있다.
- 기본 공통 모델에 없는 native metadata·알 수 없는 필드·지원 파일도 보존한다.
  공통 부분과 client 전용 variant를 같은 논리 자원에 연결한다. 원형 보존/추적 가능,
  동일 client 편집 가능, 다른 client 배포 가능 상태를 구별한다. 변환을 지원하지 않는
  이유로 목록에서 빠뜨리거나 기존 동작을 축소한 버전으로 교체하지 않는다.
- 인증 값은 Kit 원본·baseline·native variant에 복제하지 않는다. 기존 인증 설정은
  현재 위치에 유지하고 참조/사용자 소유 단위로 연결한다. 내보내기·다른 client 배포에
  필요한 인증은 별도 binding을 요구한다. credential 변경을 편입의 조건으로 삼지 않는다.

#### 업데이트를 다시 가져올 때

업데이트 가져오기는 출처의 새 내용을 읽어 후보를 만들고 비교·병합하는 작업이다.
기존 설치나 Kit 수정본을 먼저 덮어쓰지 않는다. 마지막 수용 원본 `B`, 현재 Kit 수정본
`K`, 새 upstream `U`를 보관하고 다음 규칙으로 갱신 계획을 만든다.

| 비교 결과 | 갱신 계획 |
|---|---|
| `U = B` | 출처 변경 없음. `K`와 현재 설치 유지 |
| `K = B`, `U ≠ B` | Kit 자체 수정 없음. 새 upstream을 갱신 후보로 제시 |
| `K = U` | 이미 같은 변경. 중복 수정 없이 baseline 갱신 후보로 정리 |
| 서로 다른 필드/파일만 변경 | 형식별 검증을 통과하면 3-way 병합 후보와 전체 diff 제시 |
| 같은 부분을 다르게 수정 / 한쪽 삭제·다른 쪽 수정 | 충돌로 표시. 내 수정 유지 / upstream 수용 / 직접 병합을 항목별 선택 |
| 출처 삭제·접근 불가·버전 불명 | 현재 Kit·설치 보존. 삭제 후보 또는 확인 불가 상태로 표시 |

- `B`는 사용자가 마지막으로 수용한 upstream이다. 새 버전을 발견하거나 가져왔다는
  이유로 갱신하지 않는다. 거절·일부 수용·충돌 보류 시 남은 차이를 계속 추적한다.
  부분 수용은 자원/파일/필드별 해결 내역을 기록하고 전체를 수용한 것처럼 처리하지 않는다.
- 실제 설치 `D`의 외부 변경은 마지막 적용본 `L`과 별도로 비교한다. `D ≠ L`이면
  현재 설치의 수정을 Kit로 가져올지, Kit 내용을 적용할지, 분리 보존할지 보여 준다.
  출처 변경, Kit 수정, 설치본의 수동 수정을 같은 drift로 합치지 않는다. 첫 편입의 `L`은
  그때 관측한 설치 상태이며 Kit가 파일을 생성했다는 뜻이 아니다.
- 출처 locator가 Kit 배포 대상과 같으면 Kit 자신의 적용을 upstream 업데이트로
  재수입하지 않는다. 독립 원본과 설치 관측용 출처를 구별하고 Kit가 기록한 적용은
  `L` 갱신으로 처리한다. 사용자/외부 프로그램의 수정은 설치 변경으로 제시한다.
- 파일 추가·삭제·native metadata 변경·이름 변경 후보를 포함한다. 삭제는 자동 전파하지
  않으며 실제 제거는 소유권·소비자·의존성을 확인한 별도 배포 작업으로 검토한다.
- 갱신 적용은 baseline, Kit 수정 revision, 수용/보류 내역을 일관되게 commit한다.
  클라이언트 반영은 연결된 배포 계획에서 검토한다. 하나의 UI 흐름에서 두 계획을
  연속 검토할 수 있고, Kit만 갱신한 상태와 설치까지 반영한 상태를 구별한다.
- 출처를 바꾸거나 최초 baseline을 입증할 수 없으면 기존 내용을 유지한 재연결 계획을
  만든다. 다른 출처를 같은 원본의 새 버전으로 가정해 덮어쓰지 않는다. 갱신 rollback은
  Kit baseline·수정본·수용 기록을 복원하며 외부 출처나 이미 업데이트된 외부 설치를
  함께 되돌리지 않는다. 클라이언트 배포 rollback은 기존 별도 계획을 사용한다.
- import/refresh/병합은 source 내용을 데이터로만 읽는다. 출처에 든 설치 스크립트,
  hook, MCP command를 실행하지 않는다. Git 업데이트로 Kit의 수정 작업 트리를
  `pull`/reset하지 않는다. 선택한 출처·참조를 재인가하고 가져온 버전/hash를 고정한다.
- 첫 버전은 사용자가 실행하는 업데이트 확인·다시 가져오기·충돌 해결을 제공한다.
  주기적 확인/자동 반영은 별도 명시적 설정이 생길 때만 추가하며 선행 조건으로 넣지 않는다.

예: 외부 ego-browser 링크는 목록에 외부 관리로 표시한다. 사용자가 Kit 관리로 선택한
개인 reviewer Skill은 기존 내용 편입 → Kit 수정 → 필요 시 원본 재가져오기 →
비교·병합 → 선택한 client에 변경 계획 적용으로 관리한다.

### C07. Skill의 범위·배포 대상·호환성을 분리한다

추가 요구(2026-11-06). **[공통 variant 배포 계약](../contracts/skill-distribution-v1.md)의
common/shared 범위를 구현했다. native·격리·variant 원본 갱신을 포함한 아래 전체 흐름의
구현 완료를 뜻하지 않는다.**
전역 Skill은 프로젝트에 걸쳐 사용할 자원이라는 뜻이다. 모든 클라이언트에 배포하거나
모든 클라이언트에서 같은 의미로 실행할 수 있다는 뜻으로 해석하지 않는다.

| 구분 | 관리할 의미 | 예 |
|---|---|---|
| 범위 | 자원이 속한 전역/프로젝트 origin | 전역 `review` Skill |
| 배포 대상 | 사용자가 적용을 요청한 client/surface | Codex CLI만 선택 |
| 호환성 | 선택한 원본/variant를 해당 환경에서 사용할 수 있는 근거 | Codex 검증됨, Claude 미확인 |
| 원본/variant | 공통 bundle 또는 특정 client의 원형·확장·수정본 | 공통 절차와 Codex 전용 메타데이터 |
| 실제 노출 | 설치 경로·추가 discovery 설정을 통해 읽을 수 있는 환경 | 같은 프로젝트 경로를 읽는 다른 client |

- 현재 `targets.<clientId>.assetIds`는 대상 선택이고 공통 source v2의
  client/surface override는 **연결 전략** 선택이다. 둘을 본문·도구·확장 필드의
  의미 호환성 검증으로 취급하지 않는다. 현재 공통 Skill 계약은 Codex·Antigravity만
  대상으로 한다. Claude Code 정의·기존 native 경로가 있다는 사실로 이 계약의
  Claude 지원이 확보됐다고 표시하지 않는다.
- 기존 Skill을 가져오면 원래 client/surface와 native 원형을 보존한다. 그 출처만으로
  다른 대상과 호환된다고 추정하지 않는다. 호환성을 모르면 Kit 사본 관리·편집·갱신은
  유지하되 다른 client로의 자동 배포는 차단하고 사유를 표시한다. 기존 manifest와
  이미 검증된 배포는 호환 reader로 유지하며 새 기본값으로 자동 재배포하지 않는다.
- 공통 절차만으로 충분한 Skill은 하나의 공통 원본을 사용한다. client 전용 지시·도구·
  확장이 필요한 경우 명시적인 대상 variant를 선택한다. 공통 부분이 안전하게 분리되지
  않으면 native bundle 전체를 별도로 유지한다. 이름이 같다는 이유로 서로 다른 Skill을
  합치거나 전용 필드를 삭제하여 변환 성공으로 표시하지 않는다. 예를 들어 Codex의
  `agents/openai.yaml`은 원형에 보존하고 다른 client에서 의미가 같다고 가정하지 않는다.
  근거: [OpenAI 공식 Skill 문서](https://learn.chatgpt.com/docs/build-skills).
- 배포 전 선택된 variant의 형식·논리 Tool 요구·provider binding·정책과
  client/surface/version capability를 함께 검사한다. Markdown의 전용 도구명·문장을
  자동 변환하거나 관계로 추측하지 않는다. 형식 통과·실제 발견·사용 시험을 분리하고
  본문의 임의 지시까지 의미 호환성이 증명됐다고 표시하지 않는다.
- 공유 경로에서는 대상 선택만으로 client 격리가 성립하지 않는다. client definition의
  탐색 규칙과 관측 가능한 추가 discovery 설정으로 알려진 추가 노출을 계획에 표시한다.
  전용 배포에 필요한 격리 방법이 검증되지 않으면 해당 연결은 차단한다. 다른 client의
  기존 설정을 임의로 비활성화하거나 ego-browser 같은 외부 링크를 교체하지 않는다.
- 갱신·병합 기준과 revision은 선택된 원본/variant별로 보존한다. 실제 산출물·설치 영수증과
  저장 계획에 선택 결과를 연결하고, 영향을 받은 원본·variant·정의·binding 변경 시
  관련 계획과 검증을 다시 확인한다. 한 variant의 설치 성공으로 다른 대상을 승격하지 않는다.

구현 순서는 versioned Manifest/호환 reader → 순수 대상·variant 선택과 진단 →
기존 adapter·배포/영수증·갱신/복원 연결 → 공통 CLI/HTTP/GUI 노출이다.
경로·탐색·지원 범위는 client definition에, 변환은 adapter에 둔다. 이 추가 요구는
PR11에서 독립된 단위로 진행하고 기존 관리 흐름이나 PR10 교차 scope의 완료로 합산하지 않는다.

## 실행 순서

### 확정 방향에 따른 구현 요약

기존 자원 편입과 재가져오기를 우선 사용자 흐름으로 완성한다. 아래 단계는 상세
S00~S06/PR 목록을 실행 순서로 묶은 것이며 각 단계에 CLI·HTTP·GUI와 테스트를 함께 연결한다.

| 순서 | 구현 내용 | 사용자가 확인할 완료 기준 |
|---|---|---|
| 1. 계약·회귀 기준 | 기존 테스트 실행 환경 확보. 자원 ID/scope, 출처, 원래 설치/링크, 관리 주체, baseline·Kit 수정본·적용본을 versioned 계약으로 고정 | 기존 copy/merge/apply/rollback 유지, 새로운 관리 기록을 구버전이 무시하지 않음 |
| 2. 기존 자원 탐색 | 링크·다단 연결·일반 파일과 네 자원, 전역/프로젝트·surface별 관측 및 관리 주체 표시 | ego-browser는 외부 관리로 표시되고 링크가 유지됨. 동명 자원이 섞이지 않음 |
| 3. 기존 상태 그대로 편입 | Manifest·관리 기록·baseline 등록, native 원형 보존, 관리 해제·편입 취소 | 편입 전후 파일/모드/readlink 문자열 동일. 관리 해제 후에도 기존 설치 사용 가능 |
| 4. Kit 수정본 편집 | 본문·native 확장 보존, typed 왕복 보존, 출처/수정본 분리, 안전한 편집 계획·적용 | 앱 내부 원본을 쓰지 않고 Kit 수정본만 바뀜. 무엇이 설치에 아직 반영되지 않았는지 표시 |
| 5. 업데이트 재가져오기 | 로컬 출처부터 변경 확인, B/K/U 병합, D/L 비교, 충돌 선택·부분 수용·보류·갱신 복구 | 업데이트와 내 수정이 함께 남고 충돌 시 기존 설치·Kit 수정본이 유지됨 |
| 6. 검토 후 client 반영 | 기존 배포 서비스에서 대상별 diff·소유권·의존성 검사, 적용·제거·rollback 연결 | Kit에 가져온 것과 실제 반영한 것이 구별되고 실패 시 이전 설치 상태 복원 |
| 7. 지원 범위 확장 | Kit 관리 자원의 Git/package 출처 연동, 새 snapshot 연결, 공통 배포·scope 의존성, HTTP/인증·desktop/IDE의 개별 검증 | 각 검증된 조합만 추가하고 기존 설치·외부 updater를 보존 |

1차 완료는 **ego-browser 탐색 → 외부 관리·연결 상태 표시**와
**개인 자원 선택 → 현재 상태 유지 편입 → 상태 확인 → 관리 해제**다.
2차 완료는 Kit 관리 자원의 **수정 → 필요 시 원본 재가져오기 → 병합 → 대상별 반영/복원**이다.
기존 배포 방식으로 지원 가능한 반영은 먼저 연결하고 새 snapshot-link 완성을 기다리지 않는다.

ego-browser처럼 최종 대상이 앱 내부인 링크도 관측 목록에 표시한다. 외부 관리 링크의
표시에 Kit import/source binding을 요구하지 않는다. Kit 관리로 선택한 별도 자원의
내용을 가져올 때만 해당 source 읽기 인가와 기존 경계 검증을 수행한다.

### S00. 계약·변경 영향 고정

선행 조건: 없음. S01의 조사와 병행할 수 있지만 새 계약 구현보다 먼저 완료한다.

- C01~C06을 ADR과 versioned 계약으로 정리한다. discovery/import/adoption/refresh,
  native variant·upstream baseline, snapshot/link, 실효 inventory, 교차 scope 참조의
  데이터 예·오류·상한·호환 reader를 포함한다.
- 기존 common-source/client-definition/shared-ownership/persistent-deployment/
  typed-removal/resource-bundle 계약 중 바뀌는 부분을 명시한다. bundle v1에
  native variant·upstream 선언·새 전략·교차 scope 참조를 넣을 수 없으면 명시적으로
  거절하고 몰래 축약하지 않는다. 로컬 출처 경로를 다른 호스트의 출처로 재사용하지 않는다.
- 이 문서의 G01~G15와 아래 T01~T26을 traceability에 연결한다. 새 런타임을 만들거나
  기존 검증되지 않은 권한 mapping을 통과시키는 방향으로 작업 범위를 늘리지 않는다.

완료 기준: 기존 v1 기본 fixture가 유효하고, 명시적으로 교정하는 과거 mapping 외에는
새 선언이 없는 입력의 동작을 유지한다. 계약 문서와 신규 golden fixture를 먼저 검토할 수 있다.

### S01. 현재 클라이언트 계약과 지원표 갱신

수정 지점: `clients/codex.yaml`, `clients/antigravity.yaml`,
`lib/domain/client-definition.js`, `lib/adapters/agents/index.js`,
`lib/application/plan-verified-client-deployment.js`, 검증 scripts 및 지원 문서.

- CLI·desktop·IDE별 현재 경로, 발견 방법, 새 세션/재시작 조건을 정리한다.
- 기존 pinned 버전 증거는 보존하고 새 버전·OS·아키텍처·실행 파일 증거를 추가한다.
- Agent의 기본 역할과 실제 강제 가능한 옵션을 분리한다. 지원되지 않는
  sandbox/MCP mapping은 차단 또는 명시적 대안으로 처리한다.
- AGY desktop MCP의 `ui-only` 분류는 공식 파일 설정 계약과 대조하고,
  실제 검증 후 해당 capability만 갱신한다.

상세 작업:

| 작업 | 변경 내용 | 검증·산출물 |
|---|---|---|
| S01-1 | adapter에 resolved client/surface/버전 계약을 전달. 최신 Codex에 무효인 sandbox/MCP 옵션은 거절하고 기본 역할 정의만 허용 | `agent-definition`, `agent-tool-bindings`, Agent adapter·profile fixture. 권한 문장으로 대체하지 않음 |
| S01-2 | evidence가 자원 프로필·전송/인증 방식·copy/link/discovery 연결 전략을 구별하도록 확장. adapter/definition 변경 시 재검토 | `client-definition-v2.md` 후속 계약, 검증 scripts, 현재 빌드별 재현 기록. CLI 증거는 기존처럼 실행 파일 hash 확인 |
| S01-3 | 현재 경로와 legacy 경로를 discovery 위치와 쓰기 위치로 분리. Codex Agent 등록 방식·AGY 전역 경로 변경의 과거 기록 보존 | 과거 위치는 탐색만 하고 이사는 별도 계획. 오래된 등록 섹션·중복 설치의 영향 설명 |

S01-1의 새 gate를 먼저 넣고 새 실기 기록은 이후에 확보한다. 과거 버전 계약을
최신 버전에 무조건 적용하지 않으며, 과거 버전 지원이 필요하면 명시적 별도 profile로
보존한다. 기존 기본 역할/stdio 증거가 sandbox·HTTP·OAuth 지원까지 증명하지 않는다.

완료 기준: 파일 생성 가능, 설치 흔적, 실제 자원 로딩, 실제 사용을 서로 다른
상태로 반환한다. 과거 CLI 검증을 앱/IDE 지원 증거로 재사용하지 않는다.

### S02. 기존 자원 탐색·편입·편집·업데이트 가져오기

수정 지점: `local-installation-discovery-service.js`, client definition의 discovery
계약, `manifest-editing-service.js`, 소유권/배포 상태 저장소, CLI·HTTP API,
신규 import/adoption/refresh application service와 source adapters.

- `lstat`/`realpath`로 링크와 대상을 구분하고 끊김·순환·허용 범위 이탈을 표시한다.
- Agent 파일, 프로젝트 자원, surface별 유효 탐색 경로를 함께 조회한다.
- 동일 이름만으로 자원을 합치지 않는다. scope·client surface·실제 경로·
  내용 hash·출처를 비교하고 중복/충돌을 구별한다.
- 탐색은 읽기 전용이다. 사용자가 고른 자원만 등록 계획으로 바꾼다.
- 첫 편입은 기존 설치·외부 원본·링크를 유지하며 Manifest와 관리 기록을 연결한다.
  baseline과 Kit 편집본을 확보하고 원형 보존/native variant, 공통 변환 가능 범위를
  표시한다. 이 작업은 Kit 관리로 선택한 자원에만 적용한다. ego-browser 같은 외부
  관리 링크는 존재·연결 상태·관리 주체만 표시하고 baseline이나 수정본을 만들지 않는다.
- Kit 관리 자원의 출처 추적과 재가져오기를 이 단계의 기본 범위로 포함한다. versioned
  upstream locator와 source adapter를 통해 읽고, 기존 `source`의 symlink escape
  제한을 전역 완화하거나 원본 파일을 강제 이동하지 않는다.
- MCP 내용 가져오기는 literal secret을 출력하지 않고 환경 변수/인증 참조로
  전환할 수 있는 조합만 계획한다. 모르는 옵션을 버리고 성공 처리하지 않는다.

상세 작업:

- **S02-1 최소 수정:** 기존 discovery reader에서 symlink 항목을 조용히 버리지
  않는다. 정상·끊김·순환·대상 형식 오류·권한 부족을 구별한다. 허용 범위 밖 링크는
  존재와 이슈만 표시하고 대상 내용은 읽지 않는다. `existsSync`만으로 끊김을 부재로
  처리하지 않는다. 이 단계는 import나 client file 변경 없이 끝낼 수 있다.
  `kit-paths.js`, CLI와 `gui/server/context.js`의 bootstrap 분리도 포함해
  최초 실행의 탐색 화면이 원본 Kit를 자동 생성하지 않도록 한다.
- **S02-2 탐색 확장:** surface별 유효 capability를 사용해 여러 탐색 위치, 프로젝트와
  검증된 상위 경로, Agent 두 native 형식, 지침을 지원한다. AGY discovery manifest의
  참조·제외·순환/깊이를 해석하되 인가 밖 참조는 따라가지 않는다. 사용자 패키지와
  plugin 경로는 출처를 표시하고 지원하지 않는 가져오기를 실행하지 않는다.
- **S02-3 등록·편집:** 신규 import application service를 만들고 기존
  `manifest-editing-service.js`와 안전한 원본 쓰기를 결합한다. 등록 계획/적용과
  source 편집 계획/적용은 client 배포 서비스와 구분하되 파일 트랜잭션·오류 처리는
  재사용한다. 기존 편집의 stale 오류 분기와 고정 `.tmp` 경로 충돌도 회귀 검증한다.
- **S02-4 기존 설치 편입:** 현재 hash·native 표현·소유 단위·출처·쓰기 주체를
  기록한다. 기존 파일/모드/링크를 유지하는 metadata-only adoption과 관리 해제를
  제공한다. 최초 편입·편입 취소에 파일 배포를 강요하지 않는다. 명시적 쓰기 권한
  전환은 별도 계획에서 검증하고, 미편입 사용자 설정과 외부 updater를 보존한다.
  외부 관리로 표시한 항목은 편입 대상에 자동 포함하지 않는다. ego-browser 표시를
  위해 앱 bundle 내용 읽기나 source binding을 요구하지 않는다. 사용자가 별도로 선택한
  Kit 관리 원본에만 source 읽기 인가를 적용한다.
- **S02-5 재가져오기·병합:** source 확인/가져오기, B/K/U 3-way 비교, 설치 D/L 대조,
  충돌 해결·부분 수용·보류, baseline/revision commit과 rollback을 구현한다. 로컬
  출처부터 시작해 Git·package source adapter를 추가한다. 업데이트 확인만으로
  원본/설치를 덮어쓰지 않으며 적용/저장 중 중단 복구도 시험한다.
- 탐색 목록은 이름·경로·허용한 metadata만 기본 반환한다. 선택한 자원의 내용은
  별도 검토 단계에서만 읽는다. MCP의 URL userinfo/query, headers, env, args 및
  Skill 부속 파일에도 credential이 있을 수 있으므로 원문을 API 오류에 포함하지 않는다.

추가 수정 파일: `lib/domain/client-definition.js`, `lib/interfaces/http/error-mapper.js`,
`lib/security-boundary.js`의 **기존 인가 호출부**, `bin/cli.js`,
`gui/server/routes/deploy.js`, `gui/src/api/deploy.ts`. 경계 함수를 전역 완화하지 않는다.

완료 기준: 실제 ego-browser 링크가 목록에 나타나고 출처·소유자·관리 상태가
표시된다. 같은 이름의 서로 다른 Agent/MCP가 하나의 관리 자원으로 오인되지 않는다.
ego-browser에는 Kit 소유권·baseline·재가져오기 작업이 생기지 않고 원래 링크를
유지한다. Kit 관리로 선택한 개인 자원은 첫 편입·관리 해제 후 기존 파일/모드/링크가
동일하고, 새 원본 수용·충돌 보류·실패 복원까지 확인한다.
다른 client로의 변환은 별도 지원 판정이며 편입 성공의 필수 조건으로 강요하지 않는다.

### S03. 공통 Skill 링크와 공유 소유권 통합

수정 지점: `plan-client-deployment.js`, `prepare-managed-link-deployment.js`,
`shared-resource-deployment.js`, apply/remove/rollback 및 배포 상태 저장소.

- 기존 copy 동작을 유지하면서 공통 자원에 명시적인 연결 전략을 추가한다.
- 전체 skills 디렉터리 링크 대신 Manifest에서 선택한 자원별 링크를 계획한다.
- 프로젝트의 동일 `.agents/skills/<id>`는 공유 소비자로 한 번만 관리한다.
  전역에서는 Codex·AGY의 경로 차이를 client definition으로 해결한다.
- 검토 후 반영한다는 계약을 지키려면 링크는 검토한 내용의 배포 snapshot을
  가리킨다. 편집 중인 원본을 링크해서 계획 없이 활성 내용이 바뀌게 하지 않는다.
- snapshot 경로·내용 hash·소비자·의존성을 기록한다. 새 원본은 새 계획으로
  반영하며, 이전 snapshot은 다른 소비자와 rollback 참조가 끝날 때까지 유지한다.
- AGY discovery manifest가 실제로 동작하면 같은 snapshot을 참조하는 대안을
  지원하되, 링크와 참조 중 어떤 연결이 선택됐는지 계획에 표시한다.

상세 작업과 순서:

1. **S03-1 snapshot 준비:** versioned tree descriptor와 snapshot store를 추가하고
   변경 diff·재검증·충돌·보관 참조를 구현한다. pure plan은 snapshot을 생성하지 않는다.
2. **S03-2 공유 연결:** `prepareSharedDeployment`가 파일별 copy 이외의 연결 소유권도
   표현하도록 확장한다. 별도 일반 link 경로로 우회해 공유 소비자를 잃지 않게 한다.
   첫 배포·재적용 SKIP·새 소비자 REGISTER·공동 갱신·RELEASE를 모두 지원한다.
3. **S03-3 안전한 이관:** 기존 소유 copy 디렉터리의 정확한 파일 목록과 미관리 잔여물을
   검사한 뒤 copy ↔ link 전환을 계획한다. 전체 skills 디렉터리·외부 소유 링크는 대상이 아니다.
4. **S03-4 지속성:** state/backup/FileTransaction/journal/rollback/saved-plan의 새
   연결 형식과 digest를 함께 구현한다. snapshot 생성 중·연결 교체 후·원장 commit
   전후의 강제 종료 시험을 통과한 뒤 해당 전략의 실제 적용을 활성화한다.
5. **S03-5 discovery 참조:** 검증 후 AGY adapter에서 `skills.json`의 Kit 소유 entry만
   병합한다. 기존 entries/inherits/exclude를 보존하고 동일 snapshot의 이중 로딩,
   가림·비활성 상태를 표시한다. 참조 경로는 AGY가 실제 해석하는 기준으로 렌더링한다.

추가 수정 파일: `common-source-definition.js`, `common-source-validator.js`,
`deployment-state-store.js`, `deployment-backup-store.js`, `file-transaction.js`,
`deployment-journal.js`, `saved-deployment-plan-store.js`, `rollback-deployment.js`,
`manifest-deployment-service.js`. snapshot store는 신규 infrastructure 모듈로 둔다.
bundle exporter/helper는 지원하지 않는 새 선언을 명확히 거절하는 회귀 검사를 추가한다.

완료 기준: 두 클라이언트 연결 후 하나만 제거해도 나머지는 정상 사용한다.
원본 변경 전후, 외부 링크 교체, 중간 실패 및 rollback을 모두 검증한다.
원본을 편집해도 적용 전 설치 내용은 유지되고, 링크 대상 snapshot을 외부 수정하면
진단·적용·복원이 이를 탐지한다. 복구가 끝나기 전 일반 적용을 다시 시작하지 않는다.

### S04. 전역·프로젝트의 공통 배포 범위 완성

수정 지점: 기존 MCP/Agent adapters, typed resource 계약, multi-target plan,
`scripts/verify-client-*.mjs`, `test/*deployment*.test.js`.

- 기본 Agent 역할과 MCP stdio부터 두 제품의 전역·프로젝트 범위를 채운다.
- HTTP MCP와 인증 참조는 별도 자원 프로필로 검증한다.
- 기존 다중 대상 트랜잭션·구조 병합·backup·rollback을 재사용한다.
- 모델명·도구명·권한의 차이는 client adapter에서 명시적으로 검증한다.
  미지원 필드를 조용히 버리거나 프롬프트 문장으로 권한을 대체하지 않는다.
- 사용자가 원본을 한 번 고치고 양쪽 대상을 선택하면 모든 산출물 diff가 한
  계획에 표시되도록 한다. 재적용·제거·복원을 같은 수명주기로 검증한다.

상세 작업:

- **S04-1 같은 저장소 합산:** typed Agent/MCP의 동일 target/selector 기여를
  검증한 후 합산한다. 한 파일의 서로 다른 MCP selector는 충돌 없이 병합하고,
  같은 selector에 다른 산출물은 차단한다. 중복 capability gate와 원장 precondition은
  합산 전후 모두 보존한다. typed 제거가 저장소의 설정 제거라는 의미도 유지한다.
- **S04-2 프로필 확장:** 먼저 네 자원의 기본 동작으로 전역/프로젝트 CLI를 채운다.
  HTTP MCP 무인증, 환경 변수 인증 참조, OAuth 등은 서로 다른 profile로 검증한다.
  OAuth 로그인·토큰 저장소 이전을 공통 원본 복사에 포함하지 않는다. 미지원 조합은
  형식 preview와 차단 사유를 제공하며 인증 상태를 바꿔 검증을 통과시키지 않는다.
- **S04-3 과거 설치 이관:** client definition 갱신으로 경로가 바뀌어도 과거 기록을
  지우지 않는다. 적용 당시 definition/locator와 소유 hash를 보존해 새 위치 생성·
  검증·기존 소유 항목 해제를 명시적으로 계획한다. 새 위치의 미관리 파일, 과거
  typed 소유권 불명, 오래된 Agent 등록 섹션이 있으면 별도 충돌/이관으로 처리한다.
  기존 제거 API가 현재 경로와 다르다고 막는 조건을 무조건 해제하지 않는다.
- **S04-4 surface 확장:** CLI 다음 desktop, IDE 순서로 독립 검증한다. 현재 Codex
  정의에는 `ide` surface가 없으므로 IDE를 제공하려면 definition·detection·evidence를
  함께 추가한다. 같은 설정 파일을 읽는다는 사실만으로 지원 대상에 넣지 않는다.

완료 기준: 격리 환경에서 전역/프로젝트 × 지침/Skill/MCP/Agent × 두 클라이언트의
실제 로딩을 확인하고, 별도 실제 사용 시험으로 MCP 응답·Agent 완료까지 확인한다.
모델 호출이 필요한 검증은 호출 조건과 사용량을 명시해 별도로 실행한다.
동일 저장소 surface 합산은 synthetic fixture로도 검증하되 실제 미검증 surface를
production에서 활성화하는 근거로 사용하지 않는다.

### S05. 전역·프로젝트 통합 조회 및 의존성 전제

수정 지점: `kit-paths.js`, `manifest-targets.js`, `manifest-dependencies.js`,
registry/diagnostics service, GUI scope 선택.

- 우선 전역 자원과 선택 프로젝트 자원을 함께 조회하되 각 원본과 scope를 보존한다.
- 프로젝트별 실효 자원은 클라이언트의 검증된 우선순위로 계산한다. 모든
  클라이언트가 동일하게 이름 덮어쓰기를 한다고 가정하지 않는다.
- 현재 프로젝트 계획은 전역 의존성을 만나면 거부한다. 이를 지원할 때는
  전역 Manifest catalog 및 scope가 포함된 참조 계약을 먼저 추가한다.
- 프로젝트 Agent의 전역 Skill/MCP 요구는 기존 설치 원장의 자원 revision·
  hash·provider binding을 전제로 검증한다. 미배포라면 전역 선행 계획을 안내한다.
- 프로젝트 계획이 전역 파일을 쓰지 않도록 유지하고, 적용 전에 전역 전제가
  달라졌으면 재계획한다. 두 scope의 혼합 원자적 트랜잭션은 별도 후속 작업이다.

상세 작업:

- **S05-1 조회:** 신규 catalog/실효 inventory 서비스를 추가한다. 선택 프로젝트의
  `projectName`, 실제 targetRoot, Kit scopeRoot를 함께 식별한다. 이름이 같은 다른
  프로젝트를 합치지 않으며 접근 불가는 자원 부재로 표시하지 않는다.
- **S05-2 참조:** C05의 versioned scoped reference, 논리 tool의 provider 선택,
  전역 설치 전제, 프로젝트 역참조를 domain/application 경계에서 구현한다. 일반
  `validate`, `doctor`, plan, remove, rollback, Manifest 편집/등록 삭제가 같은
  resolver와 역참조 규칙을 사용하도록 한다.
- **S05-3 일관성:** 전역/프로젝트 잠금 순서, 메타데이터 등록·해제 journal, 저장 계획
  재개 시 전제 검사, 전역 revision 변경/제거와 프로젝트 적용의 경합을 검증한다.
  프로젝트 폴더 이동·삭제 또는 등록부 손상 시 임의 해제하지 않고 복구 계획을 요구한다.
- 최초 버전에서 의존 중인 전역 revision을 교체하려면 프로젝트의 의존 자원을 명시적
  제거 계획으로 먼저 해제한 뒤 전역 갱신 → 프로젝트 재배포 순서를 따른다. 각 계획의
  중간 사용 공백을 표시한다. 프로젝트 참조만 먼저 새 revision으로 바꾸거나 전역
  갱신 후 검사하는 방식으로 미배포 전제·race를 우회하지 않는다.
- 글로벌 source 갱신 자체와 배포 revision 변경은 다르다. source를 편집했다는
  이유만으로 기존 프로젝트의 설치 의존성이 깨졌다고 처리하지 않는다. 실제 전역
  배포·제거·rollback에서 기존 의존 revision과의 관계를 판단한다.

완료 기준: 전역 리뷰 Skill과 프로젝트 전용 Agent의 연결 상태를 확인할 수 있고,
다른 프로젝트 자원이 섞이거나 전역 삭제의 영향이 숨겨지지 않는다.
단, 기본 Agent 역할의 `dependsOn.skills`는 배포 의존성이며 런타임 Skill 강제
활성화가 아니다. `uses.skills`나 특정 MCP만 허용한다는 의미가 검증되지 않으면
해당 선언은 계속 차단한다. 교차 scope 의존성 지원으로 권한 mapping을 우회하지 않는다.

### S06. GUI와 문서 정리

수정 지점: `ResourceWorkspace.tsx`, `ManifestEditor.tsx`,
`ManifestDeploymentPanel.tsx`, `ManifestApp.tsx`, 공통 API, README 및 traceability.

- 자원별로 원본 위치·scope·설치 위치·client surface·소유자·연결 방식·
  마지막 적용 hash·로딩/재시작 상태·추적 출처·업데이트/로컬 수정 상태를 표시한다.
  적용/업데이트 상태는 Kit 관리 자원에만 표시하며 외부 관리 항목은 위치·연결·관리 주체만 표시한다.
- 등록 전 발견 자원, Kit 관리 자원, 외부 프로그램 소유 자원을 구별한다.
- 이름과 도구를 입력하는 자원별 편집 화면을 기존 Manifest 편집 서비스에 연결한다.
- 변경 계획에서 두 클라이언트의 차이와 공유 소비자 영향을 보여 준다.
- README의 현재 지원 목록과 오래된 예제 상태를 실제 지원표에 맞춘다.

상세 작업:

- **S06-1 목록:** `candidateId`/scoped asset key로 행을 만들고 surface 관측을 연결한다.
  전역/프로젝트·관리/미등록·native 전용·외부 소유/미확인 필터, 동일 이름 충돌,
  source와 적용 revision의 차이, 숨겨진/비활성 자원의 이유를 표시한다.
- **S06-2 편집:** typed Agent 설명/지침, MCP transport/binding/환경 변수 참조,
  Skill·지침 본문과 논리 tool 요구를 각각 계약에 맞게 편집한다. 기존 typed 자원을
  열어 저장했을 때 definition·관계·미수정 필드가 사라지지 않아야 한다. 지원하지 않는
  모델·정책 필드는 선택할 수 없게 하고 이유를 보여 준다.
- **S06-3 계획/이력:** 여러 targetProfile, 공유 소비자·저장소 영향, 연결/등록/이관
  차이, 예상 reload, 상태 schema 변경을 표시한다. 등록·편집 완료 후 배포를 자동
  실행하지 않는다. 원본 갱신 후 대상 선택 → 모든 diff → 적용 → 관측 흐름을 연결한다.
- **S06-4 parity:** CLI discovery/import/adopt/detach/refresh/source-edit와 HTTP/GUI를 같은 service에
  연결한다. 기존 단일 대상 CLI, 기존 HTTP 응답 필드, 기존 저장 계획 재개를 보존한다.
  전체 지원표와 기존 계약 문서의 오래된 한계를 현재 상태에 맞춰 함께 갱신한다.
- **S06-5 업데이트 관리:** 기존 자원 편입, 업데이트 확인, 다시 가져오기,
  내 수정/upstream 비교·충돌 해결·부분 수용, 설치본 수정 가져오기, 관리 해제를
  Kit 관리 자원에 제공한다. 외부 관리 링크에 이 흐름이나 업데이트 알림/할 일을
  만들지 않는다. 출처 연결/변경은 Kit 관리 자원에 대해서만 검토하고 상태를 표시한다.

완료 기준: ego-browser 발견 → 외부 관리·연결 상태 표시, 개인 Skill 편입 →
Kit 수정 → 필요한 원본 재가져오기·병합 → 선택 client 반영, 기존 MCP 설정의 필드별 편입/갱신,
공통 reviewer 작성 → Codex·AGY 배포, 전역/프로젝트 전환과 관리 해제·복원을 확인한다.

## 인터페이스 변경 범위

아래에서 탐색·선택 원본 등록·등록 해제·사본 편집·로컬/고정 Git/npm 갱신·병합·source 복구/복원은 구현했고 나머지는 신규 인터페이스 제안이다.
요청은 선택 자원·scope·대상만 전달하고 임의 파일 작업·snapshot 절대 경로·runtime
evidence를 클라이언트 입력으로 받지 않는다. OS/arch는 서버의 실행 환경에서 결정한다.

| 사용자 동작 | CLI / HTTP 제안 | 공통 서비스의 책임 |
|---|---|---|
| 탐색 | `discover [--project <path>] [--client <id>] [--surface <id>]` / `GET /api/local-discovery`의 scope·projectPath 쿼리 | 구현됨. 기존 응답 보존, surface별 관측 목록 추가, 프로젝트 경로 인가, 부작용 없는 탐색 |
| 선택 원본 등록 | `import --candidate <id> [--asset <id>]` / `/api/manifest/import/plan`, `/apply` | 구현됨. candidate 재탐색·hash 대조, source-only 사본·출처·baseline과 Manifest schema 2 commit. 기존 설치 무변경 |
| 원본 등록 해제·중단 복구 | `detach --asset <id>`, `recover-sources` / `/api/manifest/detach/plan`, `/apply`, `/api/manifest/source-recovery/plan`, `/apply` | 구현됨. 참조·배포 소유권 차단, 사본·기준·원래 설치 보존, dead-owner journal 검토 복구 |
| 기존 위치 유지 편입·관리 해제 | 신규 adopt/detach 계획/적용 / `/api/manifest/adoption/plan`, `/apply` | 기존 바이트/링크 보존, 관리 단위·쓰기 주체·출처·초기 baseline 등록 또는 해제 |
| 업데이트 확인·재가져오기 | `updates --asset <id> [--upstream <json-file>]`, `refresh --asset <id> [--upstream <json-file>] [--review <hash> --resolutions <json>]` / `GET/POST /api/manifest/upstream/check`, `POST /api/manifest/refresh/plan`, `/apply` | 로컬 및 고정 Git/npm 출처 구현. 외부 관리 링크 제외, B/K/U 비교·충돌/부분 수용·보류·stale 검사, baseline·Kit revision·출처 commit. 설치 D/L 대조는 별도 installation 서비스 |
| Kit 사본 조회·편집 | `source --asset <id>`, `source-edit --asset <id> --revision <token> --changes <json>` / `GET /api/manifest/source`, `POST /api/manifest/source-edit/plan`, `/apply` | 구현됨. 인가된 Kit snapshot에서 새 revision 생성, 본문/부속 파일 diff, stale·동시 편집 검사. 원래 설치 무변경 |
| Kit 이력 복원 | `source-rollback --asset <id> --revision <token> --checkpoint <id>` / `POST /api/manifest/source-rollback/plan`, `/apply` | 구현됨. 검증한 checkpoint의 Kit 사본·기준·보류·출처 연결 복원. 기존 revision·외부 원본 보존 |
| 통합 조회 | registry 조회 옵션 / 기존 `/api/manifest/registry`에 선택적 통합 view | 기본 단일 scope 응답 유지, provenance·scope·가림/충돌 표시 |
| 설치·이관·제거·복구 | 기존 deployment plan/apply·migration·removal·save/resume·recovery 경로 확장 | 검토한 planId만 집행, 단일/다중 대상과 기존 digest 검증 유지 |
| 로딩/사용 확인 | 기존 doctor 확장 및 명시적 검증 작업 | 설치 검사와 모델/MCP 사용 시험 구분, 관측한 context와 시각 기록 |

등록/편집 계획의 TTL·단일 소비, scope 인가, 임시 파일 충돌, 실패 복원과 저장 계획
지원 여부를 계약에 명시한다. 최초 등록/편집 계획은 메모리 계획으로 시작하고 프로세스
재시작 시 재계획한다. 클라이언트 배포의 저장 계획 계약과 혼동하지 않는다.
source 입력이 바뀌었으면 같은 candidateId라도 재검토해야 한다.

## PR 분할과 의존 순서

각 PR은 동작에 해당하는 domain/application/CLI/HTTP/GUI 테스트와 계약 문서를
같이 갱신한다. S06 전체를 마지막으로 미루지 않고 사용자 흐름을 해당 PR에 연결한다.
아래 순서는 구현·리뷰 경계이며 일정 추정이나 이미 완료된 작업을 뜻하지 않는다.

| 묶음 | 선행 | 포함 작업 | 해당 묶음의 완료 조건 |
|---|---|---|---|
| PR01 계약·최소 교정 | 없음 | S00, S01-1. G01~G15 traceability, 최신 Codex 무효 옵션의 fail-closed 처리 | 기존 기본 역할 출력 유지, 무효 제한 거절, versioned 확장 fixture 검토 |
| PR02 링크 관측 | PR01 | S02-1, S06-1의 최소 표시. 정상/끊김 링크와 이슈 | ego-browser 발견, 미인가 대상 내용 미조회, 읽기 전용 유지 |
| PR03 유효 inventory | PR02 | S01-2·3의 정의, S02-2, S06-1. surface·Agent·지침·프로젝트 탐색 | native 이름과 scoped ID 분리, surface override와 충돌 표시 |
| PR04a 기존 자원 편입·편집 | PR03 | S02-3·4, S06-2·5. import, 현재 위치 유지 adoption, native 보존, 관리 해제 | 기존 설정·링크·모드 유지, typed/native 왕복 보존, 편입/취소의 메타데이터 일관성 |
| PR04b 업데이트 재가져오기 | PR04a | S02-5의 로컬 source·B/K/U·D/L 비교, S06-5 | 내 수정 보존, 갱신/삭제/충돌/부분 수용·보류, stale·중단 복구, baseline rollback |
| PR04c 출처 연동 | PR04b | Kit 관리 자원의 Git/package source adapter | 공개 HTTPS Git commit·npm version/SHA-512 범위 구현. 무실행 취득·병합·출처 포함 복원. 외부 관리 항목과 updater에는 관여하지 않음. 인증/자동 버전 탐색은 후속 |
| PR05 snapshot·연결 계획 | PR04b | S03-1·2, 새 state/연결 descriptor와 diff | 구현·검증. source v2, snapshot/store, state v6 연결 모델과 소비자/보관 계획. copy 회귀 없음, pure plan 무쓰기. 실제 적용은 PR06까지 차단 |
| PR06 링크 집행·복구 | PR05 | S03-3·4, 관련 S01-2 전략 실기 evidence, S06-3 | 구현·검증. 이관·소비자·저장 계획·SIGKILL 복구 통과. Codex 전역 CLI의 검증된 링크 조합만 활성화, AGY 미관측은 차단 유지 |
| PR07 같은 저장소·기본 범위 | PR06 | S04-1, S04-2의 기본 CLI 전역/프로젝트, S06-3 | 기본 범위 완료. typed 저장소 합산·격리 행렬 구현/검증, 기본 CLI native 16/16 증거 확보. AGY Agent 두 scope의 직접 child 완료·적용·복원 확인 |
| PR08 기존 경로 이관 | PR07 | S04-3 및 제거/rollback 호환 | 구현·격리 검증. 적용 locator와 소유 증명, 새/옛 위치 이관·양쪽 rollback·SIGKILL 복구·CLI/HTTP/GUI. 무증거 과거 설치와 미확인 Agent 등록·외부 링크는 충돌로 보존 |
| PR09 통합 조회 | PR03 | S05-1, S06-1. 구현 순서상 PR04a~08과 독립 | 진행 중. catalog·scope 작업·문서 규칙, Codex CLI Skill 활성/비활성·상위 경로, MCP 필드별 합성/가림/제외, Agent 선언 이름·지침 설정/문서 기준 선택 예상 구현·검증. Agent/지침 실제 로딩과 다른 client/surface 실효 문맥은 미확인 |
| PR10 교차 scope 의존성 | PR07·08·09 | S05-2·3, scoped schema/catalog/역참조·잠금·복구 | graph·설치/역참조·writer 보호·두 scope 집행/복구·native verifier·v4 영수증·consumer 예측 구현. 공개 v3 계획/관측/집행·제거·의존성 rollback/참조 해제·저장 v5/복구 및 일반 v3 검증·읽기 전용 doctor·선언 CRUD를 CLI/HTTP/GUI에 연결. source peer·target/동명 참조 보존과 실제 Codex 공개 왕복·사용자 Kit 무쓰기 진단 검증. native 원형/과거 경로 writer·편입된 원본의 v3 수명주기·전역 설정 전환은 미완료이며 차단 |
| PR11 추가 로딩 전략·프로필 | PR06·07·08 | S03-5, S04-2의 HTTP/인증, S04-4 desktop/IDE | 전략·전송·인증·surface별 작은 후속 PR로 분할. 증거 없는 조합은 계속 차단 |

PR11의 discovery 참조, HTTP/인증, 각 surface는 서로 독립된 검증 단위다.
하나의 성공으로 나머지를 묶어 활성화하지 않는다. README·예제·traceability는
각 완료 시점의 실제 지원 범위만 반영한다.
C07의 Skill 대상·호환성·variant도 PR11의 별도 구현/검증 단위로 추적한다.

## 누락 방지 검증표

기존 테스트 파일을 우선 확장하고 신규 서비스에만 새 파일을 추가한다. synthetic
정의·mock 클라이언트 시험은 파일 안전성과 gate를 확인하며 실기 증거를 대신하지 않는다.

| ID | 반드시 확인할 시나리오 | 주된 테스트 위치·증거 |
|---|---|---|
| T01 | 일반 Skill, 정상 symlink Skill, 빈/잘못된 bundle, native 패키지 발견. 발견과 공통 적합 판정 구분 | `local-installation-discovery-service.test.js`, `common-assets.test.js` |
| T02 | 끊김·순환·범위 이탈·부모 symlink 교체·권한 부족·파일 크기/깊이 상한. 한 항목 오류가 다른 항목 탐색을 막지 않음 | discovery, `security-boundaries.test.js` |
| T03 | base와 surface override 경로 차이, 여러 discovery 루트, AGY manifest의 제외·중첩·순환, 프로젝트 시작 위치 | discovery·client definition fixture, 실제 로딩 기록 |
| T04 | 동명 다른 내용/출처/scope/프로젝트, 같은 물리 경로의 여러 관측, 다른 Kit의 같은 asset ID | discovery, `ResourceWorkspace.test.tsx`, registry/catalog 신규 시험 |
| T05 | 탐색·통합 조회·plan이 Kit bootstrap, snapshot 생성, 원장/사용자 파일 쓰기를 하지 않음 | application·CLI·HTTP fixture의 전후 파일 목록/hash |
| T06 | import 입력 변경·중복 ID·Manifest 동시 수정·중간 write 실패·임시 경로 충돌·강제 종료. 외부 원본 보존, 일관된 등록과 검토 복구 | import/source-edit 신규 시험, `manifest-deployment-service.test.js`, CLI·HTTP |
| T07 | MCP env/header/args/URL 및 Skill 부속 파일의 비밀값이 결과·diff·오류·journal에 남지 않음. 필수 참조 누락 표시 | import·MCP·`security-boundaries.test.js`·HTTP 응답 검사 |
| T08 | typed Skill/Agent/MCP 열기→무수정 저장, 일부 필드 수정, 알 수 없는 확장 차단. definition/관계/프로젝트 scope 보존 | `ManifestApp.test.tsx`, 편집기 시험 추가, HTTP·application 왕복 |
| T09 | missing reference/provider, 중복 provider, scope 위반, policy denial, cycle 및 native/source 우회 거절 | `manifest-references.test.js`, `agent-target-deployment.test.js`, profile fixture |
| T10 | 원본 편집 전후 설치 불변, 새 revision diff, 동일 digest 재사용, snapshot 바이트/권한 외부 변경, 원본/대상 자기 참조 | snapshot 신규 시험, `managed-link-deployment.test.js`, copy·security 시험 |
| T11 | 두 소비자 등록·단독 제거·마지막 제거·공동 갱신 요구·서로 다른 경로 revision·반복 apply SKIP | `shared-resource-deployment.test.js`, `resource-removal.test.js` |
| T12 | copy ↔ link 명시적 이관, 미관리 잔여 파일/외부 링크 충돌, 대상 교체 후 rollback, snapshot 참조 보존 | link·shared·backup·`deployment-coordinator.test.js` |
| T13 | 새 연결의 저장 계획 재개·만료·원본/definition/binary 변경. snapshot/연결/state commit 각 단계 강제 종료와 검토 복구 | `persistent-deployment.test.js`, journal·rollback fault injection |
| T14 | 동일 저장소의 같은 Agent/MCP 합산, 한 MCP 파일의 여러 selector 병합, 다른 바이트·다른 Kit·미검증 surface 차단 | `manifest-deployment-service.test.js`, `mcp-rendering.test.js`, typed 제거 시험 |
| T15 | legacy 경로·등록 섹션·원장 schema 1/2/4 및 표식 3, 소유권 불명, 새 위치 충돌, 이관 후 제거/rollback | `global-ledger-migration.test.js`, `resource-removal.test.js`, migration fixture |
| T16 | 전역+선택 프로젝트 조회, 다른 프로젝트 배제, 동명 중복/가림, 비활성 설정과 실제 탐색 우선순위 | catalog·doctor·GUI 시험, 실기 관측 |
| T17 | 전역 source만 있음/미설치/다른 surface·binding·revision 설치, 계획 후 전역 변경, 프로젝트 적용 중 전역 경합 | scoped dependency·잠금 신규 시험, saved-plan 재개 |
| T18 | 프로젝트 의존 중 전역 갱신·제거·rollback, 프로젝트 이동/접근 불가/원장 손상·pending journal, 역참조 부분 반영 | 역참조·cross-ledger recovery 신규 시험. 안전 증명 불가 시 차단 |
| T19 | 발견→등록 검토→편집→두 대상 diff→적용→관측→해제/복원. 자동 배포 없음, 단일/다중 대상·기존 응답 호환 | `manifest-cli.test.js`, HTTP `control-plane-e2e.test.js`, GUI test·typecheck |
| T20 | 네 자원 × 두 scope × 두 제품의 실제 로딩과 별도 사용, 전략/transport/auth/surface별 증거, 버전/hash 불일치 차단 | `scripts/verify-client-*.mjs`, `verify-global-skills.mjs`, 검토된 evidence JSON |
| T21 | 기존 Skill/MCP/Agent/지침의 현재 위치 유지 편입·관리 해제·편입 rollback. 파일/링크/모드/사용자 설정 보존, 상대·절대/다단 링크의 readlink 문자열 불변, 최종 realpath 고정 방지와 native 확장·주석 유지 | adoption·native variant 신규 시험, CLI·HTTP·GUI flow |
| T22 | upstream만 변경, Kit만 변경, 같은 변경, 비겹침 병합, 동일 부분 충돌, 추가/삭제·이름 변경 후보. 설치 수동 수정 D/L의 별도 처리 | refresh·형식별 3-way merge 신규 fixture |
| T23 | 업데이트 확인만 실행, 수용/거절/부분 수용·보류 후 다음 업데이트. 마지막 수용 B와 해결 기록 보존, 자동 설치 변경 없음 | refresh application·GUI 충돌 해결·원본 diff 검사 |
| T24 | 출처 미연결/재연결/삭제/접근 불가, Git ref/package 버전 이동, source 내 hook/command 무실행, 인증 값의 baseline/native variant 유입 차단 | source adapter·인가·비밀값·bundle 회귀 시험 |
| T25 | 외부 관리 ego-browser의 존재·연결 상태 표시, 다시 탐색 시 연결 변경 관측. baseline/수정본/업데이트 작업/알림 미생성, 앱 내용 복사·역쓰기·링크 교체·관리 권한 자동 인수 없음, 외부 항목 refresh API 거절 | discovery·관리 모드·GUI/API 신규 시험 |
| T26 | 반복 재가져오기 멱등성, 자기 배포본 재수입 방지, 갱신 원자적 commit·강제 종료·rollback. 외부 출처/설치와 Kit 복구 범위 구분 | refresh journal·fault injection·deployment 연계 시험 |
| T27 | 전역 Skill의 client별 선택, 미확인/전용 대상 차단, common/native variant 보존, Tool provider 불일치, 공유 경로 추가 노출·격리 불가, variant 갱신 후 계획/검증 무효화, 기존 manifest·적용/복원·외부 링크 보존 | C07 후속 대상/호환성 domain·application·CLI/HTTP/GUI 시험. Claude 포함 각 대상의 native 증거는 별도 확보 |

기본 행렬은 제품 2 × scope 2 × 자원 4의 **16칸**이다. 각 칸에 적용 가능 여부,
산출물, 로딩, 실제 사용, reload 조건을 기록하고 미지원/미검증은 사유를 남긴다.
copy/link/discovery, stdio/HTTP/인증, desktop/IDE는 추가 차원이며 기존 16칸의
한 번 성공으로 대체하지 않는다. 지침 준수나 Skill 사용도 해당 시험의 관측일 뿐,
모든 후속 대화에서 항상 선택·준수된다는 보장은 아니다.

## 검증 실행과 이번 검토의 한계

첫 구현 묶음은 S00·S01의 최소 계약 교정과 S02-1의 링크 탐색 누락 수정이다.
이후 기존 설치의 무변경 편입·편집 → 업데이트 재가져오기·병합 → snapshot·공유 링크 →
기본 배포 범위 → 교차 scope 의존성 순으로 진행한다. 편입·갱신을 링크 완성 뒤로 미루지 않는다.
통합 조회와 화면 보완은 위 PR 의존관계에 따라 먼저 제공할 수 있다.

동작을 바꾸는 PR은 관련 시험 후 다음 저장소 검사를 실행한다.

```sh
npm run test:all
npm --prefix gui test
npm --prefix gui run typecheck
git diff --check
```

`test:all`은 현재 domain/application/CLI, HTTP 서버, GUI desktop build,
Cargo check를 묶는다. GUI Vitest와 TypeScript 검사는 위 명령처럼 별도로 필요하다.
테스트 실행에는 루트와 GUI의 lockfile에 맞는 의존성이 설치되어 있어야 한다.
새 snapshot/참조 계약은 export/helper와 다른 클라이언트 회귀도 확인한다.

실제 로딩/모델/MCP 사용 검증은 별도 실행한다. 검증 harness의 격리 홈·프로젝트와
marker fixture를 사용하고 실제 사용자 설정을 시험용으로 덮어쓰지 않는다. 필요한
로그인·외부 연결·모델 호출 조건과 사용량을 명시하며 credential 변경은 별도 승인 없이
수행하지 않는다. runtime 증거가 부족하면 자동 배포를 차단한 상태로 남긴다.

초기 문서 검토에서는 `yaml` 미설치로 테스트를 실행하지 못했고 링크의 무응답 누락을
재현했다. 구현 단계에서는 두 lockfile의 의존성을 설치하고 위 진행표의 자동 검사와
실제 링크·GUI 관측까지 완료했다. 기존 클라이언트 설정·링크·앱 내부 Skill은 변경하지 않았다.
실제 클라이언트 모델 호출이나 새 runtime evidence 발급은 하지 않았으며, 미검증
surface/버전의 지원을 확대하지 않았다. 이후 원본 등록·해제 구현 범위와 남은 관리 수명주기는 진행표에 구분한다.
