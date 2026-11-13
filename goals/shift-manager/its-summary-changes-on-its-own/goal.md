# shift-manager › its summary changes on its own

**Issue:** FIX-2409 (epic FIX-2369). Its spec's goal: `specs/issues/FIX-2409/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** While Shift Manager is open, what it says needs you changes on its own within a second of a change another session makes, with no read between changes and none per streamed item; where push can miss a change it catches up within 30 seconds.

**Input:** One `serve()` host on a bound port over a SQLite file (a run that asks a person needs durable execution), on the default bus (no bus given: the router fills the in-memory bus a Lab on one process runs on). The Workforce session board on two flows: `desk`, the conversation that files (a code turn: it files the tasks a line names, or streams a reply of `count` items over `ms`), and `doer`, whose task turn calls `ctx.suspendForUser({ kind: "review" })` on a task marked `[ask]`. The org's worker inventory is opened as a Lab's boot opens it. A third flow, `usage-probe`, carries the action Routines (`listRoutines`) runs on Shift Manager's own reading session. Shift Manager's `LabProvider` runs headless in the process (react-dom over a happy-dom document; Node's own `fetch` and `WebSocket`), with a probe under it that records each snapshot and, after each snapshot read, runs Shift Manager's `runAction(listRoutines)` on that flow and its usage read (`readHarnessUsageView`, a Re-check and a view, no session of its own), as those screens do. Leg d runs two hosts over one SQLite file, standing for two processes, each on its own bus that doesn't cross (FIX-2426's crossing double, `goals/lib/crossing-bus.mts`, set to `false`): the provider is on the first, and the task is filed, and its run asks, on the second, so no notice reaches the provider's socket. Every id carries the run's stamp.

**Signal:**
- `a:ask-within-1s` — another client opens a conversation the snapshot didn't list and files an `[ask]` task: the provider's Inbox count goes 0 → 1 less than 1000 ms after the delegate's request reads `suspended` in the store (polled every 5 ms).
- `a2:ask-within-1s` — a different valid input: the task filed on a listed conversation by a run on the server that no client sent (engine `runAction`, `source: "system"`), as a scheduled fire files on the board it names. Same bound.
- `b:idle-0-reads` — over a 10 s idle window, with the probe's actions run on Shift Manager's own reading and usage session after each snapshot read, the provider makes 0 snapshot reads.
- `c:as-short` — during a 200-item reply in a listed conversation, the provider makes no more than one snapshot read more than during a 2-item reply that lasts as long (3 s). A request's own notices (created, started, ended) coalesce into one read or two by how far apart they land; a read per item would be about 200.
- `d:ask-within-poll` — with the ask made on the other process, the provider's Inbox count shows it within 30 s + 1 s of the run reading `suspended`.

**Anti-game:** Reads are counted at the provider's own fetcher: one `GET /api/flows/sessions?include=dispatch-runs` is one snapshot read (the global `fetch` the provider's client calls, wrapped; the goal's own clients call Node's `fetch` directly). Every grade is the snapshot the provider holds or the reads it made, never a `publish` call or a frame. Real sockets on a bound port. The task screen, TasksPanel and the feed's board card are not mounted, so no view nudges the snapshot. Each graded list is floored with `tell.over`.

**Model:** n/a (code turns ask).

**Run:** `pnpm tsx --tsconfig goals/tsconfig.json goals/shift-manager/its-summary-changes-on-its-own/run.mts`. The `--tsconfig` gives Shift Manager's `@/…` imports their mapping. `GOAL_LEGS=a,a2,b,c,d` runs some legs; d waits up to 33 s.

**Controls:** each runs its leg with a scratch patch applied as the process loads (`goals/lib/module-patch.mts`), printed by the run and refused when it never reached the code.
- `GOAL_CONTROL=no-subscribe` — the provider opens no subscription (`enabled: false`), which is today's `main`: the snapshot reads only on boot and the person's own reads. Must FAIL `a:ask-within-1s`.
- `GOAL_CONTROL=every-kind` — the provider reads on every notice of a session's topic, `items` included. Must FAIL `c:as-short`.
- `GOAL_CONTROL=no-poll` — the subscription keeps no fallback timer. Must FAIL `d:ask-within-poll`. (Not one the spec names; it shows d's bound can fail.)
- `GOAL_CONTROL=own-sessions` — the provider hears Shift Manager's own reading and usage sessions. Must FAIL `b:idle-0-reads`: each read's Schedules and Usage actions start the next.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | claude/project-thread-uxpn8e-2409 (pre-push) | n/a | PASS | a: Inbox 0 → 1 27 ms after the run read `suspended`, on a conversation not listed at start · a2: 1 → 2 95 ms, filed by a server run · b: 0 snapshot reads over 10 s idle, Schedules' and Usage's actions run after each of 11 reads · c: 3 reads during a 200-item reply, 4 during a 2-item one · d: 0 → 1 28 389 ms with the ask made on the other process. Two earlier runs PASS (a 111/113 ms, d on one host, before d moved to two hosts) |
| 2026-11-04 | same | n/a | FAIL (expected) | `no-subscribe`: `a:ask-within-1s`, the count never moved within 3 s |
| 2026-11-04 | same | n/a | FAIL (expected) | `every-kind`: `c:as-short`, 65 reads for 200 items against 5 for 2 |
| 2026-11-04 | same | n/a | FAIL (expected) | `own-sessions`: `b:idle-0-reads`, 40 reads over 10 s idle |
| 2026-11-04 | same | n/a | FAIL (expected) | `no-poll`: `d:ask-within-poll`, the count never moved within 33 s |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | PASS | The snapshot is `client.live` now, its filter in `hear`/`paths`. a: 123 ms · a2: 81 ms · b: 0 reads over 10 s idle · c: 4 reads for 200 items, 4 for 2 · d: 28442 ms |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `no-subscribe` (patch moved to the live read's effect): `a:ask-within-1s` |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `no-poll` (`pollIntervalMs: null`): `d:ask-within-poll` |
