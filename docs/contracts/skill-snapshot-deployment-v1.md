# Skill snapshot deployment v1

2026-11-06, PR06. Extends the [PR05 source/descriptor/connection contract](skill-snapshot-plan-v1.md)
with execution, directory strategy migration and recovery. Common source v1 and
ordinary copy deployment keep their existing interfaces. Imported native resources
still require their own explicit installation/conversion flow. External manager
links, including ego-browser, remain observation-only.

Plans mixed with PR07 physical-store ownership additionally follow the
[physical-resource ledger and saved-plan contract](physical-resource-deployment-v1.md).

## Execution gate and native support

Source v2 must explicitly select `snapshot-link`. A client capability must allow
that strategy, and a runtime record must match the exact client version, OS,
architecture, surface and executable SHA-256. The record must explicitly contain
`strategy: snapshot-link` and `resourceProfile: skill-snapshot-link-v1`. A copy
record never authorizes links. Unsupported strategies never fall back to copy.

The initial activated combination is Codex CLI **global** Skills,
`0.166.0-alpha.6`, macOS arm64, the exact executable identified in
[native evidence](../reconstruction/native-global-codex-snapshot-skills-20261106.json).
Project, app, IDE and other builds remain gated independently. The
[official Skill documentation](https://learn.chatgpt.com/docs/build-skills)
documents user/repository discovery and following linked Skill directories;
the local lifecycle probe is the execution evidence for this build.

Antigravity `1.5.1` linked global Skills are **not activated**. The initial
[probe](../reconstruction/native-global-snapshot-skills-attempt1-20261106.json)
proved deployment/restoration, but produced a permission notice without a
supporting-file read or model answer. This is insufficient loading/use evidence.
Its existing copy support remains available when explicitly selected.
[Antigravity permissions](https://antigravity.google/docs/permissions) describe
approval for reads outside the workspace. The observed notice makes that a
candidate cause, not proof of a specific denied path. No user permission rule is
changed to make this probe pass.

## Atomic filesystem adapter

Link transactions require Python 3 and a filesystem supporting exclusive rename
and atomic exchange. `AtomicPathMover` runs a static, embedded `ctypes` bridge
using Python `-I -S`, without shell or source/package scripts. Parent components
are opened as directories with no-follow flags. Paths are separate argv values.
The desktop backend includes this bridge in its JS bundle.

- macOS uses `renameatx_np` with `RENAME_EXCL` and `RENAME_SWAP`, defined in the
  [Apple system header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stdio.h).
- Linux uses `renameat2` with `RENAME_NOREPLACE` and `RENAME_EXCHANGE`, described
  in the [Linux manual source](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/637b0aa571b61d98c717e7ab7490df8a3d9e4841/man/man2/rename.2).

The planner probes helper availability without creating client/store files. The
executor also checks before changes. Missing helper, unsupported filesystem or
cross-device operation fails closed. There is no copy/delete emulation. A passing
Linux primitive test would not activate an unverified Linux client profile.
Existing regular-copy plans do not require this helper.

## Transaction boundary and retained artifacts

Any plan containing a snapshot connection executes all of its mutable operations
in one tree-aware transaction, including instruction or MCP file operations.
There is one scope ledger lock; reviewed Manifest, definitions, source revision,
binary, target images and ownership are checked again before installation and
state commit. Pure planning remains free of store and client writes.

The transaction creates a private backup directory under the scope metadata root:
`backups/<tx-id>/`. Its tree-image backups contain bounded binary bytes, modes
and empty directories, with hashes recorded in the ledger. Each fresh target
image is staged as `####.stage` outside client discovery. Snapshot publication is
exclusive, verifies the whole descriptor/tree and retains a losing stage on a
publication race. File and directory synchronization orders staging, publication,
target replacement and ledger commit.

For an absent target the stage moves with exclusive rename. For an existing
directory or link it exchanges atomically with the stage. The original object
remains at the private stage path; an ordinary failed validation exchanges it
back, preserving its inode and permissions. Removal moves the original to that
private path. Unknown client contents are never recursively deleted.

`transaction.json` retains structured artifact/publication references even after
the active journal is closed. Snapshots, original trees, failed stages, backups
and transaction history remain retained. There is no garbage collection.
This is process-crash recovery tested with SIGKILL, not a power-loss or complete
machine disaster-recovery certification.

## Explicit copy/link directory migration

Changing desired strategy does not replace an existing owned directory during
ordinary apply. Call the shared `planMigration` service with
`migration: skill-strategy`, explicit Skill IDs and every affected consumer.
CLI, HTTP and GUI expose that same service and require review before applying.

For copy→link, every existing file must have matching Kit/asset/dependency and
shared-consumer ownership, unchanged bytes, and no additional files or empty
directories. Missing owned files, unknown ownership and user edits block. Legacy
single-client ownership first needs its separate metadata migration. The complete
original directory and ownership map are backed up before the exchange.

Connection schema 2 records the original directory modes. Link→copy materializes
the selected common Skill revision using original descriptor file modes and that
directory-mode lineage; all consumers must participate. It restores per-file copy
ownership. Migration includes only the selected Skills and their dependency
closure; a dependency requiring a separate mutation blocks the migration.

Example using an existing Kit with an explicitly changed desired strategy:

```bash
node bin/cli.js migrate --kit /path/to/kit --client codex --surface cli \
  --client-version 0.166.0-alpha.6 --migration skill-strategy --assets review --dry-run
```

Omit `--dry-run` only after reviewing the plan. Project selection adds
`--project /path/to/project`; it still requires independent project runtime
evidence. `--targets '[{"clientId":"codex","surface":"cli","clientVersion":"…"}]'`
selects a batch for both apply and strategy migration. Different paths may keep
different revisions; updates of one shared physical path require all consumers.
Releasing one consumer keeps the other consumers' link. Removing the last one
retains its snapshot.

## Saved plans, rollback and interrupted recovery

Snapshot and directory-migration saved plans use body v2,
`contract: tree-deployment-v1`. Replay reconstructs the same application plan and
checks its context/body digests, expiry, source, definitions, executable, target
and ledger. Existing body v1 plans remain readable; older readers reject v2.

Rollback validates the affected ownership map, target image, backup hash and every
referenced snapshot. A later owner, overlapping transaction, edited target or
corrupt retained snapshot blocks it. Explicit rollback restores bytes, modes and
ownership from the verified backup image; it need not preserve the original
inode. It uses the same transaction engine and can itself be recovered.

Journal v3 records publication, stage and target identities, fingerprints, state
hashes and the owning lock identity/token. Recovery checks that the owner is dead
and produces a review plan. It restores provable exchanges, keeps a provably
committed state, and preserves ambiguous concurrent edits with a blocked journal.
An external edit before any swap stays untouched. A process killed during
recovery can be reviewed again; its abandoned recovery guard is retained.
Lock cleanup releases only its own file identity/token, preserving replacements.

The same CLI `recover` and HTTP/GUI recovery flow handles older file journals and
the new tree journals. Recovery never guesses ownership from an external link or
follows an arbitrary snapshot target.

## Verification boundary

Unit/service and HTTP/GUI fixtures test planning, migration, consumer changes,
mixed-operation rollback, saved replay, collisions, stale sources/policies,
snapshot tampering, and SIGKILL in publication/apply/rollback/recovery. Synthetic
client definitions do not count as native support evidence.

The opt-in `npm run verify:snapshot-skills -- …` verifier uses fresh random global
Skill IDs, separate probe-only definitions and the normal deployment/rollback
services. It checks source-only edits, immutable update and removal retention;
three model turns read the applied, updated and restored snapshot. Supporting
reads must name the installed link or recorded snapshot path and return the
unpredictable marker. Reading the editable Kit source cannot pass. Codex native
discovery is checked separately, including baseline and removal. Raw transcripts,
reasoning, credentials and user file contents are not stored in reports. Probe
execution never modifies production definitions automatically.
