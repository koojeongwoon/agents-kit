# Phase 3 Copy Deployment Slice

## Completed

- Data-driven Codex and Claude Code capability definitions
- Evidence-gated capability resolution
- Client-neutral capability plan
- Filesystem observation for `copy` operations
- Recursive directory expansion without following nested symbolic links
- Before and expected-after SHA-256 hashes
- Unknown-content and externally-modified ownership conflicts
- Stale-plan rejection before mutation
- Atomic file writes and rollback on write or validation failure
- Target-local `.agent-kit/state.json` ownership and transaction records
- State-commit failure restoration

## Intentional boundary

Only the `copy` strategy has an execution path in this slice. Structured
`merge` support follows in Phase 4. `link` and fully managed replacement remain
blocked until they receive strategy-specific ownership, diff, validation,
backup, and rollback behavior.

The legacy CLI and GUI still use legacy adapters. They will move to the shared
application services only after the remaining strategies and persistent
rollback service are complete.

## Completion evidence

- Copy deployment tests cover create, directory expansion, unknown ownership,
  external modification, stale plans, post-apply validation failure, state
  commit failure, and unsupported strategy blocking.
- The complete Node and legacy adapter suites pass.
- Desktop frontend/backend build and Rust check pass.
- `git diff --check` passes.
