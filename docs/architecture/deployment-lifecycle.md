# Deployment Lifecycle

## Deployment Plan

`DeploymentPlan` is a pure result derived from desired state, client
definitions, capabilities, and observed target state.

Supported operation kinds:

- `CREATE`
- `MERGE`
- `UPDATE_MANAGED`
- `COPY`
- `LINK`
- `REPLACE_LINK`
- `MANUAL`
- `SKIP`
- `CONFLICT`
- `REMOVE_MANAGED`

Each operation records:

- operation and reason code
- client and detected version
- asset ID and source
- target path and format
- deployment strategy
- evidence and capability status
- before and expected-after hashes
- owned fields, sections, blocks, or file
- warnings and conflicts
- validation rules
- rollback recipe

## Strategies

| Strategy | Meaning |
|---|---|
| `managed` | Agent Kit owns the complete file |
| `merge` | Agent Kit owns selected structured paths or blocks |
| `copy` | Copy an asset without creating a live source link |
| `link` | Create a symbolic link when supported and safe |
| `manual` | Emit instructions without changing the target |

`merge` is the default for shared settings files. No fallback between
strategies occurs silently.

## Lifecycle

1. Validate Manifest and client definitions.
2. Resolve assets and secret references without exposing values.
3. Detect client and version.
4. Resolve capability and evidence state.
5. Observe and authorize target paths.
6. Build the complete plan without mutation.
7. Calculate diffs and ownership conflicts.
8. Require an apply request after the plan is available.
9. Revalidate preconditions and hashes.
10. Create transaction backups.
11. Apply operations atomically where possible.
12. Validate syntax and client semantics.
13. Commit state only after successful validation.
14. Restore every completed operation on failure.

## Persistent state

Target projects use:

```text
.agent-kit/
  state.json
  backups/
  transactions/
```

State records schema versions, transaction IDs, managed locations, hashes,
strategies, backup references, and validation results. It must not contain
resolved secrets.

## Conflict rules

- A user change outside Agent Kit ownership is preserved.
- A user change inside a previously owned location becomes a conflict.
- Unknown existing content is not claimed automatically.
- A stale plan fails before mutation when its precondition hash changed.
- Conflict resolution produces a new plan; it does not mutate the old plan.

## Rollback

Rollback is an explicit application service that:

- identifies a committed transaction
- verifies the current target before restoration
- previews restoration changes
- restores only transaction-owned mutations
- records the rollback as another transaction

