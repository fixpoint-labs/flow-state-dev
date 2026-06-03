---
"@flow-state-dev/server": minor
---

Resource list/get-state read endpoints now support user- and org-scoped collections (previously session-only, returning 501).

- `GET /sessions/:sessionId/resources/:ref` (list state) and `GET /sessions/:sessionId/resources/:ref/:topic` (single item state) now resolve user/org-scoped collections via the shared scope resolver (honoring `flowIsolation`), in addition to session scope.
- The session path is unchanged: it keeps its pattern-prefix-scoped read optimization. User/org scope reads the resolved scope record.
- A missing user/org record (the collection has nothing written yet) reads as an empty collection — `200` with an empty list / `null` item — never an error.
- Both endpoints continue to require `client.state.read === true` and resolve `userId` from the session. Mutation/create endpoints remain session-only for now.

This unblocks user-scoped collections (e.g. a portfolio that persists across sessions) being read from the client via `useResourceCollectionList` / get-state.
