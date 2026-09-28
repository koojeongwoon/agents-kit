# LM1 — Local daemon status

Date: 2026-09-25. Starting Kit HEAD: `02ac6bd64c6d8111aaa2309e3611384dc8aed791`.
Existing Claude Code definition edits and security planning documents were present
at start and were preserved. No production configuration or system service was
installed, no credentials were changed and no IAM/Gateway changes were made.

## Delivered

- One Kit application service used by `daemon-status`, the authenticated local
  HTTP endpoint and the home-screen panel.
- A versioned, read-only native status request on the actual worker listener,
  reached through its UID/code-verifying native adapter.
- Version/capability, policy revision/expiry and recent event metadata, with
  connectivity independent of per-call execution authorization.
- Bounded reads, safe error codes, rejection of request-supplied connection
  overrides, no success-cache reuse after failures, UI stale/expiry handling.
- No policy acceptance, checkpoint update, audit append or managed worker launch
  caused by status queries. Existing deployment behavior remains independent.

Contract: [local daemon status v1](../architecture/local-daemon-status-contract.md).
Daemon implementation is in the sibling `tools-daemon` repository; its
`docs/local-status-v1.md` describes the native endpoint and build coupling.

## Evidence

- `npm run test:all`: root tests 96/96, HTTP/server tests 12/12, desktop frontend
  and backend bundles, Tauri `cargo check` passed.
- `npm --prefix gui test`: 21/21, including five state-panel tests and two
  authenticated status API contract tests.
- `npm --prefix gui run typecheck`: passed.
- Daemon `cargo test`: 65/65; fmt and all-target Clippy with `-D warnings` passed.
- [`scripts/test-local-daemon-status.py`](../../scripts/test-local-daemon-status.py): actual same-user macOS listener,
  signature verifier, native adapter, Kit CLI and authenticated HTTP. Covers
  absent daemon; valid observation without state writes; wrong UID; actual
  socket permission denial; SIGKILL/stale-socket restart; time-based policy
  expiry; revocation; signature tampering; CLI/HTTP parity; zero worker launches.
  The [saved result](lm1-native-status-evidence.json) was produced using the
  updated sibling repository's real binary. Its 15 changed source/document files
  matched the tested staging copy by SHA-256; the sibling binary build and fmt
  check also passed.
- Browser: home screen rendered correctly with the unconfigured daemon state,
  local-use explanation and refresh control. Connected/blocked/stale transitions
  are covered by component tests plus the real native-to-HTTP integration.
- Tests requiring Unix/listening sockets initially failed with sandbox `EPERM`;
  reruns with filesystem/network permission passed. No authorization checks were
  removed to make them pass. Rejected browser origins retain the existing HTTP
  500 mapping and never reach the daemon service.

Reproduce from Kit after building the sibling daemon binaries/examples:

```sh
npm run test:all
npm --prefix gui test
npm --prefix gui run typecheck
python3 -B scripts/test-local-daemon-status.py --daemon-root ../tools-daemon
```

This completes LM1 for the existing experimental native-worker/macOS profile,
not daemon installation or production endpoint security. Dedicated-account
status integration, signed distribution and installation/update remain later
verification work. An old binary lacks the new command and must be rebuilt with
its listener/adapter together. LM2 is the next implementation stage:
IAM registration -> authenticated device management channel -> Gateway central
status view, with tenant/device isolation and stale/replay handling.
