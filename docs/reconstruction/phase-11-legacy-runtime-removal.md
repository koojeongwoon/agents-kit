# Phase 11 — Legacy Runtime Removal

## State

Completed after the CLI became Manifest-only.

## Removed Runtime Island

- Client-specific symlink adapters and their import/status/deploy APIs
- Directory-based default templates and implicit named-project bootstrap
- Resolved MCP side files and `.env` placeholder materialization
- Direct skill and Smithery marketplace stores
- LLM-generated unregistered asset writers
- The unused legacy catalog and Git helper surface

These components were unreachable from the current CLI and desktop app and
could create or mutate resources that were absent from a Manifest.

## Preserved Boundaries

- Manifest parsing and typed cross-resource references
- Client capability definitions
- Transactional deployment strategies and ownership state
- Filesystem root authorization
- GUI origin and mutation-token protection

The security checks formerly embedded in the legacy adapter suite now have a
focused runtime-boundary test.

## Gate

No production or test import may reference the removed runtime island. The
Manifest tests, security-boundary tests, desktop build, backend build, and Rust
check must all pass.
