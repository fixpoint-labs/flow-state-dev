# routines › one list for what runs for you

**Issue:** FIX-2614 (epic FIX-2471). Its spec's goal: `specs/issues/FIX-2614/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** A person sees every standing instruction that fires on its own as them, on a clock or on an event, in one list, and pauses, resumes and deletes any of them through the same verbs a worker uses, over the storage that exists today.

**Input:** `fixtures/routines.json`: two users, a weekly clock routine (filed on `lead`'s board for `eng.tasker`), a worker's clock routine, four threads (a person's, a worker's, a task's PR, a private repo's), a schedule and a subscription written the way `main`'s code wrote them (no maker), two declared routines (a clock and an event with a 15-minute cadence), and the config change a redeploy brings. The latest due time of each fired cron is worked out here from the fixture, not by the code under test. The host is Workforce's subscription test host on the real engine: the board's worker flows, a `follower` worker flow whose actions are the routine tools (called as a model would, with no model), a GitHub service flow, the scheduled-dispatch adapter, and a stub provider whose read access a run can revoke.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **a**: `a:every-writer` A's `listRoutines` holds every routine the roster (a clock and two events), the worker's tools (a clock and an event), a task's subscribe at PR open, and `main`'s rows made; `a:the-seed` and one per declared entry, made by the app; `a:equals-the-store` the list equals A's live and paused rows in both collections, read from the store.
- **e**: `e:b-sees-none` B's list holds none of A's routines.
- **g**: `g:lists` `main`'s schedule and subscription list, with no maker; `g:fires` the schedule's fire runs one task; `g:delivers` the subscription delivers a routed event.
- **h**: `h:keeps-its-task` the task's routine, paused then resumed while the task works, still names its task; `h:ends-with-its-task` when the task fails, the row ends `task_errored`.
- **b**: `b:clock-files-nothing` a paused clock routine's due fire runs no task; `b:event-delivers-nothing` a paused event routine's routed event delivers no message; `b:out-of-the-index` the org's thread index has no entry for it.
- **c**: `c:clock-fires` resumed, the clock routine's fire runs a task; `c:event-delivers` the event routine delivers; `c:read-rechecked` with read access revoked while paused, the resume is refused `not_readable` and the thread index stays empty.
- **d**: `d:not-listed` deleted routines don't list; `d:nothing-fires` their fire runs no task and their event delivers nothing.
- **f**: two restarts over the same store. `f:once` each lists one routine per declared entry; `f:keeps-the-pause` routines A paused stay paused, and the event one stays out of the index; `f:change-reaches-the-row` the changed cron and interest reach the rows.

**Anti-game:** the verbs are called over the roster flow and the follower flow as actions; assertions read stored rows (both collections and the org's thread index, from the store), task runs (dispatches), and the service's messages in the hearing session, never a verb's answer alone. A pause or resume is graded by what then fires, not by the `paused` flag. Every list an assertion grades is floored with `tell.over`, so an empty read is CAN'T TELL. A failed task's retry subscribes again, so leg h grades the resumed row before the task can write it.

**Model:** n/a

**Run:** `pnpm tsx goals/routines/one-list-for-what-runs-for-you/run.mts`

**Controls:** each patches the code under test as it loads (`goals/lib/module-patch.mts`); nothing is written to the checkout.

- `GOAL_CONTROL=schedules-only`: the list reads the schedule collection only. Must FAIL `a:every-writer` (and `a:the-seed`, `a:equals-the-store`, `g:lists`, `f:once`).
- `GOAL_CONTROL=pause-keeps-index`: a pause turns the row off and leaves its index entry (graded before any event, since delivery heals a stale entry). Must FAIL `b:out-of-the-index` (and `c:read-rechecked`, `f:keeps-the-pause`, by the same cause).
- `GOAL_CONTROL=seed-unpauses`: a seed writes declared routines on (the clock row `enabled: true`, the event row as a fresh subscribe). Must FAIL `f:keeps-the-pause`.
- `GOAL_CONTROL=resume-drops-task`: a resume subscribes without the row's task. Must FAIL `h:keeps-its-task`.
- Today's `main` has no `listRoutines` or `saveRoutine`: setup's first save throws, so it fails before leg a.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-09 | `21d31bc2c` | n/a | PASS | a: 10 listed = stored, 8 from the writers + 2 seeded; e: B lists only its own 2 seeds; g: main's schedule fired one task, main's subscription delivered; h: the resumed task routine kept its task and ended `task_errored`; b–d as signalled; f: two restarts, one row per entry, pauses kept, the changed cron and interest reached the rows |
| 2026-11-09 | `21d31bc2c` | n/a | FAIL (expected) | `GOAL_CONTROL=schedules-only`: `a:every-writer` (5 event routines missing), `a:the-seed`, `a:equals-the-store`, `g:lists`, `f:once`, `f:change-reaches-the-row` |
| 2026-11-09 | `21d31bc2c` | n/a | FAIL (expected) | `GOAL_CONTROL=pause-keeps-index`: `b:out-of-the-index`, `c:read-rechecked`, `f:keeps-the-pause` |
| 2026-11-09 | `21d31bc2c` | n/a | FAIL (expected) | `GOAL_CONTROL=seed-unpauses`: `f:keeps-the-pause` (both seeded routines on, the event one back in the index) |
| 2026-11-09 | `21d31bc2c` | n/a | FAIL (expected) | `GOAL_CONTROL=resume-drops-task`: `h:keeps-its-task` (the resumed row names no task) |
| 2026-11-09 | `08e7e49f2` + controls repointed | n/a | PASS | After the review fixes (resume only over a paused row, tenant kept, reseed leaves the old index, shared clock rows): every leg as before |
| 2026-11-09 | `08e7e49f2` + controls repointed | n/a | FAIL (expected) | All four controls fail as listed. `pause-keeps-index` now patches `unsubscribe`'s `dropFromIndex` call, and `resume-drops-task` spreads `{}` for the task, since the code they patched moved |
| 2026-11-09 | committed-transition change + controls repointed | n/a | PASS | Every subscription transition decided on the committed row; delivery heals stale index entries. All legs as before; leg b grades the index before routing |
| 2026-11-09 | committed-transition change + controls repointed | n/a | FAIL (expected) | `schedules-only`: `a:every-writer` …; `pause-keeps-index`: `b:out-of-the-index`, `c:read-rechecked`; `seed-unpauses`: `f:keeps-the-pause`; `resume-drops-task`: `h:keeps-its-task` |
