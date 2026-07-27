# Phase 5 Common Coordinator and Rollback

## Completed

- One coordinator prevalidates and applies prepared copy and merge plans
- Duplicate targets are rejected before backup or mutation
- All target precondition hashes are checked before the first write
- Original files are retained under `.agent-kit/backups/<transaction-id>/`
- Backup files use owner-only permissions
- Target writes, validation, ownership state, and transaction history commit as
  one logical transaction
- Any strategy failure restores every completed target and removes newly
  created backup files
- Rollback has a side-effect-free preview plan
- Rollback restores overwritten files and removes files created by the apply
- Rollback refuses targets modified after apply
- Rollback refuses older transactions whose ownership was superseded
- Successful rollback restores previous ownership metadata and records a new
  rollback transaction

## Remaining boundary

- The coordinator currently accepts already-prepared copy and merge plans.
- `managed` and `link` strategy executors are not implemented.
- Rollback of a rollback and arbitrary out-of-order rollback are intentionally
  unavailable.
- CLI and GUI routes are not switched to the common coordinator yet.
- Empty backup directories may remain after a failed transaction; they contain
  no backup data or state and are not considered committed history.
