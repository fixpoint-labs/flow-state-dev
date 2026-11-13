---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/orchestration": minor
---

A keyed view can answer for just the rows a change touched, and a collection read re-reads just the entries that changed (FIX-2625).

- **core:** in a view's run, `ctx.view.changed` is the notice that woke its watcher: its topic, kind and `ids`. It is set only when the notice named ids and the view declares a `key`. Return `ctx.view.partial(rows, { removed })` to answer for just those rows. A view that never calls it answers whole, as before. `partial` throws on a run with no change, or in a view with no `key`. A partial answer never reorders rows: answer whole wherever a change could move a row, or add one anywhere but last. New types: `ViewChange`, `ViewRunContext`.
- **engine:** the view routes take `changed` in the body. A partial answer comes back as `{ output, topics, keys, partial: { removed } }`.
- **client:** `client.view(ref, input, { changed })` sends the notice, and `ViewResult.partial` marks a partial answer. `watchView` (and so `useView`) asks a keyed view for just the rows a notice names, and places the answer by key over the rows it holds. In development and tests, it compares each partial answer with a whole run, logs the view's name when they differ, and shows the whole run.
- **react:** `useResource` on a user or org collection re-reads just the entries a notice names, when it shows them all. A new entry, a notice with no ids, or an org with ids turned off still reads the collection.
- **orchestration:** the board's task-list view (`taskToolViews`) answers a board notice with just the named tasks' rows and the rest of their follow-up chains.

Docs: the Views page FIX-2623 adds at release (answering for the rows that changed: `ctx.view.changed`, `ctx.view.partial`, the never-reorder rule, the development check), apps/docs/guides/realtime.md (what a screen re-reads on a notice with ids), packages/core/README.md (`ctx.view`), packages/client/README.md (`client.view`'s `changed`, `ViewResult.partial`), packages/react/README.md (`useResource` re-reads named entries)
