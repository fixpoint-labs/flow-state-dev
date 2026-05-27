---
"@flow-state-dev/store-sqlite": patch
---

Persist request items incrementally to a dedicated `request_items` table, upserting only the items that changed instead of rewriting the whole request blob on every item boundary. Existing databases read legacy blob items via a transparent fallback.
