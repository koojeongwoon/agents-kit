# ADR-002: Versioned Client-Neutral Manifest

- Status: Accepted
- Date: 2026-07-27

## Context

The current directory structure and adapter code implicitly define desired
state. This makes completeness, migration, validation, and provenance hard to
prove.

## Decision

Use a versioned `AgentKitManifest` with stable asset IDs as the only desired
state entry point. Directory-only Kits are not inferred or migrated
automatically.

## Consequences

- Desired state becomes schema-validatable and traceable.
- Client output paths do not appear as the portable meaning of an asset.
- Schema migrations require explicit dry-run and apply operations.
