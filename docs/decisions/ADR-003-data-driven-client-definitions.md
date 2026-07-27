# ADR-003: Data-Driven Client Definitions

- Status: Accepted
- Date: 2026-07-27

## Context

Client paths and support assumptions are hardcoded in Adapter classes and
change independently across client versions.

## Decision

Store paths, scopes, formats, detection rules, and capability evidence in
versioned client definitions. Keep only semantic rendering and validation logic
in client adapters.

## Consequences

- Path updates usually change data rather than application control flow.
- Capability status must include version and evidence.
- Unverified support cannot be marked stable.

