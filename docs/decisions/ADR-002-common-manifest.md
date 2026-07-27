# ADR-002: Versioned Client-Neutral Manifest

- Status: Accepted
- Date: 2026-07-27

## Context

The current directory structure and adapter code implicitly define desired
state. This makes completeness, migration, validation, and provenance hard to
prove.

## Decision

Introduce a versioned `AgentKitManifest` with stable asset IDs. Existing kit
directories remain readable through a compatibility loader until migrated.

## Consequences

- Desired state becomes schema-validatable and traceable.
- Client output paths do not appear as the portable meaning of an asset.
- Schema migrations require explicit dry-run and apply operations.

