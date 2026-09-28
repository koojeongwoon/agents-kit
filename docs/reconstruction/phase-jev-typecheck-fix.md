# JEV 타입 오류 수정 — 2026-09-25

LM2-4 당시 전체 Gateway 빌드를 막던 TypeScript 오류 10개를 해결했다.
`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 유지했다.

- Zod 변환 이후 기본값을 문자열 대신 boolean으로 지정했다.
- 라우터는 첫 후보의 존재를 확인한 후 단일 후보·fallback 경로에서 재사용한다.
- 허용 도구 목록의 요소 타입을 명확히 하고, 없는 description 속성을 생략한다.
- 테스트의 mock 호출도 존재를 검사한 뒤 접근한다.

기존 설정과 라우팅 동작을 유지한다. 플래그 기본값·명시적 true/false,
후보 없음·알 수 없는 선택, ToolRegistry/ToolRouteMap 각각의 메타 도구 등록과
설명 없는 도구 호출을 회귀 검증했다. 실 JEV 외부 API 호출은 하지 않았다.

전체 TypeScript 빌드 통과. Vitest 263 passed / 8 skipped.
건너뛴 8개는 외부 DB/Redis 환경을 요구하는 기존 통합 시험이다.
LM2-4 PostgreSQL/실 IAM 연동의 이전 실행 증거를 이번 JEV 시험 수에 포함하지 않았다.
원본 코드/시험 5개 파일과 Gateway 상태 문서를 해시 대조 후 반영했다.
운영 배포·commit/push는 하지 않았다.
