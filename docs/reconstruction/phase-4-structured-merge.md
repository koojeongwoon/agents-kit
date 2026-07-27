# Phase 4 Structured Merge Slice

## Completed

- JSON and JSON-section merge with JSON Pointer leaf ownership
- TOML and TOML-section merge with explicit table ownership
- Markdown merge with stable per-asset ownership markers
- Preservation of content outside Agent Kit ownership
- First-apply collision detection for unknown existing content
- External modification detection inside previously owned units
- Composition of multiple assets targeting one shared file
- In-memory prepared content kept out of serializable plan contracts
- Precondition hashes, atomic writes, post-apply validation hook, state commit,
  and rollback

## Fail-closed boundaries

- TOML merge sources containing root-level values are rejected because no
  unambiguous ownership selector exists.
- Duplicate or malformed TOML tables are rejected.
- YAML and JSONC merge are not implemented yet.
- Merge plans cannot be resumed in another process because rendered content is
  intentionally not serialized. A resumed apply must create and approve a new
  plan.
- Legacy CLI and GUI apply paths remain unchanged until the common coordinator,
  durable backups, and explicit rollback service are complete.

## Ownership model

- JSON: leaf JSON Pointers
- TOML: complete named table sections
- Markdown: `<!-- agents-kit:<asset-id>:start/end -->` blocks

An existing unowned unit with a different value becomes
`UNKNOWN_EXISTING_CONTENT`. A previously owned unit whose observed hash differs
from state becomes `OWNED_CONTENT_MODIFIED_EXTERNALLY`.
