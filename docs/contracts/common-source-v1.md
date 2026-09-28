# 공통 지침·Skill 원본 계약 v1

2026-09-27, CA02-3. 기존 native `source` 방식은 유지하며 `definition`을 추가한
자원에만 공통 형식 검사를 적용한다. 실제 클라이언트 로딩 검증과 별개다.

```yaml
assets:
  instructions:
    - id: shared-rules
      scope: project
      source: instructions.md
      definition: {schemaVersion: 1, format: markdown}
  skills:
    - id: source-review
      scope: project
      source: skills/source-review
      definition: {schemaVersion: 1, format: agent-skills}
```

## 검사와 적용

지침은 비어 있지 않은 UTF-8 Markdown 파일이다. Skill은 디렉터리이며 최상위
`SKILL.md`에 YAML frontmatter와 비어 있지 않은 본문이 필요하다.
frontmatter는 `name`과 문자열 `description`만 허용하고 name은 배포 디렉터리의
안정적인 asset ID와 일치해야 한다. YAML 중복 키·alias·알 수 없는 tag·미지원 필드는 거절한다.
이것은 Kit의 보수적인 공통 부분집합이며 각 제품의 모든 native 필드를 허용하는 스키마가 아니다.

부속 파일과 하위 디렉터리는 그대로 복사하지만 내부 symlink·특수 파일은 거절한다.
Skill 최상위 `agents/`는 클라이언트 전용 메타데이터에 의한 실행 의미 차이를 피하기 위해
현재 공통 형식에서 거절한다. 해당 형식이 필요하면 기존 native source 경로를 사용한다.
본문의 임의 링크가 존재하거나 실행 가능하다는 보장, 스크립트 정적 분석은 제공하지 않는다.

지침 frontmatter와 Antigravity inline include 문법 `@[label](path)`는 공통 의미가
확인되지 않아 거절한다. Kit ownership marker, 잘못된 UTF-8, 제어 문자와 인식 가능한
credential literal도 거절하며 오류에 원문을 넣지 않는다. 임의 비밀값을 모두 탐지하는 검사는 아니다.

공통 지침·Skill에 allow/deny/policy를 붙여 런타임 제한으로 해석하지 않는다.
그러한 선언은 거절한다. Skill `requires.tools`는 registry 의존성 검증과 공급자 배포에 사용하며
클라이언트의 권한 부여, 서버 인증, 자동 Skill 호출을 의미하지 않는다.

plan·doctor는 선택된 source만 검사하고 전체 validate는 모든 source를 검사한다.
Codex·Antigravity에만 이 공통 계약을 제공한다. 다른 제품은 미지원으로 차단한다.
두 제품의 지침 우선순위, 컨텍스트 길이 제한, Skill 발견 시점까지 같다는 뜻은 아니다.

Skill은 동일 내용의 미관리 파일도 자동 인수하지 않는다. 지침은 사용자의 일반 본문을
보존하고 Kit 소유 블록만 갱신한다. 이미 있는 미관리 동명 블록은 내용이 같아도 충돌한다.
프로젝트 공유 경로의 소비자 등록·공동 갱신·제거는
[공유 소유권 계약](shared-project-ownership-v1.md)을 따른다. [전역 원장·기존 소유권 이관](global-ledger-migration-v1.md)을 거쳐
전역 공통 배포와 기존 단일 소유권 전환도 지원한다. 기존 native source 방식은 유지한다.

## 공식 근거

- [Codex Skills](https://learn.chatgpt.com/docs/build-skills): SKILL.md의 name/description, 디렉터리 bundle, 별도 agents/openai.yaml 확장.
- [Antigravity Skills](https://antigravity.google/docs/skills): Skill 디렉터리, description과 선택적인 name. Kit의 공통 계약은 name을 필수로 강화한다.
- [Antigravity Rules](https://antigravity.google/docs/rules): AGENTS.md는 plain Markdown이며 rules frontmatter 및 inline include와 의미가 다르다.

## 실행 가능한 예제

[네 자원 bundle](../examples/common-resources/agent-kit.yaml)은 Codex와 Antigravity에서
같은 지침·Skill·Agent·MCP 원본을 계획하는 예제다. endpoint는 `.test` 주소이며 실행 서버가 아니다.
임시 Kit의 `projects/default`에 bundle 전체를 복사해 다음처럼 검토한다.

```sh
node bin/cli.js validate --kit /tmp/example-kit --project /tmp/example-project
node bin/cli.js apply --kit /tmp/example-kit --project /tmp/example-project --client codex --surface cli --dry-run
node bin/cli.js apply --kit /tmp/example-kit --project /tmp/example-project --client antigravity --surface cli --dry-run
```

production profile의 runtimeEvidence가 비어 있으므로 네 자원 모두 자동 적용은 차단된다.
