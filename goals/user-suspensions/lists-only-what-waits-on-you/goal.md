# user-suspensions › it lists only what waits on you

**Issue:** FIX-2770
**Outcome:** A user's Inbox, read on the server in one query, shows exactly their own pending asks on the worker flows: nothing from another tenant, organization or person, no wait gate or outside event, no expired ask. An answered ask leaves the screen on its own, and a worker streaming a reply elsewhere never makes the Inbox read again.
**Input:** One `createFlowState` over a SQLite file, served on a bound port, with a `worker` flow (asks a person, stops for a wait gate's reason and for an outside event, replies in 20 chunks), an `other` flow that also asks, and an `inbox` flow whose user view reads `sessions.userSuspensions({ flowKinds: ["worker"] })`. Eleven rows written by real runs over HTTP: alice in acme under tenant t1 asks twice, in two worker sessions; the same ask under tenant t2, in globex, by bob, on `other`; a wait gate's stop; an outside event's stop; an ask with a 1 ms deadline; and two asks made legacy afterwards, one request's organization cleared and one request deleted. Held-out: a different mix of the same kinds of rows must give the same verdict.
**Signal:**
- `a:scope` — the view, called over HTTP as alice in acme under t1, lists exactly her two pending asks on `worker`, and none of the other nine.
- `b:gone` — a client watching the view (push, poll off) sees the ask answered in the second worker session leave its next pushed value within 3 s, with no refresh.
- `c:quiet` — the view's recorded hearing is `[{ topic: { scope: "user" }, kinds: ["suspension"] }]`, and a 20-chunk reply and a turn started and finished in another worker session add no view call. FIX-2774 reruns this leg over its combined view.
- `d:projection` — every row's keys are inside the projection's declared set; `stepInput`, `resumeData` and the author's `data` are on none.
**Anti-game:** Real runs, a real SQLite store, the view called over HTTP and watched on the push socket. The goal never calls the store method itself, and seeds no suspension with `set()`: the two legacy rows are made by editing the request a real ask ran under. `a:scope` reads the view's own rows; an empty list is a FAIL, not a PASS. `c:quiet` waits for the expired ask's sweep (a real suspension write, which rightly wakes the view) before its window opens, and counts the notices its window heard, so a window with no turn in it can't pass.
**Model:** n/a (no model call)
**Run:** `pnpm tsx goals/user-suspensions/lists-only-what-waits-on-you/run.mts`
**Controls:**
- `GOAL_CONTROL=owns-request` — the SQL organization match also takes a request with no organization, as `principalOwnsRequest` does: `a:scope` must FAIL (the null-org row is listed).
- `GOAL_CONTROL=hear-run` — the read hears `run` on the user topic instead of `suspension`: `c:quiet` must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-17 | implementation PR head | n/a | PASS | a: 2 of 11 rows listed · b: answered ask left the watch 13 ms after the answer, poll off · c: hearing is suspension alone; the reply's 4 `run` notices on alice's user topic made 0 view calls · d: 2 rows, projection keys only. Controls: `owns-request` FAILS a:scope (3 rows, the null-org one included); `hear-run` FAILS c:quiet (hearing `run`, 4 view calls) |
| 2026-11-17 | after Codex fixes (cursor with requestId; user-only notices) | n/a | PASS | a: 2 of 11 · b: 14 ms · c: 0 view calls over 4 `run` notices · d: projection only. `owns-request` FAILS a:scope; `hear-run` FAILS c:quiet (4 view calls) |
| 2026-11-17 | after the session-delete wake and review nits | n/a | PASS | a: 2 of 11 · b: 13 ms · c: 0 view calls over 4 `run` notices · d: projection only. `owns-request` FAILS a:scope; `hear-run` FAILS c:quiet (4 view calls) |
