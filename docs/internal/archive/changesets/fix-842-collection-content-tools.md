---
"@flow-state-dev/core": minor
---

Resource collections can now opt into the generic content tools. `defineResourceCollection` accepts `llmReadable` / `llmWritable` (default off), declared once and applied to every instance — so a content-bearing collection's instances are read and written by `readResourceContentTool()` / `writeResourceContentTool()` and found by `grepResourceContent` / `searchResources`, with no hand-rolled per-collection read/write blocks.

The content and navigation tools now address resources by their scope-qualified uri (`session/notes/onboarding`) instead of the within-scope path. This is unique across scopes, so a `globResources` or `grepResourceContent` result feeds straight into a read or write. Note the output field rename: `globResources` returns `uris`, and `grepResourceContent` / `searchResources` matches carry `uri` (was `path`); `readResourceContentTool` / `writeResourceContentTool` take a `uri` argument (was `path`).
