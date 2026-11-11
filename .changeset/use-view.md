---
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/engine": minor
---

Watch a view from a screen, with no topics to name (FIX-2623).

- **client:** `viewRef<typeof myView>(flow, name)` names a view for the client, typed by the view through a type import, so the view's block never reaches the browser bundle. `client.view(ref, input?, { sessionId? })` runs it once and resolves to `{ value, topics, keys? }`: the answer, typed as `ViewOutput` of the view, the change topics of what its run read, and a keyed view's row keys in order. Pass `sessionId` for a session view; a user or org view takes none. Types `ViewRef`, `ViewResult`, `ViewCallOptions`, `ViewValueOf` and `ViewInputOf`.
- **react:** `useView(ref, input?, { sessionId?, enabled?, pollIntervalMs? })` returns `{ value, stale }`. `value` is `undefined` until the first answer. The hook listens to the topics each answer names and reads again on a change; it reads again on its own after a failure, and `stale` is `true` until a read lands. Every component watching the same view with the same input and session shares one read. A keyed view's rows that didn't change keep their object identity across answers.
- **engine:** a keyed view's answer carries `keys`, the rows' keys in order.

Docs: packages/client/README.md (`viewRef`, `client.view` and its answer, `ViewResult`, `ViewValueOf`, `ViewInputOf`), packages/react/README.md (`useView`, `{ value, stale }`, shared reads, keyed rows keeping identity), the new apps/docs "Views" page (watching a view from React and from the client), apps/docs/docs/api/client.md and apps/docs/docs/api/react.md (the same, as reference).
