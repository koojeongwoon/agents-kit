# Kit source editing and local upstream merge

2026-11-05. Implements the requested continuation after
[source registration](phase-shared-resource-import.md).
Contract: [source revisions v1](../contracts/source-revisions-v1.md).

## Delivered

- The shared application service exposes Kit source reads, edits, local upstream
  checks, B/K/U refresh, conflict resolution and retained-state rollback.
  CLI, authenticated HTTP and GUI call those same services.
- Record v2 separates accepted upstream files from current Kit files. Edits
  create a new tree under `assets/revisions` and commit only the Manifest pointer.
  Existing source/baseline trees, metadata, binary attachments and executable
  permissions remain preserved. No original client file or link is written.
- Source edits require the loaded revision token. File add/update/delete and
  permission changes show before/after content and Manifest changes before apply.
  Changes cannot escape the selected Kit or delete its required primary file.
- Refresh re-discovers the registered local origin and checks its binding,
  first-hop link text, external-manager classification and deployment ownership.
  Missing origins keep Kit state; Kit deployment targets cannot masquerade as
  independent upstreams. Known external resources are rejected before body reads.
- B/K/U file comparisons include additions, deletions, metadata, modes and binary
  content. Bounded non-overlapping line edits merge automatically; JSON MCP
  objects also merge independent fields. Overlap, delete/modify and ambiguous
  binary changes require explicit choices. Source text is never executed.
- Upstream/manual acceptance advances the accepted baseline only for those files.
  Keep/defer retains both Kit and accepted B for the chosen file. Remaining changes
  remain visible on the next check; repeat deferral of the same state is a no-op.
  Manual choices are bound to the exact review hash of B/K/U.
- Immutable, hashed checkpoints retain previous Kit pointers, accepted baseline
  and deferred state. Rollback is a new plan/transaction; it restores those
  together while retaining history and leaving the upstream untouched.
- Import record v1 upgrades only when a real edit/refresh is committed. The plan
  warns that older registration-only readers cannot read record v2. Existing
  detached sources can reattach their retained Kit/baseline while upstream has
  changed, without silently accepting the update.
- The existing scope lock, stale checks, atomic Manifest switch and rollback now
  include revision trees, accepted baselines and checkpoints. Journal v2 supports
  reviewed dead-owner recovery and descriptor-derived creation receipts for these
  paths. Concurrent same-byte creations are never erased by failed-create cleanup.
  Source/baseline tampering, unknown
  files, collisions, changed origins and changed checkpoints block apply.

## Interfaces

| Action | CLI | HTTP |
|---|---|---|
| Read current Kit/files/history | `source --asset <id>` | `GET /api/manifest/source` |
| Edit Kit | `source-edit --asset <id> --revision <token> --changes <json-file>` | `POST /api/manifest/source-edit/plan`, `/apply` |
| Check local origin | `updates --asset <id>` | `GET /api/manifest/upstream/check` |
| Reimport/merge | `refresh --asset <id> [--review <hash> --resolutions <json-file>]` | `POST /api/manifest/refresh/plan`, `/apply` |
| Restore checkpoint | `source-rollback --asset <id> --revision <token> --checkpoint <id>` | `POST /api/manifest/source-rollback/plan`, `/apply` |

Usual scope/Kit/project options and `--dry-run` apply. No client argument is
needed for these registered-source actions: the origin comes from the record.
Plans expire in five minutes and are single-use. Inputs contain logical resource
IDs and file changes/resolutions; callers cannot supply filesystem operations or
arbitrary origin/checkpoint paths. Changes JSON is bounded to 2 MiB per plan.

GUI imported cards provide **Kit 사본 편집**, **업데이트 가져오기**, and **이력·복원**.
Dirty editor drafts must be applied or explicitly discarded before switching
these operations. A changed draft or conflict choice invalidates apply until a
new preview. Failed apply preserves the editor draft. External cards keep no
mutation buttons. All source actions say that existing installations stay intact.

## Verification

Final results: root **286 passed / 2 skipped** (288 total), HTTP **24 passed /
1 skipped** (25 total), GUI **47 passed** (10 files). GUI typecheck, frontend and
backend desktop builds, Cargo check, Markdown links/fences and diff checks passed.

- Domain/service tests cover all four native kinds, supporting metadata/binaries,
  permissions, UTF-8 BOM/CRLF, portable names, disjoint and overlapping edits,
  additions/deletions, selected JSON MCP fields, native credential/sibling-server
  rejection, partial acceptance and repeated deferral, immutable rollback and
  reattachment. A matrix of 190 distinct text-edit pairs checks disjoint merging.
- Stale revision/review/upstream checks, source/baseline/checkpoint tampering,
  new-file collisions, link retargeting, unavailable/newly external origins and
  Kit-owned origins are tested. Ordinary faults and an upstream change during
  refresh restore Manifest/source/baseline/checkpoint together. Real child-process
  SIGKILL before/after record-v2 commit verifies journal-v2 recovery.
  Concurrent same-byte creation is preserved on failure; an unreceipted created
  file blocks automatic recovery rather than being removed.
- CLI exercises edit dry-run, apply, local update check, automatic merge and
  rollback without a client argument. HTTP exercises all new mutation session
  gates, literal-secret response redaction, single-use plans, stale tokens,
  conflict blocking, deferral, manual merge and rollback.
- GUI tests exercise revision-bound previews, explicit apply, unsaved draft
  retention, disabled operation switching, B/K/U conflict selection and bound
  re-preview, and checkpoint selection.
- Actual ego-browser review used an isolated synthetic home and Kit. It completed
  edit → non-overlapping merge → conflicting update/addition → defer/partial
  acceptance → manual merge → prior-state rollback. Filesystem assertions verified
  restored K, B and deferred state, preserved independent upstream, retained added
  files and unchanged synthetic ego-browser link. Its external card had zero
  buttons. TaskSpace 21 was finished and the temporary server stopped. Screenshot:
  `/private/tmp/agents-kit-source-merge-ui.png`.

## Remaining boundary

This implements local-source Kit management. It does not acquire installation
write ownership, reconcile installed D/L state, deploy imported native sources,
or add Git/package source adapters, snapshot links or cross-scope dependencies.
Source/refresh rollback never rewinds an external updater or client installation.

The subsequent [native installation phase](phase-native-installation.md) adds
explicit same-client ownership and installation D/L/K reconciliation through a
separate deployment transaction. The source-only guarantees above still apply to
the edit/refresh/checkpoint operations delivered in this phase.

File-level resolutions are supported; manual merged text resolves finer changes.
JSON MCP structural merge and selected native MCP validation are conservative.
Other native Agent/instruction bodies remain preserved text with filesystem and
credential checks, without claiming client syntax/runtime validation. Unsupported
MCP syntax, overly expensive text comparisons and ambiguous binary edits fail
closed or require a choice. History is capped at 1,024 checkpoints per resource;
there is no automatic GC. Existing import size/depth/link restrictions and
no-fsync/power-loss/hostile-local-user-isolation limitations remain applicable.
