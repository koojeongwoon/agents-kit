# Target Architecture Overview

## System split

Agent Kit consists of a required Configuration and Distribution Plane and an
optional Managed Runtime.

```text
Configuration and Distribution Plane
  Manifest Loader
    -> Asset Registry
    -> Dependency Graph and Reference Validator
    -> Client Definition Registry
    -> Capability Resolver
    -> Capability-aware Materializer
    -> Deployment Planner
    -> Diff and Conflict Analysis
    -> Apply Coordinator
    -> State, Backup, Validation, Rollback

Optional Managed Runtime
  Harness
    -> Agent Loop
    -> Model Adapter
    -> Tool Registry
    -> MCP Tool Adapter
    -> Effective Policy and Approval
    -> Working State and Public Trace
    -> Memory Candidate Pipeline
```

## Dependency direction

```text
CLI --------\
             -> Application Services -> Domain <- Infrastructure
GUI API ----/

Client definitions -> Domain contracts
Runtime --------> Shared asset contracts
Domain -X-> GUI, filesystem, MCP, or specific clients
Configuration Plane -X-> Managed Runtime
```

`-X->` indicates a forbidden dependency.

## Module boundaries

```text
lib/
  domain/
    manifest.js
    client-definition.js
    scope.js
    structured-merge.js
  application/
    manifest-deployment-service.js
    plan-client-deployment.js
    prepare-*-deployment.js
    apply-deployment.js
    rollback-deployment.js
  infrastructure/
    manifest-loader.js
    client-definition-loader.js
    deployment-state-store.js
    deployment-backup-store.js
    file-transaction.js
```

Client-specific behavior is data in `clients/*.yaml`, not executable adapter
classes.

## Main configuration flow

```text
Manifest load
  -> schema validation
  -> asset resolution
  -> reference and tool-provider resolution
  -> target-client detection
  -> capability resolution
  -> client rendering
  -> deployment plan
  -> diff and conflicts
  -> explicit apply request
  -> atomic execution
  -> post-apply validation
  -> state commit
```

## Safety boundaries

- Resolve and authorize paths before reading or mutating them.
- Reject targets inside the kit or Agent Kit tool repository.
- Reject filesystem root, home-as-project, and self-referencing links.
- Plan all selected targets before the first mutation.
- Use transaction-scoped backups and atomic writes.
- Fail on unknown ownership conflicts.
- Redact secret values from plans, diffs, errors, logs, and state.
- Do not infer stable support from the existence of a directory.

## UI relationship

The GUI is a projection of application-service contracts:

```text
Kit -> Assets -> Clients -> Capability Check -> Plan -> Conflict Resolution
    -> Apply Approval -> Validation -> History and Rollback
```

The GUI must not implement its own path mapping, capability resolution, merge,
or deployment behavior.
