---
"@flow-state-dev/react": minor
"@flow-state-dev/contracts": minor
---

`useResource` can keep a whole user or org collection current and says why a read failed (FIX-2775).

- **react:** `useResource(def, { all: true })` reads every page of a user or org collection through the client's `listAll()`, not its first 200 entries. A change notice that names entries reads just those and merges them in, a new entry in storage-key order and a deleted one dropped, so an append-only log never re-lists for a new entry; the collection is listed again only on a notice that names no entry, a missed-notice resync, or an entry read that failed. `topicPrefix` (with `all`) keeps only the entries whose storage key starts with it, and hears only the change notices that may touch them. Every user or org result now has `refresh()`, to read again now, and `failure` while `stale`: the same `{ message, httpStatus? }` `useView` gives, the server's own words for a refused read, and a `CollectionReadStoppedError`'s message when a read stopped on a repeated cursor or past the page ceiling.
- **contracts:** `extractBareTopic(pattern, storageKey)` is exported from `@flow-state-dev/contracts/helpers`, beside `getPatternPrefix`, so a browser package can name a collection entry without core's runtime; `@flow-state-dev/core/types` still exports it.

Docs: packages/react/README.md (`useResource`'s `all`, `topicPrefix`, `failure` and `refresh()`)
