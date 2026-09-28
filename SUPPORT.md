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

Codex and Antigravity are the primary reconstruction targets. Their schema 2
client definitions separate CLI/app/IDE file contracts from runtime evidence.
CA04-7 activates these **CLI profiles on macOS arm64**, gated by the exact
reviewed native executable SHA-256 as well as version and capability:

| Client | Activated resources |
| --- | --- |
| Codex CLI 0.145.0 | Project instructions, Skills, basic stdio MCP, basic Agent roles; global Skills |
| Antigravity CLI 1.2.12 | Project instructions, Skills, basic stdio MCP; global Skills |

MCP requires a typed stdio definition without environment forwarding. Codex Agent
roles require a typed definition with client-default permissions and no sandbox
or MCP tool defaults. Native MCP/Agent source files, HTTP, unverified options,
other versions/builds/platforms, global instructions/MCP/Agents, and app/IDE
profiles stay blocked. Native client trust and tool approvals still apply;
Kit does not change them. [Activation scope](docs/reconstruction/phase-ca04-7-cli-activation.md).
Directory or executable presence alone is not runtime support. Antigravity app
MCP remains manual/UI-only; Antigravity IDE Agents remain unverified.

Local CA04-1 observations on macOS arm64 cover Codex CLI 0.145.0 Skill discovery
and direct client MCP calls in project/global scopes, plus Antigravity CLI 1.2.11
global MCP configuration listing. These are **partial observations**, not complete
model/Agent execution or desktop/IDE support. Those observations alone did not activate runtime profiles.
See [the recognition evidence](docs/reconstruction/phase-ca04-1-cli-recognition.md).
CA04-2 additionally tests project instructions/Skills with existing native logins
and Codex model-selected stdio MCP calls. CA04-4 adds Antigravity 1.2.12 project
stdio MCP model calls with explicit temporary permission and verified restoration
of user settings. See [CA04-4 evidence](docs/reconstruction/phase-ca04-4-antigravity-mcp-use.md).
[CA04-5](docs/reconstruction/phase-ca04-5-cli-agent-use.md) adds project Agent marker
response evidence and Antigravity custom-role invocation (the update repeat was
rejected for an unexpected `schedule` tool). Direct child completion
was unconfirmed at that stage. [CA04-6](docs/reconstruction/phase-ca04-6-agent-completion-global-skills.md)
confirms Codex child completion through live App Server subscriptions and both CLI
global Skill lifecycles. Antigravity CLI 1.2.12 required `~/.gemini/config/skills`;
its CLI profile now uses that shared path. Existing legacy files are preserved,
and CA04-7 activates only the reviewed slices listed above.
Antigravity headless MCP soft-denial is now
reported explicitly as `MCP_PERMISSION_REQUIRED`; exit 0 is not tool-use proof. See [the exact model-use scope](docs/reconstruction/phase-ca04-2-cli-model-use.md).

Other schema 1 definitions retain their existing capability behavior. Their
`verified` evidence denotes documentation, not an independently completed
client runtime test. Claude support is a follow-up, not a prerequisite for the
Codex/Antigravity implementation.

See [the schema 2 contract and compatibility migration](docs/contracts/client-definition-v2.md)
and [the primary implementation plan](docs/product/codex-antigravity-implementation-plan.md).

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

## Kit GUI workflow verification

[CA04-8](docs/reconstruction/phase-ca04-8-gui-workflow.md) verifies the built browser GUI against the actual deployment service: both CLI project profiles and global Skills, apply/removal/rollback, shared-resource preservation, and blocked app requests. This is not native Tauri or target-client app/IDE runtime verification.

## Immutable resource inputs

[CA06-1](docs/reconstruction/phase-ca06-1-resource-bundle.md) adds `bundle` export
and a fixed same-user prepare/apply helper using the existing deployment service.
Hash checks, local target bindings, MCP recipe allowlisting, persistent review
receipts and crash recovery are tested. This helper is not connected to Gateway
or daemon job delivery; it provides no remote authorization. Its successful result
means files applied, with client recognition explicitly unverified. See the
[bounded v1 contract](docs/contracts/resource-bundle-v1.md).
