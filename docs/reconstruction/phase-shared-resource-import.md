# Shared resources: selected source registration

2026-11-05. The source-registration prerequisite of S02-3/4 and part of S06,
following [observation](phase-shared-resource-observation.md).
Contract: [resource import v1](../contracts/resource-import-v1.md).

## Delivered

- Manifest schema 2 with versioned source provenance, native name/format, bounded
  inventory, accepted fingerprint, baseline and active/detached registration.
  Schema 1 remains compatible. Old readers reject schema 2; bundle v1 rejects it.
- One shared application service for selected candidate import, detach and
  reviewed pending-journal recovery. CLI and authenticated HTTP expose separate
  plan/apply calls; GUI requires a preview before applying.
- Original instructions and Agent files stay byte-identical. Skills keep
  metadata, supporting files and executable modes. MCP adapters preserve only
  the selected native server, retaining unknown supported fields and excluding
  other servers. Unsupported syntax fails without dropping fields.
- Source-only copies and baselines are created under the selected Kit scope.
  Original client files, directory positions and symlink text are never written.
  Known external-manager candidates are rejected before source bodies are read.
- Source fingerprints and Manifest hashes are rechecked at apply. Existing paths
  are not overwritten. An unchanged registered source is a no-op. Reattachment
  requires the exact retained inventory; untracked/modified files block reuse.
- Detach retains the original installation, Kit sources and baselines. Logical
  dependants and deployed ownership block detach, including ownership acquired
  after its plan. Pending deployment transactions also block it.
- Scope locks, unique temporary files and a journal commit source artifacts before
  Manifest replacement. Ordinary faults restore the Manifest and remove only
  exact new files. Reviewed recovery proves a dead owner and verifies paths,
  modes, Manifest pre/post hashes and created-file hashes before modifying Kit.
- Existing Manifest editing shares this lock/journal, rejects imported-resource
  generic edits, fixes the stale-edit error and preserves existing `.tmp` files.
  The GUI fetches complete existing typed assets rather than reconstructing them
  from registry summaries, retaining definitions, native names and named scope.
- Imported source cards connect only by exact candidate ID and explicitly say
  “Kit 원본 등록”. Their native sources are excluded from implicit deployment;
  explicit deployment is blocked. External-link cards keep zero mutation buttons.

## Validation

Final automated results: root **269 passed / 2 skipped** (271 total), HTTP
**23 passed / 1 skipped** (24 total), GUI **43 passed** (9 files).
GUI typecheck, desktop frontend/backend build, Cargo check and diff checks passed.

- Root automated tests include all four kinds, selected MCP extraction, Skill
  metadata/script modes, source and Manifest staleness, collisions, credential
  literals, source bounds/links/metadata, project authorization, detach references
  and deployment ownership, schema migration and unchanged legacy selection.
- Real child-process SIGKILL before/after Manifest commit verifies blocked
  readers and reviewed cleanup/retention. Recovery refuses modified files,
  forged paths, live owners and stale journals. Fault injection covers ordinary
  journal/source/Manifest failures.
- HTTP covers session requirements for all six new mutation endpoints,
  plan-only purity, single-use plan IDs, ignored caller-supplied paths, registry
  provenance and original preservation after detach. CLI covers discover →
  dry-run → import → detach without requiring a client for detach.
- GUI covers explicit preview/apply, changed-ID invalidation, failed apply,
  detach preservation wording, external no-action cards, exact provenance
  connection and complete typed definition roundtrip.
- Actual browser review used isolated synthetic home/Kit resources. An ordinary
  Skill with `agents/openai.yaml` completed preview → import → detach. Original
  bytes, retained Kit copy and synthetic ego-browser link were verified unchanged;
  the external card had zero buttons. No real user source or client installation
  was imported or changed. Screenshot: `/private/tmp/agents-kit-imported-source-ui.png`.

## Explicit follow-up boundary

This phase delivered source registration. Subsequent [source revisions](phase-source-revisions.md)
implement Kit editing, local reimport/merge and checkpoint restoration. Deployment
of imported native sources, client-file/section ownership, snapshot links and
cross-scope dependencies remain separately tracked in the
[consolidation plan](../product/shared-resources-consolidation-plan.md).
Existing client deployment support and runtime evidence were not expanded.

Empty subdirectories/internal links/special entries are rejected. Native TOML
parsing is deliberately conservative. Recognized secret scanning cannot prove
the absence of every possible credential. Locks with no verifiable journal and
interrupted recovery guards require manual review. This does not claim durable
fsync/power-loss or hostile-local-user isolation; recursive cleanup/GC is absent.
