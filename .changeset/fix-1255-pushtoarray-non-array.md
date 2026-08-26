---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

`pushToArray` now throws when the target field is present and not an array — the same on memory, filesystem, SQLite, and Postgres. A missing field is still treated as an empty array.
