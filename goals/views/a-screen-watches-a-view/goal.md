# views › a screen watches a view

**Issue:** FIX-2623
**Outcome:** A screen gets every answer the server computes for it from one hook, the view: at the scope its data lives in, with no session at user or org scope, typed by the view, and current without the app naming a topic, because a change to anything the view read reaches its watchers.
**Input:** One `serve()` host on a bound port, built by workforce's conversation-board test host (the roster flow, the coordinator flow and its workers, a verified `x-user` header), plus a probe flow. The probe view's only read is one user collection, reached one block down in a sequencer step (FIX-2621's probe); its `write` action writes only that collection. A real client (Node's `fetch` and `WebSocket`) watches the roster view (`watchRoster`), the conversation board view (`listTasks_tasks`, session scope) and the probe view, with the poll off, and its fetcher counts every view call. Another client of the same user writes; a second user's client writes too.
**Signal:**
- `a:no-session` — the roster view answers a user who never had a session, equal (ids, flows, standard) to the roster read through a roster session for the same data, and the session store lists the same before and after.
- `b:within-1s` — a hire, a filed task and a probe write from the other client each reach the watching client under 1000 ms. A second user's hire wakes none of the first user's view calls.
- `b:idle-0-reads` — 0 view calls in 10 s idle.
- `c:inventory` — no removed name (`ReadConfig`, `runRead`, `flow().read`, flow `reads`, scope `derived`) on any root, and the glossary's "read" check fails a planted `reads:`. **Red until FIX-2623's PR 5** removes `reads` (and PR 4 removes `derived`).

**Anti-game:** Every assertion reads what the watching client reported or the view calls its own fetcher made, never the bus or `publish` calls. The client's poll is off, so a timer can't hide a missed dependency. The session store is read directly for `a`.
**Model:** n/a
**Run:** `pnpm tsx goals/views/a-screen-watches-a-view/run.mts`
**Controls:**
- `GOAL_CONTROL=blind-child` — the recorder skips a read made by any block but the view's own (a scratch patch to `createExecutionContext.ts`, in this fixture only, never production code). The probe view's only wake is the dependency under test, so this must FAIL `b:within-1s` on the probe write. The board can't be the control: under publish-all its other reads (the roster, the session's state) wake it on their own topics.

Not covered: a plan edit. No public action edits a conversation's plan ledger; a worker's model turn files plan steps. The board view's plan read is recorded at the user's topic (the board recorder test, `packages/workforce/test/conversation-board-view-reads.test.ts`), which the hire and the probe write already exercise. Today's `main` has no view route, so `a` can't run there; it would fail on the first call.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-11 | claude/fix-2623-impl-move (pre-push) | n/a | FAIL (expected: c) | a: 11 workers for a user with no session, equal to today's roster, session store unchanged (0) · b: hire 0 ms, filed task 0 ms, probe write 8 ms; a second user's hire reached none of alice's watches; 0 view calls over 10 s idle · c: `ReadConfig`, `runRead`, `flow().read`, flow `reads`, scope `derived` still exported, as planned until PR 4 and PR 5 |
| 2026-11-11 | claude/fix-2623-impl-move (pre-push) | n/a | FAIL (expected) | `blind-child`: `b:within-1s`, the probe write never reached the watching client within 3 s; the hire and the filed task still did |
| 2026-11-11 | claude/fix-2623-impl-move (pre-push) | n/a | FAIL (expected: c) | Re-measured with each clock started before its write and no clamp. The two rows above timed from after the write returned and showed a negative arrival as 0 ms (the old clock read hire −8 ms, filed task −2 ms). a: unchanged, 11 workers, session store unchanged (0) · b: from each write's start, hire 42 ms, filed task 31 ms, probe write 36 ms; a second user's hire reached none of alice's watches; 0 view calls over 10 s idle · c: still exported, as planned until PR 4 and PR 5; an empty inventory is now the leg's claim, so it passes once they land |
| 2026-11-11 | claude/fix-2623-impl-move (pre-push) | n/a | FAIL (expected) | `blind-child`, same clock: `b:within-1s`, the probe write never reached the watching client within 3 s; the hire and the filed task still did |
| 2026-11-11 | claude/fix-2623-impl-move-callers (pre-push) | n/a | FAIL (expected: c) | The board view answers keyed rows (`taskListViewRef`). a: 11 workers, session store unchanged (0) · b: from each write's start, hire 49 ms, filed task 48 ms, probe write 41 ms; a second user's hire reached none of alice's watches; 0 view calls over 10 s idle · c: still exported until PR 4 and PR 5 |
| 2026-11-11 | claude/fix-2623-impl-move-callers (pre-push) | n/a | FAIL (expected) | `blind-child`: `b:within-1s`, the probe write never reached the watching client within 3 s; the hire and the filed task still did |
