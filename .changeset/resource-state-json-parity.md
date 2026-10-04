---
"@flow-state-dev/engine": patch
---

The in-memory and filesystem resource state stores now commit the JSON form of a write, matching SQLite and Postgres (FIX-1266). A `Date` reads back as its ISO string, a `Map` or `Set` as `{}`, `Infinity`/`NaN` as `null`, and `undefined` or function fields are dropped on every store; a `bigint` or a cyclic state is refused with a `TypeError` on every store. Previously the in-memory store kept these values as written, so tests on memory could pass while the same write stored different data on a durable store.
