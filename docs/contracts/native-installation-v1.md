# Registered native source installation v1

Explicit installation plans connect a registered Kit copy to its original client,
scope, native name and canonical client-definition path. Cross-client conversion,
cross-scope writes and arbitrary destination paths are not inferred.

The first `adopt` plan registers only unchanged accepted-baseline files or the
selected MCP server. It preserves every installation byte, mode and link. It does
not claim client loading/use. A separate `apply` plan checks verified capabilities,
exact-version/resource evidence and observed binary fingerprints before writing.
Unknown native options never bypass those gates. Existing symlinks, symlinked
ancestors and known external-manager resources are fail-closed and remain unchanged.

Deployment state v5 records native file/server ownership and last-applied L
snapshots as references to retained Kit artifacts. Older readers reject v5.
Installed D, last-applied L and desired Kit K are distinct. External D changes
block default apply. Explicit per-file choices are bound to a reviewed state hash;
keep-installed preserves the file and old L, while use-kit requires an explicit
review and retains D in the transaction backup. Deletion requires a separate
remove-deleted choice and proven unchanged ownership. Unknown files are preserved.

`import-installed` performs a Kit-only L/K/D three-way merge through the existing
immutable source-revision service. It leaves the client and L unchanged. Disjoint
edits merge automatically; overlap requires state-bound keep-installed (accept D),
use-kit (retain K), or manual text. Credential-bearing input cannot be promoted
into Kit. A subsequent `apply` may safely accept drift without an overwrite choice
only when a fresh L/K/D merge proves that K already incorporates D. The accepted
upstream baseline B remains independent; installed edits do not silently advance B.

Logical dependencies must resolve before every mode. Writing additionally requires
proven, unchanged installation ownership for each provider in the same client and
scope. Cross-scope dependency installation is not inferred. Provider checks are
conservative at the whole-file hash level; unrelated edits to a provider's shared
config require reviewing/refreshing that provider's installation record first.
Native providers additionally compare their owned file/selected server with the
retained last-applied snapshot. Refreshing another owner's whole-file hash cannot
silently accept a changed dependency. Every managed target of a provider is checked.

MCP owns only one selected native server; its adapter replaces only that JSON
value or TOML table range, preserving all unrelated configuration bytes. Previews
show selected safe fragments, never unrelated credential-bearing configuration.
Existing operational full-file backups remain private (0600), local and outside
the Kit source/baseline. Credentials are not imported into desired assets.

All installation operations use the shared deployment lock, backup store,
transaction, validation, history, rollback and reviewed journal recovery. Native
operations preserve/verify modes as well as bytes. Metadata detach releases native
ownership without deleting client content. Kit registration detach is blocked
while installation ownership remains. Runtime validation is separate from write
verification: this workflow does not invoke MCP commands, models or updaters.

Journal v2 adds reviewed before/after modes and descriptor-derived creation
receipts. Failure and rollback preserve concurrent third-party changes, retaining
the private backup, lock and journal for reviewed recovery. Crash recovery checks
dead ownership and exact target state, modes and created-file identity. Existing
link deployments keep their earlier recovery boundary; this contract neither
converts them nor claims power-loss/fsync or hostile-local-user isolation.

CLI and authenticated GUI/HTTP call the same services. Plan-only operations do
not create deployment files. Apply accepts a single-use, expiring plan ID and
rechecks source/Manifest/definitions/binary/ownership/target preconditions under
the deployment lock. Imported assets stay excluded from implicit deployment.

CLI: `installation --asset <id>` reads L/D/K; `install --asset <id> --mode
adopt|apply|import-installed|detach` plans and applies. `--dry-run` only plans;
`--review <hash> --choices <json-file>` binds explicit choices, `--manual-texts
<json-file>` supplies merged text, and `--remove-deleted` reviews owned removals.
Usual Kit/project/surface/version options apply. No client argument is required
when the registered origin supplies it. HTTP exposes `GET
/api/manifest/installation` and authenticated `POST /api/manifest/installation/plan`
and `/apply`. GUI provides the same four modes and existing history/rollback.

Supported destinations are the original canonical Codex/Antigravity client path
for the imported native format. Additional discovery roots, cross-client/native
conversion, shared snapshot links and mixed typed/native ownership of a single
config file remain separate work. Advanced native Agent/MCP options stay in Kit
unchanged and fail runtime evidence gates unless explicitly covered below.
Test-only profiles do not add shipped runtime support.

The `mcp-native-stdio-options-v1` profile covers a conservatively parsed native
stdio server with `command`, `args`, `env`, `env_vars` and `startup_timeout_sec`.
Unknown fields, unsupported TOML syntax, invalid environment names, literal
credentials and invalid timeouts do not qualify. An adapter-only in-memory Symbol
marks successful classification; a serialized Manifest cannot assert that proof.
This gate does not rewrite or discard any native option. Logical MCP asset IDs
may differ from native names: selection and replacement always use the retained
native ID. The shipped global profile currently requires the exact verified Codex
CLI version and binary hash. Its evidence proves native RPC transport and
environment delivery, separately from model response accuracy. Other clients,
transports and resource profiles do not inherit that result.

Antigravity CLI `1.5.1` also has a reviewed exact-binary global
`mcp-stdio-basic-v1` slice. Safely classified native command/args servers can use
the existing bridge; environment extensions and remote URL definitions do not
inherit this grant. The [live MCP and existing canva roundtrip](../reconstruction/phase-antigravity-native-mcp.md)
preserved the original config, source and ownership. Agent completion is still unverified.

The current existing-resource checkpoint, completed Codex checks, Antigravity
limitations and verification diagnosis are recorded in
[existing native management](../reconstruction/phase-existing-native-management.md).
