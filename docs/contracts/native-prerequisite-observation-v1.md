# Native prerequisite observation v1

2026-11-06. PR10의 내부 native 전제 검증이다. 현재는 정확한 실행 파일 evidence가 있는
Codex CLI의 전역 Skill·MCP를 선택 프로젝트 문맥에서 관측한다. 관측만으로 실행 권한을
만들지 않는다. [공개 v3 실행](scoped-deployment-execution-v1.md)이 같은 private 검증기를
사용하며 다른 client/surface 지원을 추정하지 않는다.

## 관측과 집행의 경계

`createNativePrerequisiteService.observe`는 현재 설치 schema 3/4 영수증의 revision·locator·
binding과 소유/전이 revision을 먼저 확인한다. 기존 schema 1/2에 없던 선언을 추정하거나
사용자 원장을 승격하지 않는다. 전체 Skill/MCP 전이 closure가 선택에 포함돼야 한다.
[scoped v4](scoped-installation-receipts-v4.md)의 origin ID와 frozen Tool binding도 같은
검증기로 읽고 원래 native server ID를 유지한다.

클라이언트별 RPC 해석은 adapter에, 경로·실행 파일 evidence는
`clients/native-prerequisites/codex-cli.yaml`에 둔다. 이 보조 정의는 설치 locator가 참조하는
기존 client definition digest와 deployment runtime gate를 바꾸지 않는다. 실행 파일의
SHA/platform/arch와 기존 client definition이 모두 일치해야 한다.

기본 관측은 `config/read`·필요한 `skills/list`뿐이다. `observeProviders: true`가 명시된
경우만 고정한 영수증의 **원래 native server ID**로 `mcpServerStatus/list`를 요청한다.
MCP 연결 전에 설정 출처·Skill 활성·전체 closure·명시적 Tool 별칭·Tool 허용/제외 정책과
파일 문맥을 확인한다. 이 검증이 실패하면 provider 연결을 시작하지 않는다.

[공식 app-server 문서](https://learn.chatgpt.com/docs/app-server)의 선택 서버·Tool metadata
조회 RPC를 사용한다. `detail: toolsAndAuthOnly`, `serverName`을 지정하며 페이지·출력·시간을
제한한다. 서버에서 요청하는 승인/elicitation은 거절한다. thread/turn·Tool 실행·resource
본문 읽기·로그인·설정 쓰기를 요청하지 않는다. 선택하지 않은 서버를 탐색하지 않는다.

## 긍정 관측의 조건

Skill은 소유한 설치 경로 또는 영수증이 증명한 snapshot 경로의 정확히 한 `SKILL.md`가
native 목록에 있고, `enabled: true`, user scope여야 한다. 같은 이름의 다른 경로를
대신 선택하지 않는다. 선택 Skill/상위 루트 오류나 출처를 알 수 없는 오류는 미확인이다.
명확히 다른 경로의 외부 Skill 오류는 선택 자원의 긍정 관측을 취소하지 않는다.

MCP는 현재 effective 설정이 활성이고 소유한 전역 설정 파일의 single-source여야 한다.
실행 command/args·연결 값·Tool filter 등 의미 있는 필드의 출처가 빠져 있으면 통과하지
못한다. 다른 scope의 합성/가림·불명확한 별칭·정책 제외는 연결 전 미확인으로 남긴다.
설치 당시 논리 Tool ID→native 이름 매핑만 사용하며 이름을 추정하지 않는다.

초기화된 provider의 Tool capability와 완결된 목록에 필요한 native 이름이 있어야 한다.
Tool 오류·미로그인·미시작/실패 상태·다른 서버 응답·이름 불일치·모호한 중복은 통과하지
못한다. 새 thread 없이 정상적으로 탐색된 global 서버의 `runtimeStatus: null`은 허용하되,
이 사실로 active thread의 연결이나 Tool 실행을 주장하지 않는다.

## 문맥 고정과 private verifier

전체 상위 경로의 프로젝트 설정·Git 경계 metadata, 전역 설정, 보조 정의가 지정한 시스템
설정의 bytes hash/mode/identity를 고정한다. 설정 symlink·hard link·특수/초과 파일은
거절한다. macOS의 고정 `/etc` OS alias만 정규화하고 하위 사용자 링크는 따라가지 않는다.
현재 지원하지 않는 MDM/enterprise/임의 layer·named profile·custom project marker는
미확인으로 남긴다. 관측 중 변경도 provider 연결 전 및 종료 후에 다시 확인한다.

성공한 관측은 application instance 내부의 bounded map에 보관한다. public 응답에는
불투명 observation ID와 선택 자원의 안전한 결과만 전달한다. 설정/command/env/header,
Tool 설명/schema·오류 원문·외부 Skill 정보는 투영하지 않는다. public JSON에 긍정 flag를
넣거나 응답을 수정해도 verifier를 만들 수 없다.

`verifier({observationId})`는 coordinator의 동기 `verifyPrerequisites` port다. 같은 프로젝트·
pin 집합·실행 파일·정의·설정 문맥·설치 소유 상태를 재검증한다. 기본 유효 기간은 60초이며
다른 instance·알 수 없는 ID·만료·시계 역행·입력 변경에는 실패한다. 예정된 프로젝트 설정
변경도 기존 verifier를 무효화한다. 후속 [문맥 전환 계약](native-context-transition-v1.md)은
검토한 프로젝트 target만 별도로 고정하고 실제 적용 후 재관측한 after verifier를 제공한다.
기존 관측을 임의의 설정 변경에 재사용하는 예외는 두지 않는다.

## 증거와 남은 gate

[실제 실행 파일 격리 왕복](../reconstruction/codex-native-prerequisite-service-roundtrip-20261106.json)은
metadata-only 무연결, 선택 MCP의 초기화/Tool 목록, Skill 발견, private verifier, 프로젝트
설정 변경 시 무효화, 관측 무쓰기와 배포 rollback·기존 설정/외부 링크 identity 보존을 확인한다.
`scripts/client-verification/native-prerequisite-fixture.mjs --binary /absolute/codex`로 재현한다.
사용자의 실제 HOME/원장/client 설정에 쓰지 않는다.

`observed`는 이 문맥에서 발견된 전제의 관측이다. Tool 실행·프로젝트 consumer 활성·모델
응답은 미확인이며 `fulfilled: false`다. 내부 coordinator 포트와 격리 client 파일 적용은
연결했고 [읽기 전용 v3 compiler](scoped-deployment-compilation-v1.md)도 추가했다. 이후
[공개 실행 서비스](scoped-deployment-execution-v1.md)는 계획·실제 after 재관측·등록/해제와
저장 v5·재개/복구를 연결한다. native 원형/이관의 선택적 영향 예측과 진단·consumer 활성
검증, 다른 client/surface는 이 관측 계약의 성공으로 완료하지 않는다.
