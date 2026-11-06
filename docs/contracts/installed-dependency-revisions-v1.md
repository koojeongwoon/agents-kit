# Installed dependency revisions v1

2026-11-06. PR10의 설치 영수증 후속이다. 설치 당시 검토한 논리 선언·native Tool 이름과
실제로 소유를 관측한 의존 자원의 revision을 함께 보관한다. Kit 원본 편집과 설치된
provider 변경을 구분한다. 이 관측만으로 native 발견·Tool 제공·교차 scope 집행을 허용하지 않는다.

## 형식과 호환성

새 적용은 installation receipt **schema 3**을 쓴다. Manifest schema 3과는 별개의
버전이다. generated locator와 native-installation locator를 기존 구분 그대로 수용하고,
native proof는 계속 nativeOwnerDigest와 원래 native ID·lastApplied baseline 대조를 요구한다.
generated schema 1 및 native schema 2 영수증은 그대로 읽는다. 자동 이력 변환이나
설정 파일 변경은 없다. 과거 영수증에는 없던 dependency snapshot과 Tool alias를
현재 Kit으로 채우지 않는다. 해당 reader를 모르는 구버전 writer는 새 영수증을 읽는
버전으로 갱신해야 한다. 역참조 집행을 활성화할 때에는 별도 state 승격·구 writer 차단이 필요하다.

declaration schema 2는 기존 참조·요구/제공 Tool ID·직접 consumer의 binding·deny와
다음을 추가한다.

- `providedToolNames`: `{id, nativeName?}`. nativeName은 명시적으로 선언한 이름만 기록한다.
  논리 ID에서 추측하지 않으며 이름·논리 ID 중복과 잘못된 타입/문자를 거절한다.
- `dependencies`: 전이 closure의 `{assetId, assetKind, declarationDigest}`. 같은 적용
  Manifest의 stable ID를 사용한다. policy 같은 논리 자원도 선언 digest로 고정하며,
  직접 참조한 policy의 deny를 consumer의 공개 deny metadata에 합친다.
- dependency declaration digest는 그 자원의 공개 논리 선언과 alias를 대상으로 한다.
  자원 본문·MCP 접속 값·credential은 포함하지 않는다. 전이 closure 항목은 별도로
  고정하므로 digest를 계산하기 위해 현재 원본을 재귀 조회할 필요가 없다.

`dependencySnapshot.schemaVersion: 1`은 실제 설치되는 네 종류에 대해 각 전이
dependency의 declarationDigest와 상태를 보관한다.

```json
{
  "assetId": "repository-mcp",
  "assetKind": "mcpServers",
  "declarationDigest": "<sha256>",
  "status": "pinned",
  "revisionDigest": "<installed receipt sha256>",
  "locatorDigest": "<installed locator sha256>"
}
```

원본·Kit·scope·client/surface/configStore·definition digest가 같은 영수증 중 실제 소유를
대조한 후보가 하나여야 한다. provider의 설치 선언이 계획에서 검토한 논리 선언과 달라도
pin하지 않는다. 누락/모호함/선언 불일치는 `status: unverified`와 안전한 이유 코드를 저장한다.
이 항목에는 revision/locator digest를 넣지 않는다. 이후 provider가 생겨도 자동으로
채우지 않으며 명시적인 새 적용/관리 등록이 필요하다.

snapshot의 항목 누락·중복·예상 밖 의존성·타입 오류를 거절한다. declaration과 snapshot을
함께 지웠더라도 직접 참조/필수 Tool binding이 남아 있으면 거절한다. 자기 참조와
qualified Manifest 참조는 이 단일 scope 영수증 형식에서 허용하지 않는다.

## 기록과 재관측

기존 client 변경과 동일한 journal/transaction 안에서 영수증을 기록한다. dependency
closure 크기로 provider부터 처리하므로 planner의 locator 순서에 의존하지 않는다.
같은 transaction에 적용한 provider도 최종 소유 proof와 revision으로 pin한다. 다른
MCP owner가 바뀌어 transaction anchor만 바뀌면 동일한 semantic revision을 유지하며,
기존 consumer의 pin을 다시 선택하지 않는다.

재관측은 순수 domain service에 현재 영수증과 파일/selector 소유 관측을 전달한다.
locator와 revision을 모두 대조하고 전이 자원의 자체 snapshot도 검사한다. 다른 설치
경로나 다른 surface의 동명 자원을 대신 쓰지 않는다. cycle/depth와 후보 수를 제한한다.

| 결과 | 의미 |
|---|---|
| `status: ownership-observed` | 이 consumer의 소유 영역을 확인함 |
| `dependencyState: revision-observed` | 고정한 모든 전이 설치 revision·소유 proof가 일치함 |
| `dependencyState: drift` | provider revision 또는 소유 내용이 바뀜 |
| `dependencyState: unverified` | 과거 snapshot·소유 증거·후보 또는 전이 전제가 부족함 |
| `bindingDeclarationsState: recorded` | 고정한 provider에서 명시적 native Tool 이름을 확인함 |
| `bindingDeclarationsState: not-required` | 기록된 closure에 논리 Tool binding이 없음 |
| `bindingDeclarationsState: unverified` | alias 또는 dependency 전제가 부족함 |

소비자 파일이 그대로인데 provider만 바뀐 경우 ownership-observed와 dependency drift를
함께 반환한다. provider rollback으로 원래 revision이 복원되면 다시 대조를 통과한다.
source-only 편집은 기존 pin이나 native 이름을 바꾸지 않는다. 원래 native 서버 이름도
별도로 반환하므로 Kit의 별칭을 서버 이름으로 대체하지 않는다.

CLI/HTTP/GUI의 명시적 설치 대조는 같은 application service를 사용한다. GUI는 소유 상태,
의존성 변경, 설치 당시 Tool 이름, 실제 발견/실행 미확인을 구분하고 이 요약에서 적용을
제공하지 않는다. 외부 관리 링크를 조회해 snapshot을 만들거나 따라가서 가져오지 않는다.

## 남은 집행 전제

이는 audit-only의 단일 scope 기록/대조다. ordinary apply는 소유 영수증을 보강하며,
지원되지 않는 교차 scope 자동 적용은 계속 차단한다. snapshot의 alias는 실제 서버의
Tool discovery 증거가 아니고 소유 증거는 native 활성/선택 증거가 아니다.
`bindingState`, `discoveryState`는 unverified, `fulfilled`는 false를 유지한다.

전역→프로젝트 실제 적용은 [scoped contract](scoped-dependencies-v1.md)의 설치 전제
계획 고정/재검사·native 문맥/Tool 발견·역참조·잠금·두 scope journal/복구·saved plan 및
관련 모든 쓰기 진입점 보호가 필요하다. 현재 audit 기록 시점의 pin을 배포 전제의
경합 방지나 완성된 교차 scope 계획으로 사용하지 않는다.
