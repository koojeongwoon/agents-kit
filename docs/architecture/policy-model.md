# Policy Model

## Configuration policy

Configuration policy controls what Agent Kit may read, render, and deploy.
It includes:

- allowed roots
- denied targets
- secret handling
- permitted strategies
- overwrite and conflict behavior
- backup requirements
- required validators
- capability evidence thresholds

Unknown or unsupported capabilities fail closed to `MANUAL`, `SKIP`, or
`CONFLICT`; they never become automatic apply operations.

A selected Harness inline policy applies to the complete enabled dependency
closure. If an enabled Agent reaches a Skill whose Tool requirement is denied
by that Harness, reference resolution returns `POLICY_DENIED` before client
rendering.

## Runtime effective policy

The optional runtime composes policy layers:

```text
global
  -> project
  -> agent
  -> skill
  -> tool
  = effective policy
```

More specific layers may narrow permissions. They may not broaden a parent
deny without an explicit, reviewable override mechanism.

## Approval

Approval is required for policy-designated actions such as:

- credential creation or mutation
- durable knowledge or memory promotion
- external communication
- destructive operations
- permission changes
- deployment to protected targets

An approval is scoped to the exact action and does not grant unrelated future
authority.

## Trace boundary

Allowed trace content:

- goal
- public plan
- selected skill
- requested tool and redacted arguments
- policy decision
- tool result or observation
- validation result
- final outcome

Forbidden trace content:

- hidden model reasoning
- chain-of-thought extraction
- raw credentials
- unbounded private file contents
