# sessions-reach › it reads every collection from an index range on its key

**Issue:** FIX-2944 (epic FIX-2941)
**Outcome:** A busy scope's collection read costs the collection, not the scope. On Postgres and SQLite, each prefix read (`getByPrefix`, resource state and content) walks an index on the key from the collection's first row to its last, and returns the same rows as before: as the seed's own `startsWith`, and as the filesystem store for keys that are empty, multi-byte, at the highest code point, or hold `%` and `_`.
**Input:** `fixtures/default.json`: one scope of 200,000 rows per table across 40 collection prefixes (`tasks/c{n}/`, so `tasks/c1/` sits beside `tasks/c10/`), plus a corpus of awkward keys and prefixes in a second scope. Held-out: `GOAL_FIXTURE=alternate.json` (longer, multi-byte prefixes and a different corpus) must pass too. Postgres runs on a database in an ICU `en-US` collation when the server can make one (as production runs), where the primary key cannot answer a byte-order range; the evidence names the collation it ran on.
**Signal:**
- **plan** (`plan:<store>:<table>:<prefix>`): for every collection read, the database's plan of the statement the store sent has an index condition on `resource_key`, no sequential scan, no row discarded by a filter, and (Postgres) the index walked exactly as many rows as the read returned.
- **rows** (`rows:<store>:<table>:<prefix>`): each collection read returns exactly its seeded rows; each awkward prefix returns exactly the corpus keys starting with it.
- **same-as-filesystem** (`same-as-filesystem:<store>:<table>:<prefix>`): the awkward-prefix rows equal the filesystem store's.
- **collation / index** (Postgres): `resource_key` keeps the database default collation on `resource_state`, `resource_content` and `resource_index` (no `ORDER BY resource_key` changes); `idx_resource_state_key` and `idx_resource_content_key` are built and valid; `idx_resource_*_scope` are gone.
**Anti-game:** The plan is read from the database (`EXPLAIN ANALYZE`, `EXPLAIN QUERY PLAN`) for the exact statement and binds the store sent, captured off the executor (Postgres) and off better-sqlite3's statement `all` (SQLite). It never asserts on SQL text: a query that names no function can still scan. Rows are graded against the fixture, not against the store's own output. Every graded list is floored with `tell.over`.
**Model:** n/a
**Run:** `pnpm tsx goals/sessions-reach/indexed-key-segments/run.mts` (needs `initdb`/`pg_ctl` on the machine, or `FSD_DB_URL`)
**Controls:** none named. The control is today's `main`: check out its `store-postgres/src/{content-store,resource-state-store,schema}.ts` and `store-sqlite/src/{content-store,resource-state-store}.ts` over the branch and run. It must FAIL every `plan:*` leg on both stores and the `index:*` legs, and no `rows:*`, `same-as-filesystem:*` or `collation:*` leg.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-27 | 136e34830f with main's (6bb5557587) store sources | n/a | FAIL (expected) | ICU en-US. 320 `plan:*` failures: Postgres `Gather > Seq Scan` discarding 195,000 rows per read, SQLite `SEARCH … USING INDEX idx_resource_state_scope (scope_type=? AND scope_id=?)`; 4 `index:*` (key indexes missing, scope indexes present). No `rows`, `same-as-filesystem` or `collation` failure |
| 2026-11-27 | 136e34830f | n/a | PASS | ICU en-US. 160 collection reads, each an index range on the key with nothing discarded; 10 awkward prefixes × 2 tables × 2 stores match the filesystem store; 3 key columns at default collation |
| 2026-11-27 | 136e34830f · `alternate.json` | n/a | PASS | ICU en-US. 160 collection reads; 8 awkward prefixes match |
