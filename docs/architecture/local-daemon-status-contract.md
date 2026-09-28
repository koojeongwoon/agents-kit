# Local daemon status v1 (LM1)

Status: implemented and locally verified on macOS, 2026-09-25.

## Ownership and transport

CLI `daemon-status` and authenticated `POST /api/daemon/status` call
`createLocalDaemonStatusService().status()`. The home screen polls every five
seconds, independently of Manifest/project selection. Existing standalone
configuration/deployment remains usable without a daemon.

The operator configures `AGENTS_KIT_DAEMON_BINARY` and
`AGENTS_KIT_DAEMON_SOCKET` as absolute paths in the Kit process environment.
`AGENTS_KIT_DAEMON_UID` is an optional explicit non-root UID; omission means the
current UID. These are local installation inputs, never Manifest, HTTP body or
query parameters. The configured binary is trusted executable code, not a
user-supplied remote path. The future installer owns provisioning these values.

Kit launches only `tools-daemon worker-status SOCKET [--daemon-uid UID]`, with
no shell, a four-second deadline and a 64 KiB output limit. The native adapter
checks the socket peer's kernel UID and running code **before** sending anything.
The live worker listener verifies the client UID/code using the existing boundary.
The adapter and listener must come from the same build. Node does not bypass
native verification or read the daemon's protected state files.

Native request (one newline-terminated JSON frame):

```json
{"jsonrpc":"2.0","id":"kit-status-v1","method":"daemon/status","params":{"schemaVersion":1}}
```

This method is available on `enforce-worker-listen`, not the experimental
`demo-management-listen`, fixed-ping listener, or public MCP tools/list. Its
handler does not accept policy, write audit, issue execution commands or start
workers. The existing MCP stdio adapter does not expose this method.

## Projection

The native command emits `{schemaVersion: 1, connection: "connected", status}`
or a fixed error code. The common Kit service validates and projects an
allowlist into:

- `schemaVersion`, `checkedAt` (Unix ms), `staleAfterMs: 10000`.
- `connection`, stable `code`, safe remediation `message`.
- `snapshot` or null: daemon version, `native_mcp_worker` scope, observation
  time, known capabilities, policy state/revision/expiry, execution preflight
  state/reason and up to 20 recent audit events.
- Events contain sequence, fixed kind, timestamp and policy revision only.
  There are no paths, free-form audit reasons, tool arguments/results, policy
  text, tokens or keys. Unknown fields are dropped; unsupported required
  values/versions and malformed/oversized data fail closed.

Connectivity is **not** execution authorization. `preflight_passed` means the
current signature/time, previously accepted policy history, listener binding,
artifact and audit checks passed. Every call must recheck admission, storage,
executor availability and runtime isolation. Status never starts a tool to
prove it can run. An unaccepted/new revision is `unverified` until the normal
execution path accepts it; polling must not advance the policy checkpoint.

An expired policy can still return `connection: connected` with
`execution.state: blocked` and `POLICY_EXPIRED`. Signed expiry metadata can be
shown after expiry; unverified signatures never provide trusted policy metadata.
Recent events are retained across restart by the existing bounded journal.
Unreadable/poisoned audit history is not projected as trustworthy history.

Each failed observation clears the previous snapshot. Concurrent requests share
only the in-flight read, never a persisted success cache. The UI marks observations
older than ten seconds as unverified, and recalculates expiry while awaiting the
next response. Native listener serialization can produce a timeout during a long
worker call; timeout is not proof that the process has stopped.

## Surface and compatibility

HTTP is POST to use the existing local session-token boundary, despite being
read-only. It returns `Cache-Control: no-store`; request overrides are rejected.
HTTP 200 describes a completed status query even when the daemon is unavailable.
The CLI prints the identical contract: exit 0 for a connected status (which may
be execution-blocked), exit 1 when no compatible authenticated status is available.
Scripts must inspect `snapshot.execution`, not infer authorization from exit 0.

Missing daemon, timeout, permission denial, rejected peer, incompatible status
schema and failed/old adapter are distinct stable codes. An older binary without
`worker-status` fails as `DAEMON_ADAPTER_FAILED`; it is never considered healthy.
Only the native macOS peer-verification profile has been exercised here.

## Verification and next boundary

See [LM1 verification](../reconstruction/phase-lm1-local-daemon-status.md).
LM2 adds IAM device registration and the separate Gateway management channel.
It must not replace this local observation with a Gateway availability dependency,
and must not treat status/heartbeat as proof of a particular remote MCP call.
Installation, dedicated-account status trials, production signing/upgrades,
central management and whole-PC control are separate gates.
