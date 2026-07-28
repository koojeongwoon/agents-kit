# Platform support

## Supported runtime

| Platform | Node CLI | Tauri desktop |
|---|---|---|
| macOS Apple Silicon | Supported | Supported |
| macOS Intel | Supported | Build verification required |
| Linux | Supported | Planned verification |
| Windows | Supported | Planned verification |

Required software:

- Node.js 20 or newer
- Rust stable and platform-native Tauri dependencies only when building the desktop app

The desktop bundle packages the Express backend as a JavaScript resource and
starts it automatically. Node.js must still be available on the target system;
set `AGENTS_KIT_NODE` when it is not available as `node` on `PATH`.

## Supported clients

The current verified client-definition set is:

- Codex
- Claude Code

Other clients are not inferred from local directories. Adding one requires a
versioned client definition, capability evidence, and deployment tests.

## Security boundary

The local API binds only to `127.0.0.1:3710`, restricts browser origins, and
requires an ephemeral session token for mutation requests. Do not expose this
port through a reverse proxy or port-forward (do not expose port 3710). The
local control-plane API is not safe on shared machines with untrusted local
processes.

Manifest sources must remain inside their scope root. Credentials must be
provided by their target runtime through environment references and must not be
stored as literal Manifest values.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
