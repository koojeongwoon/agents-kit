# Agent Kit Product Definition

## Mission

Agent Kit manages reusable instructions, skills, agents, MCP servers, policies,
hooks, workflows, memory configuration, and client settings in a
client-neutral form. It converts that desired state into safe, inspectable,
client-specific deployment plans for multiple LLM clients.

## Primary users

- An individual developer maintaining one global kit and multiple project kits.
- A team publishing a reviewed kit for consistent client configuration.
- An operator auditing what Agent Kit owns, what differs, and what can be
  rolled back.

## Core product outcomes

1. Define agent assets once without binding their meaning to one client.
2. Determine whether a target client and version support each requested asset.
3. Show an exact plan and diff before mutation.
4. Preserve user-owned configuration during merge.
5. Apply changes atomically and validate the resulting client configuration.
6. Record ownership and transaction state for later reconciliation or rollback.
7. Expose identical behavior through CLI and GUI.

## Managed asset kinds

- Instructions and rules
- Skills
- Agents
- MCP servers
- Memory configuration
- Policies
- Hooks
- Workflows and loops
- Client-specific settings

## Configuration and Distribution Plane

This is the initial core product:

- versioned Agent Kit Manifest
- asset registry
- client definitions
- capability matrix
- client adapters
- deployment planning and diff
- managed, merge, copy, link, and manual strategies
- state and ownership tracking
- backup, atomic apply, validation, and rollback
- client detection and version-aware support checks
- CLI and GUI workflows

## Optional Managed Runtime

This is a separate, later product module:

- Harness
- agent loop
- model adapter
- tool registry
- MCP tool adapter
- effective policy and approvals
- working state
- trace
- long-term memory retrieval and consolidation

The runtime may consume the same assets, but the Configuration Plane must not
depend on the runtime.

## Explicit non-goals for the initial reconstruction

- Replacing existing LLM clients with a new chat UI.
- Building a new model inference engine.
- Recreating client-native agent loops.
- Treating every client as if it supports identical assets.
- Persisting hidden chain-of-thought or internal model reasoning.
- Automatically promoting session summaries to durable memory.
- Storing credentials in the repository or Manifest.
- Silently overwriting unknown user configuration.

## Product reset

Agent Kit starts from its versioned Manifest contract. Directory-only Kits,
legacy adapter mappings, and legacy GUI deployment workflows are not supported
or inferred. Existing target files remain protected by ownership and conflict
rules, but compatibility with the former Kit layout is not a product goal.

## Success criteria

- Every desired asset has a stable ID and traceable source.
- Every planned operation names its client, target, strategy, evidence state,
  validation, and rollback behavior.
- Repeated planning is deterministic and side-effect free.
- Repeated apply is idempotent when desired and actual state have not changed.
- User-owned settings survive Agent Kit updates.
- A failed multi-file or multi-client apply restores the previous state.
- The UI never promises more support than the capability matrix can prove.
