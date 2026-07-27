# Agent Kit Development Instructions

## Working agreements

- Minimize the scope of code changes.
- Follow existing codebase styles and patterns.
- Do not commit secrets or credentials.
- Preserve CLI and GUI compatibility unless a migration path is documented.
- Add or update tests for every behavior change.

## Product boundary

Agent Kit is primarily a multi-client configuration and distribution system.
It manages client-neutral agent assets and safely plans, transforms, deploys,
validates, and rolls them back for supported LLM clients.

A custom agent runtime, agent loop, tool registry, and long-term memory engine
are optional modules. They must not be implemented ahead of or coupled to the
Configuration and Distribution Plane.

## Architecture rules

- Use a versioned client-neutral Manifest as the source of desired state.
- Keep client paths and capabilities in data-driven client definitions.
- Keep client-specific format conversion inside adapters.
- Model relationships with stable asset and logical tool IDs, not embedded
  filesystem paths or free-form Markdown references.
- A Skill declares logical tool requirements; an MCP definition declares tools
  it provides. Resolve the binding through the registry and capability policy.
- Validate missing references, missing tool providers, scope violations,
  policy denial, and dependency cycles before deployment.
- Generate a Deployment Plan before changing client files.
- CLI and GUI must execute the same application services.
- Do not overwrite user-owned settings by default.
- Track Agent Kit-owned fields, sections, blocks, and files explicitly.
- Treat unsupported, UI-only, and unverified capabilities as fail-closed.
- Never write literal tokens or passwords into manifests or generated files.
- Retain filesystem authorization, self-target prevention, atomic writes,
  backup collision checks, and transactional rollback.

## Runtime rules

- The Harness runs the agent loop; the model does not own the runtime process.
- A Skill declares instructions and required tool scopes. It does not own MCP
  connections.
- MCP is a tool-provider protocol connected through a Harness tool registry.
- Compose global, project, agent, skill, and tool policies into an effective
  policy before execution.
- Do not parse or persist hidden model reasoning. Persist only public plans,
  requested actions, tool results, observations, validations, and outcomes.
- Durable memory promotion and credential mutation require explicit approval.

## Reconstruction sequence

1. Product definition, architecture, ADRs, and traceability.
2. Manifest and common domain model.
3. Client definitions and capability matrix.
4. Pure Deployment Plan and diff.
5. Merge, state, backup, apply, validation, and rollback.
6. Claude Code and Codex migration.
7. Remaining clients and GUI workflow expansion.
8. Optional runtime and memory modules.
