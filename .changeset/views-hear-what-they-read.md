---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/orchestration": minor
---

A view's watcher reads again only on a change to what the view read, and a task board's view re-reads only the tasks a change named (FIX-2625).

- **engine:** a view's answer adds `hears`: for each of its topics, the kinds of change that may touch what its run read and, for a resource, the storage roots a change's path must fall under. A write to another resource of the same scope, or a run's own bookkeeping, no longer wakes it. A user-scope collection entry's change notice now names its collection's root (the static prefix of its pattern), never the entry's key, so a screen of another user resource can skip it.
- **client:** `ViewResult.hears` carries it, and `watchView` (and so `useView`) reads again only on a notice it admits, through the same path rule `client.live` uses. An answer from a server that sends no `hears` reads on every notice under its topics, as before.
- **orchestration:** a view that reads a task board through its task collection hears the board's own notices, which name the tasks that changed, and no longer hears its ledger's notices on the user topic, which can't. Every write to a task ledger publishes the board notice.

Docs: the Views page (what a view's watcher reads again on), apps/docs/guides/realtime.md (a user-scope entry's notice names its collection's root; a board view hears its board's notices), packages/client/README.md (`ViewResult.hears`)
