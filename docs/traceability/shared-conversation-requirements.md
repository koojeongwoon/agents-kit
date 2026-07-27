# Shared Conversation Requirements Traceability

## Purpose

This register converts the shared design conversation into reviewable product
requirements. A requirement is complete only when its design, implementation,
tests, and user surface are linked here.

## Product and architecture

| ID | Requirement | Design owner | Initial status |
|---|---|---|---|
| AK-P01 | Manage client-neutral agent assets | Product definition, ADR-002 | Designed |
| AK-P02 | Separate Configuration Plane from optional Runtime | ADR-001 | Designed |
| AK-P03 | Preserve existing implementation where safe | Phase 0 baseline | Designed |
| AK-P04 | Keep client path and capability data outside control-flow branches | ADR-003 | Designed |
| AK-P05 | Support global and project scopes | Asset model | Designed |
| AK-P06 | Keep CLI and GUI behavior aligned | ADR-006 | Designed |

## Asset coverage

| ID | Requirement | Model | Initial status |
|---|---|---|---|
| AK-A01 | Instructions and Rules | `InstructionDefinition` | Designed |
| AK-A02 | Skills | `SkillDefinition` | Designed |
| AK-A03 | Agents | `AgentDefinition` | Designed |
| AK-A04 | MCP Servers | `McpServerDefinition` | Designed |
| AK-A05 | Memory configuration | `MemoryDefinition` | Designed |
| AK-A06 | Policies | `PolicyDefinition` | Designed |
| AK-A07 | Hooks | `HookDefinition` | Designed |
| AK-A08 | Workflows and Loops | `WorkflowDefinition` | Designed |
| AK-A09 | Client-specific settings | namespaced client options | Designed |
| AK-A10 | Typed stable references between assets | `AssetReference` | Core implemented |
| AK-A11 | Skill and Agent logical Tool requirements | `ToolRequirement` | Core implemented |
| AK-A12 | MCP definitions declare provided Tools | `ToolProvider` | Core implemented |
| AK-A13 | Agent references Skills, Policies, Tools, and Memory | Resource reference model | Core implemented and tested |
| AK-A14 | Workflow steps reference Agent, Skill, or Tool | `WorkflowStepReference` | Implemented and tested |
| AK-A15 | Memory declares readers, writers, and approval | `MemoryAccessReference` | Implemented and tested |
| AK-A16 | Load versioned YAML or JSON Manifest files | Manifest loader | Implemented and tested |
| AK-A17 | Enforce kind-specific materialization contracts | Manifest domain | Implemented and tested |
| AK-A18 | Project legacy directory Kits into a common Manifest view | Legacy projector | Implemented and tested |

## Client capability

| ID | Requirement | Design | Initial status |
|---|---|---|---|
| AK-C01 | Claude Code definition | Client capability audit | Audit pending |
| AK-C02 | Codex definition | Client capability audit | Audit pending |
| AK-C03 | Cursor definition | Client capability audit | Audit pending |
| AK-C04 | Windsurf definition | Client capability audit | Audit pending |
| AK-C05 | GitHub Copilot and VS Code definitions | Client capability audit | Audit pending |
| AK-C06 | Antigravity definition | Client capability audit | Audit pending |
| AK-C07 | Claude Desktop independent definition | Client capability audit | Audit pending |
| AK-C08 | Capability states include stable, preview, version-dependent, unsupported, and UI-only | ADR-005 | Designed |
| AK-C09 | Unverified capability is not treated as stable | ADR-005 | Designed |

## Deployment and safety

| ID | Requirement | Design | Initial status |
|---|---|---|---|
| AK-D01 | Plan before mutation | Deployment lifecycle | Implemented for copy and merge |
| AK-D02 | Show diff before apply | Deployment lifecycle | Implemented for copy and merge |
| AK-D03 | Support managed strategy | ADR-004 | Designed |
| AK-D04 | Support merge strategy | ADR-004 | Implemented for JSON, TOML, and Markdown ownership units |
| AK-D05 | Support copy strategy | ADR-004 | Implemented |
| AK-D06 | Support link strategy | ADR-004 | Designed |
| AK-D07 | Support manual strategy | ADR-004 | Designed |
| AK-D08 | Track managed fields, sections, blocks, and files | ADR-004 | Implemented for copy and merge |
| AK-D09 | Preserve user-owned configuration | ADR-004 | Implemented for copy and structured merge |
| AK-D10 | Detect ownership and stale-plan conflicts | Deployment lifecycle | Implemented for copy and merge |
| AK-D11 | Backup and write atomically | Deployment lifecycle | Implemented for copy and merge |
| AK-D12 | Validate after apply | Deployment lifecycle | Implemented for copy and merge |
| AK-D13 | Roll back multi-file and multi-client failure | Deployment lifecycle | Implemented in common coordinator |
| AK-D14 | Persist transaction history and rollback | Deployment lifecycle | Implemented for committed apply transactions |
| AK-D15 | Retain self-target and symlink escape prevention | AGENTS.md, baseline | Designed |
| AK-D16 | Never store or display literal credentials | Asset and policy models | Manifest input implemented and tested |
| AK-D17 | Account for JSON, JSONC, TOML, YAML, and Markdown formats | Deployment lifecycle | Designed |
| AK-D18 | Do not silently fall back from link to copy | Deployment lifecycle | Designed |
| AK-D19 | Resolve complete transitive dependency closure | Resource reference model | Core implemented and tested |
| AK-D20 | Reject missing asset references | `MISSING_REFERENCE` | Implemented and tested |
| AK-D21 | Reject missing or ambiguous Tool providers | Tool resolution | Implemented and tested |
| AK-D22 | Reject illegal global-to-project references | Scope rules | Implemented and tested |
| AK-D23 | Reject policy-denied Tool requirements | Effective policy | Implemented and tested |
| AK-D24 | Detect dependency cycles | Dependency graph | Implemented and tested |
| AK-D25 | Reject absolute, missing, traversal, and symlink-escaping sources | Manifest loader | Implemented and tested |
| AK-D26 | Preserve existing directory Kits when no Manifest exists | Legacy projection | Implemented and tested |
| AK-D27 | Do not copy resolved legacy MCP values into projected Manifest | Legacy projection | Implemented |
| AK-D28 | Apply selected Harness Capability denial to nested dependencies | Effective Harness policy | Implemented and tested |

## CLI and GUI

| ID | Requirement | User surface | Initial status |
|---|---|---|---|
| AK-U01 | `plan` workflow | CLI and GUI | Pending |
| AK-U02 | `apply` workflow | CLI and GUI | Existing, redesign pending |
| AK-U03 | `diff` workflow | CLI and GUI | Partial |
| AK-U04 | `validate` workflow | CLI and GUI | Pending |
| AK-U05 | `doctor` workflow | CLI and GUI | Pending |
| AK-U06 | `rollback` workflow | CLI and GUI | Pending |
| AK-U07 | Capability and version warnings | Clients UI | Pending |
| AK-U08 | Conflict resolution | Conflicts UI | Pending |
| AK-U09 | Ownership display | Plan and asset UI | Pending |
| AK-U10 | Transaction history and rollback | History UI | Pending |
| AK-U11 | Secret reference input without secret disclosure | Settings UI | Pending |
| AK-U12 | Reuse existing asset, marketplace, project, and Git workflows | Existing GUI | Existing |
| AK-U13 | Select compatible Tools when creating a Skill | Skill editor | Pending |
| AK-U14 | Select Skills, Tools, Policies, and Memory for an Agent | Agent editor | Pending |
| AK-U15 | Show dependency graph and deletion impact | Dependency UI | Pending |
| AK-U16 | Explain missing provider, scope, policy, and cycle errors | Plan and editor UI | Pending |

## Runtime and memory boundary

| ID | Requirement | Design | Initial status |
|---|---|---|---|
| AK-R01 | Harness executes the loop | Optional runtime | Designed, deferred |
| AK-R02 | Loop uses decision, selection, policy, execution, observation, update | Optional runtime | Designed, deferred |
| AK-R03 | Skill declares tools but does not own MCP | Optional runtime | Designed, deferred |
| AK-R04 | Tool Registry owns MCP tool connections | Optional runtime | Designed, deferred |
| AK-R05 | Compose global/project/agent/skill/tool policy | Policy model | Designed, deferred |
| AK-R06 | Do not persist hidden model reasoning | Policy model | Designed |
| AK-R07 | Persist only public plan, actions, results, and validation | Policy model | Designed |
| AK-R08 | Treat session summaries as memory candidates | Optional runtime | Designed, deferred |
| AK-R09 | Require approval for durable memory promotion | Policy model | Designed, deferred |

## Completion rule

No implementation phase may mark a requirement complete without:

1. a linked implementation,
2. automated tests or an explicit manual-validation contract,
3. compatibility impact,
4. user-surface behavior when applicable,
5. updated status in this register.
