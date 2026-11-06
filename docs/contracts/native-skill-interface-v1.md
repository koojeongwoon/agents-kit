# Codex native Skill UI metadata 계약 v1

2026-11-06, C07/T27/AK-SR38. 검증된 Codex CLI의 `agents/openai.yaml` UI metadata를
원형으로 배포한다. 호출 정책·native Tool 의존성·다른 client 형식은 아직 지원하지 않는다.
[대상·호환성 계약](skill-distribution-v1.md)과 [variant 원본 관리](skill-variant-sources-v1.md)를 함께 따른다.

## 선언과 경계

Skill definition 3의 native variant에 명시적인 format profile을 추가한다.

```yaml
id: codex
source: codex
format: native
native:
  schemaVersion: 1
  clientId: codex
  profile: codex-skill-interface-v1
compatibility: [] # 배포 전에 정확한 버전과 현재 tree/declaration의 작성자 검토 필요
```

기존 native variant는 이 선언이 없으면 여전히 배포를 차단한다. 선언을 추가해도 작성자 검토,
client/surface·버전·실행 파일 SHA-256·플랫폼·전략 증거가 모두 맞아야 한다. `shared` 노출을
명시하며 대상 선택을 격리 증거로 쓰지 않는다. 다른 client를 지정해 동일한 metadata를 배포하지 않는다.

adapter는 SKILL.md의 기존 name/description과 본문 및 `agents/openai.yaml`을 bounded bytes로
검사한다. 이 profile은 interface의 display_name, short_description, brand_color, default_prompt,
icon_small, icon_large만 허용한다. 아이콘은 같은 선택 bundle의 일반 파일이어야 한다.
원본 바이트·파일 모드를 변환하거나 metadata를 제거하지 않는다.

[공식 Codex Skills 문서](https://learn.chatgpt.com/docs/build-skills)의 UI 필드를 참고하고,
설치된 실행 파일의 `skills/list` 응답으로 실제 파싱을 별도로 확인했다. 같은 문서의 invocation
policy와 Tool 의존성은 현재 RPC에서 충분한 정책 증거를 얻지 못했으므로 지원하지 않는다.
`policy`·`dependencies`·알 수 없는 확장·다른 agents metadata·중복 YAML key·alias·범위 밖
아이콘·잘못된 UTF-8은 배포 전에 거절한다. source 관리에서는 해당 파일을 그대로 보존한다.

## 데이터 정의와 설치 증거

`clients/native-skills/codex-cli.yaml`의 보조 정의는 schema/client/surface/configStore/profile과
capability/strategy/version/binarySha256/platform/arch별 증거를 갖는다. 기존 client 경로 정의와
locator digest는 변경하지 않는다. 해당 증거 파일이 없거나 잘못됐거나 조건이 다르면 차단한다.

native 선택은 selection 3으로 native 선언, nativePolicyDigest, 명시적인 sourceBase(asset/kit),
source와 optional managed revision을 reviewDigest에 묶는다. transaction의 선택 receipt 1/2와
기존 설치 receipt의 schema/의미는 유지한다. 보조 정의 변경은 일반/scoped 계획과 저장 계획을
무효화하며, 현재 전역 선택을 프로젝트 전제로 확인할 때도 같은 증거 digest를 요구한다.
작성자 검토·설치 증거·native 발견·모델 사용은 별개다.

## 검증 범위

현재 증거는 Codex `0.166.0-alpha.6`, darwin/arm64,
SHA-256 `508388df35319042107560d095b271a98a512f59a542848c908b23ed1bad4b44`의
전역 copy·프로젝트 copy·전역 snapshot-link 세 조합이다. 프로젝트 snapshot-link, desktop/IDE,
Claude와 Antigravity native profile은 이 증거로 승격하지 않는다.

[실제 서비스 왕복](../reconstruction/native-skill-variants-service-roundtrip-20261106.json)은
variant 등록·편집·재가져오기·병합 후 적용, 여섯 UI 필드와 로컬 아이콘 발견, rollback 후 부재를
확인한다. metadata RPC 6회이며 provider discovery/model/Tool 호출은 없다.
[실제 브라우저 왕복](../reconstruction/native-skill-variants-gui-roundtrip-20261106.json)은
격리 HOME의 전역 copy 계획·미리보기·적용·이력 복원을 확인한다. 전체 GUI 흐름의 완료를 뜻하지 않는다.
설정과 외부 링크는 각 격리 환경에서 보존하고 사용자 HOME에는 적용하지 않는다.

실행은 `node scripts/client-verification/skill-distribution-fixture.mjs --native --managed --binary <절대 경로>`다.
자동 시험은 `test/native-skill-variants.test.js`, `test/http-error-mapper.test.js` 및 GUI preview 시험이다.
정책·Tool 의존성 지원, 추가 client/surface, exclusive 격리와 관리 해제는 후속 범위다.
