# continue-interrupted-run › after a restart

**Issue:** FIX-2377
**Outcome:** A turn that was running when its server was killed shows up, after the server starts again, as that conversation's lost turn. **Continue** carries the same request on to its answer. **Discard** ends it for good: it stops being listed as interrupted, and another restart does not bring it back.
**Input:** two sessions, each sending `respond` with its own message (`keep me`, `drop me`), on a durable host over HTTP with an on-disk SQLite store (`host.mts`). The host's turn holds until stopped while `GOAL_HOLD=1`, so both turns are in flight at the kill; started again without it, the turn answers at once.
**Signal:** through the shipped client only (`createClient`, `requests.interrupted()`, `interruptedBySession`): (a) after a `SIGKILL` and a fresh host on the same store, each lost request is listed under its own session and no other; (b) `continue()` on the first resolves to the **same** request id, which ends `completed` with the answer to `keep me`; (c) `abort()` on the second resolves, the request is `aborted`, and it is gone from `interrupted()`; (d) after a **second** restart nothing is listed, and both requests keep their endings.
**Anti-game:** a hollow pass would check that `abort()` resolved, or that the request's status reads `aborted` once. Both hold for a Discard that only hid the turn for one read, or one a later sweep marks interrupted again. The check reads the interrupted list through a separate restart, and grades Continue on the request id and its output, so a `retry()` (a new id) or a restart of the turn from scratch with no answer fails it.
**Control:** `GOAL_CONTROL=old-abort` patches the engine's stop of an interrupted request back to reporting it finished (today's behaviour) as each host loads it. Legs (c) and (d) must fail: the abort answers 409 and the turn stays listed.
**Model:** n/a. The turn is a handler; the path under test is the engine's sweep, continue and stop over a real process kill.
**Run:** `pnpm tsx goals/continue-interrupted-run/after-a-restart/run.mts`

> The host sets a 1.5 s stale threshold and a 250 ms heartbeat so the killed turns are swept in seconds. With the defaults (60 s threshold) the same turns show up about a minute after the restart.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | (this branch) | n/a | PASS | Host killed with two turns in flight; fresh host listed each under its session; Continue finished the same id with "answered: keep me"; Discard ended the other `aborted` and it left the list; after a second restart nothing listed. |
| 2026-10-31 | (this branch) | n/a | FAIL (control `old-abort`) | Discard refused (409); the turn stayed `interrupted` and was listed again after the second restart. |
