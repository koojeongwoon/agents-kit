# 핵심 자원 관리 변경의 PR 정리

2026-11-06. 기존 자원의 편입 → Kit 사본 편집 → 원본 업데이트 재가져오기·병합 →
검토한 설치 적용·복원을 배포 가능한 변경으로 정리한다. 새 기능 개발이나 지원 확장을
진행하지 않고 이미 검증한 구현과 필수 하위 의존성을 묶는다.

## 포함 범위

- 기존 자원/외부 링크 관측, 선택한 자원의 사본·출처·baseline·revision 관리.
- B/K/U 병합·충돌 검토, metadata-only 설치 관리 등록, 소유한 파일/섹션만 적용·복원.
- CLI와 GUI가 공유하는 서비스, 변경 계획·소유권·scope·참조·원장 보호, 저장/복구 경로.
- 현재 Codex의 기본 MCP·Agent·지침 전역/프로젝트 수명주기와 기존 Skill copy 증거.
- 위 구현이 이미 사용하는 scope/variant/snapshot 안전장치와 회귀 의존성. 이를 제거해
  과거 설치·Manifest·소유 기록의 호환성을 깨지 않는다. 검증하지 않은 조합의 gate는 유지한다.
- 변경된 계약, 지원 gate가 직접 참조하는 evidence와 해당 문서의 근거.

누적 작업에서 독립된 진단 보고서·스크린샷, 광범위한 확장 계획과 traceability 초안은
원래 작업 트리에 남긴다. 사용자 설정·인증·Kit 설치·원장 파일을 Git에 포함하지 않는다.

## 기준 브랜치와 보존

기준은 `origin/main`의 `af7b3e4`다. 별도 `codex/shared-resources-core` 작업 트리에서
적용해 원래 `main` 작업 파일과 index를 유지한다. 기준 브랜치 PR #2의 자산 탭 검색 초기화,
검색 빈 상태 구분과 세 회귀 테스트를 병합 시 보존했다.

실제 클라이언트의 모델 호출은 다시 수행하지 않는다. 이미 확보한
[실기·보존 증거](current-codex-final-core-acceptance-20261106.md)를 사용하고,
선별·병합한 최종 PR 트리의 자동 검사와 사용자 상태 무변경 대조를 별도로 기록한다.

## 최종 검증

- root 853개, HTTP 53개, GUI 94개: 모두 통과, 실패·건너뜀 0개.
- TypeScript, desktop frontend/backend build, offline Cargo check와 staged diff 공백 검사 통과.
- 원격 main에서 보존한 검색 초기화 관련 세 테스트도 GUI 94개에 포함한다.
- 최초 선별 검사에서 테스트의 직접 참조 evidence 하나가 빠져 두 테스트가 실패했다.
  해당 evidence를 포함한 뒤 관련 14개 시험과 전체 root 검사를 다시 통과했다.
- 총 410개 파일은 코드/테스트 275개와 계약/검증 문서·evidence 135개다.
  누적 구현의 연결 의존성을 포함한다. 독립 진단·계획·스크린샷 60개와 광범위한
  traceability 초안은 원래 작업 트리에 보존했다.
- 원래 작업 파일 470개의 내용·권한과 index 상태가 동일하다. 사용자 설정 27경로의
  내용·권한, ego-browser 링크 3개의 identity가 유지됐다. Codex config의 mtime 차이만 관측됐다.
- 원장 schema 6 / 트랜잭션 145개 / 관리 파일 3개 / 소유자 4개 / pending 0개로 동일하다.
  SHA-256 `886d2296226089f4f550e3560cfad7bfb7670ab2e53f1a978c1e3b841f656c5d`와
  기존 `node-repl` drift 등 관측 결과를 유지했다. 사용자 설정·원장 쓰기는 0회다.
