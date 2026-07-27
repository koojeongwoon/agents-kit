# ADR-004: Explicit Ownership and Safe Merge

- Status: Accepted
- Date: 2026-07-27

## Context

Replacing complete settings files can erase user configuration. Symlinks and
`.bak` files cannot represent structured ownership or durable transaction
history.

## Decision

Support managed, merge, copy, link, and manual strategies. Persist owned JSON
Pointers, TOML locations, Markdown blocks, or complete files in target-local
state. Treat external changes inside owned locations as conflicts.

## Consequences

- Shared settings default to merge.
- Apply requires precondition hashes and transaction backups.
- Rollback becomes a persistent, previewable operation.
- User-owned content remains untouched.

