# Asset and Manifest Model

## Aggregate

`AgentKitManifest` is the versioned desired-state aggregate. It references
assets and deployment targets; it does not contain resolved credentials or
client-specific output files.

The loader discovers `agent-kit.yaml`, `agent-kit.yml`, or `agent-kit.json` at
the Kit scope root, in that priority order. If none exists, loading fails
closed with `MANIFEST_REQUIRED`. Directory structure is never treated as
implicit desired state.

```text
AgentKitManifest
  schemaVersion
  kit
  assets
  targets
  defaults
```

## Required domain concepts

| Concept | Responsibility |
|---|---|
| `AgentKitManifest` | Versioned desired state |
| `AssetDefinition` | Shared identity, source, metadata, and provenance |
| `InstructionDefinition` | Persistent instructions and rule intent |
| `SkillDefinition` | Procedural instructions, references, scripts, tool needs |
| `AgentDefinition` | Role, model preferences, instructions, skills, policies |
| `McpServerDefinition` | MCP transport and secret references |
| `MemoryDefinition` | Memory configuration, not durable memory contents |
| `PolicyDefinition` | Declarative restrictions and approval requirements |
| `HookDefinition` | Lifecycle event and command/tool action |
| `WorkflowDefinition` | Repeatable public plan or automation definition |
| `ClientDefinition` | Paths, formats, scopes, detection, and capabilities |
| `DeploymentTarget` | Selected client, scope, project, and strategy overrides |
| `AssetReference` | Stable typed reference to another asset |
| `ToolRequirement` | Logical tool and capability required by an asset |
| `ToolProvider` | MCP or runtime provider for logical tools |
| `CapabilityRequirement` | Required operation and access level |
| `PolicyReference` | Policy attached to an agent, skill, or target |
| `MemoryAccessReference` | Reader/writer relationship to memory configuration |
| `WorkflowStepReference` | Agent, skill, or tool invoked by a workflow step |
| `DependencyGraph` | Resolved transitive asset and tool dependencies |
| `ReferenceValidationResult` | Stable errors and warnings from graph validation |

## Asset identity

- IDs are stable within a kit and independent of filenames.
- IDs use a restricted, portable character set.
- Duplicate IDs fail validation.
- Source paths are relative to the owning kit scope.
- Source paths cannot escape the kit through `..` or symlinks.
- Absolute, missing, and non-string source paths fail validation.
- Generated or imported assets retain provenance metadata.

## Skill relationship

A Skill contains:

- task instructions
- references and examples
- local scripts or templates
- required logical tools
- requested tool scopes

A Skill does not contain a live MCP connection and does not create a separate
Harness runtime.

A Skill references logical tools rather than a client connection:

```yaml
requires:
  tools:
    - id: github.search-commits
      capability: repository.read
      optional: false
```

An MCP definition declares which logical tools it provides:

```yaml
provides:
  tools:
    - id: github.search-commits
```

The registry resolves Skill requirement to Tool provider. Missing or ambiguous
providers fail validation.

## Cross-asset relationships

- Agents may reference Skills, logical Tools, Policies, and Memory access.
- Harness configuration enables assets and narrows allowed capabilities.
- Workflows reference Agents, Skills, or logical Tools by stable ID.
- Memory configuration declares explicit readers, writers, and promotion
  policy.
- Deployment selection expands to the transitive dependency closure.
- References use logical IDs; generated Markdown paths are adapter output only.

Reference validation uses stable error codes:

- `MISSING_REFERENCE`
- `MISSING_TOOL_PROVIDER`
- `AMBIGUOUS_TOOL_PROVIDER`
- `SCOPE_VIOLATION`
- `POLICY_DENIED`
- `CYCLIC_DEPENDENCY`

## MCP secrets

MCP definitions use secret references:

```yaml
environment:
  GITHUB_TOKEN:
    source: environment
    name: GITHUB_TOKEN
```

Literal secret-looking values fail validation unless an explicitly supported,
non-secret test fixture context is used.

### Heuristic limits for secret detection

To prevent accidental commit of credentials, the loader enforces static secret detection heuristics:
1. **Secret Key Detection:** Keys matching keywords (such as `token`, `password`, `passwd`, `secret`, `api-key`, `credential`) cannot have literal string values unless they format as environment placeholders (e.g. `env:VAR`, `${VAR}`, `{{VAR}}`, or starting with `$`).
2. **Entropy Verification:** Literal values on secret-key fields are parsed for Shannon entropy. Any non-placeholder value exceeding `12` characters with entropy greater than `3.0` is blocked.
3. **Prefix Matching:** Values matching known prefix patterns (like `ghp_`, `github_pat_`, `sk-`, `AIza`) or starting with common authorization schemes (like `Bearer ` or `Basic `) are blocked on **any** field.

Environment references use a structured object. Placeholder-looking strings do
not count as verified secret references.

## Client-specific settings

Client-neutral meaning belongs in shared definitions. A target may include
namespaced client options only when no portable representation exists:

```yaml
clientOptions:
  claude-code:
    permissionMode: default
```

Unknown client options are rejected or retained as unvalidated data according
to schema policy; they are never silently interpreted by another client.

## Schema evolution

- `schemaVersion` is mandatory.
- Readers reject unsupported future major versions.
- Migrations are explicit, deterministic, and available as a dry-run plan.
- Migration never mutates the original Manifest without an apply command.

## Materialization contracts

- Instructions, Skills, Agents, Hooks, Memory, and client settings require a
  source file or directory.
- A Workflow requires a source or inline steps.
- An MCP server requires a source, connection, environment configuration, URL,
  command, or provided Tool declaration.
- A Policy requires allow or deny rules.
- A Harness requires a source, enabled assets, or policy.
- Tool and asset references must use their restricted stable-ID formats.
