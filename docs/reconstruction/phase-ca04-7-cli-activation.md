# CA04-7: 검증된 CLI 지원 활성화

2026-09-27. 검증된 CLI 자원 범위만 실제 배포 프로필에 활성화했다.
공통 Manifest와 CLI/GUI 서비스의 계획·적용·제거·복원 경로를 사용한다.

| macOS arm64 설치본 | 프로젝트 | 전역 |
| --- | --- | --- |
| Codex CLI 0.145.0 | 지침, Skill, 기본 stdio MCP, 기본 Agent 역할 | Skill |
| Antigravity CLI 1.2.12 | 지침, Skill, 기본 stdio MCP | Skill |

## 근거와 제한

Codex 프로젝트 지침·Skill·MCP는 CA04-2, Agent는 CA04-6 child 직접 완료,
전역 Skill은 CA04-6 전체 수명주기를 근거로 한다. Antigravity 프로젝트 자원은
CA04-4, 전역 Skill은 CA04-6 교정 경로의 전체 수명주기를 근거로 한다.
각 `clients/*.yaml` runtimeEvidence는 해당 JSON 원본을 가리킨다.
과거 보고서의 `productionEvidencePromoted: false`는 당시 결과이므로 고치지 않는다.
이번 활성화 상태는 [별도 기록](ca04-7-cli-activation-evidence.json)에 남긴다.

두 프로필은 macOS arm64, 정확한 버전과 검증한 **네이티브 실행 파일 SHA-256**으로
제한한다. 같은 버전의 다른 빌드도 새 증거가 필요하다. `resourceProfile`은 다음을 제한한다.

- `mcp-stdio-basic-v1`: typed stdio 정의, 실행 파일 binding과 인수. 환경 변수 전달은 미검증으로 차단.
- `agent-role-basic-v1`: typed 기본 역할, 명시적 client-default 권한. sandboxDefault와
  mcpToolAccess는 미검증으로 차단. 기존 adapter의 정책·Skill preload 거부도 유지.

native MCP/Agent source 파일은 위 제한을 우회하지 못한다. HTTP MCP, Antigravity
Agent, 전역 지침/MCP/Agent, 다른 빌드·OS·아키텍처, 모든 앱/IDE 프로필은 차단한다.
MCP 서버 자체의 임의 기능 전체를 검증했다는 의미는 아니다. 클라이언트의 프로젝트
신뢰와 도구 승인 정책은 그대로 적용되며 Kit가 권한을 변경하지 않는다.

## 설치본 관찰과 계획 재검증

`client-binary-observer.js`는 CLI 프로필의 PATH에서 첫 실행 파일을 찾아 실제 경로와
SHA-256을 읽는다. 명령 실행, 버전 출력 파싱, 모델 호출, 인증 파일 접근을 하지 않는다.
실행 가능한 상대 PATH 후보는 거부하며 읽기 도중 파일 교체·변경도 거부한다.
512 MiB 상한과 1 MiB 버퍼를 사용한다. 식별 결과는 endpoint 보안 증명이 아니다.

공통 `planVerifiedClientDeployment`가 순수 capability 계획에 설치본 확인을 결합한다.
일치하는 기록이 있으면 버전 생략 시 검증 기록의 버전을 사용하며
`targetProfile.versionSource`는 `binary-sha256`이다. 입력 버전만 맞고 바이너리가
다르면 `CLIENT_BINARY_UNVERIFIED`로 차단한다. 계획 후 적용 직전에 실제 경로·내용을
다시 확인하며 변경 시 `CLIENT_BINARY_CHANGED`(HTTP 409)로 새 계획을 요구한다.
저장 계획은 설치본 관찰을 digest에 포함하고 재개 시 재구성·재확인한다.
제거와 rollback은 기존 소유권 기반 복구 경로를 유지한다.

설치 목록 discovery는 계속 `clientVersion: null / runtimeState: unverified`다.
클라이언트 카탈로그의 `partially-verified`와 runtimeEvidence는 배포 가능한 검증 범위를
표현한다. 단순 파일 발견으로 현재 앱의 지원 여부를 선언하지 않는다.

## 사용

지원되는 네이티브 CLI가 Kit 프로세스의 PATH에 있으면 버전을 입력할 필요가 없다.
실제 Kit와 대상 프로젝트를 지정하여 계획을 먼저 확인한다.

```sh
node bin/cli.js apply --kit /path/to/kit --project /path/to/project --client codex --surface cli --dry-run
node bin/cli.js apply --kit /path/to/kit --project /path/to/project --client codex --surface cli
```

Antigravity는 `--client antigravity`를 사용한다. 전역 Skill은 기존 전역 scope 흐름과
`~/.gemini/config/skills` 교정 경로를 사용한다. legacy 사용자 파일 자동 이동은 없다.
대체 CODEX_HOME, wrapper 실행 파일, 원격 클라이언트는 이 활성화 범위 밖이다.

## 검증

- `npm test`: 234/234, skip 없음. 아홉 자원 범위의 적용·갱신·제거·복원,
  실제 설치본을 관찰하는 두 CLI 진입점의 계획·적용·제거·복원 포함.
- GUI 서버 테스트: 22/22. 실제 바이너리 관찰을 사용하는 두 CLI HTTP 수명주기와
  동일 파일 저장소를 사용하는 desktop 요청 차단 포함. 로컬 포트 제한 때문에 샌드박스
  안의 초기 실행은 실패했고, 포트 바인딩이 가능한 승인된 실행에서 통과했다.
- ManifestDeploymentPanel: 15/15. 검증 CLI의 버전 자동 확인 안내와 desktop 분리 포함.
  GUI TypeScript 검사와 프런트엔드·데스크톱 backend bundle 빌드 통과.
- 순수 도메인 테스트는 플랫폼별 지원 범위와 원본 증거의 버전·hash·수명주기를 대조한다.
  공통 서비스 fixture는 CI에서 클라이언트 설치 없이 동작하도록 관찰만 주입한다.
  CLI/HTTP native 시험은 검증 설치본이 없는 환경에서는 명시적으로 skip한다.

실제 모델 사용 증거는 CA04-2/4/6의 기록을 재사용했다. 이번 테스트는 모델을 호출하거나
사용자 홈에 자원을 설치하지 않았다. 임시 프로젝트·시험 홈은 정리했다.
실제 Kit GUI 화면의 선택→미리보기→적용→제거·복원 검증이 다음 단계다.
HTTP 시험은 GUI 화면 검증이나 Codex/Antigravity 앱 실행 검증을 대신하지 않는다.
데몬 자원 배포 작업 계약과 운영 연동은 후속 단계다.
