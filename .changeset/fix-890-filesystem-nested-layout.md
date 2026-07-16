---
"@flow-state-dev/engine": minor
"@flow-state-dev/cli": minor
---

The filesystem content and state stores now persist each resource as a real nested file: a key like `concepts/flow-state-dev/overview` lands at `concepts/flow-state-dev/overview.md` (content) or `.json` (state), so the store directory is a browsable, diffable file tree instead of flat percent-encoded names with no extension. The store API is unchanged. A store directory written in the old flat layout is detected and refused with a clear error rather than silently misread — move it aside or delete it to upgrade. Filesystem-backed keys narrow slightly on this backend: an empty path segment or a Windows reserved device name is rejected loudly, and on case-insensitive volumes keys differing only in case can still collide.
