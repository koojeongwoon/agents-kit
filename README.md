# agents-kit

Cursor, Antigravity, Codex, Claude Code, Claude Desktop에서 사용하는 에이전트 자원을 하나의 마스터 킷으로 관리하고 배포하는 CLI 및 데스크톱 GUI입니다.

Markdown/JSON 자원을 클라이언트별 어댑터가 각 제품의 경로와 형식으로 변환합니다. LangChain이나 LangGraph 없이 symlink, 설정 변환, Node.js CLI, React/Tauri GUI로 동작합니다.

## 핵심 기능 및 특징

- **글로벌 최신 명세 지원**: Agentic AI Foundation (AAIF)의 `AGENTS.md` 및 `agentskills.io` Open Spec 100% 준수
- **✨ 1-Click AI 전문가 자동 고도화**: 자원 카테고리별(Skills, Agents, Harness, Loops, Memory) 사전 정의 메타 프롬프트를 기반으로 버튼 클릭 한 번에 고품질 규격 작성
- **🛡️ 3중 프롬프트 인젝션 방어**: XML 태그 격리(`<user_existing_content>`), 시스템 가드레일, 토큰 바운더리 캡핑으로 프롬프트 탈옥 차단
- **📁 시각적 디렉터리 탐색기**: 프로젝트 이식 및 신규 프로젝트 킷 생성 시 마우스 클릭으로 디렉터리 트리 브라우징
- **🔑 GUI 기반 Multi-LLM API Key 관리**: `~/.agents-kit/config/config.yaml`에 OpenAI(GPT-4o), Gemini, Claude 키 보안 관리
- **🐙 Git 1클릭 브라우저 인증**: GitHub CLI 기반 브라우저 1클릭 로그인 및 마스터 킷 Git 백업/동기화 지원

## 관리 자원

agents-kit은 다음 6개 자원 범주를 관리합니다.

- `harness`: `AGENTS.md`, 허용 명령, 실행 자가검증 규칙 등
- `skills`: `agentskills.io` 표준 규격의 재사용 가능한 `SKILL.md` 묶음
- `mcp`: MCP 서버 템플릿과 로컬 보안 환경변수
- `agents`: 역할별 서브에이전트 지침
- `loops`: 반복 작업 정의와 클라이언트별 자동화 형식
- `memory`: 전역 또는 프로젝트 메모리 지식베이스

## 마스터 킷 위치와 구조

기본 마스터 킷은 저장소 안이 아니라 사용자 홈의 `~/.agents-kit/kit`에 생성됩니다. 환경 설정은 `~/.agents-kit/config/config.yaml`에 저장됩니다.

```text
~/.agents-kit/
├── config/
│   └── config.yaml          # Multi-LLM API Keys & 글로벌 설정
└── kit/                     # 마스터 자원 킷
    ├── global/
    │   ├── harness/
    │   ├── skills/
    │   ├── mcp/
    │   ├── agents/
    │   ├── loops/
    │   └── memory/
    └── projects/
        └── <project-name>/
            ├── harness/
            ├── skills/
            └── ...
```

- `global`: 사용자 PC 전체에 공통으로 배포할 자원
- `projects/<name>`: 프로젝트별로 관리하는 마스터 자원

## 지원 클라이언트

| 클라이언트 | 표시 이름 | 전역 설정 위치 | 프로젝트 배포 위치 |
|---|---|---|---|
| Antigravity | Antigravity | `~/.gemini/config` | `<project>/.agents` |
| Cursor | Cursor | `~/.cursor` | `<project>/.cursor`, `<project>/.cursorrules` |
| Codex | Codex | `~/.codex` | `<project>/.codex` |
| Claude Code | Claude Code | `~/.claude` | `<project>/.claude`, `<project>/.mcp.json` |
| Claude Desktop | Claude Desktop | 사용자 Claude 설정 | 프로젝트 스코프 미지원 자원 제외 |

## 설치와 GUI/CLI 사용법

Node.js 18 이상이 필요합니다.

```bash
npm install
npm test

# GUI 데스크톱 앱 실행 (Tauri / React)
npm run gui

# CLI 전역 배포
node bin/cli.js apply
node bin/cli.js apply --dry-run
node bin/cli.js apply --client codex

# 프로젝트 배포
node bin/cli.js apply --project /path/to/project
```

`npm link`로 설치하면 `node bin/cli.js` 대신 `agents-kit` 명령어로 실행할 수 있습니다.

## Multi-LLM API Key 설정 (GUI & YAML)

상단 헤더의 **`🔑 API 키 설정`** 버튼을 눌러 OpenAI, Gemini, Anthropic Key를 등록하면 `~/.agents-kit/config/config.yaml` 파일에 안전하게 저장되며 AI 자동 고도화 호출 시 즉시 적용됩니다.

```yaml
llm:
  provider: openai
  keys:
    openai: "sk-..."
    gemini: "AIza..."
    anthropic: "sk-ant-..."
```

## skills.sh 마켓 & Smithery MCP 병합

- **skills.sh 스킬 마켓**: `Skills` 탭에서 마켓을 열어 공개 커뮤니티 스킬을 클릭 한 번으로 마스터 킷에 다운로드 및 배포합니다.
- **Smithery MCP 마켓**: `MCP` 탭에서 Smithery 원격 MCP 서버를 검색하고 로컬 환경변수(`.env`)와 함께 안전하게 병합합니다.

## 개발 검증

```bash
npm run test:all
```

플랫폼 지원 범위는 [SUPPORT.md](./SUPPORT.md), 배포 절차는 [RELEASE.md](./RELEASE.md)를 참고하세요.
