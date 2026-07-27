# Optional Managed Runtime

## Status

This document fixes conceptual boundaries only. It does not authorize runtime
implementation during the Configuration Plane reconstruction.

## Responsibilities

### Harness

- owns execution limits, sandbox, timeouts, cost limits, permissions, approvals
- executes the loop
- connects model and tool adapters
- maintains public working state

### Agent

- represents the decision-making configuration
- combines model selection, system instructions, skills, tools, and policy
- requests actions but does not execute tools directly

### Loop

```text
Model Decision
  -> Skill and Tool Selection
  -> Policy Gate
  -> Execution
  -> Observation
  -> State Update
  -> Complete or Repeat
```

The Harness executes this loop.

### Tool Registry and MCP

- the registry owns available tool descriptors and connections
- MCP is one provider/adapter mechanism
- Skills reference logical tools and scopes
- runtime policy selects the effective callable tool set

### Working state

Working state contains the current goal, public plan, conversation context,
action requests, results, validations, and completion state. It does not store
hidden model reasoning.

### Long-term memory

Memory is an infrastructure capability with storage, retrieval, context
injection, summarization candidates, review, and consolidation. Session output
becomes a candidate, not automatically approved durable knowledge.

## Separation from configuration

- Runtime consumes installed assets through stable interfaces.
- Manifest validation does not start a runtime.
- Deployment does not require a vector database or MCP runtime.
- Runtime failure cannot corrupt Configuration Plane state.
- Memory backends remain replaceable and are not embedded in Skill files.

