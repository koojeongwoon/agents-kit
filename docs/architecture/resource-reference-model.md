# Resource Reference and Dependency Model

## Goal

Agent Kit must understand relationships between assets rather than merely
writing references into generated Markdown. Relationships are part of desired
state, validated before client rendering or deployment.

## Reference direction

```text
Harness
  -> enables Agent, Skill, Workflow
  -> allows or denies Capability

Agent
  -> uses Skill
  -> requires logical Tool
  -> applies Policy
  -> reads or writes Memory

Skill
  -> requires logical Tool
  -> may depend on another Skill
  -> reads or writes Memory

Workflow
  -> invokes Agent, Skill, or logical Tool

MCP Server
  -> provides logical Tool
```

Skills and Agents do not own MCP connections. They require logical tools. The
Tool Registry selects a provider that is installed, enabled, in scope, allowed
by policy, and supported by the target client.

## Scope rules

```text
global asset  -> global asset
project asset -> project asset or global asset
global asset  -X-> project asset
```

A project asset may override a global asset only through an explicit override
contract. Accidental duplicate IDs are rejected.

## Dependency closure

Selecting an Agent for deployment expands to:

1. referenced Skills,
2. nested Skill dependencies,
3. required logical Tools,
4. selected Tool Providers,
5. referenced Policies,
6. Memory configuration,
7. Harness capability constraints.

The planner renders the complete closure or refuses the selection. It never
deploys an incomplete Agent silently.

## Tool resolution

A required tool resolves only when exactly one effective provider exists after
scope, enabled-state, policy, and target-client capability filters.

```text
zero providers     -> MISSING_TOOL_PROVIDER
multiple providers -> AMBIGUOUS_TOOL_PROVIDER
denied capability  -> POLICY_DENIED
unsupported client -> CAPABILITY_UNSUPPORTED
```

Explicit provider preference may disambiguate providers, but it remains a
binding hint rather than connection ownership.

## Graph validation

Validation occurs before capability-aware materialization:

- referenced asset exists and has the expected kind
- reference scope is legal
- required tool has one effective provider
- required capability is allowed by effective policy
- workflow step target exists
- memory reader/writer target exists
- dependency graph is acyclic where recursion is not explicitly supported

Validation returns stable machine-readable issues with source asset, reference,
code, severity, and remediation context.

## Creation and editing UI

Asset editors should project registry data:

- Skill: required Tools and Capabilities
- Agent: Skills, Tools, Policies, and Memory access
- Harness: enabled assets and allowed/denied Capabilities
- Workflow: Agent/Skill/Tool per step
- Memory: allowed readers, writers, and approval policy

The UI stores stable IDs. Human-readable names and paths are presentation data.
Deleting or renaming a referenced asset requires dependency impact review.

See the complete [Agent Kit Manifest example](../examples/agent-kit.yaml).
