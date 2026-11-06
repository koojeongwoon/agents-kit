# PR09 통합 조회: 원본 catalog 및 증거 수준 분리

2026-11-06, 통합 조회의 첫 구현을 완료하고 회귀 검증했다. PR09 전체 완료는 아니다.
실제 실효 inventory의 로딩·비활성·상위 탐색 문맥 연결이 남았다.

## 구현

- domain: origin 기반 ID, 동명 중복 보존, client/surface별 실효 후보 묶음.
- application: 전역+선택 프로젝트 조회, 부분 오류 격리, 원본 가용성, 안전한 projection.
- adapter: 일반 Skill frontmatter 이름 metadata만 제한적으로 읽기. 외부 링크는 제외.
- definition: versioned surface inventoryRules. 문서상 공존과 root 우선순위를 구분.
- CLI/HTTP/GUI: 같은 catalog service 사용. 기존 단일 scope API 유지.
- GUI: 실제 project 경로를 포함한 provenance, scope/관리 필터, 동명 설명,
  행 origin에 고정된 편집·사본·설치·배포 작업, scope별 복구 계획 연결.

계약은 [resource-catalog-v1](../contracts/resource-catalog-v1.md)이다.

## TDD와 검증

최초 실패는 catalog 서비스 부재, CLI 명령 부재, HTTP 통합 view 부재, 탐색 root 상태
부재였다. 이후 전역 행이 현재 프로젝트의 editor/설치 API로 연결되는 실패를 재현했다.
폴더 이름과 native 이름의 차이, 홈 안 프로젝트의 `~/` 표시 경로 우선순위 실패도 추가했다.
검사에서 조회 metadata가 기존 경로 이관을 막는 결합을 발견해 제거하고 PR08 회귀를 확인했다.

| 검사 | 결과 |
|---|---|
| 루트 | 497 passed, `/private/tmp/kit-pr09-root-final.log` |
| HTTP | 35 passed, `/private/tmp/kit-pr09-http-final.log` |
| GUI | 60 passed, `/private/tmp/kit-pr09-gui.log` |
| GUI typecheck | 통과, `/private/tmp/kit-pr09-typecheck.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr09-build.log` |
| 경로 이관+catalog+정의 별도 회귀 | 40 passed, `/private/tmp/kit-pr09-migration-regression.log` |

ego-browser 작업 공간 23에서 격리한 임시 Kit/HOME의 실제 빌드 화면을 확인했다.
프로젝트 미선택 시 전역 자원이 보이고, 선택 후 Global Review와 Project Review가
분리되며, 프로젝트 필터에는 프로젝트 행만 남았다. 전역 행의 편집은 global scope의
Global Review만 불러왔다. 기존 링크 행에는 변경 버튼이 없었다. 이 QA는 Kit 적용이나
클라이언트 배포를 실행하지 않았다. 임시 포트의 정적 파일 CORS 문제는 QA 서버 구성에서
해결했고 제품 CORS/세션 정책은 변경하지 않았다.

## 필요한 native 확인

[Codex 실제 조회 control](codex-catalog-skill-discovery-20261106.json)은 현재
0.166.0-alpha.6 / SHA-256 `508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44`
실행 파일을 사용했다. 새 HOME과 Git fixture에서 서로 다른 폴더의 같은 frontmatter 이름
두 항목이 `skills/list`에 함께 나타났다. 프로젝트 경로만 disabled로 설정하면 프로젝트만
`enabled=false`, 전역은 true였다. 자격 증명 복사·모델 turn·실제 HOME 설정 쓰기는 없었다.
이 control을 현재 사용자 inventory의 활성화 증거로 대신하지 않는다.

실제 HOME의 읽기 전용 catalog에서도 전역과 선택 프로젝트 Manifest를 함께 조회했다.
ego-browser는 external/contentRead=false였고 설정/링크 27개 경로 보존 검사에 차이가
없었다. 과거 Codex config 왕복의 inode/mtime 변경 1건만 기존 기록 그대로다.
[보존 체크포인트](resource-catalog-preservation-20261106.json)에 source/log hash와
원장 v6·133 transactions·3 files/4 owners·활성 hash 일치·lock/journal 없음을 기록했다.

## 첫 구현 시점의 미완료 범위

실제 native 조회와 read-only catalog의 검증된 연결, disabled/override/상위 경로·trust·
추가 manifest 문맥 및 다른 kind/surface의 우선순위는 남았다. 현재 `effective`는 그
미확인을 명시하며 문서 규칙만 별도 표시한다. native 지원 gate 14/16을 늘리지 않았다.
PR07 AGY Agent child 완료 2건, PR10 교차 scope 참조·잠금·복구, PR11 추가 profile도 남았다.

## 후속: native Skill 목록 연결

위 첫 구현 후 Codex CLI Skill의 실제 목록·비활성 상태를 공통 서비스에 연결했다.
기본 GET은 여전히 순수 조회이고 명시적 CLI `--observe-native` 및 GUI 버튼만 짧은
client 프로세스를 시작한다. exact binary evidence, versioned definition, adapter,
주입 가능한 infrastructure observer로 나눴으며 agent runtime/loop를 추가하지 않았다.

동일 경로 중복·필수 enabled 누락·틀린 cwd·미검증 binary/surface·조회 중 설정/binary
변경을 먼저 실패로 기록했다. 프로토콜 시험은 두 읽기 RPC만 전송하고 server 실행
요청을 거절하는지, 자격 증명 환경을 전달하지 않는지, 출력/시간 초과에서 종료하는지
검증한다. HTTP는 세션 없이 실행하지 않으며 사용자 body의 binary/proof를 무시한다.
GUI는 사용자가 요청했을 때만 실행하고 선택 프로젝트가 바뀐 늦은 응답은 폐기한다.

| 후속 검사 | 결과 |
|---|---|
| 루트 | 507 passed, `/private/tmp/kit-pr09-native-root-final.log` |
| HTTP | 37 passed, `/private/tmp/kit-pr09-native-http-final.log` |
| GUI | 62 passed, `/private/tmp/kit-pr09-native-gui-final.log` |
| GUI typecheck | 통과, `/private/tmp/kit-pr09-native-typecheck.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr09-native-build.log` |

[실제 공통 서비스 control](codex-native-catalog-service-20261106.json)은 새 HOME/Git
fixture에서 프로젝트 Skill을 disabled→enabled로 바꾸었을 때 두 상태를 각각 확인했다.
전역 Skill의 활성은 유지됐고 상위 repository Skill은 manageable=false 추가 항목으로
나타났다. 외부 ego 링크는 관측만 남고 native 추가 목록에 중복되지 않았다. 설정과
링크 identity/문자열을 보존했고 credentials 복사나 model turn은 없었다.

[사용자 환경 native 조회](native-live-catalog-codex-20261106.json)도 현재 검증 binary로
한 번 성공했다. 추가 경로 13개는 metadata만 반환하며 외부 링크는 contentRead=false,
activation unknown을 유지했다. 설정·링크 27개 보존 및 과거 config metadata 변경 1건은
그대로다. 이 조회에서 배포·Tool/MCP/model 호출을 하지 않았다.

ego-browser 공간 23의 실제 빌드 UI에서는 주입한 native 목록을 사용했다. 버튼 실행 후
전역 활성/프로젝트 비활성 표시, 비활성 필터의 한 행, 추가 경로 읽기 전용 및 외부
링크 변경 버튼 부재를 확인했다. 이 UI QA는 별도 실제 client 프로세스를 실행하지 않았다.
[후속 보존 체크포인트](native-catalog-preservation-20261106.json)에 source/log hash,
원장 v6·133 transactions·3 files/4 owners·활성 hash 일치·lock/journal 없음과
기존 native deployment evidence 25개가 그대로임을 기록했다.

이제 Codex CLI Skill의 native 목록 연결은 구현·검증됐다. MCP·Agent·지침과 AGY·
다른 surface의 실효 문맥은 미확인으로 유지하며 PR09 전체를 완료 처리하지 않는다.

## 후속: MCP 필드별 실효 설정과 출처

2026-11-06, 동일 service·CLI·HTTP·GUI에 Codex CLI의 `mcpServers` reader를 추가했다.
기존 native Skill 호출은 호환된다. client definition nativeInventory schema 2로
reader/evidence를 kind별 분리하고 legacy schema 1도 읽는다. 임의 RPC/프로세스를
실행하는 registry/runtime을 만들지 않고 검증된 읽기 프로토콜 두 개만 허용한다.

먼저 [CLI list control](codex-native-mcp-list-control-20261106.json)에서 등록/활성과
프로젝트 우선순위를 확인했다. 이 출력에는 출처 파일이 없어 ownership/가림을 이름만으로
판정하지 않았다. 이어 [config origin control](codex-native-config-origin-control-20261106.json)에서
공개 field origins/layers를 확인하고 `config/read` reader를 구현했다.

TDD는 MCP reader 부재부터 단일 원본·가림·비활성, 전역/프로젝트 합성, ignored layer,
불명확한 origin/profile·dotted ID, 비밀값 제거, kind/protocol 오주입 거절을 검증했다.
HTTP 세션 보호와 GUI reader 선택·필드별 출처·가림 표시·읽기 전용도 확인했다.

| 검사 | 결과 |
|---|---|
| 루트 | 514 passed, `/private/tmp/kit-pr09-mcp-root-final.log` |
| HTTP | 39 passed, `/private/tmp/kit-pr09-mcp-http-final.log` |
| GUI | 63 passed, `/private/tmp/kit-pr09-mcp-gui-final.log` |
| typecheck | 통과, `/private/tmp/kit-pr09-mcp-typecheck-final.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr09-mcp-build-final.log` |

[실제 서비스 control](codex-native-mcp-catalog-service-20261106.json)은 새 HOME/Git
fixture에서 프로젝트 비활성의 단일 원본 선택, 전역 command+프로젝트 args의 합성,
상위 root와 현재 child의 설정을 확인했다. MCP가 실행되면 marker를 쓰도록 한
실제 프로그램은 한 번도 시작되지 않았다. 설정 원문은 보존했고 모델 호출도 없었다.
[신뢰하지 않은 프로젝트 control](codex-native-mcp-untrusted-control-20261106.json)에서는
전역 활성과 프로젝트 ignored를 실제 client metadata로 확인했다. trust를 부여하지 않았다.

[사용자 환경 조회](native-live-catalog-mcp-codex-20261106.json)는 정확한 현재 binary로
한 번 수행했다. node_repl은 전역 단일 원본·활성 설정이었다. 이 관측의 연결/Tool 사용
상태는 unverified이며 실제 사용을 재시험하지 않았다. 설정·링크 27개 경로 내용·mode와
외부 링크 identity를 보존했다. 과거 config 왕복 metadata 변경 1건도 그대로다.

ego-browser 공간 23의 실제 빌드 UI는 주입한 MCP config metadata를 사용했다. 두 원본의
필드 기여, 읽기 전용 합성 요약, field→파일 표시와 원문 값 미표시를 확인했다.
브라우저 QA는 실제 client 프로세스나 MCP를 시작하지 않았다. 전용 서버/fixture는 정리했다.
[MCP 보존 체크포인트](native-mcp-catalog-preservation-20261106.json)에 source/log hash,
원장 v6·133 transactions·3 files/4 owners·활성 hash 일치·lock/journal 없음과 기존
deployment runtime evidence 25개 보존을 기록했다.

PR09의 다른 kind와 AGY/다른 surface 실효 문맥 및 PR10/11은 계속 남아 있다.

## Agent 선언 이름과 지침 설정·선택 예상 (후속)

Agent 일반 파일의 제한된 TOML header/Markdown frontmatter `name`을 읽어 파일 ID와
분리했다. 동명 역할은 각 원본을 보존하고 body 속 name, 링크 내용, 불확실한 metadata를
이름 증거로 쓰지 않는다. native 등록이나 child 완료를 주장하지 않는다.

지침 reader는 검증된 CLI의 initialize/config-read만 사용한다. definition에 선언한
전역 override/base와 Git root→cwd의 override/base/fallback을 일반 파일만 읽어 비교하고
공백·예산·사용자 정의 경계·별도 지침 설정 유무를 표시한다. 실제 주입은 미확인이다.
기본 marker가 null이라는 초기 가정은 실제 응답의 `[".git"]`을 재생한 red/green으로 고쳤다.
우선 파일이 있으면 없는 fallback까지 shadowed로 만들던 실패도 기록한 후 수정했다.
낮은 우선순위 경로는 lstat 존재 검사만 하고 링크 대상 내용은 읽지 않는다.

공개 schema의 106개 method에는 검토한 Agent 정의 목록 read가 없었다.
[capability 관측](codex-native-inventory-metadata-capabilities-20261106.json)에 남겼다.
instructionSources는 thread 초기화 응답에 있어 격리 HOME에서만 조사했다.
[첫 guard 실패](codex-native-instruction-source-control-20261106.json)는 빈 MCP map으로
기존 정의를 비활성화할 수 없어 thread 시작 전에 중단한 기록이다. 이후
[명시적 서버 비활성 control](codex-native-instruction-source-control-attempt2-20261106.json)에서
ephemeral thread 응답의 경로를 확인했지만 production observer에 thread/start를 추가하지
않았다. 실제 client의 hook/plugin/MCP 초기화를 동반하는 조회로 확대하지 않는다.

[안전한 설정 service control](codex-instruction-settings-catalog-service-20261106.json)은
새 HOME에서 config-read만으로 세 후보·공백 override·fallback·예산·기존 base 가림을
확인했다. [보존한 첫 실행](codex-instruction-settings-catalog-service-20261106-attempt1.json)의
success는 당시 좁은 assertion 결과이며, 존재하지 않는 TEAM.md를 shadowed로 표시해
완전한 성공 증거로 사용할 수 없다. 후속 control은 모든 shadowed 경로의 존재와
없는 fallback의 missing을 추가로 검사했다.

[사용자 환경 조회](native-live-catalog-instructions-codex-20261106.json)는 config-read만
사용해 32768 bytes 예산과 선택 프로젝트 AGENTS.md 후보를 확인했다. status partial/
INSTRUCTION_LOAD_UNVERIFIED를 그대로 유지한다. 전후 27개 경로 내용·mode와 외부 링크
identity를 보존했고 과거 Codex config의 metadata 변경 1건도 동일하다. 모델/Tool/MCP
요청은 없었다. 기본 sandbox 조회가 검증 결과를 내지 못한 뒤 승인된 환경에서 확인했다.

| 검사 | 결과 |
|---|---|
| 루트 | 522 passed, `/private/tmp/kit-pr09-guidance-root-verified.log` |
| HTTP | 40 passed, `/private/tmp/kit-pr09-guidance-http-authorized.log` |
| GUI | 64 passed, `/private/tmp/kit-pr09-guidance-gui-final.log` |
| typecheck | 통과, `/private/tmp/kit-pr09-guidance-typecheck-final.log` |
| Desktop frontend/backend | 통과, `/private/tmp/kit-pr09-guidance-build-verified.log` |
| Cargo check | 통과, `/private/tmp/kit-pr09-guidance-cargo-verified.log` |
| 존재하지 않는 가림 red/green | `/private/tmp/kit-pr09-guidance-phantom-{red,green}.log` |

HTTP의 기본 sandbox 실행은 localhost listen EPERM으로 실패했고 같은 코드를 승인된
로컬 테스트 환경에서 실행해 통과했다. 사용자 설정을 변경하거나 모델 호출로 회귀를
대체하지 않았다. [보존 체크포인트](native-guidance-catalog-preservation-20261106.json)에
source/log hash와 원장 상태를 기록한다. PR09의 Agent/지침 실제 로딩, 다른 client/surface,
PR07 AGY child 완료, PR10/11은 계속 남아 있다.
