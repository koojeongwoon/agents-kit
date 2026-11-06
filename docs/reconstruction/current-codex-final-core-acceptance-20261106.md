# 현재 Codex·GUI 핵심 범위 최종 검증

2026-11-06. 추가 확장을 멈추고 현재 설치된 Codex CLI의 기존 기본 형식과 GUI 관리 흐름을
검증했다. 실제 실행 파일은 `0.167.0-alpha.3.2`, darwin/arm64,
SHA-256 `a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e`다.
실제 바이너리를 격리 HOME·프로젝트에서 실행했고 사용자 설정이나 원장을 시험용으로 바꾸지 않았다.

## 실제 Codex 적용·인식·복원

[여섯 조합의 증거](current-codex-existing-resources-20261106.json)는 각 조합의
baseline → 적용 → 갱신 → 제거 → 제거 rollback을 기록한다. 이어 적용 트랜잭션도 역순으로
복원하여 격리 환경의 원래 설정·권한과 외부 링크 identity를 확인했다.

| 자원 | 전역 | 프로젝트 | 인식 증거 |
|---|---|---|---|
| MCP 기본 stdio | 통과 | 통과 | `config/read`의 선택 서버 설정, 실제 로컬 MCP의 `read_marker` Tool 목록 |
| Agent 기본 역할 | 통과 | 통과 | 실제 역할·부모 관계와 공개 자식 완료 이벤트/결과, 부모의 private marker 응답 |
| 지침 Markdown | 통과 | 통과 | `thread/start`의 실제 `instructionSources`, 해당 로딩 파일의 보존된 사용자 본문과 Kit 표식 |

지침은 전역 `~/.codex/AGENTS.md`, 프로젝트 `AGENTS.md`, Agent는 각 scope의
`.codex/agents/{assetId}.toml`, MCP는 각 scope의 `.codex/config.toml`을 사용했다.
이 경로와 기존 필수 Agent 필드는 [공식 Subagents 문서](https://learn.chatgpt.com/docs/agent-configuration/subagents?surface=cli)의
현재 계약과 대조했다. 경로·변환·배포 서비스의 설계를 바꾸지 않았다.

성공한 수명주기는 metadata 세션 20회와 Agent 부모 요청 10회·자식 완료 6개다.
Agent 진단 부모 요청 3회·자식 완료 1개는 별도로 기록했다. Agent 모델은 native가 광고한
기본 모델을 사용했다. 인증은 기존 접근 토큰을 임시 HOME에 복사하되 refresh token을
제외했고 원본 인증 파일의 SHA가 같음을 확인했다. 임시 인증·HOME은 종료 시 삭제했다.
숨은 추론이나 원문 대화는 검증 결과에 저장하지 않았다.

MCP는 로컬 fixture 서버의 Tool 목록까지만 요청했다. MCP Tool 실행, 지침에 대한 모델 응답,
다른 대화에서의 지속적인 지침 준수는 이 검증의 판정 대상이 아니다.
Agent는 파일 존재·부모의 주장만으로 통과시키지 않고 실제 자식 완료를 요구했다.

## 실제 GUI 핵심 흐름

[브라우저 실기](current-codex-gui-core-roundtrip-20261106.json)는 일반 GUI와 HTTP 보안을
유지한 채 격리된 실제 backend를 연결해 대표 Skill 한 개를 다음 순서로 조작한 기록이다.

1. 기존 설치를 Kit으로 편입하고 Kit 사본의 `alpha`를 `KIT`으로 편집했다. 설치는 유지됐다.
2. 기존 원본의 `omega`를 `UPSTREAM`으로 변경한 뒤 GUI에서 업데이트를 가져왔다.
3. B/K/U diff를 검토하고 `KIT`과 `UPSTREAM`을 함께 보존하는 비겹침 병합을 적용했다.
4. 현재 설치를 내용 변경 없이 관리 등록하고, 별도의 설치 계획을 검토해 Kit 사본을 적용했다.
5. 배포 이력에서 적용 트랜잭션의 rollback 계획을 검토·승인했다.

적용 시 두 수정이 모두 설치에 반영됐고, 복원 후 설치는 적용 직전의 `alpha/base/UPSTREAM`으로
돌아왔다. Kit에는 병합된 `KIT/base/UPSTREAM`을 유지했다. 설정 바이트·0640 권한과
외부 ego 링크 identity를 확인했다. GUI는 대표 Skill 실기이며, 네 자원 × 두 scope의 편입·편집·
병합·설치·복원은 기존 `native-installation-core-flow.test.js`의 8조합 회귀로 함께 확인한다.

## 기록된 실패와 수정 범위

- MCP fixture의 quoted trust table은 기존 TOML 보존 guard가 차단했다. guard를 유지하고
  검증 프로세스에만 trust override를 주도록 fixture를 고쳤다.
- 프로젝트 MCP 설정은 읽혔으나 전역 Tool 목록에는 없었다. 실제 검증기의 ephemeral thread ID를
  MCP 목록 요청에 전달해 프로젝트 문맥을 맞췄다. provider 승인 없이 쓰레드를 여는 제품 기능은 추가하지 않았다.
- 첫 전역 Agent 요청은 부모가 `ABSENT`를 반환했고 자식을 만들지 않았다. 이를 실패로 남긴 후
  새 문맥의 정확한 역할 호출을 명시해 프로젝트 단일 진단과 양 scope 전체 수명주기를 확인했다.
  첫 응답의 내부 원인은 단정하지 않는다.
- 지원 gate 회귀 시험을 먼저 변경해 35개 중 3개 실패를 기록했다. 실제 증거 확보 후 현재
  바이너리의 기존 여섯 profile만 추가했다. 합본 증거에서 자원 종류를 구별하지 않던 테스트도
  정확한 종류·scope·버전으로 선택하도록 수정했다. 기존 snapshot 증거 조건은 유지했다.

현재 바이너리의 Skill copy 2개를 포함한 기본 조합은 8개다. HTTP·환경변수 전달·native MCP
확장 옵션, Agent 독립 sandbox/Tool 기본값, snapshot의 새 버전 지원, desktop/IDE 등은 계속
기존 gate를 따른다. 다른 바이너리 hash는 자동 적용할 수 없다.

[실제 카탈로그 reader 확인](current-codex-catalog-readers-20261106.json)에서는 MCP의
전역 활성·프로젝트 비활성 상태를 읽었고, 지침의 설정 기반 예상은 `partial` 및
`loadedSourcesState: unverified`로 유지했다. 실제 지침 로딩 증거는 위 별도 native 검증에만 있다.
두 reader의 현재 hash 증거만 추가했으며 Agent 목록 API를 새로 만들지 않았다.

재현 검증기는 `scripts/client-verification/native-existing-resources.mjs`다.
`--binary <검증된 Codex 절대 경로> --kinds instructions,mcp --output <결과 JSON>`으로
metadata 수명주기를 실행한다. Agent는 명시적으로 `--kinds agents`를 선택하며 실제 모델 요청과
기존 로그인 접근 토큰의 임시 복사를 수행한다. bootstrap 정의는 임시 폴더 안에서만 사용한다.

최종 자동 검사와 사용자 설정·원장·ego 링크 보존 결과는
[최종 결과 JSON](current-codex-final-core-acceptance-20261106.json)을 따른다.


## 최종 판정

요청한 핵심 검증 범위는 완료했다. root **853**, HTTP **53**, GUI **91**개가 모두 통과했고
실패·건너뜀은 0개다. TypeScript, desktop frontend/backend 빌드, offline Cargo check,
`git diff --check`도 통과했다. 각 로그와 증거 선택 회귀의 RED 3개→GREEN 35개 판정은
최종 JSON에 구분했다.

시작 시 별도로 캡처한 27경로와 대조해 내용·권한 차이는 없었다. 실제 ego-browser 링크
3개의 연결과 identity를 유지했다. Codex config는 내용·권한·inode가 같고 mtime만 변경됐으며,
그 작성 주체는 단정하지 않는다. 원래 역사적 baseline은 교체하지 않았다.

사용자 원장은 schema 6, 트랜잭션 145개, 관리 파일 3개, 소유자 4개, pending 0개로 동일하다.
원장 SHA-256은 `886d2296226089f4f550e3560cfad7bfb7670ab2e53f1a978c1e3b841f656c5d`로
같고 기존 `node-repl` drift 및 다른 소유 관측 결과도 동일하다. 이 차이를 원장이나 설정에
덮어써서 정리하지 않았다. 사용자가 이미 사용 중인 설정·원장에 대한 쓰기는 0회다.

기존 광범위한 작업 트리는 유지했고 이번 검증에서는 commit·push·PR 생성이나 사용자
설정 전환을 수행하지 않았다. 중단한 추가 확장은 재개하지 않았다.
