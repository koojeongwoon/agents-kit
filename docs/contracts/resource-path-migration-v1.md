# Resource path migration v1

이 계약은 client definition의 경로가 바뀐 공통 지침/Skill과 typed Agent/MCP의
**같은 Kit·scope·논리 자원·store 안에서의 명시적 이관**이다. 일반 apply와 제거의
현재 경로 검사를 해제하지 않는다. native import/install, copy↔snapshot 전략 변경,
다른 store/format으로의 변환과 전역↔프로젝트 이동은 다른 계약이다.

## 적용 당시 경로 증거

새 apply의 committed transaction operation에는 선택적으로 `locators`를 기록한다.
각 항목은 `schemaVersion: 1`, Kit/asset/kind/client/surface/scope/store ID,
적용 당시 capability ID·경로 template·실제 target base·strategy·format과 정규화한
client definition의 `definitionDigest`를 가진다. 정의 원문이나 자격 증명을 복사하지 않는다.

이 필드는 감사 증거이므로 소유권 schema 자체를 바꾸거나 누락된 resource identity를
소급 생성하지 않는다. 과거 reader가 감사 필드를 무시해도 파일/selector/consumer
소유권을 잃지 않는다. 잘못된 locator 구조는 새 reader가 거절한다.

이관은 현재 managed record의 `transactionId`에 해당하는 committed apply receipt의
`afterManaged`/`managedAfter`가 현재 소유권과 정확히 같고, 해당 reader의 locator가
실제 과거 파일·selector와 일치할 때만 허용한다. 다른 MCP만 갱신한 경우에도 원래
reader의 증거를 유지한다. rollback은 이전 소유 record와 해당 과거 receipt 참조를
복원한다. 정의가 갱신됐다는 이유로 과거 기록을 다시 작성하지 않는다.

증거가 없는 과거 설치, 모호한 여러 origin, native owner와 외부 관리 링크는 자동
편입하거나 옮기지 않는다. `RESOURCE_PATH_OWNERSHIP_UNPROVEN` 등으로 차단하고
기존 파일을 유지한다. 현재 정의를 과거 정의의 증거로 추정하지 않는다.

## 계획

공통 `planMigration`에 `migration: resource-path`, 명시적 `assetIds`와 하나 이상의
대상을 전달한다. 현재 Manifest 의존성 closure와 runtime/binary gate는 그대로 검사한다.
함께 바뀌어야 하는 의존 자원이 아직 준비되지 않았으면 이관을 차단한다.

- `pathMigrations`에 자원·client/surface/store, 과거/새 target base와 두 정의 digest,
  과거 위치에 남는 shared consumer를 표시한다.
- 새 위치 생성/변경을 먼저 계획하고, byte·mode 검증 후 과거 소유 항목을 해제한다.
  저장소를 읽는 대상은 operation의 `affectedTargets`에도 표시한다.
- shared 지침/Skill은 선택한 consumer만 새 위치로 옮길 수 있다. 나머지는 원래
  위치와 증거를 유지한다. 먼저 이동한 consumer의 위치에 나머지가 합류할 수도 있다.
- typed Agent/MCP의 같은 물리 store는 모든 기록된 reader가 같은 새 위치로 이동해야
  한다. 화면 하나를 해제한 것처럼 설정 자체를 제거하지 않는다.
- MCP는 선택한 server selector만 이동하고, 다른 server와 사용자 설정은 남긴다.
  같은 store의 다른 selector를 나중에 합류시킬 수 있다.
- Agent의 과거 별도 등록 섹션이 남아 있으면 `RESOURCE_PATH_LEGACY_AGENT_REGISTRATION`
  으로 차단한다. 설정 위치는 client definition에서 읽고 형식 해석은 Agent adapter가 맡는다.

새 위치의 미관리 파일/링크/디렉터리는 내용이 같아도 인수하지 않는다. 이미 같은
자원이 관리하는 Skill 위치라도 미관리 파일·빈 폴더를 교체하지 않는다. 이전 Skill
위치에서는 소유 파일만 해제하므로 사용자 메모나 외부 링크는 그 위치에 남는다.
새 파일과 디렉터리는 과거 소유 항목의 mode를 유지하며, 합류 origin의 mode가
서로 다르면 검토가 필요하다. metadata/Kit 원본 자기 대상, parent symlink 탈출과
서로 겹치는 새/옛 target은 차단한다.

CLI·HTTP·GUI는 같은 application service를 사용하며 계획만으로 설치를 변경하지 않는다.
GUI는 과거/새 위치와 남는 consumer를 표시하고 별도 적용 승인을 받는다.

## 집행·재개·복원

집행은 PR06의 tree transaction을 재사용한다. Python 3와 해당 파일시스템의 원자적
rename/exchange가 필요하며 사용할 수 없으면 계획을 차단한다. 일반 copy 적용에
이관의 추가 도구 의존성을 강제하지 않는다.

원래/새 위치의 bounded image와 소유 record를 함께 backup하고 mode/hash/identity를
검사한다. snapshot은 immutable store를 유지하고 Kit 소유 링크만 바꾼다. 필요하면
새 snapshot을 기존 publication/journal 절차로 발행하고 과거 사본은 보관한다.
새/옛 위치를 하나의 journal·원장 commit으로 다루며 tree state는 최소 v6,
physical ownership이 있으면 v7을 유지한다. 계획에도 schema 전환을 표시한다.

적용 전과 중간 단계, commit 전에 Manifest/정의/binary/state, source image와 과거
Agent 설정 전제를 재검사한다. 읽은 설정이 같은 transaction의 관리 대상이면 검토한
before/after image만 허용한다. 외부 변경은 덮어쓰지 않으며 journal을 보존할 수 있다.

저장 계획은 두 위치와 reader 영향, `pathMigrations` 요약을 보존한다. 재시작 후 현재
입력으로 다시 계획해 digest가 같아야 실행한다. 완료 결과의 재요청은 이력과 대조해
중복 실행하지 않는다. SIGKILL 후에는 기존 recovery API로 미완료 변경을 복원하거나
완전히 commit된 변경을 유지한다.

rollback은 적용 당시 backup·소유권을 사용하므로 최신 정의가 다시 바뀌어도 양쪽
위치를 복원할 수 있다. 소유권이나 파일이 다른 작업으로 대체됐으면 복원을 차단한다.
새 위치의 소유 항목을 제거하고 과거 내용을 되살리며 원장 schema를 내리지 않는다.

## 사용

```sh
node bin/cli.js migrate --kit /absolute/kit --project /absolute/project \
  --client codex --surface cli --client-version <verified-version> \
  --migration resource-path --assets rules,review,reviewer,docs --dry-run
```

`--dry-run`을 제거해 검토한 이관을 실행하거나 `--save-plan`으로 저장하고 기존
`resume --plan <id> --digest <digest>`로 실행한다. 여러 reader는 기존 `--targets`
JSON 인수로 명시한다. HTTP는 `/api/deployment/migration-plan`을 사용하며 적용·저장·
재개·rollback·recovery는 기존 인증된 endpoint를 공유한다.

격리 fixture의 임의 경로는 transaction 검증용이다. 실제 클라이언트가 임의의 새 경로를
읽는다는 지원 증거가 아니며, 제공하는 client definition의 경로·지원 profile을 확대하지 않는다.
