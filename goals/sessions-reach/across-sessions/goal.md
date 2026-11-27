# sessions-reach › one read across an owner's sessions

**Issue:** FIX-2945 (epic FIX-2941). Its spec's goal: `specs/issues/FIX-2945/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** A user-scope view lists one collection's rows from every session its owner has, including a session made after it opened, in one query per page, and never shows another owner's rows. Its notices stay right: a write to any of the owner's sessions wakes it within 2 s, and nothing another owner writes, nor anything a session it can't read writes, names that session to it.

**Input:** `fixtures/default.json`: the org, another org, the person, another person, another tenant, and the D1 gate's sizes. Held-out: `GOAL_FIXTURE=alternate.json` (other names throughout) must give the same verdict. The flows are fixed by the row: `desk` (the view `board`, user scope) and `notebook` declare `notes`, on the host's resolver; `vault` declares `notes` too, behind a resolver of its own. One owner has three sessions on the two flows, and a `vault` session of 60 rows whose keys look like task ids and sort first. Each of three other owners (another user, the same user in another org, the same user under another tenant) has a session too.

**Signal:** each failure is tagged `<assertion>:<store>`, for SQLite, Postgres and the filesystem store.

- **rows-from-every-session**: the screen (the client's own `watchView`, poll off) shows exactly the owner's four rows, from the three sessions, in session then key order.
- **one-query-per-page** (SQL stores): one view call over HTTP sends, counted at the driver, exactly one statement on `resource_state` per page the view read, each reading from `sessions`, and no session read beside them. The `vault` rows fill the first page, so the call reads two pages, the first of them empty.
- **other-owners-no-notice**: each other owner files a row after the screen opened; the screen's socket receives no notice in the next second.
- **late-row-appears**: a session made after the screen opened files a row; the screen shows it within 2 s, by the notice its socket heard (no poll).
- **custom-resolver-names-nothing**: `vault` files a row after the screen opened. The screen may wake, but no page, no cursor handed back and no frame on its socket names the `vault` session or a key of it.
- **other-user-never-appears**, **other-org-never-appears**, **other-tenant-never-appears**: a fresh view answer shows none of their rows.
- **same-answer**: the filesystem store's answer equals the SQL stores', in the same order.
- **gate** (D1, SQL stores): an owner of 5,000 sessions and 100,000 rows, 2,000 of them matching a declared index, seeded straight into the tables with each session's index built. A block times the first page of 50 filtered by that index, and the first whole page, 60 times; graded on the p95 after 10 warm runs, under 50 ms. The numbers go in the verdict log.

**Anti-game:** every row assertion reads what the client's screen showed or what a view call answered over HTTP, and every notice assertion a frame the client's socket received (a tap on `WebSocket`: it records, and changes nothing). Statements are counted at the driver: better-sqlite3's statements, and every statement the Postgres executor sent. Every session is born from an action at the host's door; only the gate's store is seeded in the tables, since 5,000 sessions through the door would grade the door.

**Not here:** the admission itself (another user, org or tenant, an own-resolver refusal, a machine's run, the webhook fence) is graded at `ctx.resources.at` in `goals/sessions-reach/name-a-session/`; this read uses that same admission, and the engine's `test/context/across-sessions.test.ts` holds the two to the same refusals.

**Model:** n/a

**Run:** `pnpm tsx goals/sessions-reach/across-sessions/run.mts` (needs `initdb`/`pg_ctl` on the machine, or `FSD_DB_URL`). `GOAL_STORES=sqlite,postgres,filesystem` narrows the stores.

**Controls:** `GOAL_CONTROL=<name>` on the same command. Each is a scratch patch to the modules, applied as the process loads them (`goals/lib/module-patch.mts`); the run prints the patch and fails if it never reached the code.

- `topic-off` (no write publishes on the owner's change topic) must FAIL **`late-row-appears`** on every store.
- `owner-user-only` (the owner check compares the user only, in every store's query and in the per-row admission) must FAIL **`other-org-never-appears`** on every store. Known co-failures: `rows-from-every-session` (the same row on the screen) and `gate` (the patched query can no longer use the owner index). The other user and the other tenant stay refused: the user still compares, and the admission's own tenant check stops the tenant.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-27 | fix/FIX-2945-owner-sessions-read on 3ce5188dad | n/a | PASS | all rows on SQLite, Postgres (initdb, PG 16) and filesystem; 2 pages each took 2 row statements and no session read; the late row shown 19 / 28 / 61 ms after its write; vault's write woke 1 notice and named nothing. **Gate:** SQLite filtered p95 3.81 ms, whole 0.64 ms; Postgres filtered p95 10.94 ms, whole 2.13 ms (budget 50 ms) |
| 2026-11-27 | same | n/a | PASS · `alternate.json` | same verdict; gate SQLite 3.19 / 0.55 ms, Postgres 17.80 / 3.34 ms |
| 2026-11-27 | same | n/a | FAIL (expected) · `topic-off` | `late-row-appears` on all three stores: never shown within 3 s |
| 2026-11-27 | same | n/a | FAIL (expected) · `owner-user-only` | `other-org-never-appears` on all three stores, with `rows-from-every-session` (the other org's row on the screen) and `gate` (filtered p95 155.92 ms SQLite, 379.93 ms Postgres) |
