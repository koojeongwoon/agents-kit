# PR07 S04-2 기본 CLI 실기 검증 (2026-11-06)

**기본 조합 16개 중 14개에 현재 빌드의 증거를 확보했다. PR07 전체는 아직 완료가
아니다.** Antigravity 전역/프로젝트 Agent는 자식 완료를 직접 확인할 수 없어 차단한다.
실행 파일 버전과 SHA-256, scope·자원·profile·전략이 같은 조합만 활성화했다.
[검증 계약](../contracts/basic-cli-verification-v1.md),
[현재 gate 행렬](basic-cli-matrix-current-20261106.json).

## 실제 확인 범위

| CLI / scope | 지침 | Skill copy | MCP basic stdio | Agent basic role |
|---|---|---|---|---|
| Codex 0.166.0-alpha.6 / 전역 | 기존 실기 증거 | 기존 실기 증거 | 이번 실기 통과 | 기존 직접 child 증거 |
| Codex 0.166.0-alpha.6 / 프로젝트 | 이번 실기 통과 | 이번 실기 통과 | 이번 실기 통과 | 이번 직접 child 증거 |
| Antigravity 1.5.1 / 전역 | 이번 실기 통과 | 기존 실기 증거 | 기존 분리 검증 통과 | 미관측·차단 |
| Antigravity 1.5.1 / 프로젝트 | 이번 실기 통과 | 이번 실기 통과 | 이번 실기 통과 | 미관측·차단 |

이번 성공 보고서는 모두 baseline/applied/updated/removed/rollback의 다섯 단계와
최종 원상 복원을 통과했다. 프로젝트는 임시 작업 경로, 전역은 기존 로그인과 설정을
이용했다. 로그인 자료를 복사하지 않았고 전역 permission을 수정하지 않았다.

- [Codex 프로젝트 지침·Skill·MCP](native-project-codex-basic-cli-20261106.json):
  설치된 Skill 보조 파일 읽기, 로컬 MCP 실제 반환, 지침 context 응답과 각각의 native
  목록을 분리했다. 기존 프로젝트 지침은 유지했다.
- [Codex 프로젝트 Agent](native-project-codex-agent-cli-20261106.json):
  app-server의 지정 역할 호출, 공개 child 완료 응답과 부모 응답을 직접 확인했다.
  applied/updated/rollback에서 총 세 번 child 완료를 관측했다.
- [Antigravity 프로젝트 지침·Skill·MCP](native-project-antigravity-basic-cli-20261106.json):
  `read_file`, 지정 `call_mcp_tool` 결과와 최종 marker를 확인했다. MCP 허용은 해당
  프로세스의 `--settings`에만 지정했다.
- [Antigravity 전역 지침](native-global-antigravity-instructions-cli-20261106.json):
  `~/.gemini/GEMINI.md`에 임시 관리 블록을 만들고 갱신·제거·복원한 뒤 원래 부재
  상태로 되돌렸다. 기존 내용이 있는 경우의 내용·mode 보존은 별도 회귀로 검사했다.
- [Codex 전역 기본 MCP](native-global-codex-basic-mcp-cli-20261106.json):
  중립 definition을 정식 adapter로 렌더링하고 새 서버 하나만 native import/adopt했다.
  Kit 사본 편집·반영·부재·rollback·전체 정리와 독립 목록/실제 응답을 확인했다.
  기존 node-repl과 다른 소유권을 자동 typed 인수하지 않았다.

## 기록된 실패에서 수정한 내용

[첫 Antigravity 프로젝트 시도](native-project-antigravity-basic-cli-attempt1-20261106.json)는
baseline 한 번 후 목록에서 프로젝트 서버가 누락돼 중단하고 복원했다. 반복 모델 호출
대신 [새 HOME의 전역/프로젝트 목록 대조군](antigravity-mcp-list-scope-control-20261106.json)을
검사했다. 두 cwd 모두 전역 서버만 나열하므로 이 빌드의 프로젝트 목록 범위는
`not-observed`다. 빌드 hash가 같은 복원된 대조군만 인정하며, 실제 tool 반환 검증을
생략하거나 목록 결과를 성공으로 바꾸지 않는다.

설치된 Skill 외의 파일 읽기·복합 shell·다른 도구를 금지하는 관측기를 추가했다.
resource subset, preflight 무쓰기/무호출, 첫 실패 중단, fixture 이름 충돌,
프로세스 한정 permission, 자식 미완료를 회귀로 검사했다. Codex의 basic/native-options
두 증거가 같은 테스트 HOME을 공유하던 fixture 충돌도 별도 profile 경로로 고쳤다.

실제 verifier의 최상위 요청은 성공 다섯 보고서 25회와 첫 실패 baseline 1회로 **26회**다.
Codex Agent의 child 호출 세 번은 별도로 관측했으며 모델 내부 turn 수로 환산하지 않는다.
통과한 실제 검증은 코드 hash가 달라졌다는 이유만으로 반복하지 않았다.

## 회귀·보존

루트 **465 passed**, HTTP **31 passed**, GUI **55 passed**, skipped 0이다.
typecheck와 desktop frontend/backend build, diff 검사가 통과했다. HTTP의 첫 실행은
샌드박스의 `listen EPERM`으로 실패했고, 임시 HOME의 같은 검사를 포트 사용이 가능한
환경에서 실행해 31개 모두 통과했다.

[체크포인트](basic-cli-preservation-20261106.json)에 보고서·검사 log hash와 원장 요약을
남겼다. 실제 원장은 schema 6, 3개 물리 파일/4개 owner와 133개 이력이며 active hash가
일치하고 lock/journal이 없다. 기존 설정·인증·외부 링크 27개 경로의 내용과 mode는
그대로다. `~/.codex/config.toml`의 inode/mtime만 원자적 복원 때문에 변경됐다.
ego-browser 링크 세 개와 링크 대상 내용·identity는 유지됐다.

## 남은 범위

Antigravity Agent 두 scope의 직접 child 완료 증거가 PR07의 미완료 항목이다.
snapshot/discovery 전략은 copy 증거로 승격하지 않으며 HTTP·인증과 desktop/IDE는
PR11의 독립 프로필이다. PR08의 과거 경로 이관, PR09 통합 조회, PR10 교차 scope
의존성과 잠금도 전체 계획에 남아 있다.
