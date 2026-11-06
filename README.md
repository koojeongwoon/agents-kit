# agents-kit

여러 LLM 클라이언트의 에이전트 자원을 하나의 Manifest로 정의하고,
변경 계획을 검토한 뒤 트랜잭션으로 배포하는 CLI 및 데스크톱 앱입니다.

Manifest가 유일한 desired state입니다. 디렉터리 구조를 추측하거나,
Manifest에 없는 공통 자원을 자동 생성·가져오기·배포하지 않습니다.

## 현재 지원 범위

- 자원: Instructions, Skills, Agents, MCP, Memory, Policies, Harness, Workflows, Settings
- 참조: Skill 의존성, Agent의 Skill/Tool/Policy/Memory 참조, MCP Tool provider, Workflow step
- 클라이언트 정의: Codex, Claude Code
- 전략: copy, structured merge, managed file, safe link, manual
- 흐름: plan → explicit apply → validation → history → rollback
- 범위: global, named project
- 표면: 동일한 애플리케이션 서비스를 사용하는 CLI와 데스크톱 GUI

지원 여부는 디렉터리 존재가 아니라 `clients/*.yaml`의 capability와 검증
근거로 판단합니다. 지원되지 않거나 검증되지 않은 기능은 fail-closed로
차단됩니다.

## 기존 자원의 Kit 관리

기존 Skill·MCP·Agent·지침을 관측한 뒤 선택한 자원의 사본을 Kit에 편입합니다.
사본 편집과 원본 업데이트의 3-way 병합은 설치와 분리하며, 설치 변경은 별도의
계획을 검토한 뒤 적용하고 이력에서 복원합니다. CLI와 GUI는 같은 서비스를 사용합니다.
ego-browser 같은 외부 관리 링크는 존재·연결 상태를 표시하고 원래 관리 주체를 유지합니다.

현재 검증된 Codex CLI `0.167.0-alpha.3.2`의 기존 기본 형식은 전역·프로젝트 모두
적용·인식·복원을 확인했습니다. 자동 적용은 검토된 버전·실행 파일 hash·scope·형식만
허용합니다. [핵심 검증 결과](docs/reconstruction/current-codex-final-core-acceptance-20261106.md)와
[PR 정리 범위](docs/reconstruction/shared-resources-core-pr-20261106.md)를 참고하세요.

## Kit 구조

기본 Kit은 `~/.agents-kit/kit`에 생성됩니다.

```text
~/.agents-kit/kit/
├── global/
│   ├── agent-kit.yaml
│   └── assets/
└── projects/
    └── default/
        ├── agent-kit.yaml
        └── assets/
```

각 scope에는 `agent-kit.yaml`, `agent-kit.yml`, `agent-kit.json` 중 하나가
필수입니다. 자원 파일은 Manifest의 `source`로 명시해야 합니다.

전체 형식은 [Manifest 예제](./docs/examples/agent-kit.yaml)와
[자원 참조 모델](./docs/architecture/resource-reference-model.md)을
참고하세요.

공통 Skill은 [snapshot·공유 연결 계획](docs/contracts/skill-snapshot-plan-v1.md)도
미리 볼 수 있습니다. source v2의 명시적 전략과 대상별 override로 고정 사본·파일
변경·소비자를 비교하며, 계획만으로 snapshot이나 설치 링크를 만들지 않습니다.
검증된 Codex CLI 전역 Skill 조합은 [링크 적용·이관·복원](docs/contracts/skill-snapshot-deployment-v1.md)도
지원합니다. 기존 copy 디렉터리를 바꿀 때는 별도 이관 계획을 검토해야 하며, 미검증
클라이언트·scope·surface 조합은 계속 차단됩니다.

Skill definition v3는 [대상·호환성·variant 선택](docs/contracts/skill-distribution-v1.md)을 분리합니다.
공통 variant의 검토된 배포와 함께 [variant별 사본 관리](docs/contracts/skill-variant-sources-v1.md)도
제공합니다. `variant-register --asset <id> --variant <id>`로 관리 계획을 검토하고, 기존
`source`·`source-edit`·`updates`·`refresh`·`source-rollback`에 `--variant`를 전달합니다.
다른 variant와 현재 설치를 유지하며 편집·재가져오기·병합·복원을 진행합니다. 배포는 별도이며
[검증된 Codex native UI metadata profile](docs/contracts/native-skill-interface-v1.md)은 원형을
보존해 배포합니다. 호출 정책·native Tool 의존성·다른 native 형식과 미확인 client 격리는 차단합니다.

같은 설정 파일을 쓰는 여러 검증 대상의 Agent·MCP는 [저장소 단위로 합산](docs/contracts/physical-resource-deployment-v1.md)합니다.
서로 다른 MCP 항목은 함께 병합하고, 같은 항목의 산출물이 다르면 차단합니다. 적용·제거·
저장 계획에는 함께 영향을 받는 화면을 표시하며, 같은 파일을 읽는다는 이유로 미검증
화면을 활성화하지 않습니다. 이 소유권을 처음 쓰면 원장은 v7로 전환합니다.

클라이언트 정의의 설치 경로가 바뀌면 [과거 위치와 새 위치를 대조](docs/reconstruction/phase-resource-path-migration.md)하고
일반 중복 배포를 차단합니다. 적용 당시 소유 증거가 있는 자원은
[명시적 경로 이관](docs/contracts/resource-path-migration-v1.md)으로 이동하고 양쪽 위치를
함께 복원할 수 있습니다. 증거가 없는 설치와 외부 링크는 자동으로 옮기지 않습니다.

[통합 catalog](docs/contracts/resource-catalog-v1.md)는 전역과 선택 프로젝트의 원본·기존
설치를 함께 읽습니다. `node bin/cli.js catalog --project /path/to/project`로 조회하며,
GUI에서도 동명 자원과 원래 관리 범위를 구분합니다. 문서상 우선순위와 실제 로딩·비활성
상태를 분리하고, 미확인 결과로 자동 덮어쓰거나 외부 링크를 변경하지 않습니다.
검증된 Codex CLI Skill은 `catalog --client codex --surface cli --observe-native` 또는
GUI의 상태 확인 버튼으로 실제 활성·비활성을 조회할 수 있습니다. 모델 호출이나 설정
변경을 하지 않으며 상위·추가 경로의 항목은 읽기 전용으로 표시합니다.
Codex MCP는 같은 명령에 `--resource-kind mcpServers`를 더하거나 MCP 화면에서 조회합니다.
전역·프로젝트의 필드별 합성과 가림을 보여 주며 서버 연결·Tool 사용 여부는 별도입니다.
지침 화면과 `--resource-kind instructions`는 CLI 설정의 예산·fallback과 문서 기준 파일
선택 후보를 표시합니다. 실제 주입 여부는 미확인으로 유지합니다. Agent의 선언 이름도
파일 ID와 구분하며, 목록 인식이나 자식 완료를 의미하지 않습니다.

`catalog --dependencies`와 GUI의 범위 간 의존성 표시는 전역·프로젝트 참조와 Tool
provider를 원본별로 해석합니다. 선언 조회와 배포 실행은 별도 검증이며, 선언 검증이
통과해도 실제 설치와 native 발견은 별도로 확인해야 합니다.
v3 일반 자원 선언은 같은 검증·원본 편집 서비스에서 관리합니다. CLI의 `validate`, 읽기 전용
`doctor`, `manifest-edit --mutations <json-file> [--dry-run]`과 GUI 편집기를 사용할 수 있습니다.
설치 파일은 변경하지 않으며 편입된 native 원본의 미지원 v3 수명주기는 차단을 유지합니다.
[v3 원본 관리 계약](docs/contracts/scoped-manifest-management-v1.md)을 따릅니다.
v3 배포는 공통 계획에서 설치 전제와 capability를 확인하고,
필요한 native 관측·적용 후 재관측·의존성 등록을 거칩니다. CLI에서는
`apply`·`rollback`의 `--observe-prerequisites [--discover-providers]` 옵션과 기존 저장/재개·제거/복구 명령을 사용합니다.
[프로젝트 의존성 rollback과 참조만 해제하는 변경](docs/contracts/scoped-deployment-rollback-v1.md)은
복원할 설치 영수증과 현재 전역 전제를 대조하고, 파일·설정·Kit 소유 snapshot 링크를 보존합니다.
[공개 v3 실행 계약](docs/contracts/scoped-deployment-execution-v1.md)에 지원 범위와 미지원
rollback·이관·native writer 경계를 명시했습니다. 기존 Manifest v1/v2는 그대로 사용할 수 있습니다.
`--inspect-installations --client codex --surface cli` 또는 GUI의 설치 소유 정보 확인은
적용 당시 선언과 현재 소유 파일·설정 영역을 대조합니다. native 발견·Tool binding은
별도로 미확인이며, 과거 영수증 없는 설치를 현재 Kit 내용으로 추정하지 않습니다.
기존 native 소유 기록은 관리 등록 계획에서 마지막 적용 snapshot을 대조한 뒤 설치
파일을 바꾸지 않고 영수증만 갱신할 수 있습니다. 원래 native ID와 경로를 유지합니다.
`catalog --inspect-dependents` 또는 GUI의 등록된 의존 프로젝트 확인은 전역 원장에
명시적으로 등록된 프로젝트와 양쪽 설치 기록을 읽습니다. 누락·손상·복구 대기 항목도
등록을 유지하며 미확인으로 표시합니다. 아직 공개 등록/coordinator는 없으므로 기존
원장을 자동 승격하지 않으며, 미등록 native 사용자를 추적한 결과로 해석하지 않습니다.

## 설치 및 검증

Node.js 20 이상이 필요합니다.

snapshot 링크 적용·이관·복구에는 Python 3와 원자적 rename/exchange를 지원하는 파일시스템이
추가로 필요합니다. 도구가 없으면 해당 계획을 차단하며 일반 copy 배포는 계속 사용할 수 있습니다.

```bash
npm ci
npm ci --prefix gui
npm run test:all
npm --prefix gui test
npm --prefix gui run typecheck
```

검증기는 [배포·클라이언트 인식·모델 응답을 별도로 기록](./docs/contracts/verification-evidence-v1.md)합니다.
과거 실패는 `npm run verify:replay -- --input <기록.json> --output <새파일.json>`으로
클라이언트 호출 없이 다시 판정할 수 있습니다. [변경과 검증 기록](./docs/reconstruction/phase-verifier-separation.md).

Antigravity의 실제 전역 MCP 시험은 `npm run verify:antigravity-mcp -- --native-global temporary-fixtures --antigravity /absolute/path/to/agy --stop-on-failure true --output /tmp/new-agy-report.json`으로
명시적으로 실행합니다. 새 시험 서버만 사용하고 원래 설정으로 rollback합니다.
[실제 MCP·canva 복원과 Agent 조사 결과](./docs/reconstruction/phase-antigravity-native-mcp.md).
Codex에도 같은 전역 MCP 검증기를 `npm run verify:global-mcp -- --client codex`로
사용할 수 있습니다. 필요한 opt-in·실행 파일·새 보고서 인수와 프로젝트/전역 지침의
검증 명령은 [기본 CLI 검증 계약](docs/contracts/basic-cli-verification-v1.md)에 있습니다.

## CLI

```bash
# starter Manifest 생성
node bin/cli.js init

# 기존 자원·링크 조회: 원본과 Kit를 만들거나 변경하지 않음
node bin/cli.js discover --client codex --surface cli
node bin/cli.js discover --project /path/to/project --client antigravity --surface cli

# 조회 결과의 candidateId로 일반 자원 원본 등록 (기존 설치는 보존)
node bin/cli.js import --client codex --surface cli --candidate <candidateId> --dry-run
node bin/cli.js import --client codex --surface cli --candidate <candidateId>
node bin/cli.js detach --asset <assetId> --dry-run
node bin/cli.js detach --asset <assetId>

# 편입 도중 프로세스가 종료된 경우 검토 후 복구
node bin/cli.js recover-sources --dry-run
node bin/cli.js recover-sources

# Kit 사본·revision token·이력 조회 후 변경 계획/적용
node bin/cli.js source --asset <assetId>
node bin/cli.js source-edit --asset <assetId> --revision <revision> --changes /path/changes.json --dry-run
node bin/cli.js source-edit --asset <assetId> --revision <revision> --changes /path/changes.json

# 로컬 원본 업데이트 확인 및 B/K/U 병합 계획
node bin/cli.js updates --asset <assetId>
node bin/cli.js refresh --asset <assetId> --dry-run
node bin/cli.js refresh --asset <assetId>

# Git 커밋 또는 정확한 npm 버전/hash 연결·재가져오기
node bin/cli.js updates --asset <assetId> --upstream /path/upstream.json
node bin/cli.js refresh --asset <assetId> --upstream /path/upstream.json --dry-run
node bin/cli.js refresh --asset <assetId> --upstream /path/upstream.json

# 충돌 선택은 검토한 reviewHash와 함께 다시 계획
node bin/cli.js refresh --asset <assetId> --review <reviewHash> --resolutions /path/resolutions.json --dry-run
node bin/cli.js source-rollback --asset <assetId> --revision <revision> --checkpoint <checkpointId> --dry-run

# 등록된 원래 클라이언트의 설치 관리 등록 → Kit 반영 계획
node bin/cli.js installation --asset <assetId>
node bin/cli.js install --asset <assetId> --mode adopt --dry-run
node bin/cli.js install --asset <assetId> --mode adopt
node bin/cli.js install --asset <assetId> --mode apply --dry-run

# 설치본 외부 수정은 Kit에 먼저 병합한 뒤 다시 반영 검토
node bin/cli.js install --asset <assetId> --mode import-installed --dry-run
node bin/cli.js install --asset <assetId> --mode import-installed
node bin/cli.js install --asset <assetId> --mode apply

# 설치 파일은 남기고 설치 관리 권한만 해제
node bin/cli.js install --asset <assetId> --mode detach --dry-run

# global 계획 및 적용
node bin/cli.js apply --client codex --dry-run
node bin/cli.js apply --client codex

# project 계획 및 적용
node bin/cli.js apply \
  --project /path/to/project \
  --project-name default \
  --client claude-code \
  --dry-run

# 이력과 rollback
node bin/cli.js history --project /path/to/project --client codex
node bin/cli.js rollback \
  --project /path/to/project \
  --client codex \
  --transaction <transaction-id> \
  --dry-run
```

`npm link` 후에는 `node bin/cli.js` 대신 `agents-kit`을 사용할 수 있습니다.

CLI 명령은 `init`, `discover`, `import`, `detach`, `recover-sources`, `source`, `source-edit`, `variant-register`,
`updates`, `refresh`, `source-rollback`, `installation`, `install`, `apply`, `remove`, `migrate`, `history`, `rollback`,
`saved-plans`, `resume`, `recover`, `validate`, `doctor`, `bundle`, `daemon-status`, `help`를 제공합니다.
자원 선택은 `--resource`나 `--file`이 아니라 Manifest에서 수행합니다.

Kit 초기화는 `init`에서만 수행합니다. 기존 자동 초기화와 달리 조회·GUI 실행·dry-run은
starter Manifest를 생성하지 않으며, 아직 Kit가 없으면 `init`을 안내합니다.
기존 Kit 경로와 `--kit`/`AGENTS_KIT_DIR` 우선순위는 유지합니다.

`discover`와 GUI 목록은 기존 Skill·MCP·Agent·지침을 읽기 전용으로 관측합니다.
ego-browser처럼 외부에서 관리하는 링크는 연결 상태와 관리 주체만 표시하고 원본 복사,
업데이트, 관리 권한 인수를 수행하지 않습니다. 같은 이름의 발견 항목과 Kit 자원을
소유권 근거 없이 합치지 않습니다. [관측 계약](docs/contracts/local-resource-observation-v1.md).

일반 자원은 GUI의 **Kit에 가져오기 → 변경 계획 확인 → 적용**으로 원본 사본과
출처·기준 사본을 등록할 수 있습니다. 원본 파일·링크는 그대로 유지하며, 등록 해제 후에도
Kit 사본과 기존 설치를 보존합니다. 편입 시 해당 scope의 Manifest는 schema 2로 바뀌므로
이전 버전 Agent Kit에서는 읽을 수 없습니다. 가져온 native 자원은 자동 배포 대상에서
제외됩니다. [편입 계약](docs/contracts/resource-import-v1.md).

등록된 자원의 **Kit 사본 편집·업데이트 가져오기·이력/복원**을 GUI에서도 사용할 수
있습니다. `changes.json`은 `[{"path":"SKILL.md","text":"새 Kit 내용\n"}]` 형태이며,
`resolutions.json`은 `{"SKILL.md":{"choice":"defer"}}`처럼 파일별 수용/보류/직접 병합을
선택합니다. 겹치지 않는 변경은 자동 병합 후보를 제시하고, 충돌이 있으면 적용을 차단합니다.
보류한 파일은 기준 사본을 유지해 다음에도 미수용 변경으로 표시됩니다. 과거 Kit 사본·기준
사본은 함께 복원할 수 있고 외부 원본은 되돌리지 않습니다. 최초 변경은 관리 기록 v2로
전환하므로 원본 등록만 지원하던 이전 빌드는 읽을 수 없습니다.
[편집·갱신 계약](docs/contracts/source-revisions-v1.md).

원래 설치 위치를 보존하면서 **공개 HTTPS Git 커밋·npm 패키지 출처**도 연결할 수
있습니다. GUI의 업데이트 출처 또는 `--upstream` JSON에 정확한 커밋/버전·무결성 해시와
내부 경로를 지정하면 같은 B/K/U 병합·보류·복원 흐름을 사용합니다. 최초 연결은 관리
기록 v3로 전환하며 출처도 revision과 함께 복원합니다. 설치나 패키지 스크립트 실행,
자동 최신 버전 추적은 하지 않습니다. JSON `null`을 선택하면 원래 로컬 출처로 다시
연결합니다. 지원 형식·제한·JSON 예시는 [출처 연결 계약](docs/contracts/upstream-sources-v1.md)을
참고하세요. ego-browser 같은 외부 관리 링크는 계속 관측만 합니다.

**클라이언트 설치 반영**은 등록된 원래 client·scope의 일반 파일과 선택 MCP 서버를
관리합니다. 처음에는 내용·권한을 유지하는 관리 등록만 수행하며, Kit 반영은 별도 계획에서
검증된 버전·옵션·실행 파일 및 provider 설치 상태를 확인합니다. 설치본 D와 마지막 적용본 L이
다르면 기본 차단하고, **설치 변경을 Kit에 가져와 병합**한 뒤 다시 반영할 수 있습니다.
충돌 선택은 `--review <reviewHash> --choices /path/choices.json`으로 재검토하며,
직접 병합은 `--manual-texts /path/manual.json`을 함께 사용합니다. 기존 링크·외부 관리 자원은
교체하거나 따라가 쓰지 않으며, 등록하지 않은 파일과 다른 MCP 설정은 유지합니다.
설치 관리는 배포 원장을 v5로 전환하므로 이전 빌드는 읽을 수 없습니다. 기존 이력·백업·rollback·
중단 복구를 공유합니다. 가져온 native 자원의 다른 client 변환은 후속이며, 공통 Skill의
명시적 snapshot 전략은 별도 [배포 계약](docs/contracts/skill-snapshot-deployment-v1.md)을 따릅니다.
[설치 계약](docs/contracts/native-installation-v1.md), [구현·검증](docs/reconstruction/phase-native-installation.md).

2026-11-05에는 기본 Kit 초기화 후 실제 Codex `0.166.0-alpha.6`와 Antigravity `1.5.1`에서
임시 전역 Skill의 Kit 반영·실제 읽기·rollback·복원본 읽기까지 확인했습니다. 기존 설정과
ego-browser 링크를 보존하고 검증용 설치는 정리했습니다. 당시 활성화는 해당 실행 파일의
전역 Skill 범위에 한정됩니다. [실환경 검증 기록](docs/reconstruction/phase-native-installation-live.md).

2026-11-06의 [기본 CLI 실기](docs/reconstruction/phase-basic-cli-verification.md)에서는
현재 실행 파일의 전역/프로젝트 네 자원 16조합 중 14조합에 증거를 확보했습니다.
Codex는 네 자원, Antigravity는 지침·Skill copy·MCP basic stdio만 해당합니다.
Antigravity Agent, HTTP·인증, 미검증 전략·surface는 계속 차단합니다.

## 데스크톱 GUI

```bash
npm run gui
```

GUI는 scope, client, Manifest와 대상 프로젝트를 선택하여 계획을 만들고,
차단 사유와 변경 대상을 확인한 뒤 명시적으로 적용합니다. 완료된
트랜잭션은 같은 화면에서 rollback 계획을 만들 수 있습니다. 적용 가능한 일반 파일 계획은
24시간 저장한 뒤 재개할 수 있으며, 중단 작업은 복구 계획을 검토한 뒤 복원합니다.
CLI의 `--save-plan`, `saved-plans`, `resume`, `recover` 사용법과 제한은
[저장 계획·복구 계약](docs/contracts/persistent-deployment-v1.md)을 참고하세요.

로컬 백엔드는 `127.0.0.1:3710`에만 바인딩되며, 변경 요청은 세션 토큰과
허용 origin 검사를 통과해야 합니다. 역방향 프록시나 포트 포워딩을 통해 3710 포트를 외부로 노출하지 마십시오.
로컬 제어 평면 API는 신뢰할 수 없는 로컬 프로세스가 실행 중인 다중 사용자(shared) 기기 환경에서 사용하기에 적절하지 않습니다.

## 로컬 데몬 상태 (LM1)

홈 화면과 `node bin/cli.js daemon-status`에서 데몬 버전·지원 기능·정책 만료·최근
이벤트를 조회합니다. 데몬이 없어도 기존 로컬 자원 관리와 배포는 동작합니다.

실행 중인 `tools-daemon enforce-worker-listen`을 조회하려면 Kit 프로세스에
`AGENTS_KIT_DAEMON_BINARY`(실행 파일 절대 경로), `AGENTS_KIT_DAEMON_SOCKET`(소켓 절대 경로),
필요하면 `AGENTS_KIT_DAEMON_UID`(기대하는 non-root UID)를 설정합니다. 실행 파일은
운영자가 신뢰하는 설치 경로여야 하며 데몬과 조회 어댑터는 같은 빌드를 사용합니다.
조회 화면에서 실행 파일·소켓을 임의 지정하거나 정책을 변경할 수 없습니다.

연결 성공은 도구 실행 허가가 아닙니다. 정책이 만료되면 연결 중에도 실행 차단으로
표시하고, 호출마다 기존 실행 인가를 다시 검사합니다. 자동 설치와 IAM/Gateway
조직 연동은 후속 단계입니다. 자세한 내용은 [조회 계약](docs/architecture/local-daemon-status-contract.md)을 참고하세요.

## 안전성

- Manifest 없는 scope 거부
- 절대 경로, traversal, symlink escape source 거부
- 미확인 capability와 모호한 Tool provider 거부
- unknown ownership 및 외부 변경 충돌 거부
- 계획 만료·검토 digest 검증, 완료된 저장 계획의 중복 실행 방지
- 트랜잭션 백업, 원자적 적용, 검증 실패 rollback
- Manifest에 literal secret 저장 거부

## 문서

- [제품 정의](./docs/product/agent-kit-definition.md)
- [클라이언트별 자원 관리·중앙 배포 계획](./docs/product/client-resource-management-plan.md)
- [Codex·Antigravity 우선 구현 계획](./docs/product/codex-antigravity-implementation-plan.md)
- [아키텍처](./docs/architecture/overview.md)
- [배포 수명주기](./docs/architecture/deployment-lifecycle.md)
- [자원 참조 모델](./docs/architecture/resource-reference-model.md)
- [CLI 실기 검증과 현재 확인 범위](./docs/reconstruction/phase-ca04-1-cli-recognition.md)
- [기존 로그인으로 실제 지침·Skill·MCP 사용 검증](./docs/reconstruction/phase-ca04-2-cli-model-use.md)
- [Antigravity MCP 승인 차단과 다음 검증 조건](./docs/reconstruction/phase-ca04-3-antigravity-mcp-permission.md)
- [승인된 Antigravity MCP 실제 사용·설정 원복](./docs/reconstruction/phase-ca04-4-antigravity-mcp-use.md)
- [플랫폼 지원](./SUPPORT.md)
- [릴리스 절차](./RELEASE.md)
- [재구축 단계](./docs/reconstruction/)
- [남은 작업 인계 지시서](./docs/handoff/remaining-work-orders.md)
