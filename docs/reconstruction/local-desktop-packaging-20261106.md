# 로컬 데스크톱 배포의 패키징 누락 수정

Agent Kit은 이 Mac에서 사용하는 데스크톱 앱이므로 서버 이미지·GHCR·k3s 배포 경로를
추가하지 않는다. 검증된 소스의 `.app`과 arm64 DMG를 PC에서 빌드하고 사용자 Applications에
설치한다. 기존 클라이언트 설정과 외부 링크·Kit 원장은 설치 대상이 아니다.

## 발견한 배포 문제

기존 Tauri resources에는 `resources/backend.mjs`만 있었다. source checkout 밖에서 실행한
backend가 클라이언트 정의를 읽으려 하면 `/api/clients`가 500을 반환했다. 기존 package smoke의
`/api/session` 성공만으로는 이 누락을 확인할 수 없었다.

패키지 회귀 시험에서 이 실패를 먼저 기록했다. Tauri resource mapping에 `clients` 전체를
포함하고 native launcher가 전달하는 resource root를 backend context가 사용하도록 수정했다.
개발 실행의 기본 project root와 명시적으로 전달한 context 옵션의 우선순위는 유지한다.
설치 경로나 사용자 클라이언트 설정을 바꾸는 기능은 추가하지 않는다.

## 검증과 빌드

`gui/server/test/packaged-backend.test.js`는 실제 backend를 bundle한 뒤 Tauri resource 선언대로
임시 `.app/Contents/Resources`를 구성한다. checkout과 무관한 작업 디렉터리와 빈 HOME에서
실행해 `/api/clients` 200, Codex·Antigravity 정의와 nested native policy 파일 포함을 확인한다.
HOME과 Kit 디렉터리가 생성·변경되지 않음도 확인한다. 시험은 기존 HTTP 기본 검사에 포함한다.

로컬 빌드는 커밋된 소스에서 `npm --prefix gui run tauri:build -- --bundles app,dmg`로 수행한다.
설치 전에는 앱의 정의 파일·native binary·서명과 DMG 구조를 확인한다. 설치 후 실제 창과
bundled backend의 클라이언트 목록을 확인하고 기존 설정·ego 링크·원장을 시작 지문과 대조한다.
코드 서명은 기존 로컬 ad-hoc 범위이며 공개 배포용 Apple notarization을 새로 설정하지 않는다.
