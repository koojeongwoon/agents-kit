# Local resource observation v1

2026-11-05. This is a read-only Configuration and Distribution Plane contract.
An observation does not register desired state, establish ownership or prove
client loading. Existing deployment and runtime gates remain unchanged.

## Interfaces and compatibility

- `agents-kit discover [--project <absolute-path>] [--client <id>] [--surface <id>]`
- `GET /api/local-discovery` (global default)
- `GET /api/local-discovery?scope=project&projectPath=<absolute-path>`
- Both use `manifestDeploymentService.localDiscovery`. Project paths pass the
  existing filesystem authorization and self-target guards.

The response retains `clients`, legacy `assets` and per-surface `assets`. New
`observations` arrays preserve candidates with the same name at different paths.
Schema 2 consumers use the effective surface's observations, including overrides.
The legacy family inventory remains a compatibility projection, not a combined
view of every surface. Explicit CLI surface selection projects the selected
inventory to the top level as well.

Each observation contains:

- `id`, `kind`, `clientId`, `scope`, optional `surface`.
- `candidateId`: SHA-256 of kind, scope, local path and config selector. It is an
  inventory identity, never an authorization token or Manifest asset ID.
- `sourcePath`: discovery root; `path`: exact entry path; optional `selector`.
  Home-relative paths use `~/`; an external resolved path is displayed as absolute.
- `entryType`: `file`, `directory` or `symlink`.
- `managementMode`: `unmanaged` or `external`. Neither grants Kit ownership.
- Links: `linkTarget`, optional `resolvedTarget`, and `linkState` (`resolved`,
  `broken`, `loop`, `unreadable`, `unsupported`, or `unverified`).
- Optional `externalManager`: an ID and display name matched through the client
  definition's declared link target. This is a source association, not publisher
  authentication or an integrity check. Other links retain unknown ownership.

Schema 1 definitions remain readable. Client discovery definitions add
`agent-files` and `file-name` readers; existing readers remain available.
`discovery.paths` adds at most eight locations. `externalManagers` declares up to
eight `{id, displayName, linkTarget}` entries, using home-relative link targets.
Client paths and external-manager associations live in definitions, not client
name branches in the application service.

## Read boundary and lifecycle

Discovery reads directory entries, names of configured MCP servers, and link
metadata. It does not read Skill, Agent or instruction bodies. Resolving a link
outside home for display does not authorize opening the target's content.
Directory roots still pass canonical scope checks; an escaping linked discovery
root is not traversed. Broken/cyclic resource links stay visible and emit issues.
One malformed source does not prevent other sources from being observed.
Structured files are bounded to 1 MiB; directory readers to 512 entries.

Known external links such as ego-browser are displayed read-only with their
manager and connection state. They have no import, update, edit or deployment
actions, baseline, Kit revision or ownership record. Refreshing the inventory
does not create update tasks, rewrite the link, copy app resources or start the
external updater. Agent subdirectories are scanned only at the standard single
level; linked directories are never recursively scanned.

GUI rows use observation identities and stay separate from same-named Manifest
resources. The [source-registration contract](resource-import-v1.md) may connect
provenance using an exact candidate ID; this does not acquire client-file ownership. Repeated
surface observations of one candidate can share a row; this does not prove
those clients loaded the resource.

Kit path resolution no longer initializes a Kit. `init` remains the explicit
starter creation command. Existing Kits and path precedence (`--kit`, then
`AGENTS_KIT_DIR`, then the default home path) remain compatible. Opening the GUI,
discovering resources, or running `--dry-run` does not create starter Manifests.

## Remaining implementation

Source registration and detach are implemented separately in the import
contract. Kit editing and local upstream merge use the [revision contract](source-revisions-v1.md).
Installation ownership adoption, client reflection, snapshot links and cross-scope dependencies retain the staged work in the
consolidation plan. Observation IDs are not proof of installation ownership.
