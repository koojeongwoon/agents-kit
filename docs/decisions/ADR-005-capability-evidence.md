# ADR-005: Capability Evidence and Fail-Closed Support

- Status: Accepted
- Date: 2026-07-27

## Context

LLM client asset formats and paths change frequently. A path implemented in
Agent Kit is not proof that the client officially supports it.

## Decision

Every capability records client, asset, scope, version constraints, evidence
state, first-party source, verification date, fallback, and validation method.
Unverified, unsupported, or UI-only capabilities cannot produce automatic
stable apply operations.

## Consequences

- The UI exposes capability warnings and reasons.
- Version detection influences planning.
- Manual guidance replaces unsafe automatic deployment when evidence is weak.

