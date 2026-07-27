# Phase 9 — Legacy Surface Removal

## State

Completed after the Manifest-only control plane became the sole desktop entrypoint.

## Removed

- The legacy asset registry, marketplace, project, Git, MCP, skill, and configuration screens
- Their client hooks, API wrappers, modals, and shared UI types
- Unmounted server routes for direct file and resource mutation
- One-off server split/refactor scripts and generated AST snapshots
- Obsolete client calls for direct global, project, and single-client deployment

## Retained

- The Manifest domain and reference graph
- Client capability definitions
- Transactional copy, merge, managed, and link strategies
- Deployment planning, explicit apply, history, and rollback
- Infrastructure adapters still used behind current application services and tests

## Gate

The desktop bundle and backend must build from the reduced source tree, the
deployment router must expose only the five Manifest control-plane endpoints,
and the full test suite must remain green.
