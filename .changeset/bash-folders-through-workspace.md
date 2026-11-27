---
"@flow-state-dev/workspace": minor
"@flow-state-dev/tools": minor
---

Where a bash scope keeps its files, and how a projection is opened and flushed, are each written once, in `@flow-state-dev/workspace` (FIX-2935).

- **New in `@flow-state-dev/workspace`:** `scopeFolder(root, scope, principal)`, the folder one scope instance keeps its files in (`root/.fsdev/workspaces/<scope>/…`). The bash tools use it, and every existing bash folder resolves to the same path as before.
- **New:** `projectionSession({ place, mounts })` opens a projection, hydrates it, and flushes it back. A place that could not be read settles as `{ readable: false, error }`; a store failure rejects. Bash and the Claude Code workspace use it.
- **New:** `encodeSegment` and `tenantSegment` (the harness checkout encoder, unchanged), `readableSegment`, and `segmentDigest` (the 12-hex digest in a bash folder and MOAT run name) are exported from `@flow-state-dev/workspace`. `@flow-state-dev/harness-manager/checkout` still exports the first two.
- **Breaking:** `FileEntryState` is removed from `@flow-state-dev/tools` and `@flow-state-dev/tools/bash`. Use `ProjectedEntryState` from `@flow-state-dev/workspace`; it is the same shape. No alias.

Docs: packages/workspace/README.md (`scopeFolder`, `projectionSession`) · packages/tools/README.md and apps/docs/docs/tools/bash.md (`FileEntryState` becomes `ProjectedEntryState` from workspace)
