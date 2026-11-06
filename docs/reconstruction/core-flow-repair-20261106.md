# 핵심 흐름 수리 — 추가 확장 중지

2026-11-06. 현재 범위는 기록된 실패 7개 교정과 기존 지원 경로의
편입 → 사본 편집 → 업데이트 병합 → 설치 적용·복원이다.
새 client/format/version 지원, Manifest-v3 native 설치 조정, 추가 GUI·discovery 전략은 확장하지 않았다.

## 실패 분류와 수정

| 기존 실패 | 분류 | 확인 및 수정 |
|---|---|---|
| Skill 전역·프로젝트, companion stale, scope/external 보호: 4건 | 테스트 준비 | 종류만으로 첫 후보를 골라 끊긴 ego fixture 링크를 선택했다. 의도한 capability 경로의 후보를 정확히 선택한다. 안전 검사는 유지한다. |
| 프로젝트 지침: 1건 | 테스트 준비 | fixture가 `.codex/AGENTS.md`를 만들었다. client definition에서 프로젝트의 `AGENTS.md` 경로를 읽는다. |
| 전역·프로젝트 MCP: 2건 | 테스트 기대 | 선택 server 밖의 주석은 가져올 대상이 아니다. 선택한 server의 command와 Kit args를 독립적으로 바꿔 실제 병합을 검증한다. |

이 7건은 테스트 변경만으로 기존 10개가 모두 통과했다. 이후 안전 경계 2개를 더해
source 시험은 12개가 통과한다. 제품의 이전 v3 원본 차단과 import의 강제 v2 변환은
별개의 제품 문제로 교정했다. Manifest 버전·qualified 참조·대상·named project를 유지하고
기존 scoped source guard를 재사용한다. 검토 뒤 companion 변경, commit 중 변경 및 참조된
전역 native source의 해제를 차단한다. 설치 원장과 client 파일은 source mutation에서 쓰지 않는다.

## 핵심 흐름 검증

`test/native-installation-core-flow.test.js`는 기존 native 설치 관리 경로(Manifest 1→2)의
전역·프로젝트 × Skill·지침·Agent·MCP 8개 조합에서 편입/사본 편집/원본 업데이트/B·K·U 병합/
metadata-only adoption/적용/rollback/소유권 해제를 연속 실행한다. 합친 수정본이 반영되고,
rollback은 적용 직전 원본과 권한으로 돌아가며 다른 MCP 항목과 ego 링크 identity를 유지한다.
실행 가능한 command를 호출하는 시험은 아니며 synthetic capability fixture를 사용한다.

HTTP 시험은 설치 변경→Kit 병합→적용 뒤 rollback까지 연장해 실제 application 경로와
mutation session을 검증했다. 새 시험 두 파일은 기본 `npm test`에 포함했다.

- root: **849 passed / 0 failed / 2 skipped** (총 851).
- HTTP: **52 passed / 0 failed / 1 skipped** (총 53).
- backend bundle build와 `git diff --check`: 통과.
- frontend는 변경하지 않아 GUI 시험·전체 frontend build를 반복하지 않았다.

## 실제 클라이언트 검증 제한

이 절은 수리 직후 기록이다. 사용자가 현재 실행 파일 검증을 승인한 후의 실기 3개와
실제 적용·복원 결과는 [후속 검증](current-codex-core-acceptance-20261106.md)을 따른다.

현재 Codex CLI는 `0.167.0-alpha.3.2`, SHA-256
`a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e`다.
기존 검증 SHA `508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44`
(`0.166.0-alpha.6`)와 다르다. 핵심 actual-client probe는 이 preflight에서 중단했고
metadata RPC/model/Tool 호출 및 client 쓰기는 0이다. root 2개와 HTTP 1개도 검증된 설치본
부재로 skip했다. 지원 evidence를 위조하거나 이 새 실행 파일을 허용하지 않았다.
따라서 이번 결과로 현재 설치된 Codex의 실제 핵심 왕복까지 완료됐다고 주장하지 않는다.

## 사용자 상태와 보존

원래 27경로 baseline은 교체하지 않았다. 작업 초기 점검부터 과거 baseline과 Codex 설정,
기존 Antigravity 설정 및 ego 링크 3개의 metadata 차이가 있었다. ego 링크 3개의 대상은
여전히 `/Users/jw/.local/share/ego/ego-skills`다. 현재 링크·설정에 쓰지 않았다.

원장은 schema 6 / 145 transactions / 3 managed files / 4 owners로 SHA-256
`886d2296226089f4f550e3560cfad7bfb7670ab2e53f1a978c1e3b841f656c5d`를 유지하고
미완료 작업은 없다. 다만 현재 `.codex/config.toml`은 기록된 설치 내용과 달라 node-repl
관측은 drift다. 파일 mtime은 작업 중에도 바뀌었으며 writer는 입증되지 않았다. 현재 값을
덮어쓰거나 원장을 새 값으로 맞추지 않았다. 작업이 실제 HOME에 적용했다고 해석하지 않는다.

검사 말미의 별도 27경로 snapshot은 원래 baseline과 구분해 현재 값의 추가 변화만 확인한다.
과거 차이를 없애는 새 baseline으로 사용하지 않는다. 세부 해시·로그·검증 제한은
[검사 결과](core-flow-repair-20261106.json)에 기록한다.
