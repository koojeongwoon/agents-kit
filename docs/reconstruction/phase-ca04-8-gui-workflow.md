# CA04-8: 실제 Kit GUI 배포 흐름 검증

2026-09-27, macOS arm64. 별도 Chrome 프로필의 실제 화면에서 버튼과 입력란을
조작해 배포 흐름을 확인했다. 설치된 Codex CLI 0.145.0 / Antigravity CLI 1.2.12의
실행 파일 증거를 그대로 사용하는 제품 서버와 빌드된 GUI를 실행했다.

## 결과

| 대상 | GUI에서 확인한 범위 | 결과 |
| --- | --- | --- |
| Codex 프로젝트 | 지침·Skill·stdio MCP·기본 Agent | 계획·변환 미리보기·승인 적용·제거·제거 rollback 통과 |
| Antigravity 프로젝트 | 지침·Skill·stdio MCP | 같은 흐름 통과; Codex와 공유하는 지침·Skill 유지 |
| 두 CLI 전역 | Skill과 부속 파일 | 격리한 시험 홈에서 각각 적용·제거·rollback 통과 |
| Antigravity 앱 | 정확한 1.2.12 버전을 입력한 요청 | runtime 미검증/UI-only 표시, 적용 승인 버튼 비활성 |
| 자원 목록 | Skill 목록과 배포 검토 진입 | 등록 자원과 발견 자원 표시, 공통 배포 센터로 연결 |

프로젝트 배포 계획 승인 전에는 사용자 지침 파일 하나만 있었다. 네 번의 제거
rollback 후 전체 대상 파일 해시가 각 적용 직후와 일치했다. Antigravity 제거 시
Codex 소비자가 남은 공유 지침·Skill은 같은 해시로 유지됐다. 마지막에는 GUI에서
시험 자원을 모두 제거했고, 프로젝트·전역 관리 원장 항목은 각각 0개다.

사용자 지침 **내용**은 보존됐다. 지침 블록 제거 후 기존 merger가 삽입한 구분용
줄바꿈 2개가 남으므로, 제거 후 전체 파일이 최초 파일과 바이트 단위로 같다는
의미는 아니다. 반면 제거 rollback은 적용 상태의 파일 바이트를 정확히 복원했다.
MCP 항목 제거 후에는 빈 설정 컨테이너 파일이 남는 기존 동작을 유지했다.

## 발견한 화면 표시 수정

홈은 schema 2 클라이언트를 항상 `실기 미확인`으로 표시하고 있었다. 검증된 CLI
기록이 있으면 `CLI 일부 검증됨`으로 표시하고, 현재 설치본 확인은 배포 계획에서
수행한다는 안내를 추가했다. CLI 기록을 앱 검증이나 현재 설치 확인으로 표시하지 않는다.

자원 목록은 문서의 `stable` 상태만 보고 `지원`을 표시했다. schema 2에서는
`파일 계약`으로 구분하고 실제 적용 가능 여부는 실행 화면·설치본·자원 옵션을
배포 계획에서 판단한다고 안내한다. schema 1 표시 동작은 유지했다.
두 수정은 다시 빌드한 화면에서 확인했다.

## 실행 범위와 재현

내장 브라우저 도구가 `failed to write kernel assets`로 초기화되지 않아 설치된
Playwright와 Chrome을 사용했다. 기존 개인 브라우저 세션을 연결하지 않고 별도
임시 프로필을 실행했다. 프런트엔드는 `npm --prefix gui run build:desktop` 산출물,
백엔드는 `createControlPlaneApp(createAppContext(...))`의 실제 application service다.
서버는 127.0.0.1:3000에만 바인딩하고 static GUI와 API를 같은 origin에서 제공했다.

임시 Kit·프로젝트·홈을 각각 지정했으며, 지원 프로필을 수정하거나 합성 runtime
증거를 주입하지 않았다. UI 변경 요청은 전부 화면의 버튼으로 수행했다. 셸에서는
시험 입력 생성과 파일·원장 대조만 수행했다. 모델을 호출하거나 실제 사용자 홈의
클라이언트 설정을 변경하지 않았다. 시험 서버와 Chrome은 종료했고 임시 데이터는 정리했다.

[증거 JSON](ca04-8-gui-workflow-evidence.json)의 `fixtureInputs`에는 두 scope의 Manifest,
지침, Skill 및 부속 파일 원문이 있다. 재현 시 새 임시 kitRoot 아래 동일 상대 경로에
기록하고, 별도 homeDir/projectPath를 만든다. 프로젝트 AGENTS.md 초기 내용은
`# User-owned instructions\nPreserve this section.\n`이다. Manifest의 실행 파일 binding과
marker 서버 경로는 로컬 환경에 맞춘다. 서버 context에 세 경로와 저장소의 `clients`
디렉터리를 주입한 후 다음 순서로 화면을 조작한다.

1. 프로젝트 경로 입력 → Codex CLI 선택 → 계획 → 변환 미리보기 → 적용 승인.
2. `gui-rules, gui-review, gui-marker, gui-agent` 제거 계획 → 제거 승인 → 최신 제거 이력 rollback.
3. Antigravity CLI 선택 → 계획·적용 → `gui-rules, gui-review, gui-marker` 제거·rollback.
4. Antigravity 앱과 정확한 버전 선택 → 차단 확인. CLI로 되돌리고 버전 입력을 비운다.
5. 내 PC 전역 선택 → 두 CLI 각각 Skill 적용 → `gui-review` 제거 → rollback.
6. 두 scope에서 모든 시험 자원을 제거하고 파일·원장을 대조한다.

초기 시험 Manifest의 잘못된 `targets.assets` 필드는 정상적으로 400으로 거절됐다.
시험 입력을 정식 `assetIds`로 고친 뒤 진행했다. 제품 검증 경로를 우회하지 않았다.

## 증거와 검사

- [Codex 프로젝트 계획](ca04-8-screenshots/codex-project-plan.png)
- [미검증 Antigravity 앱 차단](ca04-8-screenshots/antigravity-app-blocked.png)
- [검증 범위를 구분한 홈](ca04-8-screenshots/home-reviewed.png)
- [Skill 목록과 파일 계약 안내](ca04-8-screenshots/skill-library.png)
- 구성요소 테스트 23개 통과: Home 5, ResourceWorkspace 3, DeploymentPanel 15.
- TypeScript 검사, 프런트엔드·desktop backend bundle 빌드, diff 공백 검사 통과.
- 브라우저 `pageerror` 0개. 제품 fixture의 네 가지 수명주기 복원 해시 대조 통과.

이 단계는 **Kit의 브라우저 GUI 흐름** 검증이다. 네이티브 Tauri 창, Codex 앱,
Antigravity 앱/IDE에서 실제 모델이 자원을 사용하는 검증은 별도다. 데몬의 자원
배포 작업 계약과 실제 수령·적용·결과 보고는 아직 구현 단계로 남아 있다.
