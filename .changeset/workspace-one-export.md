---
"@flow-state-dev/workspace": minor
---

The package has one entry point (FIX-2934). `refreshLock` and `privateTempRoot` are on the root export, and the `@flow-state-dev/workspace/internal` subpath is gone, with no alias.

- **`refreshLock(lease)`** marks a held lock live now, beside `acquireLock` and `releaseLock`. For a holder that refreshes as its work goes rather than on a timer.
- **`privateTempRoot(name, purpose)`** returns a temp folder private to this OS user, for files a harness hands its agent outside any checkout.
- **Breaking:** import both from `@flow-state-dev/workspace`.

Docs: apps/docs/docs/tools/workspace.md (the two functions, in its API list) and packages/workspace/README.md
