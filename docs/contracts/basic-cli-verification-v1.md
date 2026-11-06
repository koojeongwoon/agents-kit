# Basic CLI verification v1

PR07 S04-2의 기본 범위는 두 클라이언트의 CLI × 전역/프로젝트 × 지침/Skill/
Agent/MCP stdio다. HTTP·인증, snapshot 링크, desktop/IDE는 독립 프로필이다.
같은 파일을 읽거나 같은 버전 문자열을 보고 지원을 확대하지 않는다.

## 증거와 활성화

각 조합은 baseline → applied → updated → removed → rollback의 다섯 단계를
검사한다. 배포·복원은 공통 application service와 실제 원장의 byte/mode/ownership,
lock/journal을 검사한다. native 인식·모델 응답·프로세스 실행은 별도 판정한다.
최종 fixture 정리도 성공해야 한다. 활성화 레코드는 client/surface/scope/kind,
platform/arch, 정확한 version과 실행 파일 SHA-256, 필요한 자원 profile/전략을
고정한다. 과거 보고서나 합성 fixture가 새로운 빌드의 증거를 대신하지 않는다.

- 지침은 로드된 context의 불투명 marker를 응답해야 한다. 모델이 지침 파일을
  직접 읽으면 실패다. 별도 목록 API가 없는 경우 positive native recognition은
  not-applicable이며, 모델 응답에 의한 실효 로딩 증거와 구분한다.
- Skill은 설치된 `references/marker.txt`의 직접 읽기와 정확한 최종 응답이 필요하다.
  Kit source·다른 파일 읽기, 복합 shell 명령은 허용하지 않는다.
- MCP는 지정한 로컬 fixture 도구의 실제 반환과 정확한 최종 응답이 필요하다.
  설정에 서버 이름이 있거나 모델이 이름을 반복한 것만으로 통과하지 않는다.
- Agent는 지정한 역할 호출과 자식의 공개 완료 응답을 직접 관측해야 한다.
  부모의 응답, 자식 시작 알림, 주 Agent 목록만으로 승격하지 않는다.

`--stop-on-failure true`는 첫 실패 후 후속 모델 호출을 중단하고 원상 복원한다.
`--check-only true`는 모델을 호출하거나 설치하지 않고 계획만 검사한다.
실제 호출 수와 요청한 subset, 복원 여부를 보고서에 남긴다. 원시 transcript와
hidden reasoning, 로그인 자료를 복사하거나 저장하지 않는다.

## 목록 명령의 범위

`mcp list`의 실행 성공은 모든 scope를 나열한다는 증거가 아니다. Antigravity
1.5.1의 새 HOME에서 전역/프로젝트 대조군을 함께 설치한 결과, empty cwd와
프로젝트 cwd 모두 전역 서버만 나열했다. 이 결과는 해당 실행 파일 hash와 묶고
검증 후 대조군이 복원됐는지까지 확인한다.

이 빌드의 프로젝트 목록 결과는 `not-observed`로 남긴다. supplemental list의
실행 오류는 여전히 중단 사유다. 해당 scope의 실제 MCP 도구 반환과 모델 응답이
별도로 통과해야 전체 사용 검증이 성공한다. 범위 미관측을 `passed`로 바꾸지 않는다.
대조군이 없거나 다른 빌드·플랫폼·미복원 보고서이면 이 예외를 적용하지 않는다.

## 실제 HOME의 임시 검증

전역 fixture는 `--native-global temporary-fixtures`를 명시해야 한다. 기존 설정을
통째로 교체하거나 기존 native owner를 일반 typed 소유권으로 전환하지 않는다.

- 전역 지침은 무작위 asset ID의 관리 블록만 공통 merge service로 적용한다.
  기존 내용과 mode를 최종 복원한다. native-owned 충돌은 계속 차단한다.
- 전역 MCP는 client-neutral definition을 정식 adapter로 렌더링한 뒤, 기존 원장의
  native 소유권과 충돌하지 않는 새 selected server만 import/adopt한다. Kit 사본
  편집→적용→임시 부재→rollback→전체 복원을 수행하고 등록을 해제한다.
  fixture seed/부재도 before hash/state precondition이 있는 명시적 transaction이다.
  이 증거는 렌더링과 native 설치의 왕복을 확인하며, 기존 native owner를 일반 typed
  apply로 자동 인수할 권한은 주지 않는다. typed 일반 경로는 격리 service 회귀로 검사한다.
- Antigravity fixture MCP의 허용은 해당 프로세스의 `--settings`에만 지정한다.
  사용자의 전역 permission과 인증은 수정하지 않는다.
- concurrent edit나 미확인 소유권이 있으면 덮어쓰지 않고 복원 자료를 보존한다.
  원장과 backup 이력은 남기며 schema를 이전 버전으로 내리지 않는다.

정상 rollback도 설정 파일을 원자적으로 교체할 수 있으므로 inode/mtime와 내용·mode의
보존을 구분해 보고한다. ego-browser 등 외부 링크는 대상 내용과 링크 identity 모두
관측만 하며 업데이트·인수·교체하지 않는다.

## 명령

프로젝트 기본 자원:

```sh
node scripts/verify-client-use.mjs --client codex --codex /absolute/codex \
  --native-discovery true --stop-on-failure true --output new-project-report.json
node scripts/verify-client-agents.mjs --client codex --codex /absolute/codex \
  --scope project --codex-transport app-server --stop-on-failure true --output new-agent-report.json
```

Antigravity 프로젝트 MCP의 목록 범위는 해당 빌드의 대조군을 지정한다:

```sh
node scripts/verify-client-use.mjs --client antigravity --antigravity /absolute/agy \
  --session-permission fixture-mcp --native-discovery true \
  --mcp-list-evidence docs/reconstruction/antigravity-mcp-list-scope-control-20261106.json \
  --stop-on-failure true --output new-project-report.json
```

전역 지침과 MCP:

```sh
node scripts/verify-client-use.mjs --client antigravity --antigravity /absolute/agy \
  --scope global --resources instructions --native-global temporary-fixtures \
  --stop-on-failure true --output new-instructions-report.json
node scripts/verify-global-mcp.mjs --client codex --codex /absolute/codex \
  --native-global temporary-fixtures --stop-on-failure true --output new-mcp-report.json
```

MCP의 기존 `verify-antigravity-mcp.mjs` 진입점은 Antigravity 기본값으로 유지한다.
이 명령들은 필요 시 별도 실제 검증에만 사용한다. 통과한 증거를 코드 변경과 무관하게
반복하기 위한 정규 test 명령에 포함하지 않는다.
