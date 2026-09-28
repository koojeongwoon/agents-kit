# Typed MCP definition v1 — CA02-1

2026-09-27. Implemented for Codex and Antigravity renderers. Runtime support is
still governed by ClientDefinition v2; generated configuration is not a client
loading or authentication test.

## Source contract

The Manifest remains schema 1. Typed MCP rendering is opt-in through the new
versioned `assets.mcpServers[].definition` object. It is never inferred from an
existing source file or legacy inline `connection`, `command`, `url`, or
`environment` field. Mixing typed and native/legacy transport fields is an
error. A legacy source file keeps its existing copy/merge behavior. Legacy
inline declarations without a source do not silently gain rendering semantics.

[Complete example](../examples/mcp-common.yaml):

```yaml
schemaVersion: 1
kit: {id: example}
defaults:
  mcpBindings:
    schemaVersion: 1
    endpoints:
      docs-endpoint: {url: https://mcp.example.test/mcp}
assets:
  mcpServers:
    - id: docs
      scope: project
      definition:
        schemaVersion: 1
        transport: http
        endpointId: docs-endpoint
        authentication: {type: client-oauth}
      provides:
        tools: [docs.read]
```

Executable/endpoint IDs resolve only through `defaults.mcpBindings`.
`executables.<id>` contains a `command`; `endpoints.<id>` contains a `url`.
There is no shell evaluation, executable installation, DNS lookup or connection
during planning. Bindings identify already provisioned resources; Kit does not
verify installation merely because a binding exists.

| Transport | Required definition fields | Optional fields |
|---|---|---|
| `stdio` | `schemaVersion: 1`, `executableId` | `args`, `environment` |
| `http` | `schemaVersion: 1`, `endpointId` | `authentication` |

`environment` contains `{source: environment, name: VARIABLE_NAME}` references,
not literal values. HTTP authentication defaults to `client-oauth`, leaving
login to the native client; servers that do not require authentication may also
use the native default. Explicit bearer lookup is
`{type: environment, source: environment, name: VARIABLE_NAME}`.
Only Codex currently has a verified mapping for these environment references.
Antigravity returns `MCP_SECRET_REFERENCE_UNSUPPORTED` rather than inventing
interpolation syntax, reading the variable, or writing plaintext.

Unknown definition/binding fields, unsupported versions, mixed transports,
missing IDs, invalid references, control characters, recognizable literal
credentials and credential-like argument flags are rejected. Arguments and
commands are public configuration, never credential carriers. Endpoints allow
HTTPS or literal loopback HTTP; URL credentials, query strings and fragments
are outside this first contract. Remote SSE/websocket, custom headers, explicit
OAuth client secrets, tool/model permission extensions and command working
directories need separately verified contracts and are not silently dropped.

## Adapter output

- Codex emits a `mcp_servers.<assetId>` TOML table. STDIO uses `command`, `args`
  and `env_vars`; HTTP uses `url` and optionally `bearer_token_env_var`.
- Antigravity emits a `mcpServers` JSON object. HTTP uses `serverUrl`.
- Paths and supported surfaces stay in client definitions. The renderer must
  match the selected capability's format and merge strategy. Other families do
  not inherit these converters. Antigravity app MCP remains UI-only.

Official sources checked 2026-09-27:
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp),
[Antigravity MCP](https://antigravity.google/docs/mcp).

## Plan and ownership

The common plan service renders typed assets and supplies the resulting
in-memory document to the existing merge/backup/apply/rollback pipeline. No
intermediate file is written and no secret environment value is read.

`previews[]` exposes the generated **configuration fragment**, target, format,
operation, runtime support reason, affected ownership selectors and hashes,
and conflicts. It does not expose the current configuration or its unrelated
secret values. Preview hashes describe each fragment against the current file;
the executable operation's hash describes the combined result when several
assets target the same file. A preview is not an executable plan or a full
before/after text diff. CLI prints it; GUI exposes an expandable preview.

For documented but runtime-unverified capabilities, previews remain available
while actual operations remain blocked. Preview operations are marked
`previewOnly`, have no prepared apply content, and both apply entrypoints reject
them. Normal preview-only API requests cannot activate runtime support.

Typed MCP does not automatically adopt an existing same-name server even when
its text is identical. JSON container collisions and updates requiring obsolete
keys to be deleted are blocked. The current TOML merger is limited, so typed
MCP updates conservatively reject quoted/array tables, multiline or unsupported
assignments, duplicate keys/tables and same-server child tables. These cases
require CA03's fuller ownership/merge work rather than risking malformed output.
Existing unrelated supported settings are preserved; existing file hashes and
transaction rollback remain enforced.

## Stage boundary

This completes the **CA02-1 MCP vertical slice**, not all CA02 work. Agent typed
conversion, target selectors/dependency closure deployment, full policy binding,
and the remaining common resource semantics are subsequent work. Existing
logical tool/provider dependency validation still runs before this slice.
No production runtime profile, client setting, or daemon job type is activated.
