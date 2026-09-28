# 데몬 관리 작업 공통 fixture v1

[계약](../../architecture/daemon-management-jobs-v1.md)의 LM3-1 상호운용 시험 자료다.
`profile.json`은 제한 프로필, `vectors.json`은 실제 Ed25519 JWS를 포함한 58개 사례다.
서명 키는 생성 중 메모리에서만 사용하고 폐기했다. 저장된 키는 공개키뿐이며 ID·URL·승인은
합성 데이터다. 부정 사례의 `d` 필드는 비밀키가 아닌 금지 필드 시험 문자열이다.

Gateway `experiments/management-jobs/generate-fixtures.ts`로 생성한다. 재생성하면 무작위
공개키와 서명이 달라지므로 세 저장소에 같은 파일을 배포하고 검증해야 한다.

- 기준 사본: Kit `docs/contracts/daemon-jobs-v1/vectors.json`
- Gateway: `test/fixtures/daemon-jobs-v1/vectors.json`, `test/daemonJobs.test.ts`
- 데몬: `docs/contracts/daemon-jobs-v1/vectors.json`, `src/management_jobs/tests.rs`

각 사례는 compact JWS, 외부 신뢰 키/바인딩, 검증·계획 시각, 현재 자원 상태, 원장 기록,
기대 결정/오류를 제공한다. Gateway와 데몬은 각자의 실제 검증·계획 코드로 같은 사례를 실행한다.
Kit 시험은 문서/fixture 무결성과 실제 서명·변조를 확인하며 서비스 검증기를 대신하지 않는다.

`node --test test/management-job-contract-fixtures.test.js`로 Kit 시험을 실행한다.
검증 결과는 작업 계획이며 실제 승인 권한·전달·원장·집행·종료를 구현한 증거가 아니다.
