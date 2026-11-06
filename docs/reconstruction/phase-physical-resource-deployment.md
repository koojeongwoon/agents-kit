# PR07 S04-1: 같은 Agent/MCP 저장소 합산 (2026-11-06)

**같은 저장소 합산 구현·격리 검증 완료. PR07 전체는 진행 중이다.** S04-2의
현재 빌드 기본 CLI native 행렬의 후속 결과는 [S04-2 실기 기록](phase-basic-cli-verification.md)에
있으며 14/16 증거를 확보했다. 아래 5/16 표는 이 S04-1 시점의 사전 상태다. 합성 fixture가 통과했다는 이유로
desktop/IDE나 새 버전의 지원을 추가하지 않았다.
[저장소 소유권 계약](../contracts/physical-resource-deployment-v1.md).

## 변경

- 여러 대상의 typed Agent/MCP 기여를 각각 capability 검사한 뒤 물리 경로·store ID·
  scope·format·selector·산출물을 대조한다. 같은 MCP selector의 다른 값/의존성,
  서로 다른 자원이나 store, 혼합 형식은 충돌한다. 서로 다른 MCP selector는 한 파일에
  합치고 같은 Agent 파일은 한 번만 쓴다. JSON field 순서만 다른 경우는 같은 값으로
  취급하며 요청 순서와 무관한 계획을 만든다.
- `physicalVersion: 1`, typed resource identity v2와 state v7을 추가했다. 자원별로
  적용한 client/surface ID 목록과 배포 당시의 logical dependency ID를 보존한다.
  구 typed v1 소유 증명이 완전하고 원래 client가 참여하면 파일 내용이 같은 등록은
  metadata-only로 전환한다. legacy 식별자 누락·미관리 동일 파일은 자동 인수하지 않는다.
- Agent/MCP는 저장소의 설정 자체를 갱신/제거한다. 한 화면만 해제한 것처럼 처리하지
  않으며 계획·HTTP·GUI·저장 계획에 영향을 받는 화면을 표시한다. 저장소를 공유한다는
  이유로 미검증 화면의 gate를 생략하지 않는다. 이전 reader는 state v7/saved body v3를
  거절하고 rollback은 기존 소유권을 복원해도 새 schema를 내리지 않는다.
- 물리 자원 제거 시 모든 기록된 reader의 남은 의존성을 검사한다. native 설치도
  같은 저장소 provider를 인식하되 실제 설치 hash를 계속 확인한다. native source
  모드나 구 copy/merge helper로 새 소유권의 reader 목록을 버릴 수 없도록 막았다.
- 기존 lock·backup·원자적 파일 쓰기·mode-aware journal·저장 계획·rollback을
  재사용한다. snapshot과 섞인 계획도 PR06 tree transaction으로 한 번에 복원한다.
  적용 직전과 commit 전에 Manifest/정의/binary/state 전제를 확인한다.
- 새 물리 계획은 배포 metadata와 Kit 원본을 클라이언트 대상으로 쓰지 못한다.
  기존 설정의 일반 쓰기도 현재 mode를 유지하고, 삭제한 파일의 rollback은 backup의
  mode로 복원한다. 이 변경은 네 자원 행렬에서 발견한 실제 `0640 → 0644` 실패를 고친다.

## TDD와 검증

처음에는 두 화면이 같은 설정 파일을 고르면 `DUPLICATE_DEPLOYMENT_TARGET`으로
차단되는 실패를 확인했다. 합산 후에도 selector/의존성이 다른 기여, JSON 순서 차이,
다른 logical asset의 selector 인수, coercible ID, 잘못된 state 버전, 원장·정의 경합,
metadata 자기 대상 지정과 권한 보존 실패를 회귀 항목으로 남겼다.

- `test/physical-resource.test.js`: 순수 합산·동등성·충돌·식별자 검증.
- `test/physical-resource-deployment.test.js`: 두 scope의 적용·동일 계획 재실행·
  단일 reader 갱신·전체 저장소 제거·구 소유권 전환·saved v3·mixed snapshot·rollback·
  외부 변경·state 호환성과 실제 SIGKILL 전후 복구.
- `test/basic-cli-matrix.test.js`: 두 CLI adapter × 전역/프로젝트 × 지침/Skill/Agent/
  MCP stdio의 적용→갱신→제거→복원. 기존 지침·권한·외부 링크를 보존하며 논리 도구
  공급자와 전이 의존성을 함께 검사한다. **합성 runtime profile이며 native 사용 증거가 아니다.**
- native 설치/typed 제거/기존 일반 파일/PR06 snapshot 회귀와 HTTP·GUI에서 같은
  application service, review 후 적용 및 저장 계획의 영향 표시를 확인한다.

최종 검증은 루트 **445 passed**, HTTP **31 passed**, GUI **55 passed**, skipped 0이며
GUI typecheck·desktop frontend/backend build·diff 검사가 통과했다.
[검증·보존 체크포인트](physical-resource-preservation-20261106.json)에 검사 log hash와
실제 원장 요약을 남겼다. 기존 실제 설정은 이 단계에서 쓰지 않았으며 PR06 보존 기준의
27개 경로와 외부 링크가 그대로임을 읽기 전용으로 재확인했다. 실제 전역 원장은 계속
schema 6, 기존 3개 물리 파일/4개 owner, 119개 이력이며 lock/journal이 없다.
새 state v7 전환은 격리 fixture에서만 수행했다.

## 남은 PR07 native 범위

[현재 기본 CLI profile 사전 행렬](basic-cli-matrix-preflight-20261106.json)은
실제 실행 파일의 SHA-256과 `--version`만 새 임시 home에서 확인했다. 모델 호출·자원
적용·로그인·사용자 설정 변경은 하지 않았다. 이 표의 eligible은 현재 capability gate의
결과이고 새 native 사용 성공을 뜻하지 않는다.

| 현재 실행 파일 | 전역 typed 기본 gate | 프로젝트 typed 기본 gate |
|---|---|---|
| Codex 0.166.0-alpha.6 | 지침·Skill·Agent 허용; 일반 typed MCP 차단 | 네 자원 모두 차단 |
| Antigravity 1.5.1 | Skill·MCP stdio 허용; 지침·Agent 차단 | 네 자원 모두 차단 |

16개 기본 조합 중 5개가 eligible, 11개가 blocked다. Codex MCP의 현재 native stdio
옵션 증거는 일반 typed stdio의 증거가 아니므로 확장하지 않았다. 과거 버전의 프로젝트
증거도 현재 빌드로 재사용하지 않는다. S04-2의 다음 작업은 부족한 기본 조합에 대해
배포/복원, native 인식, 모델 응답을 분리한 필요한 실기만 수행하는 것이다.
기존 Antigravity Agent child 완료 미관측과 snapshot 링크 읽기 미관측은 유지한다.
