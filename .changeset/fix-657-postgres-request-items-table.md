---
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/server": minor
---

Postgres adapter now stores request items in a dedicated `request_items` table, one row per item, eliminating the TOAST-amplified write bloat that built up on long-running requests under serverless-throttled autovacuum. Migration is lazy — legacy `data.items` is still read on the fallback path until operators run the optional `UPDATE requests SET data = data - 'items'` + `pg_repack requests` cleanup. The deploy is forward-only; validate in staging before rolling out. `RequestStore.list()` no longer populates `record.items` by default on Postgres — pass the new `RequestListOptions.withItems: true` to opt in. The three framework-internal callers that depend on items in listings (cross-turn history, the `?includeItems` state endpoint, the session-requests listing) are already updated.
