# shift-manager › its summary changes on its own

**Issue:** FIX-2409 (epic FIX-2369); re-pointed at the inbox view by FIX-2774 (epic FIX-2683), whose spec's goal is `specs/issues/FIX-2774/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** While Shift Manager is open, what it says needs you changes on its own within a second of a change another session makes, with no read between changes, none per streamed item and none for a turn in a session that holds no ask and no board; where push can miss a change it catches up within 30 seconds; and a read that fails says why, and Retry reads again. What needs you is the roster flow's inbox view (FIX-2774), not the snapshot.

**Input:** One `serve()` host on a bound port over a SQLite file (a run that asks a person needs durable execution), on the default bus (no bus given: the router fills the in-memory bus a Lab on one process runs on). The Workforce session board on two flows: `desk`, the conversation that files (a code turn: it files the tasks a line names, or streams a reply of `count` items over `ms`), and `doer`, whose task turn calls `ctx.suspendForUser({ kind: "review" })` on a task marked `[ask]`. The org's worker inventory is opened as a Lab's boot opens it. Shift Manager's `LabProvider` runs headless in the process (react-dom over a happy-dom document; Node's own `fetch` and `WebSocket`), with its Inbox screen drawn under it and a probe that records each value the inbox view pushes (`useInbox`) and, after each, reads the roster flow's `routines` view and runs Usage's read (`readHarnessUsageView`, a Re-check and a view), as those screens do. None of them names a session (FIX-2624). Leg d runs two hosts over one SQLite file, standing for two processes, each on its own bus that doesn't cross (FIX-2426's crossing double, `goals/lib/crossing-bus.mts`, set to `false`): the provider is on the first, and the task is filed, and its run asks, on the second, so no notice reaches the provider's socket. Every id carries the run's stamp.

**Signal:**
- `a:ask-within-1s` — another client opens a conversation and files an `[ask]` task: the Inbox count the view pushed goes 0 → 1 less than 1000 ms after the delegate's request reads `suspended` in the store (polled every 5 ms).
- `a2:ask-within-1s` — a different valid input: the task filed on an existing conversation by a run on the server that no client sent (engine `runAction`, `source: "system"`), as a scheduled fire files on the board it names. Same bound.
- `b:idle-0-reads` — over a 10 s idle window, with the Routines view and Usage's Re-check and view run after each value, the provider makes 0 inbox view runs.
- `c:quiet` — a 200-item reply in a worker conversation that holds no task and no ask, and a turn started and finished in a worker session that holds neither, each add 0 inbox view runs (FIX-2770's `c:quiet`, over this view's whole hearing).
- `d:ask-within-poll` — with the ask made on the other process, the Inbox count shows it within 30 s + 1 s of the run reading `suspended`.
- `retry:shows-reason`, `retry:lists-ask` — a second provider whose first inbox view read the server refuses (503, a reason of its own): its Inbox shows that reason; its Retry runs the view again, and the Inbox lists the ask.

**Anti-game:** View runs are counted at the provider's own fetcher: one `POST …/views/inbox` is one run (the global `fetch` the provider's client calls, wrapped; the goal's own clients call Node's `fetch` directly). Every grade is the value the view pushed to the provider, the page it drew, or the runs it made, never a `publish` call, a frame or a hook's return. Real sockets on a bound port. Each graded list is floored with `tell.over`.

**Model:** n/a (code turns ask).

**Run:** `pnpm tsx --tsconfig goals/tsconfig.json goals/shift-manager/its-summary-changes-on-its-own/run.mts`. The `--tsconfig` gives Shift Manager's `@/…` imports their mapping. `GOAL_LEGS=a,a2,b,c,d,retry` runs some legs; d waits up to 33 s.

**Controls:** each runs its leg with a scratch patch applied as the process loads (`goals/lib/module-patch.mts`), printed by the run and refused when it never reached the code.
- `GOAL_CONTROL=no-subscribe` — a view's watch subscribes to none of the topics its answer names (`packages/client/src/view/view.ts`): the Inbox reads only on mount and the person's own reads. Must FAIL `a:ask-within-1s`.
- `GOAL_CONTROL=hear-run` — the view lists the caller's sessions (`sessions.list`), which hears every turn's `run` on the user topic. Must FAIL `c:quiet`.
- `GOAL_CONTROL=no-poll` — the view keeps no fallback timer. Must FAIL `d:ask-within-poll`.

FIX-2409's `every-kind` control patched the snapshot's notice filter, which no screen this goal grades reads any more; it went with the re-point.

`b:idle-0-reads` has no control that fails since FIX-2624. Its control, `own-sessions`, made the provider hear the reading sessions Routines and Usage ran an action on after every read, so each read started the next. Those sessions are gone: the screens read views and the Re-check names no session. A view writes nothing, and a Re-check writes at most once a minute per person and harness, under a path the snapshot doesn't hear, so even a provider that heard every path would read once a minute at most, never enough to fail a 10 s window. Nothing the probe runs can start a read any more, so there is no patch that would make the leg fail and still be a real defect. The leg stays as the check that the screens' reads stay quiet.

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
| 2026-11-13 | claude/fix-2627-impl-e-b2 (the workforce kit) | n/a | PASS | The host installs the workforce kit over a folder holding `lead` and `eng.doer`. *"a: Inbox 0 → 1 65 ms after the run read suspended … a2: Inbox 1 → 2 85 ms … b: 0 snapshot reads over 10 s idle … c: 4 snapshot reads during a 200-item reply, 4 during a 2-item one · d (no crossing bus): Inbox 0 → 1 28349 ms"* |
| 2026-11-13 | claude/fix-2627-impl-e-b2 (the workforce kit) | n/a | FAIL (expected) | `no-subscribe`: *"a:ask-within-1s: the provider's Inbox count never went 0 → 1 within 3000 ms of the run reading suspended"* |
| 2026-11-13 | claude/fix-2627-impl-e-b2 (the workforce kit) | n/a | FAIL (expected) | `every-kind`: *"c:as-short: 163 snapshot reads during a 200-item reply, 5 during a 2-item reply of the same length (allowed 1 more)"* |
| 2026-11-13 | claude/fix-2627-impl-e-b2 (the workforce kit) | n/a | FAIL (expected) | `no-poll`: *"d:ask-within-poll: the provider's Inbox count never went 0 → 1 within 33000 ms of the run reading suspended"* |
| 2026-11-18 | fix/FIX-2774-inbox-boards-view (pre-push) | n/a | PASS | Re-pointed at the inbox view. *"a: Inbox 0 → 1 61 ms after the run read suspended … a2: Inbox 1 → 2 81 ms … filed by a server run · b: 0 inbox view runs over 10 s idle … c: 0 inbox view runs during a 200-item reply and during a worker session's turn, neither holding a task or an ask · retry: the Inbox showed the server's reason for the refused read · retry: Retry ran the view again, and the Inbox lists 2 item(s)"* · d: *"Inbox 0 → 1 28393 ms after the run read suspended"* |
| 2026-11-18 | same | n/a | FAIL (expected) | `no-subscribe`: *"a:ask-within-1s: the provider's Inbox count never went 0 → 1 within 3000 ms of the run reading suspended"* |
| 2026-11-18 | same | n/a | FAIL (expected) | `hear-run`: *"c:quiet: 4 inbox view runs during a 200-item reply in a conversation with no task and no ask, 2 during a turn in a worker session with neither"* |
| 2026-11-18 | same | n/a | FAIL (expected) | `no-poll`: *"d:ask-within-poll: the provider's Inbox count never went 0 → 1 within 33000 ms of the run reading suspended"* |
