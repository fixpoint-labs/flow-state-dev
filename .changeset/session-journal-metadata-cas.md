---
"@flow-state-dev/engine": patch
---

`ctx.session.appendJournal` and `ctx.session.setMetadata` no longer overwrite session state or journal entries another request committed meanwhile: they now write at the version they read, retry on conflict, and throw `ConcurrentModificationError` once retries run out (FIX-1376).
