# Physical Agent/MCP store deployment v1

2026-11-06, PR07 S04-1. This extends the common application deployment service
to combine verified typed contributions for the same physical configuration store.
It does not change the client-neutral Agent/MCP desired-state definitions, grant
native support to an app/IDE, or introduce an agent runtime.

## Composition boundary

Each requested client/surface independently passes its existing capability,
exact-version, platform/architecture, resource-profile and binary checks before
its generated contribution can participate. One failed request blocks the whole
deployment. An eligible CLI cannot authorize an unverified app that reads the
same file. Client paths, store IDs and formats remain in client definitions;
conversion remains in the Agent/MCP adapters.

The application authorizes the physical target and groups typed contributions.
The pure `composePhysicalResourceContributions` model checks the common store ID,
scope, format, strategy, logical resource identity, dependencies and selectors.
Distinct MCP selectors in one file compose. Matching selector values combine
reader IDs; different values, dependencies, resource IDs or stores conflict.
JSON field order does not create a false conflict or an order-dependent plan.
Generated MCP selectors must belong to the declared asset. Agent files require
identical content and one logical asset. No client version or capability check
is discarded when contributions are combined.

The new executor path is selected for more than one reader of a physical target,
or a target already using physical ownership. Existing single-reader typed plans
continue using their v1 records. Native imports, legacy source files and common
Skill/instruction contributions keep their separate ownership contracts. They
cannot overwrite a physical record through the old merge/copy helpers.

## Ownership and compatibility

The first physical ownership write upgrades the scope ledger to **schema 7**.
The reader accepts prior schemas 1/2/4/5/6, preserves their records and never
downgrades on rollback. Older readers reject schema 7. Physical records cannot
be embedded in an earlier ledger schema or mixed with native/shared ownership.

`physicalVersion: 1` owns either an Agent file or structured MCP units. Its
resource identity is:

```json
{
  "version": 2,
  "kitId": "personal",
  "assetId": "docs",
  "assetKind": "mcpServers",
  "configStore": "codex-local",
  "scope": "project",
  "format": "toml-section",
  "dependencyIds": [],
  "targets": [
    {"clientId": "codex", "surface": "cli"},
    {"clientId": "codex", "surface": "desktop"}
  ]
}
```

The targets in this example illustrate the ownership shape; production desktop
runtime support remains gated. File paths stay in the existing managed-target
key. Relations use stable Kit/asset/client/surface IDs and logical dependency
IDs. Reader identities are bounded, sorted and unique; coercible values,
unknown fields, selector mismatches and unsupported versions fail validation.

A proven typed v1 record can be upgraded while adding readers. Its original
client must participate, every retained owner needs complete typed identity,
and store/scope/format and file/unit hashes must still match. An unchanged
upgrade is metadata-only and preserves the file inode. Unknown legacy ownership,
unmanaged identical settings and imported native ownership are not inferred or
adopted. Restoring its transaction restores the exact old ownership record while
keeping the ledger schema readable only by new readers.

## Update and removal semantics

Agent/MCP operations change the **configuration in the store**. A verified
reader can update it while retaining the full list of previously recorded
readers. This list describes affected readers, not a separate Skill consumer
lease. Removing a typed resource deletes the owned file/selector for the store;
it never reports a successful removal by releasing only the selected surface.
Other readers may need to reload. Running processes, authentication and active
sessions are outside this configuration change.

The plan exposes `storeEffect: configuration`, `configStore` and
`affectedTargets`. CLI JSON, HTTP, GUI review and saved-plan review carry the
same effect. GUI names the affected client/screens before approval. The list
covers readers known to Kit; other software may also read that physical file.

Removal checks the selected surface's documented capability, actual path,
format, store, scope and recorded client identity. A changed definition path
still blocks and requires the separate PR08 migration workflow. Removing an
MCP entry preserves other servers and user settings. The MCP file remains even
after its last Kit entry is removed. Existing JSON/TOML preservation limitations
remain those of the [typed removal contract](typed-resource-removal-v1.md).

The post-removal dependency graph checks every recorded client affected by a
physical deletion, including native and common-resource dependents. Removing a
Manifest reference does not erase the last deployed dependency. A required
provider blocks until dependents are explicitly included or safely updated.
Native installation dependency proof also recognizes a verified physical-store
provider; it still checks the installed bytes.

## Apply, saved plans and recovery

The existing scope lock, state hash, backup collision checks, atomic file writes,
validation and rollback execute the combined plan once per physical target.
Current file modes are preserved and checked. Default regular-file writes retain
the existing file mode; rollback restores recorded backup modes even when the
file was removed. Source definitions, Manifest, binary and ledger preconditions
are checked again before physical-store commit. External edits are retained and
ambiguous changes require reviewed recovery.

Physical ownership uses the existing mode-aware regular-file journal. SIGKILL
before commit restores the original files/state; a proved committed state is
kept. A plan mixing physical stores and snapshot links instead uses the PR06
tree transaction and retains both ownership models in one state commit.

Saved plans introducing physical records, or using schema 7 state, use body
**v3**, `contract: physical-resource-v1`. Earlier body v1/v2 plans remain readable;
old readers reject v3. Replay reconstructs all requested targets and rechecks
context, source, target, ownership and digest. Saved summaries retain affected
reader metadata. A saved plan does not freeze tokens, login state or model output.

## Validation scope

Pure composition, service, HTTP and GUI tests cover store/selector conflicts,
legacy ownership conversion, reader gates, dependencies, saved replay, mixed
snapshot transactions, rollback and actual child-process SIGKILL. The basic
configuration matrix covers both CLI adapters, both scopes and instructions,
Skills, Agent roles and MCP stdio with synthetic profiles. These fixtures prove
configuration behavior and preservation. They do not expand production runtime
evidence. PR07's current-build native matrix remains a separate completion gate.
