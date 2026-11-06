# PR04c: 고정 Git/npm 출처 연결 (2026-11-06)

기존 Kit 관리 자원에 공개 HTTPS Git 커밋 또는 npm 정확한 버전/SHA-512 출처를
연결하고, 기존 B/K/U 갱신·충돌·부분 수용·보류·revision 복원 흐름으로 관리한다.
원래 설치 `origin`과 별도의 versioned `upstream`을 둔다. 외부 관리 ego-browser는
등록·출처 연결 대상에 넣지 않으며 실제 설정·링크·updater에는 쓰지 않았다.

## 구현

- Domain: `upstream-source.js`가 source schema v1의 종류·버전/hash·URL·경로를 검증한다.
  관리 기록 v3 및 checkpoint v2로 출처를 보존한다. 기존 v1/v2 record/checkpoint는
  읽을 수 있고, 새 계약을 모르는 이전 reader는 v3를 거절한다.
- Infrastructure: Git은 격리된 임시 bare 저장소의 raw blob만 읽는다. npm은 metadata와
  tarball 무결성을 확인하고 메모리에서 제한된 tar 형식만 읽는다. checkout·LFS·hook·
  npm install·dependency install·lifecycle 실행을 하지 않는다. 자격 증명을 읽어
  복제하거나 transport에 전달하지 않는다.
- Application: 기존 `checkUpstream`/`planRefresh`에 acquisition port를 주입한다.
  source 선택·재연결·버전 변경·로컬 복귀가 기존 accepted B를 그대로 병합 부모로 쓴다.
  같은 바이트의 다른 pin도 reviewed metadata revision이다. 검토 hash는 pin까지 묶고,
  적용은 계획에 보관한 고정 바이트로 기존 source journal/atomic transaction을 사용한다.
  mutable 로컬 출처는 기존 apply-time 재조회 규칙을 유지한다.
- CLI `--upstream`, 인증된 POST check/refresh API, GUI 출처·pin 입력을 같은 서비스에
  연결했다. 출처 입력을 바꾸면 기존 preview/충돌 선택을 무효화한다. 기존 GET/API/CLI
  로컬 동작과 native 설치 서비스는 유지한다.

지원 범위와 의도적인 제한은 [계약](../contracts/upstream-sources-v1.md)에 명시했다.
자동 최신 버전 탐색·인증 저장소·다른 registry/package 형식·PAX/GNU tar 확장은
지원하지 않는다. Git selected tree에는 기존 파일/byte 제한을 적용하나 fetch pack의
hard byte quota는 없다. Git binary가 필요하며 fetch는 30초 제한 후 scratch를 정리한다.

## TDD와 회귀

먼저 locator/취득 실패·출처 연결·출처 포함 복원 테스트를 추가해 실패를 확인했다.
새 port가 연결되기 전에는 기존 로컬 origin을 읽는 동작으로 실패했고, source service를
확장한 뒤 통과했다. 실패 로그는 `/private/tmp/kit-upstream-red.log`,
`kit-upstream-service-red.log`에 보관했다.

테스트는 고정 pin과 credential/transport 거절, npm metadata/bytes 무결성 및 package
identity 대조, 경로 탈출·링크·특수 파일·충돌·크기 제한, raw Git blob/작업본 분리·
export-subst 비실행·submodule/잘못된 UTF-8 거절을 포함한다. macOS가 잘못된 UTF-8
파일명 생성을 막으므로 해당 fixture는 Git tree object로 직접 만들며 filesystem
보호를 우회하지 않는다.

서비스/CLI/HTTP/GUI는 무쓰기 preview, disjoint merge, 충돌 보류, pin 변경 시 stale
review 거절, 다운로드 실패 보존, same-byte 연결 변경, 로컬 복귀, 출처 포함 rollback,
commit fault 시 파일/Manifest/binding 복원, source v3를 유지한 native apply/rollback을
검증한다. HTTP fixture의 ego-browser 링크도 import/refresh/rollback 전후 동일하다.

최종 검증:

- 루트: **372 passed** (`/private/tmp/kit-upstream-root-final.log`).
- HTTP: **28 passed** (`/private/tmp/kit-upstream-server-final.log`).
- GUI: **52 passed** (`/private/tmp/kit-upstream-gui.log`).
- TypeScript, desktop frontend/backend build, `git diff --check` 통과.
- Rust 코드 변경 없음. 실제 client/model 호출·지원 profile 승격 없음.

초기 HTTP 실행은 sandbox의 `listen EPERM`으로 실패해 임시 포트 허용 환경에서
재실행했다. 첫 허용 실행 중 기존 MCP preview 사례 하나가 예상 200 대신 403을
반환했다. 응답 본문이 당시 assertion에 남지 않아 원인은 확정하지 않았고, 제품 수정으로
해결했다고 간주하지 않는다. 새 연결/복원 HTTP 시험을 포함한 최종 실행은 모두 통과했다.

## 필요한 실제 취득만 확인

기존 package-lock의 `yaml@2.8.3` SHA-512를 사용해 registry metadata/README를
가져왔다. 그 버전 metadata의 전체 Git commit
`ce14587484822bffb0f7d31aefedcaf2dc0d0387`에서도 raw README를 읽었다.
둘 다 **6,266 bytes**, 내용 SHA-256
`c8aa393826fb1c55ae195399864e7f454a2c66c4d9491459545b26cac4b958e6`로 일치했다.
[취득 증거](upstream-acquisition-smoke-20261106.json)는 acquisition-only이며
클라이언트 적용·모델 사용 증거를 뜻하지 않는다. 실제 사용자 Kit의 출처를 연결하거나
기존 자원을 업데이트하지 않았다.

실제 설정/자원 27개 항목을 위 실제 취득과 최종 검증 전후 비교해 내용·mode·inode·mtime
변경 없음과 ego-browser 링크 3개의 동일 연결을 확인했다. 링크 목적지는 순회하지 않았다.
[보존 결과](upstream-preservation-20261106.json). baseline과 체크 도구는
`/private/tmp/kit-upstream-preservation-baseline-20261106.json`,
`/private/tmp/kit-upstream-preservation.mjs`에 둔다.

다음 계획은 PR05의 immutable snapshot·연결 descriptor와 pure diff이다.
실제 링크 집행은 PR06의 별도 검증을 거친다.
