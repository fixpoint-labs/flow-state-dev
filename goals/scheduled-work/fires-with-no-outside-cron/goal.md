# scheduled-work › it fires with no outside cron

**Issue:** FIX-2752. Its spec's goal: `specs/issues/FIX-2752/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** Every schedule an app declares, static and dynamic, fires once per scheduled time from the app itself: no outside cron on a long-lived host, one cron route on a serverless one, and one process ticks however many serve the app.

**Input:** `app.mts`: a flow `digest` with a static schedule at `* * * * *` and a schedule collection on a schedule index, where a run (`plan`, as `alice` in `acme`) writes one row at `* * * * *`. Both fire a block that writes a row to the goal's own ledger (a SQLite file beside the app's stores): its origin, the scheduled time it fired for, and the process that ran it. The index's `claimDue` also writes a `claims` row naming its process: every tick claims the flow's index once, so these rows say which process ticked, and when. Held-out: the expected times are worked out from the claims (each tick stands at the minute it claimed in) and the kill time, not from the implementation, so another cron or a different start time grades the same way. Four runs, at once:

1. **Two servers.** Two `serve()` processes over one SQLite file, the scheduled endpoint mounted, the second started 5 s after the first. Once one process has ticked twice it is killed (SIGKILL of its process group, 15 s after its tick); the run waits until the other has ticked twice. With `GOAL_PG_URL` set, the same run again over Postgres.
2. **`fsdev run`.** The same app's `wait` action, held open 90 s, through `fsdev run` with the app's config.
3. **Vercel.** One process with `scheduler: vercelScheduler()`, its `route` at `GET /api/cron/schedules` beside the flow API; the run calls it with the secret 3 s past three minutes in a row, twice in the second, and once without the secret.
4. **Job queue.** A web process with `scheduler: false` and a BullMQ queue in `enqueue-only`, and a `process-only` job-queue process that only resolves the runtime, on a Redis the run starts.

**Signal:** each failure is tagged `<signal>:<assertion>`.

- **a** `a:fires-once` (two servers): no scheduled time, static or dynamic, has two rows, and every minute a tick claimed in has exactly one row per origin.
- **b** `b:one-ticker` (two servers): no minute has claims from two processes, and every minute outside the handover has exactly one claim. Minutes are counted from the first claim, so a process's beat sits mid-minute.
- **c** `c:failover` (two servers): the other process's first claim comes within 3 minutes of the kill (5 s allowed for the tick to write its claim); the latest scheduled time at its first tick fires once per origin; the times missed before it fire not at all (D3).
- **d** `d:route` (Vercel): the route answers 200 to each call and 401 without the secret, ticks once per call, and each minute it was called in fires exactly once per origin, the second call in a minute firing nothing more.
- **e** `e:one-path`: none of the removed exports resolves (`formatScheduleId`, `runScheduleTick`, `startScheduleTick`, `scheduleDispatchRequest` from `@flow-state-dev/scheduled` and its `/collection`; `serveScheduleTicks`; `registerStaticSchedules`, `createScheduleDispatchProcessor`, `createBullmqScheduleIndex`; `createGetToPostCronShim`, `createScheduleTickHandler`; the `@flow-state-dev/bullmq/schedules` and `@flow-state-dev/vercel/schedules` entries), checked by importing each.
- `cli:fires-nothing` (`fsdev run`): no claim and no fire in 90 s.
- `queue:worker-ticks` and `queue:fires-once` (job queue): only the job-queue process claims, and every minute it claimed in fires exactly once per origin.

**Anti-game:** real processes and a real clock; the run never calls the tick, and never reads a log line. Fires are counted from the rows the action writes; ticks from the `claims` rows the index writes when the tick claims it, read from the ledger. The kill is a SIGKILL with no shutdown, so the lease is not released and the handover is the crash path. Each signal's list is floored with `tell.over`, so an empty read is CAN'T TELL. Every process starts from the same `host.mts` and `app.mts`; the controls patch the code under test as it loads, never the goal.

**Model:** n/a

**Run:** `pnpm tsx goals/scheduled-work/fires-with-no-outside-cron/run.mts` (about seven minutes; the four runs go at once). Needs `redis-server` on the path. `GOAL_PG_URL=postgres://…` repeats run 1 on Postgres. `GOAL_VERBOSE=1` prints each process's stderr.

**Controls:**

- `GOAL_CONTROL=no-lease` patches the local cron (`packages/engine/src/execution/local-scheduler.ts`) to tick whether or not it holds the lease: every process ticks. It must FAIL `b:one-ticker`. `a` holds under it: the endpoint's once-per-scheduled-time record still stops the second fire, which is the record's job, not the lease's. Both processes tick from the first minute, so the kill hands nothing over and `c`'s missed times read 0 (CAN'T TELL), not red.
- `GOAL_CONTROL=index-only` patches the tick (`packages/engine/src/execution/schedule-tick.ts`) to skip static schedules, as `serve()`'s tick did. It must FAIL `a:fires-once` (the static times fire 0 times). It also fails `c:failover`, `d:route` and `queue:fires-once` by the same cause: each grades static fires too, so no leg has an isolating red state for it.
- `GOAL_CONTROL=cli-ticks` patches `createFlowState` (`packages/engine/src/flowstate/createFlowState.ts`) to start the local cron when the runtime resolves. It must FAIL `cli:fires-nothing`.
- Today's `main` fails `a` (no static schedule fires under `serve()`) and `e` (every removed export resolves).

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-16 | `fix/fix-2752` on 76bb21a7 + slice 2 | n/a | FAIL | Every signal green but one: `queue:fires-once — job queue: dynamic times a tick stood at that did not fire exactly once: 17:22×0, 17:23×0, 17:24×0`. The static schedule fires once a minute from the job-queue process; a dynamic schedule's fire is enqueued with its resolved core, which a queue runner drops (`packages/engine/src/transports/runner.ts`, `resolvedActionCore`), so it never runs. Raised as a blocker on the spec, not fixed here. a, b, c (handover inside 3 min, latest missed time once, earlier dropped), d, e and `cli:fires-nothing` passed |
| 2026-11-16 | same | n/a | FAIL (control `no-lease`, expected) | `b:one-ticker — sqlite: 1 minute(s) claimed by two processes (p1@17:28+p2@17:28)`; `b:one-ticker — … minute 0: 2 claims`. `a` held. `c`'s missed times read 0 (CAN'T TELL), as noted under Controls. The queue line as in the PASS run |
| 2026-11-16 | same | n/a | FAIL (control `index-only`, expected) | `a:fires-once — sqlite: static times … 17:31×0, 17:32×0, 17:34×0, 17:35×0`; co-failing `c:failover` (latest missed static ×0), `d:route` and `queue:fires-once` on static times, as noted |
| 2026-11-16 | same | n/a | FAIL (control `cli-ticks`, expected) | `cli:fires-nothing — fsdev run ticked 1 time(s) and fired 1 schedule(s) in 92 s`. The queue line as in the PASS run |
| 2026-11-16 | same, before `--org`/`--user` on the fsdev leg | n/a | FAIL | Setup: `fsdev run` refused the terminal with no user. Fixed in the run; not a product finding |
| 2026-11-16 | `fix/fix-2752` after the Option A fix (a carried core runs in-process) | n/a | PASS | The red is the first FAIL row above (`queue:fires-once`, dynamic ×0). Now: `PASS — sqlite: p1 ticked 2, killed; p2 ticked 2 from 109 s later; 8 fires over 4 times; fsdev run: 92 s, 0 ticks, 0 fires; vercel route: 4 calls (200, 200, 200, 200), 4 ticks, 6 fires; job queue: 3 ticks by worker, 6 fires run by worker; 16 removed names and entries checked`. The static fire still runs on the queue; the dynamic fire runs in the ticking process |
