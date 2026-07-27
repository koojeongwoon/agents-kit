# ADR-001: Configuration Plane First

- Status: Accepted
- Date: 2026-07-27

## Context

Agent Kit already distributes assets to multiple clients. Building a custom
agent runtime first would duplicate client harness behavior and leave unsafe,
client-specific configuration deployment unresolved.

## Decision

Reconstruct the Configuration and Distribution Plane before implementing an
optional Managed Runtime. The Configuration Plane must not depend on runtime or
memory infrastructure.

## Consequences

- Manifest, capability, plan, apply, state, validation, and rollback take
  priority.
- Harness, loop, tool registry, trace, and long-term memory are deferred.
- Shared asset contracts must remain usable by a later runtime.

