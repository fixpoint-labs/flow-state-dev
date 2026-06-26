---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

`reactTo` can now react to content writes. Bind `reactTo.contentUpdated` on a resource or collection to run a block after a server-side `writeContent()`, with a `ResourceContentChange` payload (`key`, `ref`, `kind`) typed by `resourceContentChangeSchema()`; the block reads the fresh body with `readContent()`. State and content are separate reaction axes — a `patchState` fires `stateUpdated`, a `writeContent` fires `contentUpdated`.
