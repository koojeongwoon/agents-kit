# Resource bundle and local executor v1

Status: **CA06-1 implemented locally; not an admitted daemon management job**.
The existing `managed_worker.revoke` signature/audience and result contract are
unchanged. This contract freezes inputs and gives a future daemon adapter a fixed
same-user execution interface; it does not grant organization authority.

## Immutable input

`agents-kit bundle --manifest <file> --bundle-id <id> --bundle-version <positive integer> --out <new file>`
exports canonical UTF-8 JSON, without a BOM or trailing newline, and reports its
SHA-256 and byte length. Existing output files are never overwritten. Files are
created with mode 0600. The output contains:

```json
{
  "schemaVersion": 1,
  "kind": "agent-kit-resource-bundle",
  "resource": {"id": "review-resources", "version": 1},
  "manifest": {"schemaVersion": 1, "kit": {"id": "example"}, "assets": {}, "targets": {}, "defaults": {}},
  "files": [{"path": "sources/rules.md", "content": "Review evidence.\n", "sha256": "<SHA-256 of the UTF-8 content>"}]
}
```

The shape illustration omits the required asset declaration. v1 allows only typed
instructions, Skills, Agents and MCP servers. Source paths are rewritten to
`sources/<asset-id>.md` for instructions and `sources/<asset-id>/...` for Skills.
Typed Agent/MCP definitions remain inline. Tool/Skill dependencies use their
existing logical IDs. Missing references/providers and dependency cycles fail.
Native configuration sources, packages, hooks, standalone policy assets, memory,
client definitions/runtime evidence, target directories and executor commands
are not transport fields. MCP executable bindings inside the Manifest are data
for the client adapter; their complete normalized recipes also require local
allowlisting before preparation.

Bounds: 8 MiB canonical bundle, 1 MiB per text source/Manifest, 256 files, 64 assets;
source traversal is limited to depth 16 and 512 entries. Paths are ASCII relative
paths, at most 240 characters, without empty/dot/hidden components. Symlinks,
special files, invalid UTF-8, control characters, duplicate or case-aliased
paths, unreferenced files and file/directory collisions fail closed. Source modes
are not transported; staging uses directories 0700 and files 0600. Supported
credential patterns/private-key headers are rejected, including in Skill
supporting text. This scan is not proof that arbitrary prose contains no secret;
publishers must keep credentials out of source assets.

Canonicalization sorts object keys with JavaScript string ordering, preserves
array order and uses JSON string escaping. File entries are sorted by path.
The receiver hashes the **original bytes**, validates structure and file hashes,
and requires an identical canonical reserialization. Duplicate JSON keys or
whitespace variants therefore fail. This is a bounded versioned format, not a
claim of general RFC 8785 support. Consumers can compare the published byte hash
without reimplementing serialization. The digest detects mutation; it is not a
signature. Resource versions are identifiers here, not a monotonic anti-replay
counter or rollback authorization.

The checked-in [canonical example](resource-bundle-v1/example.bundle.json) and
[byte digest](resource-bundle-v1/example.digest.json) are an executable fixture
for subsequent Gateway/Rust consumers. They carry no signature or deployment
authorization.

## Local configuration and process boundary

`node bin/resource-bundle-helper.js /absolute/executor-config.json` consumes one
JSON request from stdin and writes one JSON response. The helper refuses root
and requires a regular, nonsymlink, same-UID config file with no group/other
permissions. No network listener, download URL, shell command, login, model call
or client launch is provided. Input is bounded to 16 MiB, config to 64 KiB.

```json
{
  "schemaVersion": 1,
  "userId": 501,
  "definitionsDir": "/installed/agents-kit/clients",
  "homeDir": "/Users/example",
  "workRoot": "/Users/example/.agents-kit/resource-executor",
  "bindings": {
    "workspace": {
      "scope": "project",
      "targetRoot": "/Users/example/projects/demo",
      "targets": [
        {"clientId": "codex", "surface": "cli"},
        {"clientId": "antigravity", "surface": "cli"}
      ],
      "allowedMcpDigests": []
    }
  }
}
```

The UID and paths are illustrative. Local installation/enrollment must supply
actual values. Only Codex/Antigravity CLI bindings are accepted in this slice.
Definitions and binary evidence stay local; no request may replace them or opt
into preview capabilities. `clientVersion` may be specified locally, but never
bypasses binary verification. Global bindings must target the configured home;
project bindings retain self-target and scope checks. Work and private store
directories must be same-user, 0700, and must not redirect through symlinks.

`allowedMcpDigests` is deny-by-default. Each entry is `canonicalDigest` of
`normalizeMcpDefinition(asset, manifest.defaults.mcpBindings)`, including logical
ID, resolved command, arguments and environment/authentication fields. Changing
any of these needs a new local allowance and plan review. This is a recipe
allowlist, not executable-file integrity or an MCP sandbox. Actual client runtime
permissions still apply. A bundle never installs or runs that executable.

The helper/config/storage are **same-user local tools**, not a boundary against a
hostile process running as that user. In particular, knowing a receipt digest is
not organization authorization. Do not expose this protocol through HTTP/IPC or
connect it directly to the remote job queue. A protected daemon launcher must
bind the enrolled UID, pin trusted helper/runtime/config, sanitize its environment
and recheck signed authorization before calling it. None of those remote
admission/install responsibilities are claimed complete by CA06-1.

## Prepare, review and apply

Prepare request:

```json
{"schemaVersion":1,"operation":"prepare","bindingId":"workspace","sha256":"<bundle byte hash>","bundleBase64":"<canonical standard-base64 bytes>"}
```

Prepare verifies the payload and local MCP policy, atomically publishes a cache
entry by hash without replacing existing entries, and stages a private snapshot.
Common source/frontmatter validation and the regular Manifest application service
then produce the plan. The exact current client binary, definitions, target files,
ownership and shared consumers participate in the normal checks. A blocked plan
has `phase: blocked` and no executable receipt. No client file changes on prepare.

A successful response includes `phase: prepared`, `bundleSha256`, `resource`,
`bindingId`, `receiptId`, `receiptDigest`, expiry and the local review plan.
The receipt binds the bundle, local target configuration, staged inputs and the
saved prepared plan. Default expiry is five minutes. Review the plan before apply:

```json
{"schemaVersion":1,"operation":"apply","receiptId":"<prepared UUID>","receiptDigest":"<reviewed digest>"}
```

Apply takes no new paths, programs, resource selection or bundle. It verifies the
receipt and cached/staged bytes, checks local binding identity, and resumes the
same saved deployment service used by CLI/GUI. Current targets, ownership,
definitions and binary identity must still match the reviewed prepared plan.
Atomic file writes, transaction backups, shared ownership and rollback are reused.
The helper does not obtain or invent a new approval by silently preparing again.

The successful result is metadata only:

```json
{"schemaVersion":1,"phase":"files-applied","receiptId":"<UUID>","bundleSha256":"<hash>","resource":{"id":"review-resources","version":1},"bindingId":"workspace","transactionId":"tx-plan-<UUID>","clientRecognition":"unverified"}
```

The outer response is `{ok:true,result:...}`. Failures return `{ok:false,code:...}`
and exit 1; rejected values, source text, filesystem paths and exception stacks
are not error output. Prepared plans are for **local review** and may contain
file previews; they must not be forwarded as central telemetry. Successful
results establish file application, not client reload, model use or execution
termination. Duplicate apply returns the historical transaction result, not a
fresh attestation of current files.

## Restart and recovery

The work root holds `<bundle-hash>.json`, private `bundle-*` staging,
`.deployment-plans/` inner saved plans, and `receipts/` outer records. Both layers
claim execution exclusively and share deterministic `tx-plan-<receiptId>` identity.
If commit completed but result recording did not, the existing saved-plan
reconciler can return the recorded transaction without executing again. If the
inner plan remains ready after an interrupted outer claim, it is not started
automatically. Incomplete writes/active journals require reviewed existing
deployment recovery; restored attempts require a new prepare/review.

Use `createManifestDeploymentService` with the same `definitionsDir`, `homeDir`
and `planStoreRoot: <workRoot>/.deployment-plans` for `planRecovery/recover` and
`planRollback/rollback`. For a normal installed home, existing CLI recovery also
accepts `--kit <workRoot> --project <bound-target> --client codex` (omit project for
global scope); first inspect with `--dry-run`. Recovery never requires rereading
the mutable publisher source. Persistent snapshots currently have no automatic
garbage collector; retaining them supports review/reconciliation. The existing
file journal limitations, including no fsync power-loss guarantee, remain.

## Required next gate

CA06-2 must define a separate signed distribution job/approval exchange and
metadata result schema in Gateway and tools-daemon. Bind tenant, organization,
subject, device/key/version, resource byte hash/version, local binding ID,
policy revision, expected state and reviewed receipt digest, with issue/expiry,
issuer/audience and durable replay checks. Reauthorize delivery and apply, then
correlate daemon receipts to issued jobs. The revoke-only v1 audience/results
cannot be reused. Production installation, protected/user process separation,
two-device partial failure, remote rollback authorization and native client
recognition remain later operational evidence.
