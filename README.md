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

## 설치 및 검증

Node.js 20 이상이 필요합니다.

```bash
npm install
npm ci --prefix gui
npm run test:all
```

## CLI

```bash
# starter Manifest 생성
node bin/cli.js init

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

CLI 명령은 `init`, `apply`, `history`, `rollback`, `help`만 제공합니다.
자원 선택은 `--resource`나 `--file`이 아니라 Manifest에서 수행합니다.

## 데스크톱 GUI

```bash
npm run gui
```

GUI는 scope, client, Manifest와 대상 프로젝트를 선택하여 계획을 만들고,
차단 사유와 변경 대상을 확인한 뒤 명시적으로 적용합니다. 완료된
트랜잭션은 같은 화면에서 rollback 계획을 만들 수 있습니다.

로컬 백엔드는 `127.0.0.1:3710`에만 바인딩되며, 변경 요청은 세션 토큰과
허용 origin 검사를 통과해야 합니다. 역방향 프록시나 포트 포워딩을 통해 3710 포트를 외부로 노출하지 마십시오.
로컬 제어 평면 API는 신뢰할 수 없는 로컬 프로세스가 실행 중인 다중 사용자(shared) 기기 환경에서 사용하기에 적절하지 않습니다.

## 안전성

- Manifest 없는 scope 거부
- 절대 경로, traversal, symlink escape source 거부
- 미확인 capability와 모호한 Tool provider 거부
- unknown ownership 및 외부 변경 충돌 거부
- 계획 만료와 재사용 거부
- 트랜잭션 백업, 원자적 적용, 검증 실패 rollback
- Manifest에 literal secret 저장 거부

## 문서

- [제품 정의](./docs/product/agent-kit-definition.md)
- [아키텍처](./docs/architecture/overview.md)
- [배포 수명주기](./docs/architecture/deployment-lifecycle.md)
- [자원 참조 모델](./docs/architecture/resource-reference-model.md)
- [플랫폼 지원](./SUPPORT.md)
- [릴리스 절차](./RELEASE.md)
- [재구축 단계](./docs/reconstruction/)
- [남은 작업 인계 지시서](./docs/handoff/remaining-work-orders.md)
