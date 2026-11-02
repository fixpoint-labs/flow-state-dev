# harness-manager › a run is done only when its checks pass

**Issue:** FIX-2387 (epic FIX-2369, ER-2). Its spec's goal: `specs/issues/FIX-2387/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a host that wraps its phase in `commandCheck` gets *done* only when the phase's own check and then the project's commands pass. A red command makes the attempt not done; the next attempt's brief names the command and carries the end of its output. Every result is on the run record, and a done run's review shows "Checks n/m passed" with the results in its `data`. A run stopped at its limit runs nothing. A command past the wall clock is stopped and recorded as timed out. In a session, `verify` records the checks on the turn and the turn stands.

**Input:** harness-manager on a real engine, a real task board with fenced settlement, a real git checkout cut from a scratch repository, and real commands. Only the harness is a stub, scripted per leg to commit a change the check rejects, the fix, or a run stopped at its limit. The check is the scratch repository's own `node check.mjs`: it exits 3 printing the fixture's marker until `state.txt` holds the fixture's good state. `fixtures/input.json`, held out: the marker, the good state and the session check's marker. Any of them pass the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`. The task is read through the board's `getTask`; the run record through the user-scoped `runs/*` collection the manager writes; the review through the stop's suspension `data`.

- `a`: `a:not-done` attempt 1 goes back to the board, not done; `a:recorded` the run record's `checks` holds `node check.mjs`, exit 3, and a tail with the marker.
- `b`: `b:brief-has-tail` attempt 2's brief names the command and carries the marker; `b:review-checks` run 2's fix waits on review with `data.checks` 1 of 1 passed and the prompt line "Checks 1/1 passed.".
- `c`: `c:no-command` a run stopped at its limit runs no command.
- `d`: `d:timed-out` a hanging command is stopped near the 1.5 s clock, recorded as timed out, the next one skipped; `d:not-done`.
- `e`: `e:turn-checks` `harnessSessionFlow` with `verify`: a red check, with its marker, is on the turn's record; `e:turn-stands` the turn is not failed.

**Anti-game:** the commands are real processes in the run's real checkout; the check script is the scratch repository's, not the goal's. The brief is what the stub harness was handed, recorded by the slot. The run record is read from the store, never from the verdict object. Traces are off.

**Model:** n/a (model-free: a stub harness).

**Run:** `pnpm tsx goals/harness-manager/checks-gate-done/run.mts`. `GOAL_LEGS=a,b,c,d,e` runs some legs.

**Controls:** scratch patches applied as the code loads, printed by the run, and refused when they never reached the code.

- `GOAL_CONTROL=no-checks`: `commandCheck` hands the phase back unchanged (`packages/harness-manager/src/command-check.ts`). Must fail **`a:not-done`**.
- `GOAL_CONTROL=drop-reason`: the manager ignores the verdict's reason (`packages/harness-manager/src/manager.ts`). Must fail **`b:brief-has-tail`**.

Before this change there is no `commandCheck` and `isDone` answers only a boolean, so leg a fails as under `no-checks`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | claude/project-thread-2ksmgs (working tree) | n/a | PASS | All legs. a: attempt 1 not done; run record `node check.mjs` exit 3, tail has the marker. b: attempt 2's brief named the command and carried the marker; review `data.checks` 1/1 passed. c: a run stopped at its limit ran no command. d: `node hang.mjs` stopped at 1.5 s and recorded timed out, the next skipped; not done. e: a red verify check is on the turn's record, and the turn stands |
| 2026-10-31 | claude/project-thread-2ksmgs (working tree) | n/a | FAIL (each control, as required) | `no-checks`: `a:not-done` (settled with no checks, record null). `drop-reason`: `b:brief-has-tail` (brief had only the generic not-done line) |
