# Skill snapshot and shared connection plan v1

2026-11-06, PR05. This introduces the source/descriptor/ownership and pure-plan
parts of S03. It does **not** enable link deployment. PR06 must supply directory
migration, transactional publication/link changes, backups, saved-plan replay,
rollback, crash recovery and independent native loading evidence before execution.
Existing common source v1 and copy behavior remain unchanged.

This document records the PR05 staging boundary. PR06 execution and the currently
verified combination are specified in [Skill snapshot deployment v1](skill-snapshot-deployment-v1.md).

## Desired state

Only common Skill definitions opt in to source contract v2:

```yaml
definition:
  schemaVersion: 2
  format: agent-skills
  deployment:
    schemaVersion: 1
    strategy: snapshot-link
    overrides:
      - clientId: antigravity
        surface: cli
        strategy: copy
```

The declared choices are `copy`, `snapshot-link`, and `discovery-reference`.
An override applies to one stable client ID and optionally one surface. An exact
surface override takes precedence over the client-wide override, then the default
strategy. Duplicate selectors, unknown fields/strategies/versions and instructions
v2 fail validation. Old readers reject source v2 rather than silently copying it.
Manifest schema 1/2 and existing resource-management versions are unchanged.

A client capability may explicitly declare
`connectionStrategies: {schemaVersion: 1, strategies: [snapshot-link]}`. Surface
overrides may override that declaration. This is an allowed-strategy declaration,
not runtime evidence. An absent declaration blocks with
`CLIENT_CONNECTION_STRATEGY_UNVERIFIED`. Existing copy runtime evidence cannot
activate another strategy. No production client declaration/evidence is promoted
by PR05. `snapshot-link` and discovery reference execution stay blocked with
their own reasons; neither falls back to copy.

Common source v1 content checks remain in force, including stable Skill name and
explicit tool/provider dependencies. Source v2 snapshot inputs additionally use
bounded import reads and credential scanning across the entire selected bundle.
The new declaration does not convert imported native assets into a portable
common Skill or take ownership of externally managed observations.

## Snapshot descriptor

`schemaVersion: 1`, `kind: skill-tree`, a canonical sorted `files` inventory and
`treeDigest` describe a snapshot. Every file has NFC relative `path`, byte SHA-256,
original permission `mode` and byte count. The digest hashes the deterministic
JSON body `{schemaVersion, kind, files}` without the digest field. File modes,
binary bytes, additions and deletions therefore change the digest. File contents
are retained only in the prepared in-memory input, not public plan JSON.

Limits are 8 MiB total, 1 MiB/file, 256 files, depth 16 and 512 entries including
implicit directories. `SKILL.md` is required. The descriptor rejects unsafe paths,
reserved management directories, duplicate/case/NFC aliases at every path prefix,
file/directory conflicts, non-readable/special modes and unsupported fields.
Source reads reject internal links, empty directories and special files. Larger
existing copy resources remain governed by their original copy contract.

`diffSkillSnapshots` describes CREATE/UPDATE/REMOVE with before/after file hashes,
sizes and permissions. No source scripts or models execute to compute a diff.

## Private store

The fixed host-local store is `~/.agents-kit/snapshots/v1/<treeDigest>/`, containing
`descriptor.json` and `tree/`. It is outside client discovery roots and independent
of a custom Kit root. The snapshot ID is a content identifier, not an asset/tool
ID. Installed ownership continues to use stable asset and consumer IDs.

The `.agents-kit` ancestor must be owned by the current user and not writable by
others. The snapshots/v1 roots are private, real directories; symlink ancestors
are rejected. A completed digest directory and all tree directories are 0500,
descriptor.json is 0400, and file modes remove the original write bits. The
descriptor still records original modes. This is a write-protection convention,
not a promise that the user or operating system cannot alter a snapshot.

`prepareSkillSnapshot` reads the authorized source and inspects any existing
digest directory without creating anything. The infrastructure publisher accepts
only bytes matching the entire descriptor and prepares a private stage before
publication. Reuse requires a full descriptor/byte/mode/tree inventory match.
Additional entries, changed bytes/modes, links, hard-link aliases and unsafe store
parents are drift. Failed/interrupted stages are retained for reviewed recovery;
there is no automatic cleanup or recursive deletion. PR05 tests call publication
only in disposable directories; no client apply path calls it yet.

## Shared connection ownership

Deployment state v6 reads the previous 1/2/4/5 versions. It alone accepts a strict
`sharedVersion: 2`, `strategy: snapshot-link`, `ownership: connection` record with
an exact link string, snapshot descriptor, kit/asset IDs, dependencies and bounded
consumer IDs. Earlier schemas reject these fields. Native or typed ownership
cannot be mixed into that record. Existing writes never downgrade a newer ledger.

Shared Skill planning coalesces one physical path into one connection with all
requested consumers. Same-path different strategies, resources, snapshot bytes
or dependencies conflict. Different physical paths can select different
strategies and revisions. Every requested client still retains its independent
capability/version/binary checks.

Pure connection lifecycle decisions:

- LINK creates the first ownership proposal for an absent target.
- SKIP keeps an identical connection and consumer set.
- REGISTER adds a consumer without replacing the link.
- REPLACE_LINK requires every existing consumer when revision, dependencies or
  link location change.
- RELEASE removes one consumer and keeps the others' connection.
- REMOVE_LINK removes the last connection; the snapshot remains retained.

Unmanaged links, including an identical link, cannot be adopted automatically.
The link text and its previous snapshot inventory must both still match. Parent
symlinks, file parents and scope escapes block before following the leaf link.
Existing copy ownership requires a separate migration plan; its directory is
never replaced as a side effect of selecting a new strategy.

`collectSnapshotReferences` inventories active ownership, transaction history,
merge/baseline parents, saved plans, journals and backups from explicit structured
frames. Unknown/unavailable frames are recorded. Collection is always disabled;
even an apparently complete inventory does not authorize GC or deletion.

## Shared interfaces and execution gate

Existing CLI apply/dry-run, HTTP deployment plan/removal, and GUI deployment
planning call the same services. Public operations include the selected strategy,
snapshot descriptor/status, per-file diff, retained snapshots and consumers.
Plans create no store, client directory, ownership state or link. GUI displays
the fixed-copy plan and disables apply/save for every preview-only operation.

Connection operations carry `previewOnly: true`; server apply rejects them before
opening a state lock or creating backups. Saved-plan publication is also rejected.
Removing the preview flag does not bypass the separate strategy execution gate.
Copy regression paths still apply, register, release and roll back as before.
This staging gate is removed only by the separately verified PR06 implementation.
Discovery reference, native import conversion and real client link loading are
not implied by a passing pure planner test.

Resource bundle v1 refuses common-source v2 at export and validation. Its portable
text contract must not accidentally carry host absolute snapshot paths or discard
the new desired-state semantics. A future bundle version must explicitly define
how to re-plan snapshot bytes at the destination.
