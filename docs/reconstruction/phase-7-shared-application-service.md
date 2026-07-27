# Phase 7 Shared Application Service

## Completed

- One application service owns Manifest load, dependency validation, client
  definition lookup, capability resolution, strategy preparation, apply,
  history, rollback planning, and rollback apply.
- Copy, merge, managed, and link preparation compose without duplicating
  unsupported-capability errors.
- Scope selection deploys only assets declared for the requested scope.
- Plan and rollback approvals use short-lived, single-use plan IDs.
- Prepared merge content remains process-local and is never returned by the
  public plan contract.
- Expired and reused plan IDs fail closed.
- CLI Manifest apply, dry-run, history, and rollback use the shared service.
- GUI backend exposes separate plan/apply and rollback-plan/rollback endpoints
  using the same service.
- Existing Kit directories without a Manifest continue using legacy adapters.
- Read-only plan resolution no longer creates a missing named project Kit.

## HTTP endpoints

- `POST /api/deployment/plan`
- `POST /api/deployment/apply`
- `GET /api/deployment/history`
- `POST /api/deployment/rollback-plan`
- `POST /api/deployment/rollback`

Plan lookup and transaction lookup errors use stable HTTP status contracts.
Mutation endpoints continue to require the desktop session token.

## Intentional boundaries

- Manifest mode initially requires one explicit client.
- Resource and individual-file filters remain legacy-only.
- The React UI does not render the new plan, conflict, history, or rollback
  contracts yet.
- Client-specific syntax and semantic validators still need to replace the
  generic validation hook before broad migration.
