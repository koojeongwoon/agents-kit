# Agent Kit Remaining Work Orders

## Purpose

This document is the execution contract for handing the remaining Agent Kit
work to another AI client. It is intentionally stricter than a roadmap: every
work order defines scope, dependencies, completion evidence, and boundaries.

The baseline used when this document was written is commit `0e33c2a`
(`build: verify tauri control plane package`). Before starting any order, the
worker must record the actual `HEAD` and confirm that the worktree is clean.
If the baseline has advanced, the current code and requirement register take
precedence over the commit named here.

## Rules for every worker

1. Read `AGENTS.md`, this document, and every design document named by the work
   order before editing.
2. Treat the Manifest as the only source of desired state. Do not restore a
   legacy adapter, legacy resource directory inference, or direct client-file
   mutation path.
3. Reuse the domain, application, infrastructure, HTTP, and GUI boundaries
   already present. CLI, HTTP, and GUI must call shared application services;
   they must not reimplement domain decisions.
4. Preserve the reference model:
   - Skills and Agents require logical Tools.
   - MCP resources provide logical Tools.
   - Skills and Agents do not own MCP connections.
   - durable Memory changes require an explicit approval contract.
5. Keep all errors machine-readable. A UI-friendly explanation supplements,
   but never replaces, the stable issue code.
6. Do not store, print, return, or commit literal credentials.
7. Do not claim a requirement is complete until implementation, automated
   tests, user behavior, compatibility impact, and
   `docs/traceability/shared-conversation-requirements.md` agree.
8. Keep each work order in its own commit unless the owner explicitly asks for
   a different arrangement. Do not mix unrelated cleanup into the commit.
9. Before handoff, run the order-specific checks, `npm run test:all`, and
   `git diff --check`. If a full check cannot run, report the exact blocker and
   do not describe the order as complete.
10. Never commit build outputs under `gui/src-tauri/target`.

## Recommended execution sequence

```text
WO-01 CI gate
   |
   v
WO-02 Validate/Doctor
   |
   v
WO-03 Manifest registry/editor foundation
   |
   +--> WO-04 Skill editor
   +--> WO-05 Agent and related resource editors
   |        |
   |        v
   +--> WO-06 Dependency graph and deletion impact
              |
              v
           WO-07 Error and conflict UX
              |
              v
           WO-08 Secret reference UX

WO-09 Client definitions may run after WO-02 and independently per client.
WO-10 Structured merge may run independently after WO-01.
WO-11 Marketplace/Git starts only after WO-03 and WO-06.
WO-12 Optional runtime is a separate product milestone and starts last.
```

WO-04 and WO-05 may be assigned in parallel only after WO-03 is merged. Client
definitions in WO-09 should be split into one branch and one commit per client.
WO-07 should not run in parallel with WO-04 through WO-06 because they are
expected to touch the same GUI surfaces.

---

## WO-01 — Complete the CI release gate

**Goal:** Make CI exercise the same complete verification contract documented
for local release checks.

**Requirements:** release quality gate; supports all implemented requirements.

**Read first:**

- `package.json`
- `.github/workflows/ci.yml`
- `RELEASE.md`
- `gui/package.json`
- `docs/reconstruction/phase-13-http-integration.md`
- `docs/reconstruction/phase-15-tauri-package-smoke.md`

**Tasks:**

1. Change CI to run the root `test:all` contract, including the HTTP/server
   integration test.
2. Remove duplicate CI commands only when `test:all` already covers them.
3. Add a deterministic package or bundle smoke check if it can run on the
   GitHub macOS runner without signing credentials.
4. Keep dependency installation cache keys correct for both lockfiles.
5. Align `RELEASE.md` with the commands CI actually executes.

**Acceptance criteria:**

- A clean checkout can install dependencies and run the full gate.
- HTTP integration tests are not accidentally omitted.
- No Apple signing or notarization secret is required.
- Existing local packaging behavior remains unchanged.

**Verification:**

```sh
npm ci
npm ci --prefix gui
npm run test:all
git diff --check
```

**Do not:**

- Add fake signing identities or placeholder secrets.
- Commit `.app`, `.dmg`, or `target` output.
- weaken a test to accommodate CI.

**Suggested commit:** `ci: run complete control plane verification`

---

## WO-02 — Add shared Validate and Doctor workflows

**Goal:** Provide reusable Manifest validation and local deployment diagnostics
through CLI, HTTP, and GUI without duplicating rules.

**Requirements:** AK-U04, AK-U05, AK-U16 foundation.

**Read first:**

- `docs/architecture/resource-reference-model.md`
- `docs/architecture/deployment-lifecycle.md`
- `docs/decisions/ADR-006-shared-application-services.md`
- `lib/domain/manifest.js`
- `lib/domain/errors.js`
- `lib/application/manifest-deployment-service.js`
- `bin/cli.js`
- `gui/server/routes/deploy.js`
- `gui/src/ManifestApp.tsx`

**Tasks:**

1. Define stable result contracts for validation issues and doctor checks.
2. Implement application services that:
   - load the Manifest safely,
   - validate typed references and complete dependency closure,
   - resolve Tools and policy decisions,
   - inspect selected client definitions and target paths,
   - distinguish invalid configuration, unsupported capability, missing local
     prerequisite, warning, and healthy state.
3. Add CLI commands `validate` and `doctor`.
4. Add authenticated HTTP endpoints and typed GUI client functions.
5. Add a non-mutating GUI diagnostics surface with clear remediation text.
6. Ensure both workflows are read-only.

**Acceptance criteria:**

- The same fixture produces the same issue codes in CLI, HTTP, and GUI.
- `validate` does not inspect unrelated machine state.
- `doctor` does not alter files or install dependencies.
- Missing provider, illegal scope, policy denial, capability mismatch, cycle,
  and unsafe target produce distinct stable codes.
- HTTP endpoints retain the existing local token boundary.

**Tests required:**

- Domain/application tests for healthy and failing Manifests.
- CLI tests for exit code and JSON-safe output.
- HTTP authorization and response-contract tests.
- GUI component behavior for healthy, warning, and blocked results.

**Suggested commit:** `feat: add shared manifest diagnostics`

---

## WO-03 — Build the Manifest registry and editor foundation

**Goal:** Add a safe editing foundation so later resource editors manipulate
one versioned Manifest rather than client-specific files.

**Requirements:** foundation for AK-U11, AK-U13, AK-U14, AK-U15, AK-U16.

**Read first:**

- `docs/decisions/ADR-002-common-manifest.md`
- `docs/architecture/asset-model.md`
- `docs/architecture/resource-reference-model.md`
- `docs/examples/agent-kit.yaml`
- `lib/domain/manifest.js`
- `lib/infrastructure/manifest-loader.js`
- `gui/src/ManifestApp.tsx`

**Tasks:**

1. Add an application-level resource registry projection containing stable ID,
   kind, display name, scope, provided Tools, required Tools, and references.
2. Add read, create, update, and delete planning contracts for Manifest
   resources. Mutations must use atomic file handling and optimistic stale-file
   detection.
3. Preserve YAML/JSON format and reject unsupported or lossy writes.
4. Validate the complete Manifest before commit; never persist a partial edit.
5. Add authenticated HTTP routes and typed frontend APIs.
6. Build the common editor shell: resource list, kind filter, detail panel,
   dirty-state warning, validation summary, save/cancel.
7. Store IDs in references; labels and paths are presentation only.

**Acceptance criteria:**

- No editor writes directly to a client configuration.
- Failed validation leaves the original Manifest byte-for-byte unchanged.
- Concurrent external modification produces a stale-edit conflict.
- Creation and editing preserve unrelated Manifest content.
- Delete is blocked when references exist until WO-06 supplies reviewed impact.

**Tests required:**

- Registry projection and ordering.
- Atomic success/failure behavior.
- stale-edit detection.
- reference-preserving round trip.
- HTTP auth and GUI save/cancel behavior.

**Suggested commit:** `feat: add manifest resource editor foundation`

---

## WO-04 — Add the Skill editor with logical Tool selection

**Goal:** Let users create and edit Skills by selecting compatible logical
Tools and dependencies already declared in the Manifest.

**Requirements:** AK-U13 and relevant parts of AK-A10 through AK-A12.

**Depends on:** WO-02 and WO-03.

**Read first:**

- `docs/architecture/resource-reference-model.md`
- `docs/architecture/policy-model.md`
- `docs/examples/agent-kit.yaml`
- the registry/editor contracts introduced by WO-03

**Tasks:**

1. Add Skill fields supported by the Manifest domain without inventing a
   parallel frontend model.
2. Populate Tool choices from effective MCP providers and client capability
   evidence.
3. Display logical Tool ID, provider, scope, support state, and policy status.
4. Allow nested Skill and Memory references where the domain contract allows.
5. Prevent missing, ambiguous, denied, out-of-scope, and cyclic selections.
6. Explain why a Tool is unavailable rather than silently hiding it.

**Acceptance criteria:**

- The editor stores a logical Tool requirement, not an MCP connection object.
- Compatible choices react to scope and selected target client.
- Ambiguous providers require explicit provider preference when supported.
- Saving reuses full Manifest validation and atomic persistence.

**Tests required:**

- provider filtering and ambiguity,
- global/project scope behavior,
- nested Skill cycle prevention,
- policy-denied and unsupported Tool rendering,
- successful edit round trip.

**Suggested commit:** `feat: add dependency-aware skill editor`

---

## WO-05 — Add Agent, Harness, Workflow, Policy, and Memory editors

**Goal:** Complete dependency-aware creation of the remaining reference-bearing
resources, led by the Agent editor.

**Requirements:** AK-U14 plus user surfaces for AK-A03 and AK-A05 through
AK-A08.

**Depends on:** WO-02 and WO-03. WO-04 should be merged first unless file
ownership is explicitly partitioned.

**Tasks:**

1. Agent editor:
   - select Skills,
   - require logical Tools,
   - attach Policies,
   - configure Memory read/write references.
2. Harness editor:
   - enable Agents, Skills, and Workflows,
   - configure allowed/denied capabilities.
3. Workflow editor:
   - build ordered steps referencing Agent, Skill, or logical Tool.
4. Policy editor:
   - express only policies supported by the domain model.
5. Memory editor:
   - configure readers, writers, and approval policy,
   - default durable promotion to explicit approval.
6. Reuse common reference pickers and issue presentation; do not duplicate
   validation logic per editor.

**Acceptance criteria:**

- Every stored relationship uses a stable typed reference.
- A global resource cannot select a project resource.
- Harness denial is reflected in nested Agent/Skill Tool availability.
- Workflow target kind is validated.
- Memory writers/readers reference existing allowed resource kinds.
- No UI claims that hidden model reasoning will be persisted.

**Tests required:**

- one complete valid cross-resource graph,
- illegal scope,
- wrong reference kind,
- Harness policy denial,
- missing Workflow target,
- invalid Memory reader/writer,
- save and reload for each resource kind.

**Suggested commit:** `feat: add manifest resource relationship editors`

---

## WO-06 — Add dependency graph and deletion impact review

**Goal:** Make forward and reverse dependencies visible and prevent destructive
resource changes without impact review.

**Requirements:** AK-U15.

**Depends on:** WO-03; should integrate with WO-04 and WO-05.

**Tasks:**

1. Add an application query that returns nodes, typed edges, effective scope,
   and reverse references for a selected resource.
2. Add a delete/rename impact plan listing every directly and transitively
   affected resource.
3. Render a dependency view that remains usable without a heavy graph library;
   a tree/list view is acceptable if it communicates direction and type.
4. Block deletion while required references remain.
5. Permit an explicit edit plan that removes/replaces references and deletes
   the resource atomically.
6. Keep impact planning read-only until the user explicitly applies it.

**Acceptance criteria:**

- Forward and reverse dependencies match planner dependency closure.
- Direct and transitive effects are distinguishable.
- Cycles are reported safely without infinite traversal.
- Cancel leaves the Manifest unchanged.
- Apply is atomic and stale-plan protected.

**Tests required:**

- reverse-reference correctness,
- transitive impact,
- cycle-safe traversal,
- blocked deletion,
- atomic replace-and-delete,
- stale impact plan.

**Suggested commit:** `feat: add manifest dependency impact review`

---

## WO-07 — Add actionable error and conflict resolution UX

**Goal:** Turn blocked plans and stale/ownership conflicts into understandable,
reviewable actions without bypassing safety rules.

**Requirements:** AK-U08, AK-U16.

**Depends on:** WO-02, WO-04, WO-05, and WO-06.

**Tasks:**

1. Create a central presentation mapping for stable domain issue codes.
2. Show source resource, failed reference, target client/scope, reason, and
   recommended remediation.
3. Cover at minimum:
   - missing reference,
   - missing/ambiguous provider,
   - illegal scope,
   - policy denial,
   - unsupported/version-dependent capability,
   - dependency cycle,
   - stale plan/edit,
   - ownership conflict.
4. Add field-level navigation from an editor issue to the relevant control.
5. For deployment conflicts, support only explicit safe actions exposed by the
   application layer: cancel, re-plan, keep user-owned content, or apply an
   approved resolution plan.
6. Never implement a generic “force” action that disables ownership or path
   safety.

**Acceptance criteria:**

- Stable issue codes remain visible in technical details.
- The primary text is understandable without reading logs.
- Every offered action is backed by a tested application operation.
- Re-plan is required after stale state.
- No resolution mutates files before final confirmation.

**Suggested commit:** `feat: add actionable validation and conflict guidance`

---

## WO-08 — Add safe Secret Reference UX

**Goal:** Let users bind configuration to external secret references without
accepting or exposing literal secret values.

**Requirements:** AK-U11, AK-D16.

**Depends on:** WO-02 and WO-03; preferably after WO-07.

**Read first:**

- `docs/architecture/asset-model.md`
- `docs/architecture/policy-model.md`
- `lib/security-boundary.js`
- `lib/gui-security.js`

**Tasks:**

1. Inventory the secret-reference forms already accepted by the Manifest
   domain. Do not invent a provider-specific contract in the GUI.
2. Add controls for reference type and reference name only.
3. Reject literal secret-looking fields at domain, HTTP, and UI boundaries.
4. Ensure diagnostics report whether a reference is resolvable without
   returning its value.
5. Redact request bodies, errors, history, and UI summaries.
6. Add explicit copy explaining that Agent Kit stores references, not secrets.

**Acceptance criteria:**

- No API response contains a resolved secret.
- No test fixture uses a real credential pattern.
- Validation can distinguish missing reference metadata from inaccessible
   external state.
- Logs and errors remain redacted.

**Suggested commit:** `feat: add secret reference configuration`

---

## WO-09 — Add verified client definitions

**Goal:** Expand client coverage through evidence-backed data definitions,
without adding client-name branches to deployment code.

**Requirements:** AK-C03 through AK-C07, AK-C08, AK-C09.

**Depends on:** WO-02 for doctor evidence. Each client is a separate sub-order:

| Sub-order | Client | Requirement |
|---|---|---|
| WO-09A | Cursor | AK-C03 |
| WO-09B | Antigravity | AK-C06 |
| WO-09C | Claude Desktop | AK-C07 |
| WO-09D | Windsurf | AK-C04 |
| WO-09E | VS Code / GitHub Copilot | AK-C05 |

**Read first:**

- `docs/reconstruction/client-capability-audit.md`
- `docs/decisions/ADR-003-data-driven-client-definitions.md`
- `docs/decisions/ADR-005-capability-evidence.md`
- `clients/codex.yaml`
- `clients/claude-code.yaml`
- `lib/domain/client-definition.js`

**Tasks for each client:**

1. Audit current official documentation and an installed client when available.
2. Record evidence date, tested version, supported scopes, paths, formats,
   restart/reload requirements, and capability state.
3. Mark uncertain support as preview, version-dependent, unsupported, or
   UI-only; never infer stable support.
4. Add one data-driven definition and its tests.
5. Verify plan/apply/rollback in an isolated temporary profile or fixture.
6. Update the capability audit and traceability row only for that client.

**Acceptance criteria:**

- No core control-flow branch checks the client name.
- Paths are platform-aware and do not rely on unresolved broad environment
  variables.
- Unsupported resources block or produce an explicit manual plan.
- An uninstalled client is diagnosed, not treated as a broken Manifest.
- Evidence and automated tests accompany the definition.

**Suggested commits:**

- `feat: add verified cursor client definition`
- `feat: add verified antigravity client definition`
- `feat: add verified claude desktop client definition`
- `feat: add verified windsurf client definition`
- `feat: add verified vscode copilot client definition`

---

## WO-10 — Extend structured merge to YAML and JSONC

**Goal:** Support ownership-safe semantic merge for the remaining designed
configuration formats.

**Requirements:** AK-D04, AK-D08, AK-D09, AK-D17.

**Read first:**

- `docs/reconstruction/phase-4-structured-merge.md`
- `docs/architecture/deployment-lifecycle.md`
- `docs/decisions/ADR-004-safe-merge-and-ownership.md`
- `lib/domain/structured-merge.js`
- `lib/application/prepare-merge-deployment.js`

**Tasks:**

1. Implement YAML semantic merge with owned-field tracking.
2. Implement JSONC merge while preserving comments and user-owned formatting
   as far as the selected parser can guarantee.
3. Refuse a merge when preservation cannot be guaranteed; do not silently
   rewrite as plain JSON.
4. Extend plan diff, conflict detection, backup, validation, and rollback.
5. Document exact preservation limitations.

**Acceptance criteria:**

- User-owned keys, comments, and unrelated sections survive.
- Managed ownership is recorded at the correct semantic unit.
- Parse or preservation uncertainty fails before mutation.
- stale-plan and rollback behavior matches JSON/TOML/Markdown.

**Tests required:**

- nested YAML maps/lists and comments,
- JSONC line/block comments and trailing commas,
- user/managed collision,
- malformed input,
- stale plan,
- rollback after multi-file failure.

**Suggested commit:** `feat: add safe yaml and jsonc merge`

---

## WO-11 — Add Manifest-native Marketplace and Git workflows

**Goal:** Package, import, and synchronize Manifest resources and their
dependency closure without restoring legacy direct mutation.

**Requirements:** AK-U12.

**Depends on:** WO-03 and WO-06. Do not start before their contracts stabilize.

**Tasks:**

1. Write an ADR defining package identity, version, source, integrity,
   dependency closure, update policy, and trust boundary.
2. Model install/update/remove as desired-state Manifest changes.
3. Show import/update impact before mutation.
4. Preserve source provenance without treating repository access as
   authentication proof.
5. Keep Git transport, repository permissions, local installation, and
   deployment as distinct states.
6. Use atomic Manifest editing and normal plan/apply deployment afterward.

**Acceptance criteria:**

- Marketplace or Git code never writes client files directly.
- Removing a package cannot orphan referenced resources silently.
- Integrity or trust failure blocks import.
- Conflicting IDs require explicit resolution.
- Private repository credentials are delegated to an external credential
  mechanism and never stored by Agent Kit.

**Suggested commits:** split ADR/domain, application/infrastructure, and UI into
separate reviewable commits.

---

## WO-12 — Optional execution runtime milestone

**Goal:** Build runtime execution only after the configuration plane is stable.
This is a separate product milestone, not unfinished deployment work.

**Requirements:** AK-R01 through AK-R09.

**Read first:**

- `docs/architecture/optional-runtime.md`
- `docs/architecture/policy-model.md`
- `docs/architecture/resource-reference-model.md`
- `docs/decisions/ADR-001-configuration-plane-first.md`

**Mandatory design gate before coding:**

1. Write and approve ADRs for Harness execution, Tool Registry lifecycle,
   effective Policy evaluation, public event records, and Memory promotion.
2. Define process, network, credential, timeout, cancellation, audit, and human
   approval boundaries.
3. Prove the runtime can remain optional and cannot mutate configuration-plane
   desired state implicitly.

**Implementation slices after approval:**

1. Tool Registry discovery and connection lifecycle.
2. Effective Policy calculation.
3. Harness/Loop state machine.
4. public plan/action/result/validation event log.
5. Memory candidate staging and explicit promotion approval.

**Non-negotiable acceptance criteria:**

- No hidden model reasoning is persisted.
- Skills and Agents still require logical Tools; they do not own MCP sessions.
- Tool execution is denied unless provider, scope, client capability, Harness,
  and effective Policy all allow it.
- Durable Memory promotion requires an explicit user action.
- Runtime failure cannot corrupt the Manifest or deployed client state.

**Commit guidance:** one bounded vertical slice per commit; never submit the
entire runtime as one undifferentiated change.

---

## Standard assignment prompt

Copy the following prompt to the client receiving an individual work order:

> Work in `/Users/jw/__dev/agents-kit`. Execute only **WO-XX** from
> `docs/handoff/remaining-work-orders.md`. Read `AGENTS.md` and every document
> listed under “Read first” before editing. Inspect the current code and Git
> status; do not assume the recorded baseline is still HEAD. Preserve unrelated
> changes and the Manifest-only architecture. Implement the work order,
> including tests and traceability updates, then run its required checks,
> `npm run test:all`, and `git diff --check`. Do not commit until I explicitly
> authorize it. Report changed files, validation evidence, compatibility
> impact, unresolved risks, and the exact suggested commit message.

## Required handoff report

Every client must return:

1. work order and requirement IDs completed,
2. current base commit,
3. changed files grouped by domain/application/infrastructure/interface/docs,
4. user-visible behavior,
5. tests executed and exact pass/fail counts,
6. security and compatibility impact,
7. known gaps or follow-up work,
8. whether traceability was updated,
9. proposed commit message,
10. explicit statement that no credentials or build outputs were added.
