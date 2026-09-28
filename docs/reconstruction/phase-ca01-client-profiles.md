# CA01: Codex·Antigravity 대상 계약과 지원 판정

2026-09-27. 범위: 대상 계약·공통 판정·설치 흔적/인벤토리·CLI/GUI 연결.
상태: **해당 구현과 자동 검증 완료. 실제 제품 실기 및 지원 활성화는 미완료.**

## 변경

- ClientDefinition schema 2: CLI/desktop/IDE, 명시적 capability 선택과 경로 override,
  논리 configStore, 기본 CLI alias, 문서와 실기 증거 분리.
- Codex standalone Agent TOML 및 Antigravity 전역 MCP 경로 교정.
  Antigravity CLI와 앱/IDE의 전역 Skill 경로 분리.
- Antigravity 앱 MCP는 UI-only, IDE Agent는 unverified로 유지.
- 정확한 버전·surface·OS·architecture·capability 조합이 없으면 자동 적용 차단.
  프리릴리스/다른 화면/다른 OS로 증거를 전용하지 않음.
- CLI `--surface`, `--client-version`, GUI 실행 화면 선택과 plan/doctor의 동일 판정.
  API에서 받은 OS나 runtimeEvidence는 적용하지 않음.
- 설치 디렉터리/명령과 실제 지원을 분리. 앱 설치 여부는 CLI 존재로 추정하지 않음.
- 구 Codex Agent 섹션과 Antigravity MCP 파일은 자동 이동/삭제하지 않음.
  실제 사용자 클라이언트 설정을 수정하지 않음.

계약과 호환성 변경: [ClientDefinition v2](../contracts/client-definition-v2.md).
공식 경로 근거: [클라이언트별 계획](../product/client-resource-management-plan.md).

## 검증

| 검사 | 결과 |
|---|---|
| `npm test` | 113/113 통과 |
| `npm --prefix gui run test:server` | 13/13 통과 |
| `npm --prefix gui run test -- src/components/deploy/ManifestDeploymentPanel.test.tsx src/components/home/ControlCenterHome.test.tsx src/api/deploy.test.ts` | 10/10 통과 |
| `npm --prefix gui run typecheck` | 통과 |
| `npm --prefix gui run build:desktop` | Vite frontend + Node backend bundle 통과 |
| `git diff --check` | 통과 |

HTTP 검사는 최초 sandbox 실행에서 `listen EPERM`으로 실패했고, 허용된 환경의
재실행에서 통과했다. build:desktop은 Tauri 네이티브 앱 실행/패키징 검증이 아니다.

핵심 시험은 미검증 프로필의 실제 apply 거부/파일 미생성, CLI와 doctor의 일치,
GUI 선택 변경 시 계획 폐기, schema 1 호환 apply/rollback, schema 2 HTTP
apply/history/rollback이다. HTTP 성공 경로는 **합성 버전 `0.0.1-test`**의 임시 정의를
사용하며 클라이언트 실행 증거가 아니다. 제품 YAML의 runtimeEvidence는 모두 비어 있다.

## 다음 단계와 제한

- CA02: 동일 논리 MCP 원본에서 Codex TOML·Antigravity JSON과 diff 생성,
  이어 지침·Skill·Agent 공통 변환·참조/권한 검증.
- CA03: 기존 원장/소유 설정의 명시적 이관, 공유 물리 경로의 소비자·제거·복구,
  적용 직전 환경/버전 관측 재검사.
- CA04/05: 신뢰한 실제 버전/채널 관측과 제품별 로딩/사용 실기. 현재 버전 입력은
  reported이고 설치 탐지는 실행 파일/디렉터리 흔적뿐이다. 환경별 CODEX_HOME,
  프로젝트 신뢰, 앱 실행 환경 확인을 마친 뒤 관련 실기 프로필을 등록해야 한다.
- CA06: 데몬 서명 배포 계약과 중앙 채널. 기존 revoke-only 작업 계약을 바꾸지 않음.

기존 Codex·Antigravity Manifest 자동 적용은 실기 증거가 없어 현재 차단된다.
계획·진단과 기존 기록/롤백은 유지한다. 이를 사용 가능한 전체 자원 배포 또는
데몬 운영 배포 완료로 표시하지 않는다. Claude는 계속 후속 P1이다.
