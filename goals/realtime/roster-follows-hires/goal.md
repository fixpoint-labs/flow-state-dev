# realtime › the roster follows hires

**Issue:** FIX-2412
**Outcome:** When a worker is hired, forked, edited or fired, from another tab or by a worker's turn, the roster in Kitchen Sink, Shift Manager and the Teammates lab shows it without a reload or a Retry, reading nothing while nothing changes; and Kitchen Sink's rail lists the coordinators the roster names, with no list kept by hand.
**Input:** One `serve()` host on a bound port with Kitchen Sink's workforce tree, on FIX-2426's crossing double (`goals/lib/crossing-bus.mts`), alice and bob behind bearer tokens. Each app's own view, on its own credential so its reads are counted at its fetcher: Kitchen Sink's `TeamPanel` (react-dom over a happy-dom document, read off the rows it draws), Shift Manager's `useRoster` under its real `LabProvider` (read off what the hook hands back) and the Teammates adapter's `watchWorkers`. Alice's other tab makes each change through the workforce client, through the workers collection's `runBy` writer; a second valid input, a hire by `runAction` with no stream, must pass too. Leg c runs the views on `serve({ push: false })`; leg d builds the tree with a second coordinator `WORKER.md` beside `support.help`.
**Signal:**
- `a:within-1s` — each of alice's three views shows a hire, a fork, an edited description, a fire and a no-stream hire less than 1000 ms after the change's request completes. This covers the Workers panel, not the rail: the rail reads the roster at each listing, and when the listing re-runs is FIX-2411's.
- `a:quiet` — over a 10 s idle window, each view makes 0 roster reads.
- `b:other-user` — bob's three views make 0 roster reads during alice's changes and never show her workers.
- `c:no-push` — on a host with no push, each view shows a hire within the fallback pace (3 s) + 1 s.
- `d:rail` — on the tree with two coordinators, `railSessions` lists exactly `support.desk` and `support.help`.

**Anti-game:** Every assertion reads what an app's own code renders or hands back, or the roster reads counted at that view's fetcher (a call of the roster flow's `roster` view, which each app's watch follows since FIX-2623), never `publish` calls, frames sent, or a `watchRoster` called outside the apps. Real sockets on a bound port. Each graded list is floored with `tell.over`.
**Model:** n/a (the roster flow's actions write; no turn runs a model)
**Run:** `cd goals && pnpm tsx realtime/roster-follows-hires/run.mts`
**Controls:**
- `GOAL_CONTROL=read-once` — the watch reads at start and ignores notices and the timer. Must FAIL `a:within-1s` and `c:no-push`.
- `GOAL_CONTROL=hand-list` — the rail lists `support.help` by hand, as `SHELL_COORDINATORS` did. Must FAIL `d:rail`.
- `GOAL_CONTROL=timer` — the watch keeps a timer of its own beside its subscription. Must FAIL `a:quiet` and `b:other-user`'s reads.

Not shown failing: `b:other-user`'s "never shows alice's workers" half. The server scopes the roster read to its caller; no app-side patch can make bob's view read alice's roster.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | claude/project-thread-uxpn8e (pre-push) | n/a | PASS | a: 3 views × 5 changes, slowest 24 ms after completion; 0 roster reads over 10 s idle in 3 views · b: bob's 3 views read 0 times, never showed alice's workers · c: no push, hire shown in 1529/1530/1514 ms · d: rail listed support.desk and support.help |
| 2026-11-04 | claude/project-thread-uxpn8e (pre-push) | n/a | FAIL (expected) | `read-once`: `a:within-1s` (all 15 never shown within 3 s) and `c:no-push` (3 views never); a:quiet, b, d held |
| 2026-11-04 | claude/project-thread-uxpn8e (pre-push) | n/a | FAIL (expected) | `hand-list`: `d:rail` (listed ["support.help"]); nothing else failed |
| 2026-11-04 | claude/project-thread-uxpn8e (pre-push) | n/a | FAIL (expected) | `timer`: `a:quiet` (4 reads per view over 10 s idle) and `b:other-user` (4 reads per bob view); a:within-1s, c, d held |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | PASS (a–c) | The watch is `client.live` now; the controls patch its call. a: 3 views × 5 changes, slowest 26 ms; 0 reads over 10 s idle · b: bob's views read 0 times · c: no push, 1501/1504/1493 ms. d not run: `twoCoordinatorTree` fails at `hireWorkforce` (support.fsd names tools no catalog registers), in setup, before the rail reads |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `read-once`: `a:within-1s` (every change never shown in 3 views) and `c:no-push` (3 views never) |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `timer`: `a:quiet` (4 reads per view over 10 s idle) and `b:other-user` (4 per bob view) |
| 2026-11-13 | 9404a8752 | n/a | PASS | Setup has no roster session (FIX-2624): the tab writes through the workforce client (`runBy`), the turn's hire runs in her write session, a roster read is a roster view call (FIX-2623), and d's tree registers Kitchen Sink's worker blocks. a: 3 views × 5 changes, slowest 31 ms; 0 reads over 10 s idle · b: bob's views read 0 times · c: no push, 1511/1522/1501 ms · d: the rail listed support.desk and support.help |
| 2026-11-13 | 9404a8752 | n/a | FAIL (expected) | `read-once`: `a:within-1s` (all 15 never shown within 3 s) and `c:no-push` (3 views never) |
| 2026-11-13 | 9404a8752 | n/a | FAIL (expected) | `timer`: `a:quiet` (4 reads per view over 10 s idle) and `b:other-user` (4 per bob view) |
| 2026-11-13 | 9404a8752 | n/a | FAIL (expected) | `hand-list`: `d:rail` (listed ["support.help"]) |
