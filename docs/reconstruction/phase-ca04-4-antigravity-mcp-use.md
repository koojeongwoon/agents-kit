# CA04-4: 승인된 시험 MCP의 실제 사용과 설정 복원

2026-09-27. 대상: Antigravity CLI 1.2.12, macOS arm64, project, stdio.

**결과: 지침·Skill·stdio MCP의 다섯 단계 모두 통과. 원본 사용자 설정 바이트 복원 확인.**

| 단계 | 지침·Skill | MCP |
| --- | --- | --- |
| baseline | ABSENT 응답 확인 | ABSENT 응답 확인 |
| 적용 | 새 표식과 실제 부속 파일 읽기 확인 | 정확한 시험 도구 호출·표식 확인 |
| 갱신 | 갱신 표식 확인 | 갱신 표식 확인 |
| 제거 | ABSENT 응답 확인 | ABSENT 응답, 호출 없음 |
| rollback | 갱신본 표식·사용 복원 확인 | 갱신본 호출·표식 복원 확인 |

최종 보고서는 `fullLifecycleConfirmed: true`, `temporaryPermission.restored: true`,
`temporaryPermission.originalBytesRestored: true`다. 설정의 임시 허용 항목이 없는 것도
별도 재조회했다. 동시 설정 변경은 관측되지 않았다.

## 실행 조건

사용자가 `mcp(ca04-marker/read_marker)` 하나의 임시 허용과 검증 후 원복을 명시적으로
승인했다. 기존 native 인증을 이용하고, 홈 설정에는 이 허용 항목만 잠시 추가했다.
전체 도구 승인 우회나 기존 Ask/Deny 제거는 하지 않았다.

검증은 기존 Manifest 배포 서비스의 계획·적용·갱신·제거·rollback으로 만든 임시
프로젝트에서 진행한다. 시험 MCP는 임의 파일·명령·네트워크에 접근하지 않고 고정
무작위 표식만 반환한다. 지침·Skill·MCP의 표식은 서로 다르며 질문에는 넣지 않는다.

## 호출 판별

설치본은 MCP 호출을 `call_mcp_tool`로 표시한다. 공개 이벤트의
`tool_info.parameters.ServerName`이 `ca04-marker`이고 `ToolName`이 `read_marker`인
성공한 호출을 확인한 뒤, 도구 결과와 모델 최종 응답의 표식까지 대조한다.
단순히 `call_mcp_tool` 이름이나 최종 응답에 표식이 있다는 이유만으로 통과하지 않는다.
다른 서버·도구, 실패한 호출, `isError: true`인 MCP 반환값은 거절한다.

[실기 결과](ca04-4-antigravity-mcp-use-evidence.json)는 자원 사용과 일시 허용의 복원 결과를
함께 기록한다. 앞선 [CA04-3](phase-ca04-3-antigravity-mcp-permission.md)의 무허용 상태에서
발생한 `MCP_PERMISSION_REQUIRED`도 유효한 대조 증거로 남긴다.

## 임시 허용의 복원

`scoped-permission.mjs`는 시험용 한 규칙만 추가할 수 있다. 기존 설정·파일 모드를
메모리에 보존하고 원자적 교체 직전 현재 바이트를 확인한다. 성공·실패 양쪽 모두
finally에서 복원한다. 동시 변경이 없으면 원래 바이트와 모드를 복원하고, 동시 변경이
있으면 다른 항목을 보존하면서 자신이 추가한 규칙만 제거한다.

명시적인 일치 Ask/Deny, 심볼릭 링크, 잘못된 설정 형식은 거절한다. 소유권을 구별할 수
없는 중복 규칙이나 복원 실패는 성공으로 보고하지 않는다. 이 helper는 시험용이며
일반 자원 배포의 권한 관리나 crash-recovery 트랜잭션을 대신하지 않는다.

## 재현

기본 검증 명령은 사용자 권한을 변경하지 않는다. 아래 옵션은 사용자가 동일 범위의
임시 설정 변경을 명시적으로 승인한 경우에만 사용한다.

```sh
npm run verify:client-use -- --client antigravity \
  --antigravity /absolute/path/to/agy \
  --fixture-permission approved-temporary \
  --output /tmp/antigravity-permitted-use.json
```

보고서의 `temporaryPermission`은 적용/복원 여부와 helper hash를 기록한다.
`isolation.userSettingsWritten: true`는 허용 항목의 일시 변경을 뜻하며,
`temporaryPermission.originalBytesRestored`로 실제 원복을 별도 확인한다.

CLI 전체 지원 게이트는 아직 완료되지 않았으므로 종료 코드 2와 `complete: false`를
유지한다. `fullLifecycleConfirmed`는 이 실행에서 선택한 project 지침·Skill·stdio MCP의
다섯 단계에만 적용한다. 전역·HTTP MCP·커스텀 Agent·앱/IDE·데몬 배포로 확대하지 않는다.

## 회귀 검증

`npm test`: 217 tests 통과. 임시 허용 후 정확한 바이트/모드 복원, 실행 실패 시 복원,
동시 변경 보존, 명시 정책/심볼릭 링크 거절, generic MCP 호출의 정확한 식별을 추가 검증했다.
production runtimeEvidence는 활성화하지 않았다.
