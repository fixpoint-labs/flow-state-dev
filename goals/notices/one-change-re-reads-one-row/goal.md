# notices › one change re-reads one row

**Issue:** FIX-2625
**Outcome:** When one entry of what a screen shows changes, the screen re-reads only that entry (a board one task, a collection one entry), never misses a change because of it, and a scope that turns ids off sends a browser no ids and no entry keys.
**Input:** Two runs of one `serve()` host on a bound port with push, on the default in-memory bus: ids on, then org ids off (`noticeIds: { org: false }`). A flow with a board of 200 tasks on a user-scope ledger, filed from the watched session (orchestration's task board and its task-list view, which answers for the tasks a board notice names), a second keyed view of the board that does not opt in and orders by status, and an org collection of 200 entries written through the default write flow. A screen (react-dom over happy-dom, under `FlowProvider`, poll off) watches the board view, the second view (`useView`) and the collection (`useResource`); a second client writes, from other sessions.
**Signal:**
- `a:one-row` — one task's edit makes the board view answer exactly one partial answer of 1 entry; one entry's edit makes the collection read fetch exactly 1 entry and no list.
- `b:equals-store` — after a single edit, a follow-up's ending (which changes its root's entry too), a burst of 300 writes (150 holds from five sessions at once, 150 new tasks, then 100 entry renames), a cancelled task and a deleted entry, each screen equals a fresh whole read; the second view too.
- `c:ids-off` — with org ids off, no org frame on the screen's socket carries `ids` and no scope-wide org frame names an entry key, while its screens stay equal to the store.
- `d:old-client` — a client built from `main` before this change, against this host, passes `b`.

**Anti-game:** Entries are counted in the answers the server sent, at the screen's fetcher; screens are compared with a fresh whole read, never with the merge function or `publish` calls. Poll off, so a timer can't hide a missed entry. The client's development check (a partial answer compared with a whole run) is off, so the controls grade what production shows.
**Model:** n/a
**Run:** `cd goals && pnpm tsx notices/one-change-re-reads-one-row/run.mts`
**Controls:**
- `GOAL_CONTROL=identity-only` — the board's partial answer re-runs only the entries whose keys equal the ids, so a follow-up's ending leaves its root stale. Must FAIL `b:equals-store`.
- `GOAL_CONTROL=drop-ids` — the publish queue drops every notice's ids. Must FAIL `a:one-row`.

**Not shown failing:** the board view hearing its ledger's user-topic notices (FIX-2625 D3), which name no task. With the task collection's board read unrecorded (`recordBoardRead` in `get-or-create.ts`), `a:one-row` fails: the board answers whole, 200 entries. Not kept as a control: it is the shape the owner ruled out, and `task-list-view-partial.test.ts` pins what the board's answer hears.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (a:one-row) | Before D3: the board view also heard its ledger's user-topic notices, which name no task, so one task's edit answered the whole board, 200 entries. Re-run with the board read unrecorded: same failure |
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | PASS | a: one task's edit → 1 board answer of 1 row (partial) · one entry's edit → 1 entry fetched, 0 lists · b: 15 screens equal a whole read across 5 steps · d: main's client equals the store on 3 screens · ids on: 102 org frames named ids · c: org ids off, 52 org frames heard, none with ids or an entry key |
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (expected) | `identity-only`: `b:equals-store` after a follow-up's ending, the board screen differs at t000 |
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (expected) | `drop-ids`: `a:one-row` (the board answered 200 entries whole; the collection read 1 list and 0 entries), and the ids-off run's setup check (no org frame carried ids) |
