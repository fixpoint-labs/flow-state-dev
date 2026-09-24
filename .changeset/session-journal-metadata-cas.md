---
"@flow-state-dev/engine": patch
---

`ctx.session.appendJournal` and `ctx.session.setMetadata` no longer overwrite session state, or journal entries, that another request committed while this one was running. Both now re-read the session record and write it back at the version they read, retrying on a conflict; after the retries are spent they throw `ConcurrentModificationError`. Each call now also advances the session record's version.
