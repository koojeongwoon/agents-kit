# Phase 14 — GUI End-to-End Verification

## State

Completed against an isolated Kit, home directory, and target project.

## Browser Flow

The real Vite UI and Express backend completed:

```text
Project scope and Codex selection
  -> target path input
  -> deployment plan preview
  -> explicit apply approval
  -> committed transaction history
  -> rollback plan preview
  -> explicit rollback approval
  -> rolled-back history state
```

No browser errors or warnings remained after the flow.

## Defects Found

1. The default backend repository root resolved one directory too high, so
   packaged and development startup could not find `clients/*.yaml`.
2. A backend restart invalidated the in-memory GUI token and left mutations
   blocked until a full page reload.

The repository root now resolves from `gui/server` to the actual project root.
Mutation requests refresh the session token and retry once after a 403.

## Gate

- Default client definitions load without injected test paths.
- Plan, apply, history, rollback plan, and rollback work through the GUI.
- A restarted backend session recovers without reloading the page.
- Rollback removes the owned target file and retains harmless empty parent
  directories.
