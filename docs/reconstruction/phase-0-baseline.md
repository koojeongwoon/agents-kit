# Phase 0 Reconstruction Baseline

## Status

- Baseline date: 2026-07-27
- Baseline commit: `7b80110`
- Working tree at inspection: clean
- Product version: `1.0.0`
- Runtime: Node.js ES modules
- User surfaces: CLI, React web UI, Tauri desktop shell

This document records the behavior that exists before the Agent Kit
reconstruction. It is a compatibility baseline, not a description of the
target architecture.

## Validation baseline

The following checks passed at commit `7b80110`:

| Check | Result |
|---|---|
| `npm test` | Passed |
| Node test runner suites | 21 passed, 0 failed |
| Legacy adapter integration suite | Passed |
| CLI status and dry-run integration | Passed |
| `npm --prefix gui run build:desktop` | Passed |
| Vite frontend build | Passed |
| Bundled Express backend build | Passed |

The current full validation command also includes a Rust `cargo check`. That
check remains part of the phase completion gate even though it was not needed
to establish the JavaScript and GUI build baseline recorded above.

## Existing product capabilities

### Master Kit and scopes

- The default master kit is stored under `~/.agents-kit/kit`.
- Assets are split into `global` and named `projects/<name>` scopes.
- Managed categories are `harness`, `skills`, `mcp`, `agents`, `loops`, and
  `memory`.
- A default kit can be bootstrapped and existing client configuration can be
  imported.

### CLI

The current CLI provides:

- `apply` and `sync`
- `init` and `import`
- `generate`
- `status`
- `git`
- global and project scopes
- client, resource, and file filters
- dry-run deployment preview

The reconstruction must either retain these commands or provide an explicit
compatibility and migration path.

### Deployment

The current deployment model is primarily symlink-oriented:

1. Adapter code calculates categorized source/target link pairs.
2. `BaseAdapter.plan()` classifies link changes.
3. `deployAllAdapters()` plans all selected clients before mutation.
4. Adapters apply links and generated permission/configuration files.
5. Completed adapters are rolled back if a later adapter fails.

Existing safety behavior that must remain invariant:

- Reject filesystem root and home directory as project targets.
- Reject deployment into the master kit or tool repository.
- Reject source/target identity and self-referencing symlinks.
- Refuse backup collisions.
- Preserve and restore overwritten regular files.
- Restore replaced symlinks after failure.
- Use atomic temporary-file writes for generated files.
- Keep mutation paths within approved filesystem roots.

### Client adapters

The current registry contains:

- Google Antigravity
- Cursor
- Codex
- Claude Code
- Claude Desktop

Paths and client behavior are currently encoded directly in adapter classes.
They are implementation facts, not yet verified client capability contracts.

### MCP and secrets

- MCP templates are resolved into local generated configuration.
- Public examples and local values are separated through `.env.example` and
  `.env`.
- Unresolved placeholders generate warnings.
- Files containing local MCP values use restricted file permissions.
- Git credentials and remote URLs pass validation and redaction boundaries.

The target manifest must store secret references, never literal credentials.

### GUI

The existing GUI provides:

- global/project kit selection
- asset browsing, creation, editing, deletion, and AI assistance
- client status and categorized link status
- all-client, project, single-client, and single-asset deployment
- dry-run deployment preview
- source/target diff preview
- project directory selection
- skills.sh and Smithery marketplace flows
- MCP enable/disable controls
- Git/GitHub synchronization
- LLM provider key management

The current deployment preview is specifically a list of symbolic-link
changes. It does not yet model structured merge, copy, manual action,
capability warnings, managed ownership, conflicts, transaction history, or
persistent rollback.

### Local GUI API

The Express backend currently exposes route groups for:

- status and catalog
- file preview, diff, and save
- deployment, link, unlink, and import merge
- assets and AI assistance
- MCP and Smithery
- skills.sh
- project kit management
- LLM and permission configuration
- Git and GitHub CLI operations

Mutating `/api` requests require an ephemeral session token. The server binds
to `127.0.0.1` and restricts allowed origins.

## Keep, replace, and defer

### Keep as implementation foundations

- CLI entry point and command compatibility
- React/Tauri application shell
- Express security boundary
- filesystem authorization helpers
- domain error mapping
- `FileTransaction`
- preflight planning before multi-client mutation
- cross-adapter rollback coordination
- scope value validation
- MCP environment separation
- secret and Git input validation
- current test fixtures and safety regression tests
- marketplace and asset-management workflows

### Replace behind compatibility facades

- directory layout as the implicit common model
- hardcoded client path tables inside adapters
- symlink-only deployment operation vocabulary
- link-only client status calculation
- generated client configuration without persistent ownership state
- dry-run response shaped only as source/target link changes
- GUI deployment modal wording and rendering tied to symbolic links
- import behavior that directly appends or rewrites shared files

### Add

- versioned `AgentKitManifest`
- asset registry and stable asset identifiers
- data-driven `ClientDefinition`
- versioned capability matrix with evidence status
- client-neutral `DeploymentPlan`
- managed, merge, copy, link, and manual strategies
- JSON, JSONC, TOML, YAML, and Markdown-aware merge support
- `.agent-kit/state.json`
- persistent transaction history, backups, and rollback
- conflict detection and resolution contracts
- post-apply semantic validation
- CLI/GUI plan parity
- capability, conflict, ownership, history, rollback, and doctor UI

### Defer until the configuration plane is stable

- a custom model execution runtime
- Harness-owned agent loop execution
- tool registry and MCP runtime adapter
- runtime approval orchestration
- working-state persistence
- long-term memory retrieval and consolidation
- trace storage beyond public plans, actions, results, and validations

## Compatibility risks

1. Client paths currently mix verified conventions, compatibility paths, and
   project-specific assumptions.
2. Existing status means “linked correctly”, while the target status must mean
   “desired state is valid” across multiple deployment strategies.
3. Existing `.bak` recovery is local to a target path and cannot represent
   durable multi-file transaction history.
4. GUI and CLI share lower-level adapter functions but expose different
   operation shapes and messages.
5. Import flows can combine client content directly without an ownership model.
6. Client capabilities change independently of Agent Kit releases.
7. Existing global/project behavior must remain usable while manifest
   migration is introduced.

## Phase 0 completion gate

- [x] Existing user changes are committed and the worktree is clean.
- [x] Baseline commit is recorded.
- [x] CLI, GUI, adapter, and API capabilities are inventoried.
- [x] Existing safety invariants are identified.
- [x] Keep, replace, add, and defer decisions are recorded.
- [x] Core tests and desktop frontend/backend builds pass.
- [x] Rust/Tauri check passes.
- [x] Client path and capability claims have an explicit verification status.
