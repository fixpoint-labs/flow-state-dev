---
"@flow-state-dev/tools": minor
---

The bash tool now reconciles the sandbox through `@flow-state-dev/workspace` instead of its own copy of the logic.

What changes for you: a file changed in its collection while a run held it is no longer silently overwritten or deleted. The write is skipped and a warning names the contested path, leaving both copies alone. A workspace listing that fails now skips the flush instead of being read as an empty workspace, which previously deleted everything the run owned.

Three `createBashTool` options are gone:

- `syncMode: "full"` meant "write every file back regardless of what the collection holds", which is the overwrite this change exists to prevent.
- `fileFilter` has no equivalent — exclude a collection from the mount set instead.
- `collections` are now mounted at their pattern prefix, matching `createBashBlocks`. A collection matching `files/*` lands at `<workspace>/files/` rather than at the workspace root. A collection whose pattern gives no prefix is skipped with a warning instead of silently becoming the owner of every loose file.

`FileSync` is no longer exported. `hashContent` still is, now re-exported from `@flow-state-dev/workspace`. `createSandboxPlace` is newly exported for wiring a sandbox into a projection directly.
