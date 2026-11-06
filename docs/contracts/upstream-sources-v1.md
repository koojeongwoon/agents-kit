# Pinned Git and npm upstream sources v1

This extends [source revisions](source-revisions-v1.md) for active Kit-managed
imports. A local installation `origin` remains the original client/scope/native
binding. The optional `upstream` describes where to obtain new source bytes; it
never changes installation ownership, client paths, capability gates or external
updaters. External-manager observations cannot be registered or connected.

## Versioned locator and migration

```json
{
  "schemaVersion": 1,
  "type": "git",
  "repository": "https://github.com/team/repository.git",
  "commit": "<full lowercase 40- or 64-character commit hash>",
  "subpath": "skills/review"
}
```

```json
{
  "schemaVersion": 1,
  "type": "npm",
  "package": "@team/review",
  "version": "1.0.0",
  "integrity": "sha512-<canonical base64 SHA-512 digest>",
  "subpath": "skills/review"
}
```

Select a Skill directory containing `SKILL.md`, or one instructions/Agent/native
MCP file in its existing format. Single-file sources retain the Kit's existing
native filename. MCP conversion still selects only the recorded server; sibling
settings and credentials never enter the Kit copy.

Only credential-free HTTPS Git repositories and public `registry.npmjs.org`
packages are supported. Unknown fields, other protocols/registries, embedded
authentication, query strings, unsafe paths, Git branches/tags, npm ranges/tags,
and weak or absent integrity pins fail closed. New versions are explicitly
selected; there is no automatic polling, latest-version discovery or updater.

An applied first connection upgrades its resource management record to v3.
Manifest schema 2 and management container v1 remain unchanged. Record v3 keeps
the existing source/baseline/history semantics plus the optional locator. Readers
supporting only records v1/v2 reject it. Edits, detach/reattach and native install
plans preserve v3. Rollback does not downgrade it. History checkpoint v2 includes
the binding; old checkpoint v1 remains readable and restores the original local
source when it contains no upstream.

## Acquisition adapter

Git uses a fresh private temporary bare repository, an exact commit fetch with
no tags/submodules, and raw `ls-tree`/`cat-file` reads. There is no checkout,
archive substitution, Git LFS filter, source command, package install or lifecycle
script. System/global Git configuration, credential helpers, inherited Git
configuration/proxy variables, hooks and templates are disabled or isolated.
Redirects and interactive authentication are disabled. Network fetch has a
30-second timeout; the temporary repository is removed on success or failure.
The Git executable must be available on the host. Selected files are limited as
below; the fetched repository pack itself does not have a hard byte quota.

npm reads exact-version metadata and then its same-registry tarball, verifying
the selected SHA-512 integrity against both metadata and downloaded bytes before
decompression. Package identity/version must also match `package.json` inside
the archive. It never invokes npm and never installs dependencies. Downloads are
bounded to 1 MiB metadata and 8 MiB compressed archive, with 16 MiB decompressed.
HTTPS requests have 30-second timeouts and reject redirects/authentication.

Archive entries are inspected in memory and never extracted into the filesystem.
Only regular files/directories are accepted; symlinks, hard links, devices,
PAX/GNU extension records, traversal, unsafe names, duplicate/case/Unicode
collisions and invalid checksums/truncated/trailing data are rejected. Git trees
reject symlinks, submodules, non-UTF8 names and special modes. Import content and
native MCP checks remain mandatory. Each file is at most 1 MiB; the selected
bundle is at most 8 MiB/256 files, with the existing path/depth/entry limits.
These bounds intentionally reject larger or unsupported source layouts.

## Reviewed binding and merge

`checkUpstream` and `planRefresh` accept optional `upstream`. Omission uses the
stored connection, or the original local source if none exists. Explicit JSON
`null` selects the original local source. Check/plan do not change the Manifest
or installed resources; temporary acquisition files are discarded.

Connecting, reconnecting, changing a version, and returning local use the same
B/K/U merge, conflict resolution, partial acceptance and source transaction as
local refresh. The existing accepted B remains the merge parent: connecting a
new upstream never silently replaces B. A same-byte version change still creates
a reviewed metadata revision. Review tokens include the resource revision,
incoming fingerprint **and locator**, so resolutions cannot be reused for another
version that happens to have the same content.

Apply commits exactly the immutable bytes retained in the five-minute single-use
plan. It does not fetch a second remote version during commit. Mutable local
sources retain their existing apply-time revalidation. Manifest and retained
artifacts are rechecked under the shared lock and journal; failures roll back
files, baseline, history and binding together. A deferred path keeps its old B;
the selected pin plus `lastCheck.deferred` records what still needs acceptance.
Revision rollback restores K/B/deferred state and the binding together.

Native client adoption/apply/rollback is a separate reviewed step with unchanged
runtime/capability policy. Source acquisition never grants new client support.

## CLI, HTTP and GUI

- `updates --asset <id> [--upstream /path/locator.json]`
- `refresh --asset <id> [--upstream /path/locator.json] [--dry-run]`
- `refresh` keeps its existing `--review`/`--resolutions` conflict workflow.
- `POST /api/manifest/upstream/check` accepts the selected locator in its body;
  the original GET route still checks the stored binding.
- `POST /api/manifest/refresh/plan` accepts `upstream`; `/apply` accepts only the
  retained plan ID. POST requests require the existing session token.
- GUI source management exposes current/local/Git/npm source choices and pin
  fields. Changing a locator clears the previous preview and conflict choices.
  CLI and GUI use the same application service and source transaction.

Protocol references: [Git object reads](https://git-scm.com/docs/git-cat-file),
[Git fetch](https://git-scm.com/docs/git-fetch), and
[npm version metadata](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md).
