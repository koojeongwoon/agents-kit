# Dependency coordination v1 — internal transaction engine

2026-11-06. PR10의 등록/해제 transaction과 중단 복구 core 계약이다.
[공개 실행](scoped-deployment-execution-v1.md)이 같은 session·journal·실제 파일 증거를 사용한다. 후속
[native 전제 관측](native-prerequisite-observation-v1.md)은 Codex CLI Skill/MCP의 private
verifier를 연결했다. 사용자 원장을 자동 승격하거나 deployment native gate를 확대하지 않는다.
[scoped 변경 계획](scoped-deployment-compilation-v1.md)은 별도 읽기 전용 compiler이며,
아직 공개 coordinator 집행 권한을 만들지 않는다.
[scoped 영수증 v4 후속](scoped-installation-receipts-v4.md)은 private descriptor·세션의 global
ledger 읽기와 기존 owned 파일의 metadata 등록을 연결했다. 새/upsert v4 consumer는 소유뿐
아니라 실제 전이 revision/binding도 commit 전에 확인한다. 미완전 closure는 project commit을
거절하고 reserved metadata를 복구한다. [공통/typed 설치 예측](deployment-installation-prediction-v1.md)은
새·변경 consumer revision을 내부 적용과 대조한다. native 원형/이관 예측은 후속이다.
[원본 제거 보호](source-dependency-guards-v1.md)는 pin의 현재 Kit 전역 선언과 source lock/journal을
locked 재계획·commit 전/후·완료 복구에서 확인한다. source 제거 쪽도 전역 배포 잠금과 index를
Kit lock 안에서 검사하여 새 등록과 동시에 통과하지 못하게 한다.
후속 [native 문맥 전환](native-context-transition-v1.md)은 같은 workflow의 async executor와
before/after 검증 단계를 제공한다. 실제 프로젝트 설정 적용 후 새 native 관측을 기다려야
등록을 완료하며, 두 scope의 잠금/세션은 대기 완료까지 유지한다. 공개 v3는 별도 실행 서비스가 같은 private 검증기를 연결한다.

## 도메인 변화와 검토 계획

순수 `planDependencyRegistrationChange`가 consumer별 upsert/해제와 공유 prerequisite를
병합한다. 다른 consumer/프로젝트의 pin은 보존한다. 같은 설치 전제의 revision을
사용 중인 consumer를 남긴 채 바꾸는 요청은 거절한다. 누락된 consumer의 해제나
모호한 여러 client/profile 대상도 추정하지 않는다. 반환한 검토 데이터를 바꿔도
입력 index와 다른 프로젝트 기록을 바꾸지 않는다.

프로젝트 등록 generation은 한 번, global index generation은 예약과 완료에 각각
한 번 증가한다. 마지막 소비자가 실제로 제거되면 global index에서 해당 등록을 빼고
프로젝트에는 `status: released`, 빈 consumers/prerequisites의 tombstone을 남긴다.
released는 프로젝트 state에만 허용하며 global index 항목으로 허용하지 않는다.
이력 generation은 재등록 시 이어지고 일반 writer는 tombstone을 지우거나 downgrade할 수 없다.

`planDependencyCoordination`은 물리 origin·양쪽 원장 digest와 원본 bytes/mode fingerprint,
설치 revision/locator/binding, consumer 변화, 예정 target의 before/after image fingerprint,
native prerequisite proof digest를 포함한다. 계획은 무쓰기·무잠금이다. 자원 본문이나
MCP command/args/env/header·credential은 계획/journal에 넣지 않는다.

`verifyPrerequisites`는 신뢰한 내부 adapter의 동기 검증 port다. 기본값이나 누락/미확인
결과로 통과시키지 않는다. 실제 native 관측은 별도로 수집하고 이 port는 고정한 관측의
문맥/입력이 여전히 일치하는지 확인해야 한다. 사용자 JSON flag는 port나 잠금 세션을
만들 수 없다. 격리 시험의 synthetic proof는 실제 client 지원 증거가 아니다.

## 두 scope 집행

`executeDependencyCoordination`은 동일한 검토 계획을 다시 생성해 비교한 뒤 global→project
순서로 잠근다. 잠금을 얻은 뒤에도 상태와 proof를 다시 확인한다. private WeakMap의
세션은 store instance와 실제 lock inode·owner nonce에 묶이며 모든 commit에서 대조한다.

1. 기존 두 원장 bytes/mode를 충돌 없는 private backup에 보관하고 sha를 기록한다.
2. global의 schema 4 coordination journal을 만든다. 원래 client 변경 journal과 구별한다.
3. global index에 reserved/releasing 등록을 쓴다. 아직 바뀌지 않은 이전 전제도 보존한다.
4. 같은 application의 journaled project engine으로 검토한 client 변경을 적용한다.
5. project state commit 전에 실제 consumer 영수증·제거 proof·예정 after image와 native
   proof를 대조하고, 최종 등록/tombstone을 넣는다. child journal의 after-state hash도
   이 최종 metadata를 대상으로 기록한다.
6. project commit과 파일 증거를 확인한 뒤 global index를 active/해제 상태로 완료한다.
7. 완료 marker를 journal에 남긴 뒤 project lock→global lock→journal 순서로 정리한다.

첫 client 파일 변경 전, engine이 만들려는 target 집합과 before/after image를 검토 계획에
대조한다. 추가/누락 target이나 다른 내용을 거절하며 자식 engine의 global client 파일
쓰기도 거절한다. 전역에서 쓰는 것은 index/journal/backup 같은 Kit metadata뿐이다.
ego-browser 같은 외부 링크는 mutation target으로 허용하지 않는다. 일반 copy/merge
저수준 engine이나 별도 prerequisite 변화가 없는 rollback을 이 세션의 권한으로 우회
실행하지 못한다. 기존 단일 scope에서는 해당 API의 동작을 유지한다.

실제 전제 해제는 consumer 파일 또는 관리 block/selector/server의 제거 증거를 요구한다.
metadata만 지우거나 native 파일을 그대로 두는 관리 해제는 이를 대신하지 않는다.
제거만 하는 작업은 새 provider를 활성화하지 않으므로 기존 upstream이 변경/접근 실패해도
새 native proof를 강요하지 않는다. 남은 consumer/전제는 그대로 보존한다.

기록한 원장의 논리 digest뿐 아니라 bytes/mode도 확인하므로 예약 직전 수동으로 고친
metadata나 formatting을 덮어쓰지 않는다. child 실패 중 client target이 before/after
어느 쪽에도 맞지 않으면 자동 rollback을 하지 않고 양쪽 journal/lock을 남겨 수동 편집을
보존한다. 오류 메시지 원문은 journal에 보관하지 않고 안전한 코드만 기록한다.

## 중단과 검토 복구

`planDependencyCoordinationRecovery`는 journal/backup hash·origin·등록 변화 재계산·
lock inode/nonce·owner 상태와 현재 두 원장을 대조하는 읽기 전용 계획이다. 정상 집행
중인 owner는 회수하지 않는다. 오류가 반환되어 세션이 종료됐으면 durable failed marker로
끝난 lease를 구별하므로 장시간 실행되는 daemon을 죽이지 않고도 복구할 수 있다.
SIGKILL로 marker가 없으면 기록한 PID의 사망 증거를 요구한다.

`applyDependencyCoordinationRecovery`는 별도 nonce guard를 잡고 검토 hash를 다시
대조한다. child journal이 남아 있으면 기존 검증된 복구 engine을 사용하되 외부 coordinator의
project lock은 유지한다. 아직 project가 commit되지 않았으면 client의 before image를
복원한 증거와 원본 project state를 확인하고 global metadata의 원본 bytes/mode를 복원한다.
project가 commit됐으면 영수증/target/설치 전제를 확인하고 final index만 완료한다.

완료 marker는 실제 최종 global digest와 project 등록 digest, committed/restored 결과에
맞아야 한다. 예약만 있는 상태를 completed로 바꿔 journal을 버릴 수 없다. 완료 뒤 lock
정리 중 중단된 경우는 이미 검증된 완료 marker를 기준으로 남은 metadata만 정리한다.
복구 중 재중단된 guard는 PID 사망과 inode를 확인하고 atomic no-replace 이동으로
abandoned 증거를 보관한 뒤 다시 획득한다. 살아 있거나 identity가 다른 guard는 보존한다.

변조한 backup·교체한 lock·원장/target/관계 불일치·경로 이탈은 복구를 멈추고 등록과
증거를 남긴다. 경로가 사라졌다는 이유로 참조를 지우지 않는다. 복구 후 `outcome`은
파일/원장 transaction의 결과이며 native 사용 성공이 아니다. `fulfilled: false`,
`nativePrerequisitesState: unverified-after-recovery`를 반환한다.

## 현재 연결 범위와 다음 gate

내부 engine은 임시 client 파일을 사용하는 실제 project apply/remove 및 global/project
metadata transaction으로 검증했다. 예약 전/후, child state 전, project commit 후,
final index/완료 marker/각 lock 해제와 복구 자체 중단을 실제 SIGKILL로 재현했다.
사용자 Kit에서는 과거 schema 6 원장과 schema 2 영수증을 읽기 전용으로만 대조했다.
이는 초기 내부 단계의 기록이다. 이후 [공개 v3 실행](scoped-deployment-execution-v1.md)과
[의존성 rollback/참조 해제](scoped-deployment-rollback-v1.md)를 같은 coordinator에 연결했다.
사용자 기본 Kit의 원장 승격이나 새 index 생성은 하지 않았다.

일반 state 1/2/4/5/6/7의 client 배포·복구는 그대로다. 새 보호에서 일반 쓰기와 검증된
기존 복구 진입점을 구분한다. 등록 state 8은 private coordinator 없이 쓰거나 관계를
변경할 수 없으며, released tombstone/빈 global index를 보존하는 일반 작업만 허용한다.

다음은 native 원형·과거 경로 이관 예측,
전역 설정 변경 후 각 등록 프로젝트 문맥 전환과 별도의 consumer 활성 검증이다.
공개 controller가 지원한 조합만 실행하며 일반 writer의 state 8 차단을 임의로 풀지 않는다.
