# ADR-009: Managed Execution Runtime and Harness Boundaries

- Status: Proposed
- Date: 2026-07-27

## Context

As the Configuration and Distribution Plane has stabilized, we must define the architectural boundaries for the optional Runtime Plane (the Harness, Tool Registry, Loop Execution, and Long-Term Memory). The runtime executes arbitrary agent loops, connects to MCP servers, evaluates security policies, and interacts with host environments. Without strict isolation boundaries, the runtime could compromise host security, leak credentials, corrupt the manifest desired state, or persist unverified models' hidden thoughts.

## Decision

Establish the following strict boundaries and architectural gates for the execution runtime:

1. **Harness Execution Loop Boundaries**:
   - **Isolation**: Loops run in sandboxed child processes with isolated network scopes.
   - **Timeouts & Cost Limits**: Every execution step must enforce hard timeouts (cancellation tokens) and CPU/token budget limits.
   - **Execution Log**: The Harness records a public audit trail of event logs (planned action, requested parameters, validation gates, outcomes). It must **never** record or parse hidden model reasoning/thoughts.

2. **Tool Registry & MCP Lifecycle**:
   - **Connection Ownership**: The Harness owns and isolates connections to MCP servers. Skills declare logical tool requirements but **never** manage active network ports or connections.
   - **Pre-execution Policy Gate**: Before any tool is invoked, the effective policy engine evaluates the capability permission:
     `Tool Allow = (Is Provider Registered) AND (Is In Scope) AND (Is Harness Policy Allowed) AND (Is Effective Policy Allowed)`.
   - **Human-in-the-Loop Gate**: Write operations and high-privilege shell commands require an explicit interactive human approval step in the GUI/CLI.

3. **Memory Staging & Promotion**:
   - **Ephemeral vs. Durable**: Conversation history remains ephemeral working memory.
   - **Durable Staging**: Session output candidate summaries are staged in a read-only queue.
   - **Durable Promotion**: Promoting a staged memory candidate to durable long-term storage requires an explicit user approval action. Memory engines cannot self-promote.

4. **Strict Configuration Boundary Preservation**:
   - **Optional Execution**: The entire runtime plane remains optional. The compiler, diagnostics, and deployment plane must function fully without a running execution database, model key, or active MCP connections.
   - **State Mutation Prevention**: The runtime is consumer-only of the Manifest and client directories. Under no circumstances can the runtime write to, mutate, or bypass the OCC validation checks of the Configuration Plane.

## Consequences

- Secures the agent runtime against privilege escalation and credential leakage.
- Prevents silent modifications to the local deployment directory.
- Ensures the Harness remains auditable and fail-safe.
