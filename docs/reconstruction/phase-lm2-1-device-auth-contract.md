# LM2-1 — 기기 신원·관리 채널 인증 계약

날짜: 2026-09-25. **계약 단계 완료. 실제 IAM 등록·발급, 데몬 인증,
Gateway 관리 채널은 다음 단계이며 G-1A/G-2는 통과하지 않았다.**

## 산출물

- [관리 인증 v1](../architecture/daemon-management-auth-v1.md): client/resource/scope,
  namespaced 기기 claim, 등록→관리 승인 흐름, 동일 등록 키 DPoP,
  refresh·회수·상태 조회·오류·수명 기준.
- [공통 fixture](../contracts/daemon-management-v1/README.md): 기계 판독 프로파일,
  등록 요청/응답 모양, 실제 서명된 합성 JWT/DPoP, 관리 변형 사례 30개 및
  수명주기·호환·격리 시나리오 23개. 사례는 구현팀이 실행할 기대 결과다.
- [fixture 무결성 검사](../../test/device-auth-contract-fixtures.test.js):
  공개키 서명, JWK thumbprint, token hash, 신원 연결, 서명 변조 실패,
  private JWK 부재 및 카탈로그 일관성. production verifier는 추가하지 않았다.
- 기존 상위 인증 결정, 세 구성 요소 계획과 추적표를 LM2-1 확정/LM2-2 다음으로 갱신했다.

## 소스 확인과 필요한 변경

- IAM HEAD `e70902e90f8e3f4d2fa5582ea2229994b3ba39fe`.
  `UserDevice`는 접속 지문 모델이다. resource validator, audience customizer,
  public refresh, 정확 redirect validator와 수동 tenant discovery에서 새
  관리 프로파일이 필요한 변경 지점을 확인했다. 기존 SAS 발급 경로의 조직
  claim과 등록 키 바인딩은 별도 추가가 필요하다.
- Gateway HEAD `d346d56f64480f0e88babd11e0df9f3e46729344`.
  현재 MCP는 Bearer 토큰의 JWT/scope/사용자·서비스 접근 검사 경로다.
  요청별 DPoP/관리 route와 IAM 기기 상태 조회는 새 경로로 구현해야 한다.
- tools-daemon에는 아직 Git HEAD가 없다. Cargo 의존성과 worker 구현을
  읽었으며 LM1 상태 조회와 기존 정책 서명을 관리 채널 인증으로 간주하지 않았다.
- 세 저장소는 읽기만 했다. 배포·고객 IdP·OS 키 저장소·실서버 인증을
  실행하지 않았다. 기존 작업 파일과 운영 설정은 보존했다.

## 검증

- `npm run test:device-contract`: 7/7 통과.
- `npm test`: 103/103 통과(위 7개 포함).
- 이번 변경 문서의 로컬 링크와 whitespace 확인 통과.
- UI/daemon/IAM/Gateway runtime 변경이 없어 해당 통합 빌드/배포 시험은
  이번 단계의 통과 증거에 포함하지 않는다.

30개 변형 사례의 실제 서비스 거부와 23개 시나리오의 DB/네트워크 동작을
통과했다고 보고하지 않는다. 15초 회수 기준은 채택한 시험 기준이며 아직
측정한 운영 SLA가 아니다. ES256 샘플 검증은 OS 비추출 키 지원 증거가 아니다.

## 다음: LM2-2 IAM 수직 구현

1. 등록부/키/도전/회수 모델과 DB 제약을 추가하고 접속 이력 `user_devices`를 보존한다.
2. 등록된 native client·resource 계약, 검증된 조직 grant, DPoP key 검증을
   기존 발급 경로에 연결한다. 임의 resource 허용이나 전역 redirect 완화는 금지한다.
3. 등록→발급→재시작 후 refresh→제한된 상태 조회→회수→refresh 거부를
   IAM DB 포함 시험으로 검증한다. 관리 프로파일에서 기존 서비스 접근
   enforcement 비활성화가 권한 우회가 되지 않도록 검사한다.
4. 카탈로그 I01~I17 및 기존 일반 서비스/MCP 로그인·갱신 회귀를 실제 구현에
   연결하고 증거를 기록한 다음 LM2-3으로 진행한다.

운영 client/entitlement 생성 및 사용자 기기 등록은 실제 도입 절차에서 수행한다.
