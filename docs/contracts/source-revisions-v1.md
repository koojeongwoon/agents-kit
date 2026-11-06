# Kit source revisions and local upstream refresh v1

Kit edits and local refresh are reviewed source-management transactions. They
never write an original installation, external link, updater or deployment ledger.
External-manager resources remain observation-only. Native installation ownership
and D/L deployment reconciliation use the separate [installation contract](native-installation-v1.md).
Pinned Git/npm connections extend this contract through [upstream sources v1](upstream-sources-v1.md).
Skill variants reuse this engine through [variant source lifecycle v1](skill-variant-sources-v1.md).
That contract gives each asset/variant pair its own record, baseline and subject-bound checkpoints.

Resource management record version 2 separates accepted upstream `files`/baseline
from current `kitFiles`/source. Version 1 records upgrade only on an applied edit
or refresh. New source trees use `assets/revisions/<assetId>/<revisionId>/`.
Previous states are retained as hashed checkpoints under `.kit-sources/revisions`;
their source trees and baselines are never collected automatically. Older readers
reject record/journal version 2 instead of ignoring these semantics.

Source editing requires the revision token from the complete source read. Bounded
UTF-8 file create/update/delete and permission changes produce an immutable
revision and Manifest diff. Unknown metadata, support files and binary files not
selected for editing survive. Required primary files remain mandatory. Credential
scanning and native MCP validation apply before any new source is written.

Local refresh reads only the stored, re-discovered local locator inside its authorized
scope. Missing/unreadable sources preserve Kit state. Link retargeting and locator
or format changes require a separate binding review. Kit-managed deployment
targets cannot be treated as an independent upstream.

Plans compare the accepted baseline B, current Kit K and new upstream U per file,
including additions, deletions and modes. Identical/one-sided changes are resolved
directly. Bounded line-based three-way merge combines non-overlapping UTF-8 edits;
overlaps, binary ambiguity and delete/modify cases become explicit conflicts.
Native JSON MCP fields are also merged structurally. No model or source command runs.

Conflicts require upstream acceptance, manual merged text, or keeping/deferring
the Kit file. A keep/defer preserves that file's accepted baseline so remaining
upstream differences stay visible. Accepted files advance their own baseline;
partial acceptance is never recorded as full acceptance. Resolutions are bound
to a review token covering B/K/U; a changed review requires new choices.

Apply rechecks the Manifest, current/baseline artifacts, upstream snapshot and
reused files. The shared scope lock and journal create immutable source trees,
accepted baselines and checkpoints before atomically switching the Manifest.
New journal-v2 transactions record device/inode receipts from each created file
descriptor. Rollback never removes a same-byte file whose creation failed or
whose identity changed. Recovery refuses an existing planned file without its
creation receipt; the create/receipt interruption window requires manual review.
All existing stale, rollback and reviewed dead-owner recovery rules still apply.
Revision rollback restores the selected Kit content, baseline and deferred state
through a new reviewed transaction, retaining history and never reverting upstream.

CLI and authenticated HTTP/GUI call the same application service. Plan IDs remain
single-use and expire after five minutes; restart requires a new plan. Check and
preview are read-only. File/byte/depth bounds follow import v1; history is bounded
to 1,024 checkpoints per resource without silently dropping older entries.

Canonical Manifest-v3 sources can use the same source lifecycle without being
downgraded. Companion source changes invalidate review, and a detected companion
change during commit restores only the selected source transaction. Direct native
installation from Manifest v3 remains blocked pending separate coordination work.
