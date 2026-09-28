# CA02-3: 공통 지침·Skill 검증과 Agent 설정 연결

2026-09-27. 상태: **네 자원의 최소 공통 계약과 확인된 Codex 설정 변환 완료. 실기 및 고급 권한 매핑은 미완료.**

## 결과

- 기존 native source 호환을 유지하는 opt-in 지침·Skill source 계약.
- 공통 Skill의 필수 metadata, 이름/디렉터리 일치, UTF-8, 안전한 bundle 검사.
- 지침의 공통 Markdown 검사와 사용자 본문 보존. 미관리 동일 블록/파일 자동 인수 거부.
- Agent/Skill 논리 도구 요구 → MCP 공급자 및 명시적인 nativeName → Codex Agent의 provider별 도구 목록.
- Codex 읽기 전용 sandbox 기본값. 부모 설정에 덮어써질 수 있고 전체 Agent 보안 정책이 아님을 preview에 표시.
- Antigravity에서 해당 고급 mapping은 미검증으로 차단. 기본 Agent와 공통 지침·Skill·MCP는 계속 제공.
- CLI·HTTP·GUI가 동일한 plan/loader/검증 및 preview 계약 사용.

[공통 source 계약](../contracts/common-source-v1.md) · [Agent 확장](../contracts/agent-definition-v1.md) ·
[네 자원 예제](../examples/common-resources/agent-kit.yaml)

## 검증

임시 profile에서 같은 네 자원 fixture를 두 제품 각각에 적용했다. 사용자 AGENTS.md 보존,
Skill 부속 파일 복사, 재계획 SKIP, rollback과 native tool 이름 변환을 확인했다.
잘못된 frontmatter·scope/의존성·미지원 정책·optional 도구·중복/누락 native 이름,
심볼릭 링크와 사용자 소유 파일 충돌을 거절한다.
CLI/HTTP production profile은 계속 미검증이며 파일을 쓰지 않는다.

최종 명령 결과는 아래 표에 기록한다. fixture 성공을 실제 클라이언트 인식 증거로 사용하지 않는다.

| 검증 | 결과 |
| --- | --- |
| `npm test` | 150 tests 통과 |
| `npm --prefix gui run test:server` | 16 tests 통과 |
| deployment panel + API tests | 8 tests 통과 |
| `npm --prefix gui run typecheck` | 통과 |
| `npm --prefix gui run build:desktop` | frontend/backend bundle 통과, Tauri native 빌드 아님 |
| 독립 Python tomllib | 생성 Agent의 sandbox 기본값·provider별 native 도구 목록 파싱 통과 |
| `git diff --check` | 통과 |

## 다음

CA03의 공유 경로 소유권·소비자 집합·제거·이관·지속 계획을 진행한다.
Agent 강제 정책, Skill preload와 모델 mapping, Antigravity 고급 도구 mapping은
지원 가능성이 검증될 때 별도 확장한다. 실제 surface별 인식은 CA04/05,
승인된 daemon 자원 배포 작업은 CA06 범위다. 실제 홈 설정과 daemon 계약은 변경하지 않았다.
