# realtime › app views read on a notice

**Issue:** FIX-2466
**Outcome:** On a long-lived host, each app view this change moved shows a change another session made within a second, reads nothing between changes, and reads no more during a long reply than a short one; on a host whose bus doesn't cross, the same views still show the change within their old pace.
**Input:** One `serve()` host on a bound port over a `desk` flow (`respond` writes `count` messages one at a time, after an optional hold) and the claude-code-style lab's `pins` flow, one user behind a bearer token, on FIX-2426's crossing double (`goals/lib/crossing-bus.mts`). The views, each on its own real client (Node's `fetch` and `WebSocket`) whose fetcher counts its reads: the claude-code-style lab's `watchThread` (running turn) and `watchPins`, the Teammates lab's `watchConversation` (answering) and `watchWindow`, and Shift Manager's `followSessionItems`, the follow its conversation hook runs. Leg c runs the same views on a host with the plain in-memory stores, whose bus doesn't cross.
**Signal:**
- `a:within-1s` — after another client sends a slow turn into the watched session, the claude-code-style thread and the Teammates conversation report it running, Shift Manager's conversation shows its reply, and after a pin the pins view shows it, each less than 1000 ms after the write.
- `a:idle-0-reads` — over a 10 s idle window, each of the five views makes 0 reads.
- `b:as-short` — during a 200-item reply each request view (thread running turn, Teammates answering, divider) makes the same number of reads as during a 2-item reply that takes as long, and Shift Manager's conversation makes none. The two replies last the same time so they differ only in items: how a request's own notices coalesce depends on how far apart they land.
- `c:within-poll` — with no crossing bus, the pins view shows a pin within 3 s + 1 s, and the Teammates conversation a turn within 1.5 s + 1 s.

**Anti-game:** Every assertion reads what a view reported or the reads its own fetcher made, never `publish` calls or frames sent. Real sockets on a bound port. Each graded list is floored with `tell.over`.
**Model:** n/a
**Run:** `pnpm tsx goals/realtime/app-views-read-on-notice/run.mts`
**Controls:**
- `GOAL_CONTROL=timer` — each lab view keeps a fixed timer beside its subscription (a scratch patch to both lab adapters' `onNotice`). Must FAIL `a:idle-0-reads`.
- `GOAL_CONTROL=every-kind` — the lab views read on every notice on their topic, `items` included (a scratch patch to both adapters). Must FAIL `b:as-short`.

Not covered yet: Shift Manager's message log and project entries, the Teammates Talk panel, and Shift Manager's task-view run link, which this change leaves on their timers (see the PR).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-03 | fix/FIX-2466-app-polls (pre-push) | n/a | PASS | a: running turn 4 ms, answering 5 ms, Shift Manager reply 119 ms, pin 0 ms; 0 reads over 10 s idle in 5 views · b: request views 2/2/4 reads for 200 items, as for 2; Shift Manager 0 · c: no crossing bus, pins 0 ms, answering 6 ms |
| 2026-11-03 | fix/FIX-2466-app-polls (pre-push) | n/a | FAIL (expected) | `timer`: `a:idle-0-reads` (7, 4, 7, 14 reads over 10 s idle) |
| 2026-11-03 | fix/FIX-2466-app-polls (pre-push) | n/a | FAIL (expected) | `every-kind`: `b:as-short` (144, 143, 146 reads for 200 items against 4, 3, 6 for 2) |
| 2026-11-03 | fix/FIX-2466-app-polls (round 2, pre-push) | n/a | PASS ×4 | Recovery wakes added. One earlier run failed `b:as-short` on timing (divider 6 against 4: the short reply's request notices coalesced); the 2-item reply now lasts as long as the 200-item one. b: 3/3/6 reads for both · controls: `timer` FAIL `a:idle-0-reads` (7, 4, 7, 14); `every-kind` FAIL `b:as-short` (184/184/186 against 5/5/8) |
