---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

The SQLite and Postgres request stores now write a settling record's `items` in the same transaction as its status, and read a record's row and items in one snapshot, so a reader never sees a final status without its items or one request's row paired with another's items after a request id is reused (FIX-1750, FIX-1619). A custom `RequestStore` must land the `items` a terminal `set` carries in that same write; the runtime no longer persists them separately before settling.
