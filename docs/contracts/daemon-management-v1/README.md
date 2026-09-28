# Daemon management authentication v1 fixtures

Normative design: [LM2-1 contract](../../architecture/daemon-management-auth-v1.md).

- `profile.json`: selected wire names, algorithms, lifetimes and errors.
- `examples.json`: synthetic enrollment request/response shapes and a genuinely
  signed management JWT/DPoP request. Only public keys are retained. Evaluate at
  `now`, not the machine clock. Enrollment examples deliberately require their
  own enrollment token; do not send the management sample to IAM.
- `cases.json`: management mutation vectors and stateful service acceptance
  scenarios. These are expected results, **not executed service test evidence**.

Run `npm run test:device-contract` to check fixture integrity: real signatures,
thumbprint, access-token hash, claims, public-only keys and catalog consistency.
It does not implement an authentication server or validate service behavior.

## Consumer adapter rules (LM2-2 to LM2-4)

Start each management case from `examples.management` and reset state. Apply
each dotted-path replacement in `changes`. A null deletes that field.
`device_claim` aliases the namespaced claim in `token_claims`; `$now`, `$now-61`
and `$now+6` are fixed-clock expressions. These are fixture instructions, not
request parameters. Do not evaluate arbitrary expressions or code.

Import the committed public JWKS and signed positive request for verification
tests. For mutation cases, create ephemeral test issuer/device key pairs in the
consumer test process, update the matching trusted JWKS, registered thumbprint,
and `cnf.jkt`, then sign the base tokens. Re-sign changed claims/headers with the
appropriate test key. Recompute `ath` after a token mutation, except for a case
explicitly replacing `ath`. Rebuild Authorization after token changes; M02
retains the same token but changes the scheme. This isolates the stated error
instead of failing every case on an invalid fixture signature.

`proof_signer: fresh-unregistered-key` generates a new key and embeds its public
JWK in a validly signed proof while retaining the original token/registry key.
`proof_signature: tamper-first-byte` flips a signature byte after signing.
The default context has IAM and replay stores available. Seed the replay store
using the current verifier/key and the listed `seen_proof_jtis`. The normative
profile requires nonce generation/challenge headers and atomic replay handling;
test these through the real HTTP adapter as well as pure verifiers.

Successful report reception is 202 with a receipt. Lifecycle scenarios use real
database transactions, fresh proofs and controlled clocks. Preserve the case IDs
in each consumer's test names/evidence. Verify private-key rejection, malformed
JWT/JWK limits, algorithm allowlists, duplicate headers and unknown critical
headers in consumer parser tests; these fixtures are not a full JOSE compliance
suite. G-2 direct MCP compatibility is outside this catalog.

LM2-4 실행 결과: [Gateway/데몬 통합 검증](../../reconstruction/phase-lm2-4-gateway-reports.md). 원본 서명 fixture와 M01–M30을 실제 Gateway verifier/reader로 검증했다. 보고 상세 스키마는 [인증 계약 §8](../../architecture/daemon-management-auth-v1.md)을 따른다.
