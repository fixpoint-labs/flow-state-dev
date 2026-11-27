---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
"@flow-state-dev/react": patch
"@flow-state-dev/shift-manager": patch
---

A screen can keep a whole user or org collection current without re-reading every entry, and can read one newest-first, one page at a time (FIX-2845). Shift Manager's message log shows the newest messages first and loads older ones as you scroll.

Docs: apps/docs/docs/shift-manager/overview.md (the message log), apps/docs/docs/resources/client-access.md (`useResource` on a user or org collection: `all` and `newest`).
