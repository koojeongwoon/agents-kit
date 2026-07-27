# Phase 6 Managed and Link Strategies

## Completed

- Client definitions accept `managed` and `link` strategies
- Managed strategy owns and replaces one complete regular file
- Managed targets reject unknown existing content
- Managed targets reject external modifications after ownership
- Link strategy creates links only at an absent target
- Link replacement is allowed only for a previously owned, unchanged link
- Unknown files, directories, and links are never silently replaced
- Link target authorization checks the link location rather than following the
  existing link destination
- Self-referencing links are rejected
- Link fingerprints include their exact stored link source
- File transactions atomically create and replace links
- Persistent backups retain previous links without dereferencing them
- Explicit rollback restores the previous link and ownership record

## Intentional boundaries

- Managed directories are not supported; directory assets use copy or link.
- Identical unowned files and links are skipped but not claimed as owned.
- Client definitions do not silently change strategy when a requested strategy
  is unsupported.
- The common prepare service and CLI/API integration remain separate work.
