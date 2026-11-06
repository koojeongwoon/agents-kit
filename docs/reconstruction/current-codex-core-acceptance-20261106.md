# 현재 Codex 핵심 흐름 실기 검증

이 문서는 앞선 Skill 중심 검증 기록이다. 이후 요청한 MCP·Agent·지침 및 GUI 전체 흐름의
최종 판정은 [후속 핵심 검증](current-codex-final-core-acceptance-20261106.md)을 따른다.

2026-11-06. [핵심 흐름 수리](core-flow-repair-20261106.md)에서 실행 파일 변경으로
남았던 실기 3개와 현재 설치본의 실제 적용·복원을 확인한다. 새 client/format/전략은 추가하지 않는다.

현재 실행 파일은 Codex CLI `0.167.0-alpha.3.2`, darwin/arm64,
SHA-256 `a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e`다.
버전 명령도 임시 HOME에서 실행했다. 원래 27경로 baseline을 교체하지 않고 이번 작업의
별도 시작 지문과 비교한다. 사용자 원장과 다른 Codex 설정을 복원하거나 원장에 수용하지 않는다.

## 실행한 검증

1. [직접 discovery](current-codex-skill-discovery-20261106.json): 지원 기록을 추가하기 전에
   실제 실행 파일의 `skills/list`로 전역·프로젝트 copy Skill의 이름·경로·활성 상태·scope를 확인했다.
   native RPC 1회이며 기존 bounded parser를 통과했다.
2. 기존 client definition에 이 실행 파일의 전역·프로젝트 copy Skill 증거와 Skill reader 증거만
   추가했다. 기존 증거·경로·gate는 유지한다. MCP·Agent·지침·snapshot·desktop 지원은 승격하지 않는다.
3. [핵심 왕복](current-codex-core-roundtrip-20261106.json): 기존 native 설치 관리 경로에서
   전역·프로젝트 각각 편입 → 사본 편집 → upstream 변경/재가져오기 → 병합 → metadata-only
   adoption → 적용 → rollback → 소유권 해제까지 실행했다. Kit 수정과 upstream 수정이 합쳐졌고,
   적용한 Skill과 복원한 Skill을 실제 클라이언트가 각각 인식했다. 같은 실행에서 common
   copy의 baseline·생성·갱신·제거·rollback도 실제 인식과 파일로 확인해 총 native RPC 14회다.
4. 이전에 skip한 CLI·고정 helper·HTTP 실기 3개가 모두 실행돼 통과했다. 이 시험들은 현재
   미검증인 프로젝트 지침/MCP/Agent 조합과 desktop의 차단도 유지하는지 확인한다. 기존 AGY
   검증 조합은 회귀 검증만 하며 지원을 확대하지 않는다. CLI 실기의 HOME도 임시 경로로 분리했다.

설정 바이트·권한, 외부 링크 identity와 payload, 적용 직전 파일로의 복원 및 새 Kit 파일의
제거를 격리 환경에서 확인했다. 최종 discovery/왕복 증거의 관측은 metadata RPC 15회이며
모델·Tool/provider discovery 호출은 0이다. 초기 핵심 왕복 4회도 별도 로그로 보존하므로
이번 작업의 전체 metadata 관측은 19회다. 이 결과는 모델 사용이나 다른 자원/전략의
새 버전 지원을 증명하지 않는다.

중간 root 검사는 852개 중 1개가 실패했다. runtime 증거가 발견만 확인한 artifact를
가리켜 기존 full lifecycle 검사에 맞지 않았다. 해당 검사를 유지하고 실제 생성/갱신/제거/
복원을 추가 관측한 뒤 runtime 증거를 왕복 artifact로 연결했다. 전체 허용 기록 수를
새 copy 두 조합을 포함한 27개로 갱신했다. 이후 activation/client definition 시험 34개가
통과했다. `fullLifecycleConfirmed`는 파일과 native metadata 수명주기의 확인이며 모델 사용은
계속 unverified다.

재현: `node scripts/client-verification/native-core-roundtrip.mjs --binary <현재 검증된 Codex 절대 경로>`.

최종 회귀 결과와 사용자 설정·원장·링크의 보존 대조는
[최종 검사 결과](current-codex-core-acceptance-20261106.json)를 따른다.

최종 root **852 passed / 0 failed / 0 skipped**, HTTP **53 passed / 0 failed / 0 skipped**다.
이전에 skip한 실기 3개도 각각 통과했다. 시작 지문과 대조한 27경로의 내용·권한 및 링크
identity는 같고, Codex config의 mtime만 달라졌다. 원장 SHA와 기존 node-repl 설정 drift
상태도 그대로다. 해당 설정이나 원장을 덮어쓰지 않았다. 이번 요청 범위의 검증은 완료했다.
