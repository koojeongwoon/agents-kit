# ADR-007: Logical Tool and Asset References

- Status: Accepted
- Date: 2026-07-27

## Context

The current generator can include installed Skills, Loops, and MCP names in
Agent or Harness Markdown. These free-form references cannot prove existence,
scope, policy compatibility, client support, or complete deployment.

Binding a Skill directly to an MCP connection would also couple reusable
business procedure to one transport and client configuration.

## Decision

Represent asset relationships with typed stable IDs. Skills and Agents declare
logical Tool and Capability requirements. MCP definitions declare logical
Tools they provide. A registry resolves effective providers after scope,
policy, enabled-state, and client-capability filtering.

Build and validate a dependency graph before rendering or planning. Selected
assets expand to a complete transitive dependency closure.

## Consequences

- Missing, ambiguous, denied, cross-scope, and cyclic relationships fail before
  deployment.
- Asset creation UI can offer compatible resources instead of inserting only
  Markdown links.
- MCP providers can change without rewriting Skill procedure.
- Adapters may render client-specific file references from logical IDs.
- Existing free-form references remain content but do not count as validated
  dependencies until migrated.

