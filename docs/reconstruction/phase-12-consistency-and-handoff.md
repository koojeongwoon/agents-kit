# Phase 12 — Consistency and Handoff

## State

Completed after removal of the legacy runtime.

## Aligned Surfaces

- README documents only the Manifest control plane and current commands.
- Platform support lists only verified clients and runtime requirements.
- Release checks validate fail-closed planning, apply, ownership, and rollback.
- Desktop metadata uses the Control Plane product name.
- Traceability statuses reflect the implemented CLI and GUI.
- Obsolete LLM environment examples and unused Markdown/TOML converters are removed.

## Current Product Boundary

The shipped configuration plane is:

```text
Manifest
  -> typed reference validation
  -> client capability resolution
  -> deployment plan and conflicts
  -> explicit transactional apply
  -> validation, history, rollback
```

Marketplace installation, Git synchronization, asset editing, optional managed
runtime execution, and additional client definitions are future Manifest-native
extensions rather than compatibility features.

## Final Gate

- No current user document advertises a removed feature.
- No production import points to a removed module.
- Manifest examples and client definitions pass automated validation.
- CLI, server, desktop frontend, backend bundle, and Rust checks pass together.
