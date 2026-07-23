# Platform support

## Supported runtime

| Platform | CLI and browser GUI | Tauri desktop bundle | GitHub CLI install button |
|---|---|---|---|
| macOS Apple Silicon | Supported | Supported | Homebrew |
| macOS Intel | Supported | Build verification required | Homebrew |
| Linux | Node CLI supported | Planned verification | Manual `gh` installation |
| Windows | Node CLI supported | Planned verification | Manual `gh` installation |

Required software:

- Node.js 20 or newer
- Git
- GitHub CLI for GitHub login, repository creation, push, and pull
- Rust stable and platform-native Tauri build dependencies only when building the desktop app

The current desktop bundle packages the Express backend as a single JavaScript resource and starts it automatically. It does not depend on Vite or another development server. Node.js 20+ must still be installed on the target machine; set `AGENTS_KIT_NODE` when the executable is not available as `node` on `PATH`.

## GitHub CLI installation

The GUI install button currently performs automatic installation only when Homebrew is available on macOS.

- macOS: `brew install gh`
- Linux: use the package instructions at <https://github.com/cli/cli/blob/trunk/docs/install_linux.md>
- Windows: `winget install --id GitHub.cli`

After installation, use the GUI login button or run:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git --hostname github.com
```

Automatic Linux and Windows package-manager adapters are not yet implemented. The GUI returns a platform-appropriate manual-install message instead of attempting an unsupported install.

## Security boundary

The local API binds only to `127.0.0.1:3710`, restricts browser origins, and requires an ephemeral session token for mutation requests. Do not expose this port through a reverse proxy or port-forwarding tool.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

