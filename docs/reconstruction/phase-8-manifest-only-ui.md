# Phase 8 Manifest-only Product Reset and UI

## Product reset

The user explicitly selected a clean-slate product boundary. Agent Kit no
longer projects, guesses, or deploys legacy directory Kits.

- Manifest is mandatory.
- Legacy CLI apply fallback is removed.
- Legacy deployment HTTP routes are removed.
- Legacy projector code and tests are removed.
- The desktop entry point no longer loads the legacy asset registry, client
  symlink table, or immediate legacy deployment workflows.
- Fresh installation creates only a starter Manifest and one
  Manifest-referenced instruction asset per scope.
- Existing files in a user home or target project are never automatically
  deleted by this reset.

## New desktop workflow

The desktop application now starts on a Manifest Control Plane:

1. Select global or project scope.
2. Select a verified client definition.
3. Enter the target project when required.
4. Create a side-effect-free plan.
5. Review automatic operations and blocked reasons.
6. Explicitly approve apply.
7. Inspect transaction history.
8. Create and approve a rollback plan.

The screen renders the same plan, conflict, history, and rollback contracts as
the CLI and backend API.

## Next boundary

The next slice is a Manifest and resource editor. It must create and update
typed assets and references rather than reviving the removed category-folder
registry.
