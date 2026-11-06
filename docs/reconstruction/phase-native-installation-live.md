# Native installation verification in the actual client environment

2026-11-05, macOS arm64. Requested continuation after the
[native installation implementation](phase-native-installation.md).

## Result

The default Kit was explicitly initialized at `/Users/jw/.agents-kit/kit`.
Both `global` and `projects/default` Manifests validate successfully. Actual-user
home verification completed for both clients:

| Client | Exact CLI version | Native Skill root | Verified result |
|---|---|---|---|
| Codex | `0.166.0-alpha.6` | `~/.agents/skills` | Runtime lifecycle plus native import/adopt/edit/apply/client read/rollback/cleanup |
| Antigravity | `1.5.1` | `~/.gemini/config/skills` | Runtime lifecycle plus native import/adopt/edit/apply/client read/rollback/cleanup |

These runs used existing native authentication and actual installed executables,
default Kit, global ledger and client paths. Fresh randomly named verification
Skills were the only client assets written. Existing assets were not automatically
adopted, renamed, merged or moved. Verification assets and their installation
ownership were released afterward; retained Kit sources, backups and audit history
remain available. The global ledger is v5 with **zero managed targets**, **28
retained transactions**, and no pending lock/journal recovery.

## Installation and restoration evidence

The shared production service imported each temporary Skill, adopted it without
changing bytes, modes or mtimes, and edited only the Kit revision. A reviewed
native plan then changed a supporting marker, changed a script's mode from 0750
to 0755, and added a file. The actual client read the new marker. Existing rollback
restored the original marker and 0750 script mode and removed the added file.
The actual client then read the restored marker. The script was never executed.
Cleanup verified original contents, released installation ownership, detached
source registration, unlinked only known verification files and removed empty
verification directories without recursive deletion.

| Client | Apply transaction | Rollback transaction |
|---|---|---|
| Codex | `tx-2026-11-05T12-18-45-253Z-561ea31e` | `tx-2026-11-05T12-18-53-135Z-ac47723a` |
| Antigravity | `tx-2026-11-05T12-20-37-842Z-0b500578` | `tx-2026-11-05T12-20-50-994Z-3985350c` |

Evidence:

- [Codex native installation](native-installation-live-codex-20261105.json)
- [Antigravity native installation](native-installation-live-antigravity-20261105.json)
- [Preservation, cleanup and support review](native-installation-live-preservation-20261105.json)

## Existing settings and external links

Before initialization, a private snapshot recorded 23 relevant existing paths,
including client settings, instructions, native authentication file metadata/hashes
and Skill/Agent directories. No credential values were printed, copied into Kit
assets or committed to the repository. Final comparison confirmed unchanged file
content and modes, no added/removed existing entries, and exact link identity,
mtime and readlink strings for all three existing ego-browser links:

- `~/.agents/skills/ego-browser`
- `~/.gemini/config/skills/ego-browser`
- `~/.gemini/antigravity-cli/skills/ego-browser`

All still point to `/Users/jw/.local/share/ego/ego-skills`. Their destination was
not imported, adopted, written or updated. Existing MCP settings and providers
were not modified or invoked.

The Codex config file's mtime changed during native-client verification while its
bytes, mode and inode stayed identical. The verifier did not write that config,
attribute the metadata touch to a particular process, or reset its timestamp over
an active application's state. All other watched file metadata and all external
link metadata remained unchanged.

Private before-snapshot, final comparison and audit copies of the operation scripts
are under `~/.agents-kit/verification/native-installation-20261105` (0700 directory,
0600 files). Repository receipts retain fixed statuses, hashes and booleans;
raw model responses, reasoning, tool contents and credential values are not stored
by the verifier. Native clients may retain their own normal history/cache data.

## Current executable verification and narrow activation

The installed binaries no longer matched the September evidence, so their
previous records did not authorize new writes. Disposable native global fixtures
were used to establish current evidence before activating these exact two
`skills-global` slices. Successful runs confirmed baseline absence, application,
update, removal and rollback, including actual supporting-file reads and exact
current markers:

- [Codex successful recheck](native-installation-live-codex-runtime-recheck-20261105.json)
- [Antigravity stable 1.5.1 recheck](native-installation-live-antigravity-runtime-recheck-20261105.json)

The initial [Codex run](native-installation-live-codex-runtime-20261105.json) had a
final marker mismatch in the applied stage even though its tool read the marker.
It remains a failed observation and was not used for activation. The complete
subsequent recheck passed all five stages; this does not guarantee deterministic
model response formatting.

During the first [Antigravity run](native-installation-live-antigravity-runtime-20261105.json),
the installed executable changed from 1.5.0 to 1.5.1. Its original per-stage
booleans do not establish one stable executable's lifecycle. The preservation
receipt explicitly rejects that report for activation. The stable 1.5.1 recheck
uses the hardened runner, which verifies exact executable hashes before and after
each model probe and rejects evidence from changed binaries. No external updater
was invoked by Agent Kit.

The global verifier also now retains exact prerelease/build suffixes instead of
rejecting or conflating the current Codex prerelease. `clients/*.yaml` add only the
two successful global Skill/version/platform/architecture/binary slices. Existing
project Agent/MCP/instruction profiles, app/IDE support and other versions remain
gated. There are eleven reviewed CLI version/capability slices in total.

The collectors keep their original `complete: false`, exit status 2 and
`productionEvidencePromoted: false`: they do not complete the entire historical
CA04 program or automatically edit support definitions. The reviewed activation
here uses each accepted client's `fullLifecycleConfirmed`, all five stage results,
current executable hash, and subsequent native installation proof.

## Regression verification

- Root: **308 passed**, no failures/skips. HTTP: **26 passed**, no failures/skips.
  GUI: **50 passed** across 11 files. GUI typecheck, frontend/backend desktop
  builds, Cargo check, Markdown links/fences and diff checks passed.
- New tests preserve prerelease/build versions and reject executable replacement
  both before launching a model probe and during a successful-looking turn.
- Runtime activation tests check each record's own exact version and source
  lifecycle rather than assuming every record uses the September version.
  Installed-host CLI, fixed-helper and HTTP tests now assert capability-specific
  behavior: verified global Skills can deploy; unverified current-version project
  instructions/Skills/MCP/Agents remain blocked and leave targets unchanged.
- The previously skipped installed-host checks ran against the actual reviewed
  binaries. Their temporary test homes do not change the user home. Separate
  native receipts above provide the actual-user-home evidence.

This establishes current CLI global Skill installation/use and restoration.
Installing existing user MCP/Agent/instruction resources, supporting additional
native options or app/IDE surfaces still requires its own verified scope and plan.
