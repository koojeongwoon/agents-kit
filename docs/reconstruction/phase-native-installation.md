# Registered resource installation and installed-change merge

2026-11-05. Continues [Kit editing and local upstream merge](phase-source-revisions.md)
through explicit original-client installation ownership and deployment.
Contract: [native installation v1](../contracts/native-installation-v1.md).

## Delivered

- CLI, authenticated HTTP and GUI share `native-installation-service`. Ordinary
  native Skill, instructions, Agent files and selected MCP servers can remain at
  their original canonical client/scope path. The first adoption is metadata-only:
  accepted-baseline bytes, modes and selected server must still match. It does not
  write the client or claim runtime loading. Release also preserves client files.
- A separate reviewed apply verifies the existing client-definition capability,
  exact-version/resource evidence and observed binary checks. Native Agent/MCP
  options outside the explicitly proven subset cannot bypass typed-only evidence.
  Imported assets remain excluded from implicit `apply` deployment.
- Desired K, installed D, last-applied L and accepted upstream B remain distinct.
  External D changes block default writes. `import-installed` merges L/K/D into a
  new immutable Kit revision without changing D, L or B. Disjoint edits merge;
  overlap needs state-bound acceptance, keeping Kit, or manual text. A subsequent
  apply accepts already-incorporated installed changes only after a fresh merge
  proves K contains them. Other overwrite choices require the exact review hash.
- Skill operations touch only registered/owned files. Unknown notes, files and
  links stay in place; owned removals require explicit deletion review and reject
  externally modified content. Native instructions/Agent files keep their native
  shape, without adding a second managed Markdown block.
- MCP patches only the selected JSON value or contiguous TOML server tables.
  Unrelated text, settings, servers, credentials and full-file permissions stay
  intact. Multiple native server owners can coexist. A removed selected server
  can be explicitly restored into the remaining config without replacing it.
  Public previews contain only selected safe fragments; literal-sensitive drift
  is redacted and cannot be overwritten through an ordinary choice or copied
  into Kit. Operational full-file backups remain private local 0600 files.
- Logical references, tool providers, policy, scope and cycles resolve before
  planning. Apply additionally requires unchanged installed dependency ownership
  in the same client/scope. Existing native dependency records participate in
  generic provider-removal protection. Generic copy/merge/managed/link workflows
  cannot take over a native-owned target.
- Deployment ledger v5 stores native ownership plus references to retained Kit L
  artifacts. Older readers reject it. Existing history, private backups,
  validation, rollback and reviewed recovery are reused. Byte and permission
  preconditions are checked under the deployment lock; native creation uses an
  exclusive target and journal-v2 creation identity receipts. Rollback restores
  exact reviewed modes and bytes, including new/removal paths. Concurrent user
  changes during apply or rollback validation remain untouched, with journal,
  lock and backup retained for reviewed recovery.

## Interfaces

| Action | CLI | HTTP |
|---|---|---|
| Read installed D / L / Kit K | `installation --asset <id>` | `GET /api/manifest/installation` |
| Adopt unchanged installation | `install --asset <id> --mode adopt` | `POST /api/manifest/installation/plan` with mode `adopt`, then `/apply` |
| Reflect reviewed Kit files | `install --asset <id> --mode apply` | Same pair, mode `apply` |
| Merge installed edits into Kit | `install --asset <id> --mode import-installed` | Same pair, mode `import-installed` |
| Release ownership, keep contents | `install --asset <id> --mode detach` | Same pair, mode `detach` |

The usual Kit/project/surface/version options and `--dry-run` apply. The registered
origin supplies the client when omitted. Choices JSON maps relative file names to
`keep-installed` / `use-kit` / `manual` (manual only for import-installed); manual
texts JSON maps file names to merged strings. Both require re-planning against the
returned `--review` hash. Choices are bounded to 1 MiB, manual input to 2 MiB and
each merged text to 1 MiB. Source inventory limits still apply. Plans expire in
five minutes, are single-use and are not persisted for resume. HTTP accepts
logical selection and choices, never caller-supplied destinations or evidence.

GUI registered cards expose **클라이언트 설치 반영**. The panel shows original
target, pending Kit changes and installed drift, four explicit operation modes,
L/D/K and merge candidate, state-version warning, deletion review, conflict choices
and an apply button enabled only after a fresh successful preview. Changes to
inputs invalidate apply. Existing **배포 이력·복원·중단 복구** opens the correct
client's deployment history.

## Verification

Final results: root **304 passed / 2 skipped** (306 total), HTTP **25 passed /
1 skipped** (26 total), GUI **50 passed** (11 files). GUI typecheck, frontend and
backend desktop builds, Cargo check, Markdown links/fences and diff checks passed.

- Native service tests cover both clients' four kinds, global/project Skill paths,
  pure planning, metadata-only adoption mtime, file permissions, additional files,
  removal review, selected-server preservation, separate native MCP ownership,
  dependency proof, ownership release and ordinary validation rollback.
- External drift, explicit bound choices, stale plans/reviews, credential
  redaction, link/ancestor protection, unknown-file collisions, unverified runtime
  evidence, automatic installed-change incorporation, manual overlap and stale
  installed import are covered. Both successful and failed validation callbacks
  simulate concurrent edits during apply and rollback; those edits are retained.
- Real child-process SIGKILL before/after native state commit exercises reviewed
  journal-v2 recovery, executable modes and new-file identity. Existing typed,
  shared, managed/link and schema-v1/2/4 transaction regressions remain passing.
- CLI verifies registration/adoption, installed-change import, oversized manual
  input rejection, unverified-client write blocking and ownership release. HTTP
  verifies mutation session gates, pure planning, stale drift, Kit-only merge,
  actual temporary file apply and release; untrusted path/evidence inputs cannot
  widen scope. GUI tests cover reviewed adoption, drift re-preview and manual
  Kit-only merging.
- Actual ego-browser review completed isolated global Skill adoption → external
  installed edit → automatic Kit merge → reviewed installation write → existing
  history rollback. Filesystem assertions verified unchanged adoption mtime,
  combined installed content, exact 0640/0750 modes, retained user notes and
  readlink strings. Rollback restored the pre-apply external installed edit,
  preserving it rather than reverting to the older import baseline. TaskSpace 22
  was finished and the temporary server stopped. Screenshot:
  `/private/tmp/agents-kit-native-installation-ui.png`.

The test/browser fixture uses synthetic verification profiles solely to exercise
filesystem transactions. It does not add shipped runtime support or prove a real
client loaded an asset. No MCP process, model or external updater was invoked.

Read-only inspection found the actual default Kit
`/Users/jw/.agents-kit/kit` absent; global and default project scopes report
`MANIFEST_REQUIRED`. No live user-home client installation was adopted or written.
This records the implementation-phase boundary. The subsequent explicitly
requested [live verification phase](phase-native-installation-live.md) initialized
that Kit and verified temporary native Skills in the actual client environment.

## Remaining boundary

- Same original client, scope, config store and canonical capability path only.
  Additional discovery roots, cross-client native conversion, cross-scope provider
  installation, Git/package adapters and shared snapshot links remain subsequent
  plan stages. Existing symlinks and symlinked ancestors are preserved by refusing
  native writes through them. Known external-manager resources such as
  ego-browser remain observation-only and are never updated/imported/adopted.
- Mixed typed/native ownership within a single config file fails closed. Native
  MCP owners may coexist with each other. Dependency proof is conservative at the
  full provider-file hash: unrelated edits require reviewing/refreshing that
  provider's installation state before dependent writes.
- Advanced native options remain preserved in Kit, with unsupported writes
  blocked. Metadata adoption success does not relax runtime-use evidence gates.
  MCP syntax handling stays conservative; ambiguous syntax is rejected.
- Retained snapshots, private backups and history have no automatic garbage
  collection. Crash leftovers before creation receipts and unproven/live locks
  require review; no recursive cleanup or automatic lock stealing occurs.
  Existing no-fsync/power-loss and hostile-local-user isolation limits remain.
