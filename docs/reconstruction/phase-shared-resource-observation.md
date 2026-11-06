# Shared resource consolidation: observation implementation

2026-11-05. Initial implementation of the
[consolidation plan](../product/shared-resources-consolidation-plan.md).

## Implemented

- A read-only [observation contract](../contracts/local-resource-observation-v1.md).
- Global/project discovery for instructions, Skills, Agents and MCP server names
  in the Codex/Antigravity client definitions. Other clients keep existing readers.
- Directory/file/agent readers, effective surface paths, and additional CLI-only
  Antigravity Skill roots. Agent directory traversal remains one level deep.
- Normal, broken, cyclic and unknown Skill links remain visible. Only link
  metadata is inspected; external app source content is never opened.
- Known ego-browser links show their external manager via data-driven discovery
  metadata. No baseline, import, update task, ownership or mutation is created.
- Stable candidate IDs distinguish same-named resources at different locations.
  CLI/HTTP/GUI use the same application service. GUI uses effective surface
  observations and does not merge observed and desired resources by name.
- An instructions view, project inventory, external link status, read-only cards,
  and explicit init guidance when a Kit is absent.
- Kit path resolution is now read-only; `init` is the explicit starter creation
  command. This also fixes daemon-status/bundle CLI calls attempting to bootstrap
  the user's home Kit.
- Current Agent adapters reject legacy sandbox/MCP defaults rather than emitting
  settings that do not enforce the claimed behavior. Basic roles, logical tool
  registry binding and existing ownership/rollback behavior remain available.

## Validation

Dependencies were installed from both lockfiles without install scripts. The
first root baseline had 243 passing, 2 failing and 2 skipped tests. Both failures
were caused by implicit Kit creation outside the workspace; explicit init fixes
that behavior. The GUI baseline had 36 passing tests.

Final checks:

| Check | Result |
|---|---|
| `npm run test:all`: root | 251 passed, 2 skipped |
| `npm run test:all`: HTTP | 22 passed, 1 skipped |
| `npm run test:all`: GUI desktop build/backend bundle | Passed |
| `npm run test:all`: Cargo check | Passed |
| `npm --prefix gui test` | 38 passed |
| `npm --prefix gui run typecheck` | Passed |
| `git diff --check` | Passed |

Skipped tests require the previously reviewed native client builds; those exact
builds are not installed. No new client runtime evidence or support activation
was created. The first sandbox HTTP run could not bind a local port; the same
full command passed with local test-port access.

The actual ego-browser link was queried using the application service. It was
reported as `external`, `symlink`, `resolved`, manager `ego`. Its `readlink` value
and link modification time were identical before and after discovery. The
application's Skill content was not copied. Unit tests also instrument file
reads and verify that link-only discovery opens no source files.

The built GUI was checked through ego-browser using the existing allowed local
origin, with an empty temporary Kit location and the real read-only inventory.
Four existing ego-browser locations appeared separately; all had zero action
buttons. Known Codex/Antigravity manager mappings showed the external label;
unknown ownership remained unknown. The absent Kit did not hide observed
resources. No deployment action or actual model/client invocation was performed.

## Remaining work

Import/adoption/detach, typed editor preservation, source editing, upstream
tracking and merge, shared snapshot links, typed store coalescing and cross-scope
dependencies remain the following stages. Discovery manifests and parent-folder
effective resource resolution also remain separate work; this change observes
the explicitly selected project root. This phase does not claim those features
are implemented.
