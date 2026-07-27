# ADR-008: Manifest-Native Marketplace and Git Packaging

- Status: Proposed
- Date: 2026-07-27

## Context

Users want to package, share, and import Agent Kit configurations (such as custom Skills, Agents, workflows, or policies) from external Git repositories or registries. To prevent credentials leaks, path traversal, arbitrary execution, and unverified overrides, this system must not allow direct mutations or unverified downloads.

## Decision

Establish a declarative, manifest-native packaging and import framework:

1. **Package Identity & Provenance**: A package is uniquely identified by a combination of its source repository/registry URL, package path, and semantic version (e.g., `git::https://github.com/org/kit.git#v1.0.0`).
2. **Desired State Model**: Importing, updating, or removing a package is modeled strictly as a desired-state modification in the Manifest itself under a new `packages` section.
3. **Integrity & Verification**: Every package reference requires a cryptographic checksum/hash (`sha256`) of its content to enforce tamper-resistance (Integrity).
4. **Dependency Closure Validation**: When importing a package, the dependency visualizer and impact planner must evaluate the package's resources and check if all referenced tools (MCP) and sub-skills are fully resolvable within the current project scope.
5. **No Direct Filesystem Mutation**: The import process downloads package files to a read-only, versioned local cache (`~/.agent-kit/cache/packages/...`) and updates the manifest. The actual deployment is performed via standard, OCC-protected `plan` and `apply` cycles.
6. **Trust Boundary**: Git repository access relies on standard host credentials (SSH keys, HTTPS auth tokens stored externally). Agent Kit does not store credentials.

## Consequences

- Resolves requirements for AK-U12 safely.
- No direct code injection or arbitrary execution is allowed during imports.
- Stale imports fail OCC validation.
- Deleting or updating a package computes transitive impact on dependent assets before applying changes.
