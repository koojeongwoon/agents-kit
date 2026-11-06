# C07 Skill 대상·호환성·공통 variant 배포

2026-11-06. 상태: **common/shared variant의 배포·선택 영수증·복원 및 variant별 원본 등록/
편집/갱신/병합/이력 복원 및 Codex native UI metadata profile 배포 구현.
다른 native 형식·exclusive·명시적 관리 해제는 미완료**.
[현재 계약](../contracts/skill-distribution-v1.md),
[통합 계획 C07](../product/shared-resources-consolidation-plan.md#c07-skill의-범위배포-대상호환성을-분리한다).

## 최초 reader·선택 단계 기록

처음에는 Skill definition v3 reader·순수 대상/variant 선택·정확한 버전별 작성자 검토·bounded 원본 검사를
추가했다. Manifest v1/v2/v3에서 읽으며 기존 definition v1/v2는 변환하지 않는다.
client/surface별 implicit 선택을 적용하고 명시적 선택과 의존성은 진단에서 숨기지 않는다.
native 파일은 원형으로 읽고, 본문·Tool 이름·native 메타데이터의 의미를 자동 변환하지 않는다.

최초 TDD 실행은 13개 중 7개 통과·6개 실패였다. 일반/scoped public plan이 작성자 검토만으로
새 형식을 허용했고, 기존 전역 영수증이 새 배포 정책을 증명하지 못하는 문제를 재현했다.
root symlink·filesystem 별칭·비정규 버전 거절도 보완했다. 신규 형식의 집행 및 전제 사용을
명시적으로 차단하고 snapshot/discovery contribution에 우회로 들어가지 않도록 했다.
scoped apply의 예상 오류 코드는 기존 서비스의 `SCOPED_DEPLOYMENT_PLAN_BLOCKED`에 맞췄다.
별도 선택 시험은 최초 fixture의 catalogId 누락을 수정한 뒤 세 Manifest reader에서 검증했다.

이 시점 신규 시험 17개와 root 전체 798개, HTTP 51개가 통과했다. 기존 copy/snapshot·저장 계획·
경로 이관·의존성 조정·rollback/중단 복구 시험도 전체 실행에 포함된다. GUI 코드는 변경하지
않았고 이 단계에서 GUI component/typecheck/build나 실제 native/model/Tool 호출은 반복하지 않았다.
HTTP 결과는 기존 API 회귀 검사이며 새 variant 배포 API가 완성됐다는 뜻이 아니다.

사용자 원장은 schema 6/145 transactions/3 managed files/4 owners로 내용 해시가 이전과 같다.
미완료 journal은 없고 관리 파일의 내용이 원장과 일치한다. 읽기 검사에서 기존 v2 영수증 4개는
ownership-observed를 유지하며 의존성과 native 발견은 unverified다. 사용자 client/state 쓰기는 없다.
원래 보존 baseline의 27경로 중 Antigravity `config.json` 1건 차이는 앞서 기록한 현재 해시·모드를
그대로 유지한다. 원인 귀속은 미확정이며 되돌리거나 baseline을 교체하지 않았다. 나머지 26경로와
외부 ego-browser 링크 3개의 identity는 유지한다. Codex config의 기존 metadata 차이도 같다.

남은 작업은 선택된 variant의 실제 산출물·설치 증거, 공유 경로/추가 discovery 노출·격리 검사,
저장 계획과 변경 무효화, variant별 편집/갱신/병합/복원 및 CLI/HTTP/GUI 표시다. native adapter와
Claude 등 추가 client의 지원 증거는 별도다. PR10의 native 원형/과거 경로·전역 설정 전환,
PR07/09/11의 나머지 범위와 실제 GUI/consumer/Agent 완료 증거도 여전히 남아 있다.

로그는 `/private/tmp/kit-c07-foundation-red.log`, `kit-c07-selection-red.log`,
`kit-c07-foundation-focused.log`, `kit-c07-foundation-root.log`, `kit-c07-foundation-http.log`다.
이 시점 검토 기준은 [체크포인트](skill-distribution-checkpoint-20261106.json)를 따른다.

## common/shared variant 집행 연결

후속 단계에서 선택한 하위 bundle을 기존 일반/scoped compiler·copy/snapshot 서비스에 연결했다.
새 source format을 허용하더라도 기존 client/surface/version/binary/strategy gate를 그대로 적용한다.
native와 exclusive-client는 계속 차단하며 Claude 지원을 경로 정의만으로 추가하지 않았다.

copy는 bounded reader가 캡처한 내용·모드로 산출물을 만들고 준비한 descriptor를 review와 대조한다.
snapshot도 실제 준비한 treeDigest를 대조한다. copy 파일의 모드 변경을 계획·소비자 gate·journal·
rollback에 연결했다. 두 variant의 파일 집합이 다르면 같은 target에 합집합으로 설치하지 않는다.
직전 source 검증과 실제 준비 사이의 변경이나 검증 callback의 metadata 교체도 재현해 차단했다.

apply transaction의 versioned `skillSelections`는 실제 설치 receipt digest·definition digest·선택한
variant/client/surface/version/review를 함께 묶는다. state reader는 대응 영수증과 형식을 검증하고,
배포 시 요청한 선택 증거를 남길 수 없으면 트랜잭션을 실패시킨다. 바이트가 같은 variant 전환도
기록하며 해당 metadata-only 적용의 rollback 후에는 이전 정상 선택으로 돌아간다. 기존 설치
영수증의 버전이나 logical declaration 의미는 변경하지 않았다. 전역 설치를 새 프로젝트의
전제로 사용할 때 선택 기록·현재 선언/버전이 맞아야 하며 native 관측은 별도로 요구한다.

저장 계획/목록에 `skillDistributions` 검토를 보존하고 재개 시 재계획·fingerprint를 대조한다.
일반 배포도 selected source와 private 설치 metadata를 preflight/before-commit에 재검사한다.
CLI/HTTP 및 GUI preview는 variant·작성자 검토·기존 정의에 알려진 추가 독자를 보여 준다.
추가 discovery 설정은 미관측이며 이 결과가 격리나 모델 사용의 증거가 아님을 구분한다.

신규 설치 시험의 최초 8개 중 2개가 실패해 bundle 합집합 문제와 저장 목록의 선택 누락을
재현했다. 추가 2개 실패는 검증 중 선택 metadata 변경과 snapshot 준비 시 review 미대조였다.
CLI 시험의 save/rollback 출력은 기존처럼 JSON 뒤 안내문을 포함하므로 해당 동작은 종료 코드와
저장 파일로 검증하도록 시험을 수정했다. CLI 제품 출력 형식을 바꾸지 않았다.

최종 root **810개**, HTTP **52개**, GUI **88개** 및 typecheck·desktop frontend/backend build가
통과했다. root에는 C07 시험 29개가 포함되며 일반/scoped global 및 project·저장/재개·복원·
모드/내용 변경·metadata-only 전환·기존 receipt 거절·공유 경로 충돌·CLI 왕복을 확인한다.
GUI component와 build 증거이며 실제 브라우저 GUI 통합 완료를 뜻하지 않는다.

## 실제 native 관측

[격리 실제 Codex 왕복](skill-distribution-native-roundtrip-20261106.json)은 검증된 SHA-256의
Codex `0.166.0-alpha.6`에서 Manifest v3 전역 common/shared copy 및 snapshot-link를 적용했다.
각각 선택한 bundle의 이름·설명·설치 파일을 `skills/list`로 읽고 설치 선택 기록을 확인한 뒤,
rollback 후 같은 API에서 제거를 관측했다. 설정 바이트/권한과 검증용 외부 링크 identity는 같다.
최종 성공 실행 native 관측은 4회이며 model/Tool/provider discovery 요청은 0이다.

실제 검증 스크립트의 앞선 2회는 이력 API의 client/target 인수 누락으로 첫 copy 관측 후 중단했다.
세 번째는 copy 왕복 후 snapshot의 canonical 경로 응답을 논리 링크 경로와 직접 비교해 실패했다.
Kit이 소유한 실제 snapshot 파일까지 확인하도록 고쳐 최종 두 왕복이 통과했다. 실패 3개의 stderr도
보존한다. 전체 시도에서 metadata RPC는 합계 9회이며 이는 모델 호출 수가 아니다. 실패한 검증용
HOME도 각 실행의 finally로 정리했고 사용자 HOME에 적용하지 않았다.

사용자 원장은 이전과 같은 schema 6/145 transactions/3 managed files/4 owners다. 관리 파일의
내용과 외부 링크 3개가 유지되고 미완료 journal은 없다. 기존 Antigravity 설정 차이 1건과 Codex
metadata 차이를 이전 baseline과 구별해 보존하며 원래 baseline을 바꾸지 않았다.

이번 단계의 증거와 잔여 범위는 [배포 체크포인트](skill-distribution-deployment-checkpoint-20261106.json)를
따른다. native variant·exclusive 격리·실제 추가 discovery 설정·variant별 원본 편집/재가져오기/
병합 revision과 다른 client/surface의 새 증거가 남아 있다. PR10 native 원형/과거 경로와
전역 설정 전환, PR07/09/11 및 실제 GUI/consumer/Agent 완료 증거도 미완료다.

## variant별 원본 수명주기

[원본 계약](../contracts/skill-variant-sources-v1.md)은 definition 3의 distribution 2에 명시적인
managed source 1을 추가한다. 기존 문자열 source와 구별하고 기존 source revision 엔진에
record 읽기/쓰기 port를 연결했다. 각 asset/variant ID 쌍이 자기 namespace·수정본·baseline·
origin·history를 갖는다. source checkpoint 3은 두 논리 ID를 함께 검증한다. 기존 imported
resource 관리와 v3 native import 수명주기 차단을 유지한다.

기본 등록은 현재 Kit 경로를 원본으로 기록하고, 명시적 local candidate 등록은 원래 설치본을
B로 받아 현재 Kit K의 선행 수정도 보존한다. local 갱신과 고정 Git/npm 연결은 기존 B/K/U
병합·부분 수용/보류·reviewHash·불변 다운로드·rollback을 재사용한다. source 등록/편집/
갱신/복원은 원본·클라이언트·배포 원장을 쓰지 않는다. native metadata·binary·모드와 다른
variant를 보존하며 external ego candidate는 내용 읽기 전에 거절한다.

CLI `variant-register`와 기존 source 명령의 `--variant`, HTTP 등록/기존 source endpoint,
GUI variant별 등록 검토/편집/업데이트/이력을 같은 서비스로 연결했다. Kit origin을 실제
클라이언트 설치 origin처럼 표시하지 않는다. generic 선언 CRUD는 관리 source/history
덮어쓰기·삭제를 차단하고 호환성 검토/대상 선언 변경은 허용한다. 관리 해제는 별도 미구현이다.

최초 새 시험은 미구현 등록 API로 실패했다. 이후 generic metadata 우회, metadata-only
refresh/rollback에서 내용 디렉터리 ID와 head revision을 같다고 가정한 검사, SIGKILL용
inline script의 개행 escaping 문제를 기록하고 수정했다. 관리 head와 내용 artifact를 구별한다.
source/Manifest commit 전후 실제 SIGKILL·reviewed recovery에서 설치와 다른 variant가 같다.

추가 TDD는 A만 등록/편집해도 B의 전역 설치/프로젝트 전제가 `SKILL_DISTRIBUTION_INSTALLATION_UNVERIFIED`
로 차단되는 실패를 재현했다. 새 선택 영수증 2는 선택한 variant와 해당 대상/버전 규칙만 묶어
B의 설치 증거를 보존한다. 기존 선택 영수증 1의 전체 정의 digest 의미는 유지하고 자동 추정
이관하지 않는다. 새 source 선택 2는 정확한 Kit source 경로와 관리 head revision을 기록한다.

최종 root **823개**(C07 42개 포함), HTTP **53개**, GUI **90개**, typecheck·desktop frontend/
backend build가 통과했다. HTTP 중간 실행의 path-migration rollback-plan에서 401 1건이
발생했다. 현재 앱의 mutation guard는 403을 반환하며 repo에서 401 반환 경로를 찾지 못했지만
당시 응답의 출처는 입증되지 않았다. status/app request ID/content-type의 비밀값 없는 진단을
추가했다. 최종 전체 HTTP 실행에서는 재현되지 않았다. 인증을 완화하지 않았고 실패 로그를
보존한다. GUI는 component/build 검증이며 실제 브라우저 통합은 여전히 별도다.

[실제 관리 사본 왕복](skill-variant-sources-native-roundtrip-20261106.json)은 같은 검증된 Codex
`0.166.0-alpha.6`의 격리 HOME에서 variant 등록 → Kit notes 편집 → 원본 파일 추가/재가져오기 →
병합 → 새 tree 작성자 검토 → 공통 copy/snapshot 적용 → native 발견 → rollback/부재 관측을
통과했다. 두 방식 모두 수정본과 새 원본 파일이 설치되고 다른 variant는 설치되지 않았다.
성공 실행의 metadata 관측은 4회이며 provider discovery/model/Tool 요청은 0이다. 이 관측은
관리 source 2의 파일/경로·클라이언트 발견/복원을 증명하고, 선택 영수증 v2의 variant 간 정책
독립성은 뒤이은 서비스/원장 시험으로 분리해 검증했다.

사용자 보존 검사는 원래 baseline을 그대로 사용한다. 최종 원장/관리 파일/외부 링크 및 기존
Antigravity 설정 차이의 현재 값은 [체크포인트](skill-variant-sources-checkpoint-20261106.json)에
기록한다. native variant 배포·exclusive·추가 discovery 실제 설정·명시적 variant 관리 해제,
다른 client/surface, PR10 native 원형/과거 경로/전역 설정 전환과 PR07/09/11·실제 GUI·
consumer/Agent 완료 증거는 계속 남아 있다.

## Codex native UI metadata profile

[native profile 계약](../contracts/native-skill-interface-v1.md)을 추가했다. variant에 native client와
format profile을 명시하고, 기존 client 경로 정의를 바꾸지 않는 보조 증거 파일로 정확한
version/binary/platform/scope/strategy를 확인한다. 선택 3은 native 선언·증거 digest와
asset/Kit source 기준을 묶으며 기존 common 선택 1/2와 설치 영수증은 유지한다.
정책 파일 변경은 계획·저장 재개·검증 callback·프로젝트 전제를 무효화한다.

공식 Skills 문서를 ego-browser로 확인한 뒤 실제 실행 파일의 UI metadata 파싱을
[세 조합에서 관측](codex-native-skill-interface-research-20261106.json)했다. UI 여섯 필드와
같은 bundle의 아이콘만 허용한다. invocation policy는 최초 연구 응답에 노출되지 않아
policy/Tool dependencies/알 수 없는 확장을 배포 전에 차단하며 Kit 원본은 보존한다.
이는 native 호출 정책·모델 사용이나 Claude/Antigravity 지원의 증거가 아니다.

초기 fixture의 client 정의 변경으로 기존 locator 증거가 무효화되는 실패를 수정하고
보조 policy를 선택했다. 실제 프로젝트 probe의 파일 누락은 async apply/rollback 완료를
기다리지 않은 검증 코드 오류로 재현했다. await를 수정한 뒤 프로젝트 관리 사본의
편집/재가져오기/메타데이터/선택 기록/복원을 자동 시험과 실제 서비스에서 확인했다.

[서비스 왕복](native-skill-variants-service-roundtrip-20261106.json)은 관리 native variant의
편집·업데이트 병합 후 전역 copy·프로젝트 copy·전역 snapshot-link를 적용하고 모든 UI 필드와
아이콘을 읽은 뒤 복원/부재를 관측했다. metadata RPC는 최종 6회이고 모델·Tool/provider
discovery 요청은 0이다. 첫 실패 실행의 global copy 관측 2회도 별도로 기록하며 반복 성공으로
합산하지 않는다.

[실제 브라우저 GUI](native-skill-variants-gui-roundtrip-20261106.json)에서는 격리 HOME의
전역 native copy 계획·원형/추가 노출 미리보기·적용·이력 rollback을 확인했다. 처음 임시
backend의 임의 port에서 정적 GUI를 직접 열었을 때 CORS origin이 지원 범위와 맞지 않아
화면을 실행하지 못했다. 허용된 Vite 3000 origin/proxy로 확인했으며 인증/CORS를 완화하지
않았다. 완료 문구를 잘못 지정한 wait 두 건도 동작 실패와 구분한다. 사용한 TaskSpace와
임시 GUI 서버는 종료했다. 이 증거는 전역 copy 배포 화면에 한정한다.

최종 root **831개**, HTTP **53개**, GUI **91개**, typecheck·desktop frontend/backend build가
통과했다. 새 native 서비스 시험은 7개이며 policy/deps/아이콘/버전/실행 파일/격리 gate와
저장/검증 도중 변경 및 scoped 전제를 다룬다. 중간 HTTP source refresh plan에서 403이
한 번 발생했다. 응답의 앱 출처는 입증되지 않았으며 request ID와 현재 fixture의 request log
대조 진단을 추가했다. 최종 전체 검사에서는 재현되지 않았다. 실패 로그를 유지한다.

사용자 원장·관리 파일·외부 링크 보존은 [체크포인트](native-skill-variants-checkpoint-20261106.json)에
기록한다. 기존 Antigravity 설정 차이 1건과 Codex metadata 차이는 원래 baseline과 구분해
보존한다. 프로젝트 snapshot·다른 native 형식/client/surface·exclusive·관리 해제·추가 discovery
설정과 PR10/07/09/11의 나머지 및 전체 GUI/consumer/Agent 완료 증거는 여전히 남아 있다.
