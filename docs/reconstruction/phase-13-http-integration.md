# Phase 13 — HTTP Integration

## State

Completed after documentation and module consistency cleanup.

## Boundary

Express app construction is separate from socket startup. Production still
listens on `127.0.0.1:3710`, while tests can exercise the complete HTTP stack
without opening a port.

The app factory includes:

- origin validation
- JSON size limits
- request IDs and request logging
- ephemeral mutation token enforcement
- Manifest deployment routes
- stable error responses

## End-to-End Proof

An isolated Kit and target project execute:

```text
session token
  -> unauthorized mutation rejection
  -> deployment plan
  -> explicit apply
  -> target file verification
  -> transaction history
  -> rollback plan
  -> explicit rollback
  -> target restoration verification
```

This test uses the real Manifest loader, client definition, planner,
transaction coordinator, ownership state, backup store, HTTP router, and
security middleware.
