# Client Adapters

클라이언트 **전용** 설정·어댑터. 공용 kit 자원(`harness/`, `skills/` 등)은 모든 클라이언트에 symlink되고, 여기는 배포 형식이 다른 것만 둡니다.

| 경로 | 클라이언트 | 내용 |
|------|-----------|------|
| `antigravity/` | Google Antigravity | `plugin.json` (플러그인 manifest), 루프 어댑터 |
| `cursor/` | Cursor IDE | 클라이언트별 루프 프롬프트 등 |
| `codex/` | Codex CLI | TOML automations 등 |
| `claude/` | Claude (예정) | Desktop/Code 전용 설정 |

공용 규칙·훅은 `../harness/`에 두고, **“이 클라이언트만 이렇게 배포한다”**는 파일만 이 디렉터리에 추가합니다.
