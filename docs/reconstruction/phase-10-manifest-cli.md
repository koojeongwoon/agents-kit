# Phase 10 — Manifest-only CLI

## State

Completed after removal of the legacy desktop and HTTP surfaces.

## Command Surface

- `init`: creates starter global and default-project Manifests
- `apply`: plans and optionally applies one Manifest for one client
- `history`: lists committed transactions
- `rollback`: plans and optionally applies one rollback
- `help`: documents the current surface

The former `sync`, `import`, `generate`, `status`, and `git` workflows were
removed because they mutated or inspected resources outside the Manifest
control plane. The `--resource` and `--file` filters are rejected explicitly;
asset selection belongs in the Manifest.

## Bootstrap Contract

Initialization creates only `agent-kit.yaml` and its referenced starter
instruction asset for global and default-project scopes. It does not create a
Git repository, adapter directories, or unlisted common resources.

## Gate

CLI integration tests must prove plan/apply/history/rollback behavior, clean
Manifest initialization, rejection of removed commands and filters, and
absence of implicit Git or legacy directory creation.
