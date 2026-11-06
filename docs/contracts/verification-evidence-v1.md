# Client verification evidence v1

Reports retain their schema 1 envelope and legacy fields. Each stage adds a
`verification` object with its own `schemaVersion: 1`. These are diagnostic results;
client version/binary/resource gates and deployment authorization remain unchanged.

## Independent results

| Field | Evidence | Does not imply |
|---|---|---|
| `deployment` | Application-service transaction, bytes, modes, ownership and recovery state | Client loading, tool execution or model compliance |
| `nativeRecognition` | Named configuration/source discovery, file read, MCP result or Agent role/child checks | Correct final model response |
| `modelBehavior` | Final JSON parsing, requested value match and public terminal turn | Ownership, real MCP invocation or child execution |

Each layer contains `status` and allowlisted `checks`: `passed`, `failed`,
`not-observed`, `not-tested`, `not-applicable`. Empty evidence is `not-tested`.
Missing required public evidence is `not-observed`. Definitive failure takes
precedence, while individual unknown checks remain visible. Truthy strings and
arbitrary check names are invalid.

`execution` is a separate integrity guard for process completion, unchanged binary
and permitted tools. Allowlisted reasons distinguish timeout, observer failure,
permission denial, CLI/RPC failure and binary replacement. A later execution
failure blocks confirmation without erasing an already observed tool result.
Timeout without output leaves model behavior unobserved; a wrong actual response
fails. `responseParsed` distinguishes malformed JSON from a parsed value mismatch.

Negative controls record `noUnexpectedInvocation`, not independently discovered
configuration absence. Deployment checks prove target absence; only an actual
listing can prove native discovery absence. Positive instruction behavior has no
independent native discovery in the model-use probe, so its native layer is
`not-applicable`. Discovery can separately record instruction sources when exposed.

Agent execution requires role invocation and a directly observed child result.
A parent response cannot satisfy `childCompleted`. Missing Antigravity child
events remain unobserved. Configuration listing alone proves discovery, not Agent
execution. Preflight retains `verificationByResource` so one unknown does not hide
another resource's observed registration.

Native RPC without a model turn leaves model behavior untested. Historical
receipts without per-stage deployment observations leave deployment untested,
even when cleanup or a legacy confirmation succeeded. None of these observations
is automatically promoted to full support.

Antigravity child inspection may load only the child identified by the current
probe's public role metadata. Thought frames are discarded before decoding.
Public-message replay completion does not prove original turn completion. A
read-only `manage_subagents` list can supply separately correlated state; only
state for the exact observed child plus its matching ACP public reply can be
combined. Kill/kill_all are not permitted verification tools. An Agent list that
does not declare subagent coverage cannot prove a subagent absent.

## Deployment and restoration

The observer delegates all writes to existing reviewed application services. It
compares committed transactions with actual target hashes and managed state,
tracks observed modes for drift, and checks declared native modes when present.
Observing a new file's mode does not verify an undeclared executable requirement.

Restoration compares original bytes, modes and ownership and requires absent
deployment locks/journals. Project fixtures reverse their own transactions through
reviewed rollback plans: instruction-block removal alone may leave whitespace.
Fresh global fixtures retain ownership-scoped cleanup and original comparisons.
Link observation uses `lstat`/`readlink`; no write follows a symlink destination.

Concurrent edits block rollback. Unverified restoration retains the private
workspace under `recovery.scratchRoot`, including source needed for investigation.
Operational backups, journals and ownership controls retain their existing boundary.

## Completion and compatibility

Client summaries aggregate each layer over requested stages. Missing stages stay
untested. `complete` requires satisfied evidence/integrity for every requested
stage and verified cleanup. `fullLifecycleConfirmed` additionally requires all
five stages: baseline, applied, updated, removed, rollback. Applied-only success
cannot prove a full lifecycle.

New reports declare `completionScope: requested-clients-resources-stages`. Top
`complete` is computed from client summaries, replacing the old constant CA04-wide
false. It does not cover unrequested clients, resources, scopes or surfaces.
Live verifier exit codes are 0 for this completion and 2 for incomplete/failure.
Preflight leaves model behavior untested and cannot claim full completion.

Legacy `confirmed`, `markerConfirmed`, `invocationConfirmed` and `fileLifecycle`
remain readable. New consumers must use individual layers to diagnose failures.
No capability activation reads these new results automatically; generated reports
retain `productionEvidencePromoted: false`. Historical activation receipts are
unchanged. Absolute binary paths allow native before/after fingerprint checks;
an unobserved fingerprint cannot satisfy the new integrity summary. Component
hashes identify grading, adapters and deployment observation used for a report.

## Recorded failure replay

```sh
npm run verify:replay -- \
  --input docs/reconstruction/native-global-antigravity-mcp-runtime-recheck-20261105.json \
  --output /tmp/new-verification-replay.json
```

Replay never starts a client/model/provider or writes settings. Output uses
exclusive creation (`wx`, 0600); an existing output or source cannot be overwritten.
Exit 0 means replay completed; the described original verification may have failed.

`replayOnly`, input SHA-256, component hashes, recorded confirmations and separated
summaries identify the interpretation. Missing evidence stays missing and blockers
are normalized. Historical failures are neither rewritten nor promoted. Reports
retain public facts/statuses, never raw responses, tool output, credentials,
native child IDs or hidden reasoning.
