# 후속 P1: 공통 AGENTS.md와 Claude Code 호환 배포 계획

작성·공식 문서 확인: 2026-09-27. 상태: **후속 검토 계획, 기능 구현 전**.

상위 계획: [클라이언트별 자원 관리·중앙 배포](client-resource-management-plan.md). **먼저 구현할 계획은 [Codex·Antigravity 우선 구현 계획](codex-antigravity-implementation-plan.md)이다.** 이 문서는 그 첫 묶음 완료 뒤 공통 기반을 재사용할 Claude 지침 호환 후보를 보존한다. 아래 I01~I06은 P0, LM4-0~4 및 LM5의 선행 조건이나 합격 기준이 아니다.

## 1. 결정

공통 프로젝트 지침의 편집 원본은 Kit Manifest가 참조하는 `AGENTS.md`로 유지한다. 대상 프로젝트에 배포된 `AGENTS.md`를 지원 클라이언트가 읽는다. Claude Code는 유효한 직접 로딩을 우선하고, 호환 경로가 필요하면 프로젝트 `CLAUDE.md`에 `@AGENTS.md`를 넣는다. 두 파일에 공통 지침 본문을 각각 복제하지 않는다.

Manifest가 자원·범위·대상의 유일한 원하는 상태다. 디스크에 AGENTS.md가 있다는 이유로 새 자산을 자동 등록하지 않는다. 이미 프로젝트가 관리하는 AGENTS.md를 사용하려면 명시적 등록·소유권/읽기 전용 참조 모드를 계획에 표현한다. 사용자 파일 전체를 Kit 소유로 자동 전환하지 않는다.

이 결정은 **프로젝트 공통 지침**에 우선 적용한다. 개인 전역 지침은 각 클라이언트의 공식 전역 경로로 배포한다. 프로젝트 상대 import를 전역 CLAUDE.md에 그대로 쓰거나 하나의 프로젝트 지침을 모든 프로젝트에 노출하지 않는다.

## 2. 공식 근거와 설계의 구분

Claude Code 공식 문서에서 확인한 사실:

- AGENTS.md 직접 로딩은 v2.1.277 이상이며, v2.1.281 이전 일부 환경에는 제한이 있다. 플러그인·설정·세션 조건도 영향을 준다.
- 기본 모드에서는 작업 디렉터리 및 상위의 CLAUDE.md/CLAUDE.local.md 유무에 따라 읽는 지침이 달라진다. `.claude/CLAUDE.md`도 확인 대상이다.
- CLAUDE.md에서 `@AGENTS.md`로 가져오는 방식이 공식 호환 경로다. 상대 경로는 import를 담은 파일 기준이다.
- 직접 읽은 AGENTS.md의 목록 표시는 v2.1.280 이전에 제한된다.

근거: [AGENTS.md](https://code.claude.com/docs/en/memory#agentsmd), [공유 파일 가져오기](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools), [로딩 진단](https://code.claude.com/docs/en/memory#my-agentsmd-isnt-loading).

아래의 분기·오류 이름·단계는 **Kit에서 구현할 설계**다. 위 버전 번호를 모든 설치에서 자동 지원을 보장하는 범위로 사용하지 않는다. 실제 시험을 통과한 버전·surface·설정 조합을 기록한다.

## 3. 선택 규칙

분기는 아래 순서로 평가한다. 상위 정책 또는 필수 조건이 불명인 경우 하위 호환 경로로 무조건 내려가지 않는다.

| 조건 | Kit의 계획 | 완료 표시 |
|---|---|---|
| 조직 정책이 프로젝트 지침을 허용하지 않음, managed-only 등 | 변경을 통한 우회 없이 차단 이유 표시 | 정책으로 비활성 |
| 실효 설정·실행 호스트·경로 경계를 확정할 수 없음 | 필요한 관측과 수동 확인 항목 제시 | 지원 미확인 |
| AGENTS.md를 직접 읽는 검증된 버전/환경/설정이며 다른 파일에 가려지지 않음 | AGENTS.md만 배포 | 파일 적용 후 실제 로딩 확인 필요 |
| 기존의 유효한 import가 같은 AGENTS.md를 이미 참조함 | import 재사용, 추가 삽입 없음 | 기존 호환 경로 사용 |
| 구버전·직접 로딩 비활성·기존 CLAUDE 계열 파일로 인한 가림, 프로젝트 import는 허용되고 검증됨 | AGENTS.md + 프로젝트 CLAUDE.md의 Kit 소유 import 블록 | 호환 경로로 적용 |
| 사용자 설정이 이미 두 파일을 읽도록 구성되고 직접 로딩 조건 충족 | 설정 유지, 불필요한 import 생성 안 함 | 직접 로딩 검증 |
| 외부 수정, 중복 정의, 순환 import, 부정확한 대상, 필요한 외부 import 승인 없음 | 충돌/사용자 후속 작업으로 분리 | 적용/로딩 완료 아님 |

버전 불명은 구버전으로 간주하지 않는다. 버전이 직접 로딩을 지원해도 플러그인 상태·세션 옵션·상위 지침·제외 설정을 모르면 성공으로 판정하지 않는다. `claude-md-and-agents-md`로 사용자 전역 설정을 자동 변경하는 방식은 기본 경로로 쓰지 않는다.

기존 사용자 정책이 공통 지침 사용을 허용하는 상황에서만 호환 import를 제안한다. v2.1.277~280의 제한된 조합은 검증된 호환 경로 또는 재시작/업데이트 안내로 처리한다. 프리릴리스는 단순 숫자 비교로 정식 릴리스와 동등하게 판정하지 않는다.

## 4. 출력과 소유권

기본 프로젝트 산출물 예:

```text
Kit Manifest
  └─ instructions 자산 → instructions/AGENTS.md (편집 원본)
       └─ 대상 프로젝트 AGENTS.md (Kit 소유 블록 또는 명시적으로 등록한 참조)
            ├─ Codex/Antigravity 등: 각 공식 로딩 규칙으로 읽기
            └─ Claude Code: 직접 읽기 또는 CLAUDE.md에서 import
```

새 프로젝트에 호환 파일을 만들 때 내용은 다음과 같다. 실제 적용 시 기존 Markdown 소유권 마커를 사용한다.

```markdown
@AGENTS.md
```

구체적인 변경 규칙:

1. 기존 CLAUDE.md가 있으면 본문을 보존하고 계획에서 보여준 import 블록만 추가한다. 공통 지침이 Claude 전용 내용보다 먼저 읽히도록 블록 위치를 명시한다. 현재 병합기의 기본 append 동작을 그대로 사용해 원하는 순서를 뒤집지 않는다.
2. 기본 생성 위치는 대상 프로젝트 루트의 CLAUDE.md다. 이미 `.claude/CLAUDE.md`에 정상 import가 있으면 재사용한다. 그 파일에 import를 생성하는 선택을 지원할 때 경로는 `@../AGENTS.md`처럼 실제 위치 기준으로 계산한다.
3. 현재 작업 디렉터리·프로젝트 루트·허용된 상위 경로의 지침 존재와 실효 설정을 읽기 전용으로 조사한다. 상위 사용자 파일은 수정하지 않는다. 접근할 수 없는 상위 경로는 부재가 아닌 미확인이다.
4. Markdown의 인라인 코드·코드 블록·주석 안 문자열을 활성 import로 오인하지 않는다. 경로 정규화·중첩·순환·길이/깊이 제한을 검증하고 불확실한 구문은 미확인으로 반환한다.
5. 원본 AGENTS.md 안의 클라이언트 전용 import·조건·지침은 공통 의미 검증 대상이다. Claude가 해석하는 `@path`를 다른 클라이언트가 같은 의미로 해석한다고 가정하지 않는다. 단순 본문부터 지원하고 확장은 어댑터 또는 클라이언트별 지침 자산으로 분리한다.
6. 기존 symlink는 링크 교체 없이 읽기·인가 경계를 확인한다. 첫 구현은 일반 파일과 import를 생성하며, 새 symlink 배포를 기본값으로 삼지 않는다.
7. 같은 AGENTS.md의 소비자 목록을 기록한다. Claude만 제거하면 Kit 소유 호환 블록만 제거하며 다른 클라이언트가 쓰는 AGENTS.md는 남긴다. 사용자가 작성한 import는 자동 삭제하지 않는다.
8. Kit 소유 호환 파일을 제거할 때도 다른 문서의 참조와 소비자를 확인한다. 사용자 본문·연결이 남으면 파일을 유지한다. 버전 업그레이드만으로 기존 정상 import를 자동 삭제하지 않는다.
9. 예전에 Kit이 CLAUDE.md에 복제한 본문은 원장·블록·내용 해시가 일치할 때만 import로 이관한다. 기존 본문이 외부 수정됐으면 충돌로 표시하고 임의 합치기·삭제를 하지 않는다.
10. AGENTS.md 갱신과 import 이관은 같은 파일 트랜잭션으로 처리한다. apply 직전에 지침 파일·설정·프로필의 관측을 다시 대조하고 변경되면 재계획한다.

공통 지침과 커스텀 Agent 정의는 계속 별도 자원이다. 이 작업에서 `.claude/agents/*.md`를 AGENTS.md로 합치거나 Claude의 Agent 모델을 변경하지 않는다.

## 5. 구현 작업 순서

Claude Code의 지침·MCP·Skill·커스텀 Agent 모두 후속 P1이다. 아래 I01~I06은 Codex·Antigravity에서 완성한 계약·변환·소유권·검증 서비스를 재사용하는 추가 작업이다. 표의 LM4 표기는 재사용할 기반의 출처이며 해당 단계에 Claude 구현을 끼워 넣는 의미가 아니다.

| 작업 | 구현 대상·범위 | 선행 / 부담 | 완료 기준 |
|---|---|---|---|
| I01. 계약·fixture | ClientDefinition에 대체 지침 capability, 버전/설정 조건, `direct`/`import`/`manual`/`blocked` 선택 결과 정의. 새 필드는 버전형 계약으로 도입 | LM4-0A / 중 | 조건표·오류 코드·기존 v1 호환 fixture 작성. 순서만 바꿔 결과가 달라지지 않음 |
| I02. 읽기 전용 관측·선택 | 설치/버전 어댑터, 지침 존재·import·소유권·실효 설정 수집. 순수 instruction resolver 추가 | I01 / 중 | 아래 분기 시험 통과. 전체 개인 설정/토큰을 응답·로그로 내보내지 않음 |
| I03. 계획·렌더링 | 한 자산에서 AGENTS.md와 호환 블록을 생성하는 다중 산출물 계획. 선택 이유·사용자 본문 diff·다른 소비자 영향 표시 | I02, LM4-0B / 중 | CLI/GUI가 같은 계획을 사용하고 기존 정상 import 재사용 |
| I04. 적용·이관·제거 | Markdown 블록의 위치 지정, 공유 소유권, 원장 이관, 파일과 설정 관측 재검사, 원자적 복구 | I03, LM4-0C / 중~높음 | 멱등 적용·외부 수정 거부·중간 실패 복원·Claude만 제거 시험 |
| I05. 진단·실기 | 로딩 상태와 파일 상태 분리. 지원 버전에서 `/memory`·`/context`·시작 로그와 고유 시험 표식 확인 | I04, LM4-1A / 중 | 직접/import 각각 실기 통과. 목록 증거가 없는 구버전은 검증 한계를 표시 |
| I06. 데몬 배포 계약 연결 | 선택된 mode·원본/산출물 hash·설정 관측 digest·소유권 revision을 승인 계획에 결합 | I05, LM4-2~4 / 중 | 다른 단말은 자체 조건으로 계획. 적용 전 mode가 바뀌면 기존 승인을 재사용하지 않음 |

변경 지점:

- `clients/claude-code.yaml`: AGENTS 직접 경로와 호환 경로를 조건 있는 대안으로 정의. 지원 근거 URL/날짜 갱신.
- `lib/domain/client-definition.js`: 같은 kind/scope의 첫 항목만 선택하는 방식에서 명시적 대안 선택으로 확장. 기존 단일 capability 동작 유지.
- 신규 순수 지침 resolver와 읽기 전용 관측 어댑터: 실제 파일 I/O와 클라이언트별 분기 분리. 필요 정보가 없을 때 추측 대신 안정적인 사유 코드 반환.
- `lib/application/plan-client-deployment.js`, `manifest-deployment-service.js`: 한 자산의 다중 산출물, 공유 소비자, 선택 이유·검증 전제 처리.
- `lib/domain/structured-merge.js`, prepare/apply/rollback 서비스: 기존 소유권 블록 재사용, 원하는 위치·제거·충돌·롤백 추가.
- `client-diagnostics-service.js`, CLI 및 `gui/server/routes/deploy.js`, `ManifestDeploymentPanel`: 같은 application service 결과를 표시.

예정 오류/상태: `INSTRUCTION_CONTEXT_UNKNOWN`, `INSTRUCTION_POLICY_BLOCKED`, `INSTRUCTION_IMPORT_CONFLICT`, `INSTRUCTION_IMPORT_CYCLE`, `INSTRUCTION_PLAN_STALE`, `INSTRUCTION_RELOAD_REQUIRED`. 구현 전 기존 오류 규약과 이름을 대조한다.

## 6. 필수 시험

| 경우 | 기대 결과 |
|---|---|
| 직접 지원 프로필 + 가리는 파일 없음 | AGENTS.md만 계획 |
| 가리는 루트·상위·`.claude/` 지침, CLAUDE.local.md 각각 존재 | 허용된 호환 import 또는 명확한 차단/미확인 |
| 기존 유효 import / 두 파일 읽기 설정 | 불필요한 import·본문 중복 없음 |
| 구버전 / 제한된 2.1.277~280 환경 / 플러그인 비활성 | 검증된 import 경로 또는 정확한 후속 작업 |
| managed-only / 정책 거부 / 설정 불명 / 버전 불명 | 성공·직접 지원으로 오표시하지 않음 |
| 코드 블록 속 `@AGENTS.md`, 다른 대상 import, 순환, 범위 밖 경로 | 오탐 방지, 충돌·인가 처리 |
| 사용자 CLAUDE 본문과 기존 Kit 복제 블록 | 사용자 본문 보존, 소유 블록만 이관, 공통 지침 읽기 순서 검증 |
| 사용자 symlink·read-only 파일·기존 AGENTS.md | 자동 소유권 인수·링크 교체 없음 |
| 원본 또는 실효 설정을 plan 후 변경 | stale 거부 및 재계획 |
| 반복 적용·제거·롤백, 다른 클라이언트도 같은 파일 소비 | 중복·내용 손실·참조 끊김 없음 |
| 두 파일 중 두 번째 쓰기/원장 저장 실패, 프로세스 중단 | 기존 파일과 소유권 복구, 결과 불명은 재대조 |
| 직접/import 실기와 클라이언트 재시작 | 고유 표식과 실제 파일 목록/로그를 함께 확인 |

자동 회귀는 `client-definitions`, `structured-merge`, `merge-deployment`, `manifest-deployment-service`, `manifest-cli`, GUI deploy 경로 시험에 추가한다. 관측·선택 순수 함수에는 조건표 기반 테스트를 추가한다. 실기 시험은 격리 홈/프로젝트에서 진행하며 사용자의 현재 AGENTS.md·CLAUDE.md·전역 설정을 시험용으로 변경하지 않는다.

## 7. 완료 정의

- [ ] 공통 원본 한 번 수정으로 선택한 클라이언트의 다음 실행에 일관되게 반영된다.
- [ ] Claude Code 직접 읽기와 import 경로를 각각 실제 지원 프로필에서 입증했다.
- [ ] 기존 사용자 내용·설정·상위 지침과 공유 소비자 관계를 보존한다.
- [ ] 파일 적용, 로딩 필요, 로딩 확인, 정책 거부, 미확인을 구분한다.
- [ ] 갱신·이관·제거·롤백·부분 실패 시험을 통과한다.
- [ ] 데몬 연결 전에도 개인 Kit의 CLI/GUI로 동일 기능이 동작한다.

이 후속 작업을 착수할 때 I01의 지침 대안 선택 계약과 fixture부터 검토한다. **현재 첫 구현은 Codex·Antigravity 계획의 CA01(LM4-0A)**이다. 이 문서 작성으로 실제 클라이언트 설정이나 구현 코드를 변경하지 않았다.
