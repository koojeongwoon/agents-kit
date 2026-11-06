# Selected resource import v1

2026-11-05. Implements the source-registration prerequisite of S02-3/4. Existing client
files, links and credentials remain unchanged. This does not transfer ownership
of an installed client file or bypass deployment ownership/runtime gates.

## Desired state

Manifest schema 1 remains readable and keeps its normalized shape. Import
upgrades the selected scope to schema 2, with
`management: {schemaVersion: 1, resources: {<assetId>: <record>}}`.
Older readers reject schema 2 instead of ignoring management metadata.
An existing schema-3 Manifest retains schema 3, qualified references, target
selections and its canonical project name. Its source-management plans validate
companion source graphs and bind their snapshots/locks through the existing
scoped edit guard. This does not enable schema-3 native installation writers.

A record identifies the asset's kind, `active`/`detached` registration, source
locator (client/surface/scope/root/path/candidate ID), native format/name, a
bounded file inventory and fingerprint, and a Kit-relative baseline location.
The imported asset has a Kit-relative `source` under `assets/imported/<id>`.
The accepted baseline lives under `.kit-sources/baselines/<id>/<fingerprint>`.
These are source artifacts, not client installation paths or tool relationships.
All dependency relationships continue to use logical IDs.

The first import preserves native content, including Skill metadata and Agent
options. Native imports are source-only and excluded from implicit deployments;
explicit deployment is blocked with `IMPORTED_RESOURCE_DEPLOYMENT_NOT_ENABLED`.
Original-client deployment uses the separate explicit
[native installation contract](native-installation-v1.md); common conversion
remains separate. A raw native option is never claimed to enforce a
Kit policy. Existing installation ownership is not inferred from matching bytes.

## Selection and read boundary

The caller selects a discovery candidate and asset ID. The service re-discovers
the candidate in its declared client/surface/scope; it accepts no arbitrary
source path or caller-supplied file operations. External-manager candidates are
rejected before content is opened. Unknown root links must resolve inside the
authorized source scope; the original link is never replaced. Internal links,
special files, empty subdirectories and SCM/Kit metadata directories are rejected
rather than omitted. Other clients' formats are accepted only where the native
reader can preserve the selected content; conservative TOML parsing rejects
multiline values, inline assignment comments and duplicate selected keys/tables.

Bounds: 8 MiB total bytes, 1 MiB per file, 256 files, depth 16 and 512 entries.
Files are read through bounded descriptors and rechecked at apply. Recognized
credential literals, private keys and inline credential assignments are blocked
without returning their values. MCP imports include only the selected server;
unsupported parsing or required credential binding fails without modifying the
original configuration. No installation script, MCP command or client is run.

## Plan, apply, detach and recovery

Import plans show the new asset, source inventory/fingerprint and Manifest diff.
They do not write sources, initialize a Kit or modify client files. Apply requires
the single-use plan ID, revalidates the Manifest and selected source, then creates
the source and baseline before atomically committing the Manifest. Existing paths
are never overwritten without a recorded matching artifact. Repeated import of
an unchanged registered source is a no-op; changed origins require reimport/merge
in a subsequent contract instead of silently replacing Kit edits.

Detach removes the chosen desired asset/target selections and marks its source
record detached. Logical dependants and deployed ownership block unsafe detach.
Original installation files, source artifacts, baselines and deployment history
are retained. A later reattachment may reuse only artifacts verified against the
detached record; changed or untracked files block that reuse.

The scope uses a shared management lock and a versioned pending journal. Client
file deployment is never part of this transaction. Interrupted source mutations
block Manifest use and further editing. Reviewed recovery checks a dead lock
owner, exact authorized paths, Manifest pre/post hashes and every created file.
If the Manifest did not commit, only exact created files are removed. If it
committed, verified artifacts are retained. External changes block recovery.
Ordinary exceptions restore the previous Manifest and remove exact new files;
empty directories and interrupted temporary writes may remain. A crash before
the journal exists can leave a lock requiring manual review; automatic recovery
does not claim or delete unproven locks. No automatic recursive deletion or lock stealing
is performed. This does not claim power-loss/fsync or hostile-local-user isolation.

CLI and GUI use the same application services. HTTP mutations retain the existing
session/origin checks. Apply accepts only plan IDs. Schema 2 is explicitly outside
resource bundle v1; it cannot be exported with management metadata silently lost.

CLI: `import --client <id> [--surface <id>] --candidate <candidateId>
[--asset <assetId>] [--source-scope global|project]`, `detach --asset <assetId>`,
and `recover-sources`. The usual `--kit`, `--project`, `--project-name` and
`--dry-run` options apply. Plans expire after five minutes and are single-use;
they are not persisted for resume. HTTP plan/apply pairs live under
`/api/manifest/import`, `/api/manifest/detach`, and `/api/manifest/source-recovery`.
GUI shows import only for ordinary candidates, and detach only for registered
sources. Matching candidate IDs connect provenance without asserting client
installation ownership. Generic Manifest edits cannot modify/delete imported
assets. The implemented [revision contract](source-revisions-v1.md) tracks Kit
edits independently of the accepted upstream baseline. Reattachment keeps the
verified retained Kit/baseline even if upstream changed, without accepting that
update. Existing typed assets use their complete fetched
definition when edited, preserving native names and named scopes.
