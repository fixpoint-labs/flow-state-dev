# realtime › scope changes reach other sessions

**Issue:** FIX-1506
**Outcome:** When one session changes user or org state, or a resource a client can read, every other live view that may read it shows the change within a second on a long-lived host, with no poll and no remount, and the view that made the change reads it no more often than a view without `live`.
**Input:** One `serve()` host on a bound port over a four-action handler flow (`setPlan` patches org state, `addLicense` adds an org license, `addDesk` adds a row to a second org collection, `setTheme` patches user state), with an org view, `licenseCount`, counting the licenses. Two users (alice, bob) in one org, behind a bearer-token sign-in, on FIX-2426's crossing double (`goals/lib/crossing-bus.mts`), so no view keeps its fallback timer. Views are real React roots (react-dom over a happy-dom document) using `useSession(id, { live: true })`, `useClientData`, `useView` and `useResourceCollectionList`, each with a fetcher that adds its token and counts its reads; their sockets are Node's own `WebSocket` against the bound port. Held-out: any session ids; a change to a second collection, which must not re-read B's licenses.
**Signal:**
- `a:within-1s` — B's view of its own session renders A's org plan, the license count view and the new license row, each less than 1000 ms after A's run was saved (read off the host's store every 5 ms).
- `a:other-collection` — a desk A adds runs 0 reads of B's licenses.
- `b:within-1s` — A's second tab, on another session, renders A's user change less than 1000 ms after it was saved.
- `b:b-reads-nothing` — B's view makes 0 reads for A's user change, and never renders it.
- `c:within-1s` — as a, from `runAction` with no stream (a worker's run): B renders the plan and the row less than 1000 ms after each run returned.
- `d:reads-as-plain` — A's own live view, sending a plan change and a license through `sendAction`, makes the same number of reads per change as A's view without `live` makes for the same two changes.

**Anti-game:** Not `publish` calls and not frames sent: every assertion reads what a view rendered, or the reads its own fetcher made. Real sockets against a bound port, not an in-process fetch. Leg d's baseline is measured in the same run, on the same host: a view without `live` hears no notice, so its reads per change are the writer's cost without this change. Each graded list is floored with `tell.over`; the lists whose empty state is the claim say so.
**Model:** n/a
**Run:** `pnpm tsx goals/realtime/scope-changes-reach-other-sessions/run.mts`
**Controls:**
- `GOAL_CONTROL=no-publish` — the scope-change publish cut out (a scratch patch to `packages/engine/src/bus/scope-changes.ts`, which both run seams and the resource routes publish through). Must FAIL `a:within-1s`, `b:within-1s` and `c:within-1s`.
- `GOAL_CONTROL=no-origin` — the writer's view no longer skips its own request's notice (a scratch patch to `packages/react/src/hooks/useSession.ts`). Must FAIL `d:reads-as-plain`.
- Today's `main` (the parent of this change) publishes no `state` or `resource` notice, which is what `no-publish` reproduces: legs a, b and c fail there.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-03 | fix/FIX-1506-resource-notices (pre-commit) | n/a | PASS | a: B shows plan 8 ms, license row 20 ms, derived count 9 ms after saved; a desk ran 0 reads of B's licenses · b: A's second tab 4 ms; B made 0 reads · c: from a run with no stream, plan 17 ms, row 23 ms · d: A's live view reads 1, 2 per change (plan, license), as without `live` |
| 2026-11-03 | fix/FIX-1506-resource-notices (pre-commit) | n/a | FAIL (expected) | `no-publish`: `a:within-1s` (plan, row and count never shown in 3 s), `b:within-1s`, `c:within-1s`; each also CAN'T TELL, since nothing rendered |
| 2026-11-03 | fix/FIX-1506-resource-notices (pre-commit) | n/a | FAIL (expected) | `no-origin`: `d:reads-as-plain` only (live 2, 3 reads per change; without `live` 1, 2) |
| 2026-11-03 | fix/FIX-1506-resource-notices (after renaming the fixture's collection, pre-push) | n/a | PASS | a: plan 8 ms, license row 18 ms, derived count 9 ms; a desk ran 0 reads of B's licenses · b: A's second tab 6 ms; B made 0 reads · c: plan 22 ms, row 26 ms · d: 1, 2 reads per change, as without `live` · controls re-run: `no-publish` FAIL on a, b, c; `no-origin` FAIL on d only (2, 3 against 1, 2) |
| 2026-11-03 | fix/FIX-1506-resource-notices (round 2, pre-push) | n/a | PASS | After the stream-coverage, non-live single and empty-prefix fixes. a: plan 8 ms, row 18 ms, count 9 ms; 0 reads of B's licenses for a desk · b: 4 ms; B made 0 reads · c: plan 22 ms, row 25 ms · d: 1, 2 per change, as without `live` · controls: `no-publish` FAIL on a, b, c; `no-origin` FAIL on d only (2, 3 against 1, 2) |
| 2026-11-03 | fix/FIX-1506-resource-notices (round 3, pre-push) | n/a | PASS | After the storage-path rule shared by useSession and the panels. a: plan 9 ms, row 23 ms, count 11 ms; 0 reads of B's licenses for a desk · b: 6 ms; B made 0 reads · c: plan 18 ms, row 22 ms · d: 1, 2 per change, as without `live` · controls: `no-publish` FAIL on a, b, c; `no-origin` FAIL on d only (2, 3 against 1, 2) |
| 2026-11-03 | fix/FIX-1506-resource-notices (round 4, pre-push) | n/a | PASS | Own-notice skip limited to an open stream; collection hooks match storage paths through the manifest. Three runs: d reads 1, 2 per change each time, as without `live` (unchanged from round 3) · controls: `no-publish` FAIL on a, b, c; `no-origin` FAIL on d only (2, 3 against 1, 2) |
| 2026-11-03 | fix/FIX-1506-resource-notices (round 5, pre-push) | n/a | PASS | Owner-private rows publish on the bare scope topic. a: plan 12 ms, row 26 ms, count 13 ms; 0 reads of B's licenses for a desk · b: 4 ms; B made 0 reads · c: plan 24 ms, row 29 ms · d: 1, 2 per change, as without `live` · controls: `no-publish` FAIL on a, b, c; `no-origin` FAIL on d only (2, 3 against 1, 2) |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | PASS | useSession's state reads are `client.live` now. a: plan 79 ms, row 21 ms, count 7 ms; 0 reads of B's licenses for a desk · b: 6 ms; B made 0 reads · c: plan 23 ms, row 29 ms · d: 1, 2 per change, as without `live` |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `no-origin` (patch moved to `fromElsewhere`): `d:reads-as-plain` only (2, 3 against 1, 2) |
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (d:reads-as-plain) | FIX-2625: the license-count view no longer reads on the org `state` notice, so the licenses list's two wakes for one change (its `resourceChanges` entry, then the snapshot count) landed in separate renders: live read 1, 3 per change against 1, 2 |
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | PASS | `useResourceCollection` reads once per change: the count no longer invalidates when the whole list read since the last invalidation holds as many entries. Three runs: a: plan 5–10 ms, row 21–25 ms, count 14–18 ms · b: 3 ms; B made 0 reads · c: plan 18–19 ms, row 22–23 ms · d: 1, 2 per change, as without `live` |
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (expected) | `no-publish`: `a:within-1s`, `b:within-1s`, `c:within-1s` |
| 2026-11-13 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (expected) | `no-origin`: `d:reads-as-plain` only (2, 3 against 1, 2) |
| 2026-11-14 | claude/fix-2625-impl-c (pre-push) | n/a | PASS | The count's skip now trusts read order, not the count: it skips only when the snapshot that moved it was read before the list (`read-position.ts`). Three runs: d: 1, 2 per change, as without `live` |
| 2026-11-14 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (expected) | `no-origin`: `d:reads-as-plain` only (2, 3 against 1, 2) |
| 2026-11-14 | claude/fix-2625-impl-c (pre-push) | n/a | PASS | The read-position skip could leave a list stale when the server serves the list before a state read sent first (Gitar on #5232); replaced by a 50 ms trailing window (250 ms cap) that coalesces one change's two signals into one read and never skips one. Three runs: a: plan 4–6 ms, row 67–76 ms, count 12–16 ms · b: 2–7 ms; B made 0 reads · c: plan 18–30 ms, row 71–84 ms · d: 1, 2 per change, as without `live` |
| 2026-11-14 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (expected) | `no-publish`: `a:within-1s`, `b:within-1s`, `c:within-1s` |
| 2026-11-14 | claude/fix-2625-impl-c (pre-push) | n/a | FAIL (expected) | `no-origin`: `d:reads-as-plain` only (2, 3 against 1, 2) |
