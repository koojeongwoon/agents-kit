# ADR-006: Shared CLI and GUI Application Services

- Status: Accepted
- Date: 2026-07-27

## Context

CLI and GUI currently expose overlapping deployment behavior with different
response shapes and some route-specific logic.

## Decision

CLI commands and GUI routes call the same plan, diff, apply, validate, doctor,
and rollback application services. UI code only renders contracts and submits
explicit user actions.

## Consequences

- Identical input produces identical plans in CLI and GUI.
- Security and filesystem authorization remain server-side.
- UI development follows stable operation and conflict contracts.

