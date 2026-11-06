# PR05: Skill snapshot·공유 연결 계획 (2026-11-06)

이 단계는 S03-1·2의 source/descriptor/소유권 모델과 무쓰기 계획을 구현한다.
전체 공유 링크 수명주기의 완료를 뜻하지 않는다. 실제 link 집행·copy↔link 디렉터리
이관·저장 계획 재개·backup/rollback·SIGKILL 복구·native 로딩 검증은 PR06에 남긴다.
해당 조건이 충족되기 전 connection operation은 preview-only로 적용·저장이 차단된다.

## 구현과 불변 조건

- 공통 Skill definition v2에서 versioned deployment 전략을 명시한다. 기존 v1과 v2
  copy는 기존 공유 배포를 사용한다. client/surface override, 중복 selector·unknown
  필드 거절, client definition의 versioned 허용 전략을 추가했다. production client
  정의와 runtime evidence는 승격하지 않았다. 미지원 전략은 copy로 대체하지 않는다.
- 순수 `skill-snapshot` domain은 NFC 경로·SHA-256·원래 파일 mode·byte 크기를
  포함한 정렬 inventory와 tree digest를 계산한다. 파일 diff, alias/파일·디렉터리
  충돌, 관리 경로, binary/권한 변화, 8 MiB/1 MiB/256파일/16깊이/512entry 제한을 다룬다.
- `SkillSnapshotStore`는 home 아래 discovery 밖의 고정 위치를 사용한다. prepare와
  inspect는 저장소를 생성하지 않는다. publisher는 일치하는 바이트만 private stage에
  만들고 read-only mode로 보관한다. 기존 digest는 전체 내용·mode·inventory가
  일치해야 재사용한다. 사용자 변경·추가 파일·symlink·hard-link alias·unsafe parent를
  drift로 거절한다. publisher는 현재 disposable unit fixture에서만 호출된다.
- 순수 shared connection domain은 소비자를 유지하는 LINK/SKIP/REGISTER/
  REPLACE_LINK/RELEASE/REMOVE_LINK를 결정한다. 동일 경로의 다른 전략/자원/내용은
  충돌이며 revision·의존성·연결 위치 변경에는 전체 소비자의 참여가 필요하다.
  미관리 동일 링크도 인수하지 않는다. leaf를 따라가기 전에 parent 경계를 인가한다.
- state v6만 엄격한 connection record를 허용한다. v1/2/4/5를 계속 읽고, 구 schema에
  연결 필드를 넣으면 거절한다. native 설치 쓰기가 원장을 v5로 낮추던 경로도
  `Math.max`로 고쳐 새 semantics를 보존한다. record에 native/typed 소유권을 섞지 않는다.
- 참조 inventory는 활성 원장·이력·병합/기준 부모·저장 계획·journal·backup의 구조화된
  snapshot 참조를 센다. unknown/unavailable 참조를 기록하고 자동 GC는 제공하지 않는다.
- 기존 Manifest deployment service에 연결 계획과 제거 계획을 통합했다. CLI/HTTP/GUI에
  descriptor·소비자·파일 diff·보존 snapshot을 같은 DTO로 제공한다. 새 연결 계획은
  store/설치/원장을 쓰지 않는다. UI도 preview-only를 별도로 검사해 적용·저장을 막는다.
- text resource bundle v1의 export/validation 모두 source v2를 명시적으로 거절한다.
  host 절대 snapshot 경로를 내보내거나 새 전략을 조용히 버리지 않는다.

[계약과 schema 예시](../contracts/skill-snapshot-plan-v1.md).

## 검증

source v2를 기존 코드가 거절하는 실패를 먼저 확보했다
(`/private/tmp/kit-pr05-service-red.log`). 이후 domain/store/공유 application service와
CLI/HTTP/GUI를 연결하며 회귀를 확인했다. 신규 회귀에는 다음이 포함된다.

- 정렬 순서에 독립적인 digest, mode/content/binary diff, 경로 prefix의 case/NFC alias,
  file/directory 충돌과 크기 제한.
- 순수 계획의 store/target/state 부재, 변경된 입력의 publish 전 거절, 기존 snapshot
  재사용과 source 편집 격리, 내용/mode/추가 파일/hard-link/unsafe parent drift.
- 한 경로의 두 client coalescing, 동일 연결 SKIP, 새 소비자 REGISTER, 전체 소비자
  revision 갱신, 일부/마지막 소비자 해제 후 snapshot 보존.
- 기존 versioned snapshot 연결의 실제 임시 symlink/state를 이용한 service
  SKIP·공동 갱신·RELEASE·REMOVE_LINK 미리보기. 외부 목적지로 retarget 후 무변경 거절.
- legacy copy 이관 필요 판정, file/symlink parent 거절, source/capability schema 검증,
  bundle export/validation 거절, 원장 v6 유효성 및 native 쓰기 시 버전 유지.
- CLI dry-run 무쓰기와 직접 적용 거절. HTTP token 유지·preview 적용 거절. GUI는
  잘못된 `automatic: true`가 주어져도 `previewOnly`를 확인해 적용·저장을 차단한다.

루트 **391 passed** (`/private/tmp/kit-pr05-root-verified.log`), HTTP **29 passed**
(`/private/tmp/kit-pr05-http-final.log`), GUI **53 passed**
(`/private/tmp/kit-pr05-gui-final.log`). source v2 bundle decode 차단, 기존 native
deployment guard 보존과 preview flag 제거 우회 차단도 루트 전체 회귀에 포함한다.
TypeScript, desktop frontend/backend build, diff 검사 통과. Rust 코드 변경 없음.

실제 client/model 호출·source 네트워크 취득은 하지 않았다. 기존 전역 client 설정과
ego-browser 링크에 쓰지 않았고, 이전 PR04c 기준의 27개 관찰 경로도 여전히 내용·mode·
inode·mtime·연결이 동일하다. [보존 결과](skill-snapshot-plan-preservation-20261106.json).
snapshot publication과 연결 검증은 별도의 임시 home/project에서만 수행했다.

## 다음 구현에서 해결할 조건

PR06은 publication 중단 stage의 journal 등록·검토 복구, 디렉터리 이관의 정확한
inventory/identity backup, 연결의 원자적 교체와 원장 commit, 저장 계획/rollback 및
모드·bytes·소비자를 보존하는 실제 SIGKILL 시험을 연결해야 한다. 현재 publisher의
동시 publication/실패 stage 보존을 독립적인 crash recovery 완료로 간주하지 않는다.
copy 디렉터리나 외부 관리 링크를 교체하는 기본 경로도 아직 열지 않는다.
이후 각 client의 실제 snapshot-link 인식을 분리 검증한 조합만 활성화한다.
