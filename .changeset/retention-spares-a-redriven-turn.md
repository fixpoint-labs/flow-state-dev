---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Session retention no longer deletes a request that started running again after retention judged it evictable. An `interrupted` turn the durability sweep re-drives between retention's read and its delete now keeps its record, items, events and runOnce results. `RequestStore` gains `deleteIfStatus(id, allowedStatuses)`, which deletes a request only while its status is one of `allowedStatuses`, checked in the same atomic step; the memory, filesystem, SQLite and Postgres stores implement it. A custom `RequestStore` must add it (FIX-2109).
