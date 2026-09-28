# CA04-1: 설치된 CLI의 자원 인식 검증

2026-09-27. 상태: **재현 가능한 격리 검증 도구와 부분 실기 증거 확보. CA04 전체 미완료.**

## 실제 확인한 범위

macOS arm64에서 설치된 Codex CLI 0.145.0, Antigravity CLI 1.2.11을 실행했다.
각 제품·scope마다 새 임시 홈/프로젝트를 만들고 Kit의 공통 서비스로 계획 → 적용 →
갱신 → 제거 → 제거 rollback을 수행했다. CLI를 다시 시작해서 목록과 반환값을 대조했다.
[기계 판독 증거](ca04-1-cli-recognition-evidence.json)에 실행 시각, 실행 파일/정의/검증 스크립트
SHA-256, scope별 관측을 기록했다. raw 로그·대화·모델 reasoning은 저장하지 않는다.

| 자원 | Codex CLI 0.145.0 | Antigravity CLI 1.2.11 |
| --- | --- | --- |
| 지침 | 프로젝트·전역 AGENTS.md가 app-server의 instructionSources에 표시됨. 원본 사용자 본문 보존 | 파일 수명주기 확인. CLI의 지침 로딩·준수는 미확인 |
| Skill | 프로젝트·전역 skills/list에서 경로·enabled·설명 v1→v2 확인. 제거 시 부재, rollback 시 복원 | 파일 수명주기 확인. 목록·부속 파일 사용 미확인 |
| Agent | 생성·제거·rollback 바이트 확인. 개별 Agent 로딩/실행 미확인 | 생성·제거·rollback 바이트 확인. subagent 목록/실행 미확인 |
| MCP | 프로젝트·전역 mcp list와 실제 client RPC 호출에서 v1/v2 표식 일치. 제거 시 목록 부재, rollback 후 v2 호출 | 전역 mcp list에서 적용·제거·rollback 반영 확인. 프로젝트 목록 미확인, 도구 호출 미실행 |

Codex MCP 호출은 설치된 CLI 실행 파일의 `app-server` → `mcpServer/tool/call`을 통한다.
시험 서버에 검증 도구가 직접 연결한 결과가 아니다. 다만 모델이 MCP를 선택해 호출하는
`codex exec` 검증은 아니며, app-server 증거를 데스크톱 앱 실행 증거로 복사하지 않는다.
지침 source 목록은 사용자 파일이 남아 제거 후에도 나타난다. 이것을 Kit 지침 본문 적용/
제거의 모델 준수 증거로 사용하지 않는다.

Antigravity 대조 실험에서 같은 프로젝트 cwd의 `agy mcp list`는 고유 전역 대조 서버를
표시하고 프로젝트 서버는 표시하지 않았다. `agy agents`는 전역 mainAgent 대조 항목을
표시했으나 Kit이 생성한 `mainAgent: false, subagent: true` 항목은 표시하지 않았다.
따라서 목록 부재를 프로젝트 MCP 또는 subagent 자체의 미지원 판정으로 해석하지 않는다.
프로젝트 인식은 로그인된 실제 실행 세션의 `/mcp`, `/agents` 또는 도구 호출로 확인해야 한다.

두 제품의 네 자원 모두 project/global에서 적용·갱신·명시 제거·rollback 서비스가 동작했고,
rollback 후 지침/Skill/Agent/MCP 파일 바이트가 제거 직전과 일치했다. 이 파일 검증과
클라이언트 인식/사용 검증은 별도 결과다.

## 재현

```sh
npm run verify:clients -- \
  --codex /absolute/path/to/codex \
  --antigravity /absolute/path/to/agy \
  --output /tmp/agents-kit-cli-recognition.json
```

현재 도구는 **전체 CA04를 판정하지 않으므로 종료 코드 2와 complete:false**를 반환한다.
0을 받았다는 이유로 지원 승격하는 파이프라인에 연결하면 안 된다. 설치되지 않은 CLI,
실행 실패·타임아웃도 보고서에 미확인으로 기록한다. `--output`을 생략하면 JSON을 출력한다.

- 상위 프로세스의 인증 환경변수를 상속하지 않는다. fresh HOME/CODEX_HOME/XDG 경로를 자식 프로세스에만 설정한다.
- 기존 사용자 설정·인증 파일을 복사하거나 로그인/업데이트하지 않는다. 모델 turn을 요청하지 않는다.
- 15초 제한, 출력 크기 제한, 개별 프로세스 그룹 종료와 임시 폴더 정리를 사용한다.
- Antigravity agents 명령은 로컬 보조 서버 포트 바인딩이 필요하다. sandbox에서 거절되면 목록은 차단으로 기록한다.
- 실제 공유 배포 서비스를 실행하기 위해 임시 ClientDefinition 복사본에 시험용 bootstrap evidence를 넣는다. 저장소의 clients/*.yaml은 수정하지 않는다.
- bootstrap은 시험 시작을 위한 조건일 뿐 지원 증거가 아니다. 배포한 파일의 존재나 API 기본 validation 성공도 runtimeEvidence가 아니다.
- Codex 프로젝트 trust는 임시 홈에만 설정한다. 전역 MCP 시험은 최소 config.toml을 사용한다. 임의 사용자 TOML 전체 호환성을 검증한 것은 아니다.

## 공식 문서와 설치본 대조

[Codex 비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode)은 read-only 실행,
JSON 이벤트, 기존 로그인 재사용과 ephemeral 옵션을 설명한다.
[Codex app-server](https://learn.chatgpt.com/docs/app-server)는 stdio JSON-RPC 초기화와
skills/list, 버전별 스키마 생성을 제공한다. 설치된 0.145.0에서 스키마를 생성해 사용한
RPC 필드를 확인했다. 실험적 app-server API는 검증 도구에만 사용한다.

[Antigravity MCP](https://antigravity.google/docs/mcp)는 전역
`~/.gemini/config/mcp_config.json`과 프로젝트 `.agents/mcp_config.json`을 문서화한다.
[Subagents](https://antigravity.google/docs/subagents?tab=cli)는 개별 파일과 mainAgent/subagent
속성을 구분한다. [Headless](https://antigravity.google/docs/cli/headless/)는 캐시된 로그인을
전제로 한다. 문서상 경로 지원과 설치본 목록 명령의 관측 범위를 혼동하지 않는다.

## 남은 검증과 진행 조건

Codex의 새 격리 홈에서 `login status`는 **Not logged in**이었다. Antigravity의 별도
fresh-home headless 사전 시도는 25초 제한 안에 결과를 내지 못했다. 이 결과를 인증 실패나
자원 미지원으로 단정하지 않았으며, 최종 재현 스크립트는 모델 turn을 요청하지 않는다.

후속 확인에서 **기존 사용자 홈의 두 CLI 로그인은 이미 정상**이었다. 위 fresh-home 결과는
사용자 계정의 로그아웃을 뜻하지 않는다. 재로그인이나 인증 복사 없이 기존 native 인증을
사용하고 프로젝트 파일만 임시 경로에 배포하는 [CA04-2 검증](phase-ca04-2-cli-model-use.md)으로 이어간다. 확인 항목은 다음과 같다.

1. 질문에 포함하지 않은 지침 표식과 갱신/제거 후 새 세션 응답.
2. Skill 본문 및 부속 파일을 실제 도구로 읽은 관측.
3. 커스텀 Agent의 별도 실행과 역할 표식.
4. 두 CLI의 모델이 시험 MCP를 실제 호출한 결과와 프로젝트 범위 인식.
5. 정확한 버전·OS·scope·자원·전송 방식의 검증 수준을 정의한 뒤 runtimeEvidence 승격 검토.

현재 production runtimeEvidence는 비어 있고 자동 적용은 계속 차단된다.
CA05 앱/IDE, CA06 승인·불변 묶음·daemon 집행 역시 이 결과로 완료 처리하지 않는다.

## 회귀 검증

검증 프로세스의 환경 격리·시간/출력 제한, 실패 메시지 비노출, 정확한 Skill 식별,
수명주기에서 부재/미관측 구분, 실제 시험 MCP protocol 왕복을 자동 테스트한다.

- `npm test`: **207 tests 통과** (새 검증 도구 테스트 4개 포함).
- 실제 CLI 검증: 양쪽 제품·project/global 네 조합의 파일 수명주기 및 바이트 rollback 통과. 인식 범위는 위 표와 JSON을 따른다.
- `git diff --check`: 통과. GUI/HTTP 제품 코드는 이번 단계에서 변경하지 않았다.
