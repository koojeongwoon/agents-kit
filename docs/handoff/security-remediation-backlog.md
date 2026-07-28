# Agent Kit Security Remediation Backlog

## Purpose

This document captures security hardening work identified during a 2026-07-28
review of the Configuration and Distribution Plane. It is a **deferred backlog**:
nothing here is implemented yet. Use it when scheduling security-focused work
without mixing it into unrelated feature orders.

The current product trust model assumes a **single-user local desktop**:
localhost-only GUI server, trusted local processes, and no remote multi-tenant
exposure.

## Current posture (baseline)

| Area | Status | Notes |
|------|--------|-------|
| Path authorization + symlink escape | Strong | `lib/security-boundary.js`, manifest loader, deployment preparers |
| Atomic writes, backup, rollback | Strong | `file-transaction.js`, `apply-deployment.js`, coordinator tests |
| Manifest literal secret rejection | Strong | `LITERAL_SECRET` in manifest loader |
| Capability fail-closed | Strong | `client-definition.js`, planner blocked operations |
| HTTP error redaction | Strong | `error-mapper.js` strips domain `details` |
| GUI localhost bind + CORS + mutation token | Good | `127.0.0.1:3710`, origin allowlist, `timingSafeEqual` |
| Tauri minimal surface + CSP | Good | No custom IPC/shell/fs plugins |
| Self-target prevention (GUI) | Partial | Implemented in `gui/server/context.js`, **not tested** |
| Self-target prevention (CLI) | Missing | `bin/cli.js` resolves `--project` without guard |
| Doctor route project scope | Partial | `projectPath` optional; guard can be skipped |
| Runtime sandbox / approval (ADR-009) | Not implemented | Design only |

## Recommended execution sequence

```text
SEC-01 CLI/GUI self-target parity
   |
   v
SEC-02 AK-D15 regression tests
   |
   v
SEC-03 Doctor route consistency
   |
   v
SEC-04 Secret detection hardening (optional)
   |
   v
SEC-05 Local API hardening (optional, shared-machine scenarios)
   |
   v
SEC-06 Runtime security (ADR-009, separate milestone)
```

SEC-01 through SEC-03 are small, low-risk changes and should land together.
SEC-05 and SEC-06 are larger and depend on product decisions.

---

## SEC-01 — Unify self-target prevention across CLI and GUI

**Goal:** Prevent deployment into Agent Kit's own repository, Kit directory,
home directory, or filesystem root from **every** entry point.

**Requirements:** AK-D15.

**Problem:**

- GUI defines `assertSafeProjectTarget()` in `gui/server/context.js`.
- CLI (`bin/cli.js`) resolves `--project` directly in `deploymentInput()` and
  `doctor` without calling the guard.
- A mistaken script or automation can mutate the Agent Kit installation itself.

**Read first:**

- `AGENTS.md`
- `lib/security-boundary.js`
- `gui/server/context.js`
- `bin/cli.js`
- `gui/server/routes/deploy.js`

**Tasks:**

1. Move `assertSafeProjectTarget()` into `lib/security-boundary.js` (or a small
   adjacent module imported by both CLI and GUI).
2. Accept explicit roots: `{ targetDir, homeDir, projectRoot, kitRoot }`.
3. Reuse `resolveForAuthorization()` and `isWithinRoot()` for symlink-safe
   checks.
4. Call the shared guard from:
   - `bin/cli.js` → `deploymentInput()` when `scope === 'project'`
   - `bin/cli.js` → `doctor` when `scope === 'project'`
   - `gui/server/context.js` → thin wrapper delegating to shared module
5. Keep **global** scope targeting `homeDir` unchanged (by design).

**Forbidden targets (project scope):**

- Filesystem root (`/` on Unix, drive root on Windows)
- User home directory (`homeDir`)
- Agent Kit repository root (`projectRoot`)
- Kit root (`kitRoot`)
- Any path inside repository or Kit root (including via symlink)

**Acceptance criteria:**

- CLI `apply --project <kitRoot>` fails with a clear error.
- CLI `apply --project <repositoryRoot>` fails.
- CLI `apply --project <homeDir>` fails.
- GUI behavior unchanged for valid project paths.
- Global scope still deploys to `homeDir`.

**Tests required:**

- Unit tests in `test/security-boundaries.test.js` for each forbidden root.
- CLI integration test in `test/manifest-cli.test.js` asserting non-zero exit
  and error message when `--project` points at kit/repo/home.

**Suggested commit:** `fix: enforce self-target guard in CLI and shared module`

---

## SEC-02 — Add AK-D15 regression tests

**Goal:** Close the traceability gap for AK-D15 (`Designed` → `Implemented`).

**Requirements:** AK-D15.

**Depends on:** SEC-01 (shared module must exist before tests reference it).

**Tasks:**

1. Add unit tests for `assertSafeProjectTarget()` covering:
   - valid project subdirectory under a temp root,
   - direct match on forbidden roots,
   - path inside kit/repo via normal path,
   - path inside kit/repo via symlink escape.
2. Add HTTP e2e test in `gui/server/test/control-plane-e2e.test.js` (or a
   dedicated security test file) asserting `POST /api/deployment/plan` returns
   4xx when `projectPath` is the kit root.
3. Update `docs/traceability/shared-conversation-requirements.md`:
   - AK-D15 status → **Implemented**
   - link to `test/security-boundaries.test.js` and CLI test.

**Acceptance criteria:**

- All new tests pass in CI via `npm run test:all`.
- AK-D15 row reflects implemented + tested state.

**Suggested commit:** `test: add self-target and symlink escape regression coverage`

---

## SEC-03 — Fix doctor route projectPath consistency

**Goal:** Ensure `doctor` cannot bypass self-target checks when `scope` is
`project`.

**Problem:**

In `gui/server/routes/deploy.js`, the doctor handler treats `projectPath` as
optional for project scope:

```javascript
if (scope === 'project' && projectPath?.trim()) {
  assertSafeProjectTarget(projectPath);
  resolved.targetRoot = path.resolve(projectPath);
}
```

Other routes use `locations()`, which requires `projectPath` and always runs the
guard.

**Tasks:**

1. Refactor doctor to use the shared `locations()` helper (or equivalent).
2. Require `projectPath` for project scope; return stable error code
   `PROJECT_PATH_REQUIRED` when missing.
3. Align CLI `doctor` to require `--project` when diagnosing project scope
   (or document that project-scope doctor without target is intentionally
   manifest-only — pick one behavior and test it).

**Acceptance criteria:**

- `POST /api/deployment/doctor` with `scope: 'project'` and empty
  `projectPath` returns 400 with `PROJECT_PATH_REQUIRED`.
- Doctor with forbidden `projectPath` fails identically to plan/apply routes.
- CLI and HTTP behavior documented in `SUPPORT.md` if semantics change.

**Tests required:**

- Route test in `gui/server/test/deployment-routes.test.js` for missing and
  forbidden `projectPath`.
- CLI doctor test if CLI semantics change.

**Suggested commit:** `fix: align doctor route with project path safety checks`

---

## SEC-04 — Harden secret detection (optional)

**Goal:** Reduce false negatives for non-prefix secret formats.

**Requirements:** AK-D16 (extend).

**Problem:**

`lib/infrastructure/manifest-loader.js` rejects:

- keys matching `SECRET_KEY` regex with string values,
- values matching known prefixes (`ghp_`, `sk-`, `AIza`, etc.).

Custom tokens, base64 blobs, and uncommon provider formats may slip through.

**Tasks:**

1. Document current heuristic limits in `docs/architecture/asset-model.md`.
2. Consider additional rules:
   - reject high-entropy strings over N chars on secret-key fields,
   - reject `Bearer ` / `Basic ` prefixed values,
   - expand prefix list from client definitions (data-driven, not hardcoded in
     loader if possible).
3. Do **not** block legitimate non-secret high-entropy IDs; tune carefully.

**Acceptance criteria:**

- New patterns covered by tests in `test/manifest-loader.test.js`.
- No increase in false positives on example Manifest fixtures.

**Suggested commit:** `feat: extend manifest secret heuristics`

---

## SEC-05 — Local API hardening (optional)

**Goal:** Improve security when the GUI server runs on a shared or forwarded
host. Only pursue if product scope expands beyond single-user desktop.

**Current model:**

- `GET /api/session` issues mutation token without authentication.
- Any local process can obtain the token and call mutating endpoints.
- Server binds to `127.0.0.1` only (documented in `SUPPORT.md`).

**Tasks (pick based on threat model):**

1. **Documentation:** Add explicit "do not expose port 3710" and "not safe on
   shared machines" to README and SUPPORT.md (low effort, do regardless).
2. **Session binding:** Bind token to Tauri webview origin or a per-launch
   random file/socket path readable only by the desktop app.
3. **Unix domain socket:** Replace TCP listener with a socket in
   `~/.agents-kit/` with `0600` permissions.
4. **Rate limiting:** Add lightweight rate limits on plan/apply endpoints.

**Acceptance criteria:**

- Documented trust boundary matches implementation.
- If session binding is added, curl-only token fetch no longer works without
  the desktop client context.

**Suggested commit:** `docs: clarify local API trust boundary` (minimal) or
`feat: bind GUI session token to desktop client` (full)

---

## SEC-06 — Runtime security (ADR-009, separate milestone)

**Goal:** Implement execution-runtime controls when the optional Harness module
is built. Not part of the configuration-plane backlog except as a gate.

**Requirements:** AK-R01 through AK-R09, ADR-009.

**Non-negotiable controls (from ADR-009):**

- Runtime cannot mutate configuration-plane desired state implicitly.
- Tool execution denied unless provider, scope, client capability, Harness, and
  effective Policy all allow it.
- Durable Memory promotion requires explicit user approval.
- No hidden model reasoning persisted.
- Sandbox: process, network, credential, timeout, cancellation boundaries.

**Action:** Track under WO-12 in `remaining-work-orders.md`. Do not implement
ahead of the configuration plane.

---

## Files to touch (SEC-01 through SEC-03)

| File | Change |
|------|--------|
| `lib/security-boundary.js` | Add `assertSafeProjectTarget()` |
| `gui/server/context.js` | Delegate to shared guard |
| `bin/cli.js` | Call guard for project scope |
| `gui/server/routes/deploy.js` | Doctor uses `locations()` |
| `test/security-boundaries.test.js` | Unit tests |
| `test/manifest-cli.test.js` | CLI self-target test |
| `gui/server/test/deployment-routes.test.js` | Doctor path tests |
| `gui/server/test/control-plane-e2e.test.js` | Optional HTTP forbidden-path test |
| `docs/traceability/shared-conversation-requirements.md` | AK-D15 → Implemented |

## Verification (after implementation)

```sh
npm ci
npm ci --prefix gui
npm run test:all
git diff --check
```

Manual smoke checks:

```sh
# Should fail (after SEC-01):
node bin/cli.js apply --kit ~/.agents-kit/kit --project ~/.agents-kit/kit --client codex --dry-run

# Should succeed on a normal temp project path:
node bin/cli.js apply --kit ~/.agents-kit/kit --project /tmp/my-project --client codex --dry-run
```

## Standard assignment prompt

> Work in the agents-kit repository. Execute **SEC-XX** from
> `docs/handoff/security-remediation-backlog.md`. Read `AGENTS.md` and every
> document listed under “Read first” before editing. Preserve unrelated changes.
> Implement the order including tests and traceability updates, then run
> `npm run test:all` and `git diff --check`. Do not commit until explicitly
> authorized. Report changed files, validation evidence, and unresolved risks.

## Review source

Findings from security evaluation on 2026-07-28 covering:

- filesystem authorization (`resolveForAuthorization`, `assertWithinRoots`)
- deployment transaction safety (plan TTL, stale hash, atomic write, rollback)
- manifest secret handling (`LITERAL_SECRET`)
- capability fail-closed behavior
- GUI/Tauri attack surface reduction
- CLI/GUI parity gap for self-target prevention
- local API trust model limitations
