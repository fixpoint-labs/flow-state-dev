# collection-indexes › it finds rows by a declared field

**Issue:** FIX-2532
**Outcome:** A flow finds a collection's rows by a declared field and gets the same rows on every store. On SQLite and Postgres it reads an index kept in step with the rows, including rows written before the index existed. Here the collection is a task ledger kept per partition, looked up by task id across partitions (`findTaskPartitions`, which is `findBy` on the ledger's `byTaskId`).
**Input:** `fixtures/default.json`: ledger rows and old `__ids` markers seeded straight into the store (one marker names a partition that holds no row), then tasks filed through the flow in three partitions, one id in two of them, plus ids nobody filed. Held-out: `GOAL_FIXTURE=alternate.json` (different ids, four partitions, a duplicate legacy id, partition names that need encoding) must pass too, and so must any other fixture of the same shape.
**Signal:**
- **(a)** after filing, every lookup returns exactly the fixture's partitions for the id, duplicates included and the ghost marker's partition excluded, and memory, SQLite and Postgres return the same sets (`a:<store>:<id>`, `a:same-everywhere`).
- **(b)** on SQLite and Postgres, the lookups after the index is built make **zero** prefix or whole-scope reads of resource state (`b:<store>`).
- **(c)** the first lookup of each seeded id returns the seeded rows' partitions (`c:<store>:<id>`).
**Anti-game:** The check reads which partitions come back from a real flow's action and which store reads ran. It does not read the index table, and it never mocks a store: a store that kept entries but still scanned fails (b), and a lookup that missed a row fails (a). Every graded list is floored with `tell.over`, so an empty read is CAN'T TELL.
**Model:** n/a
**Run:** `pnpm tsx goals/collection-indexes/find-rows-by-a-declared-field/run.mts`
**Controls:**
- `GOAL_CONTROL=wrong-index-values`: every write's `byTaskId` entries reach the store with a wrong value. Must FAIL (a) on the rows filed after the first build (`a:sqlite:*`, `a:postgres:*`, `a:same-everywhere`), and nothing in (b) or (c).
- `GOAL_CONTROL=scan-only`: the SQL stores' index verbs are hidden, so `findBy` scans. Must FAIL (b) on both SQL stores, and nothing in (a) or (c).

The spec named the first control `no-index-writes` (writes carry no entries). That control cannot fail (a): a write that carries no entries for a built index clears the index's built marker (D1), so the next lookup rebuilds from the rows and finds the new ones. Writing wrong values keeps the marker and breaks the index path, which is the failure (a) exists to catch.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-05 | 8c55e86 (main, before this change) | n/a | FAIL (expected) | Fails (a), (b) and (c) on every store: the `__ids` lookup returns the ghost partition and misses seeded rows; SQL lookups make 9 prefix reads |
| 2026-11-05 | p3 working tree on 8c55e86 | n/a | FAIL (expected) · `wrong-index-values` | 10 × `a:sqlite/postgres:<filed id>` (filed rows missing) + 2 × `a:same-everywhere`; no (b) or (c) failure |
| 2026-11-05 | p3 working tree on 8c55e86 | n/a | FAIL (expected) · `scan-only` | `b:sqlite` and `b:postgres`: 9 prefix reads each, want 0; no (a) or (c) failure |
| 2026-11-05 | p3 working tree on 8c55e86 | n/a | PASS | 9 ids × 3 stores matched; reads after build sqlite 0, postgres 0; seeded rows found on first lookup |
| 2026-11-05 | p3 working tree on 8c55e86 | n/a | PASS · `alternate.json` | 9 ids × 3 stores matched (duplicates job-a, job-c, job-x); reads after build 0 / 0 |
