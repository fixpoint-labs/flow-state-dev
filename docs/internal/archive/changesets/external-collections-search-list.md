---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
---

External resource collections gain search and list — the app's own store engine runs every "find", the framework never enumerates in memory.

- `ctx.resources.<name>.list(query?)` returns a cursor-paged `{ items, nextCursor? }` by pushing the query down to your `search` hook (a bare string is `{ search }` shorthand). Each item is a read-only ref with resolved state and rendered content.
- The agent's `searchResources` tool routes to `search` for `llmReadable` external collections and pages with a `nextCursor`; `globResources` / `grepResourceContent` skip them (their deterministic-match contract can't be pushed down). `readResourceContent` resolves an external URI directly.
- The collection list route (`GET …/resources/:ref`) and its client/react surface move from offset to **cursor** pagination for every collection: the response is `{ items, nextCursor? }`, `listCollectionItems` takes `cursor`, and `useResourceCollectionList` exposes `hasMore` / `loadMore` over an opaque cursor. Store-backed collections page by keyset (stable under inserts); external collections pass the app store's own cursor straight through. Search hits are validated through `stateSchema` — a bad row is dropped and logged, never sinking the page.
