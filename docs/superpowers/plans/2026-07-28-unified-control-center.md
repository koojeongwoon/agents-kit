# Unified Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current deployment/editor GUI into the first working slice of a local control center for client-neutral MCP, Skill, Agent, and Harness assets without changing adapter semantics.

**Architecture:** Preserve `clients/*.yaml`, capability resolution, and the existing copy/merge/managed-link/manual deployment strategies. Add read-only projections and an application shell above the current services; all mutations continue through plan/apply and rollback contracts.

**Tech Stack:** Node.js application services, Express, React 18, TypeScript, Vite, Tailwind CSS, Node test runner, React Testing Library/Vitest.

## Global Constraints

- Client-specific paths and capabilities remain data in `clients/*.yaml`.
- Existing adapter output and deployment strategies must not change.
- Scanning and status reads must not modify client or Kit files.
- No action is silently disabled; a blocked action exposes its reason and remediation.
- Korean is the primary UI language, with established technical terms retained.
- Every behavior change starts with a failing test.

---

### Task 1: Read-only client catalog contract

**Files:**
- Modify: `lib/application/manifest-deployment-service.js`
- Modify: `gui/server/routes/deploy.js`
- Modify: `gui/src/api/deploy.ts`
- Test: `test/manifest-deployment-service.test.js`
- Test: `gui/server/test/deployment-routes.test.js`

**Interfaces:**
- Produces: `manifestDeploymentService.clients()` and `GET /api/clients`
- Returns: `{ clients: ClientSummary[] }` where each item exposes definition ID, display name, detection metadata, and capability summaries without target mutation

- [ ] Add a failing application-service test proving all client definitions are projected without exposing adapter internals.
- [ ] Run the focused test and verify the missing `clients()` contract fails.
- [ ] Implement the read-only projection from the existing client definition loader.
- [ ] Add and fail a router contract test for `GET /api/clients`.
- [ ] Implement the route and typed frontend API.
- [ ] Run focused application and server tests.

### Task 2: Typed API errors and lossless resource reads

**Files:**
- Modify: `gui/src/api/deploy.ts`
- Modify: `lib/application/manifest-deployment-service.js`
- Modify: `gui/server/routes/deploy.js`
- Test: `test/manifest-deployment-service.test.js`
- Test: `gui/server/test/deployment-routes.test.js`

**Interfaces:**
- Produces: `ApiRequestError`, `manifestDeploymentService.resource({scopeRoot, assetId})`, and `GET /api/manifest/resources/:assetId`
- Preserves: `code`, `message`, `requestId`, `details`, and HTTP status from the server envelope

- [ ] Add failing tests for a full resource projection and unknown asset error.
- [ ] Implement full resource lookup without changing registry list projections.
- [ ] Add failing route tests and implement the resource detail endpoint.
- [ ] Add a frontend unit test proving error metadata survives `jsonOrError`.
- [ ] Implement `ApiRequestError` and typed resource fetch.
- [ ] Run focused tests.

### Task 3: Control-center app shell

**Files:**
- Modify: `gui/src/ManifestApp.tsx`
- Create: `gui/src/components/shell/ControlCenterShell.tsx`
- Create: `gui/src/components/home/ControlCenterHome.tsx`
- Create: `gui/src/components/resources/ResourceWorkspace.tsx`
- Test: `gui/src/components/shell/ControlCenterShell.test.tsx`

**Interfaces:**
- Consumes: current scope/Kit context, `fetchClients()`, and `fetchManifestRegistry()`
- Produces: Home plus `MCP`, `Skill`, `Agent`, and `Harness` semantic tabs with shared environment status

- [ ] Install and configure Vitest, React Testing Library, and jsdom within the GUI package.
- [ ] Add a failing shell test for semantic navigation and shared target context.
- [ ] Implement the shell with a Home entry and four resource tabs.
- [ ] Add a failing Home empty-state test.
- [ ] Implement first-use guidance and client capability summaries.
- [ ] Add a failing resource workspace test for kind filtering and status empty states.
- [ ] Implement MCP/Skill/Agent/Harness workspaces over the existing registry.
- [ ] Run GUI unit tests and type checking.

### Task 4: Deployment readiness and actionable errors

**Files:**
- Modify: `gui/src/components/deploy/ManifestDeploymentPanel.tsx`
- Modify: `gui/src/components/common/ActionableErrorResolution.tsx`
- Test: `gui/src/components/deploy/ManifestDeploymentPanel.test.tsx`

**Interfaces:**
- Preserves: existing plan, apply, doctor, validate, history, and rollback APIs
- Produces: explicit target readiness, optional diagnostics, visible blocked reasons, and stable error remediation

- [ ] Add a failing test proving plan creation does not require a Doctor result.
- [ ] Add a failing test proving a missing project path displays an inline reason instead of a silent disabled state.
- [ ] Refactor configuration into a readiness summary with one primary action.
- [ ] Render Doctor as an optional advanced safety check.
- [ ] Surface stable API error codes, request IDs, and remediation.
- [ ] Run focused component tests.

### Task 5: Integration and regression verification

**Files:**
- Modify: `gui/package.json`
- Modify: root `package.json` only if needed to include new quality gates

**Interfaces:**
- Produces: `test`, `typecheck`, and existing build/test scripts that run consistently in CI

- [ ] Run all GUI unit tests.
- [ ] Run `npm --prefix gui run typecheck`.
- [ ] Run `npm test`.
- [ ] Run GUI server tests with local bind permission.
- [ ] Run `npm --prefix gui run build:desktop`.
- [ ] Exercise Home, each resource tab, target readiness, optional Doctor, and plan creation in the local browser.
- [ ] Confirm `clients/*.yaml` and deployment adapter outputs have no behavioral diff.
