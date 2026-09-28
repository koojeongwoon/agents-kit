# ClientDefinition v2: surface and runtime evidence

CA01, 2026-09-27. Implementation: `lib/domain/client-definition.js`.

## Contract

Schema 1 remains readable. Schema 2 adds `defaultSurface` and `surfaces` to the
existing capabilities. The canonical client IDs remain `codex` and
`antigravity`; omitted surface selects their explicit `cli` default. Explicit
unknown surfaces fail closed, including surface requests against schema 1.

Each surface contains:

- `id`: `cli`, `desktop`, or `ide`; unique within the family.
- `displayName`: user-facing product/surface name.
- `configStore`: logical shared store identifier, not a filesystem path or proof
  of shared runtime support. Host/user/physical-path ownership is CA03 work.
- `detection`: read-only command/root signals. Empty means installation unknown;
  the presence of another surface's command does not prove app installation.
- `capabilityIds`: explicit subset of base capabilities, unique by kind/scope.
- `overrides`: optional changes to path, format, strategy, status, documentation
  evidence or discovery reader. Cannot change asset kind/scope or add unknown IDs.
  `discovery: null` removes an inherited reader, as for UI-only app MCP.
- `runtimeEvidence`: required array, empty for an unverified surface. Each record
  binds `capabilityId`, exact `version`, `platform`, `arch`, `verifiedAt` and
  `source` pointing to reproducible evidence. Synthetic test records stay in tests.
- Optional `resourceProfile`: `mcp-stdio-basic-v1` permits typed stdio MCP without
  environment forwarding; `agent-role-basic-v1` permits typed Agent roles with
  client-default permissions and no native sandbox/MCP defaults. Unknown profiles
  and mismatched capability kinds fail validation. Missing assets/native source
  files cannot satisfy a restricted profile. Adapter validation still applies.
- Optional CLI `binarySha256`: reviewed native executable SHA-256. CA04-7 shipped
  records require it; the application service must observe matching executable
  bytes before preparing writes and recheck immediately before apply.

`evidence.state: verified` means first-party documentation was checked, not that
the product was tested. Automatic eligibility additionally requires an exact
runtime record for the requested capability and local OS/architecture. Versions
require three numeric components; prerelease/build suffixes match exactly.
A leading `v` is normalized; unknown, truncated, or trailing text is rejected.
Runtime evidence cannot override unsupported, UI-only, unverified or manual
capability gates. CLI evidence cannot activate desktop even when stores match.

## API and CLI

`plan` and `doctor` accept optional `surface` and `clientVersion`. CLI options
are `--surface` and `--client-version`. GUI selection uses the same service.
OS/architecture come from the service host, never request-supplied fields.
Plans expose `targetProfile` and stable block reasons:

| Reason | Meaning |
|---|---|
| `CLIENT_SURFACE_NOT_DEFINED` | No explicit contract for this surface |
| `CLIENT_VERSION_REQUIRED` | Exact version missing or invalid |
| `CLIENT_PROFILE_UNVERIFIED` | No matching runtime evidence |
| `CLIENT_RESOURCE_PROFILE_UNVERIFIED` | Resource shape/options exceed evidence |
| `CLIENT_BINARY_UNVERIFIED` | Installed executable does not match evidence |
| `CLIENT_BINARY_CHANGED` | Executable changed after plan; replan required |
| `CAPABILITY_UI_ONLY` | UI contract, no automatic file deployment |
| `CAPABILITY_UNVERIFIED` | Capability support unconfirmed |

Explicit version input is **reported** and cannot establish support by itself.
CA04-7 planning and diagnostics read the first executable in the selected CLI's
PATH and compare its SHA-256 with reviewed evidence. They do not execute it.
Relative executable paths, missing/unreadable binaries and changes during reads
fail closed. A match supplies the recorded version when input is omitted and
sets `targetProfile.versionSource: binary-sha256`. An explicit different version
still fails. A matching version string with different bytes cannot enable writes.
The 512 MiB read bound and fixed-size buffer bound resource use.

Apply rechecks path and bytes. Saved plans bind the observed runtime to their
snapshot and repeat checks on reconstruction and execution. Binary changes require
new planning (`CLIENT_BINARY_CHANGED`, HTTP 409); a new unreviewed build needs new
runtime evidence. Removal and rollback retain their existing ownership-based
recovery paths even when the client is upgraded or removed.

Inventory discovery remains read-only without binary version claims:
`clientVersion: null`, `runtimeState: unverified` are deliberate. The client
catalog separately exposes per-surface reviewed `runtimeEvidence`, including
resource profile and binary hash, with `runtimeState: partially-verified`.
These observations are compatibility evidence, not endpoint integrity or a daemon
execution authorization. Same-byte native executables are supported; wrappers,
alternate CODEX_HOME, remote runtimes and automatic client settings/approval changes
are outside this activation.

Discovery keeps legacy `installed` as an installation signal. Schema 2 also
returns `definitionAvailable`, `installationState`, per-surface inventory and
`runtimeState`; `supported` is false until runtime support is established.
Shared configuration files do not prove installation of every consuming app.

## Compatibility and migration

Old client IDs, Manifest schema, state locations and rollback services remain.
Codex/Antigravity automatic deployment requires reviewed runtime evidence.
CA04-7 enables only its nine reviewed CLI capability slices. This is a documented safety migration;
there is no opt-out switch that converts missing evidence into support.
Existing history and rollback remain available without selecting a new surface.
Other schema 1 clients retain their previous behavior.

Codex agents now target standalone TOML files with copy semantics, avoiding the
existing section-only merger. Existing config sections are left untouched.
Antigravity global MCP now targets `~/.gemini/config/mcp_config.json`. The old
`~/.gemini/antigravity-cli/mcp_config.json` is not moved, rewritten or deleted.
Both migrations require explicit owned-content plans in CA03.

Default local homes/workspaces are the current contract. Alternate CODEX_HOME,
remote execution, model/tool bindings, typed rendering, policy constraints,
physical-store ownership and crash recovery are not implemented by CA01.
They must be evaluated in their subsequent stages before enabling relevant
production profiles. `configStore` alone does not implement safe multi-client
ownership or deployment deduplication.
