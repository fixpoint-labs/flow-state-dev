# task-board › every ending reaches its filer

**Issue:** FIX-2078
**Outcome:** Every ending of a delegated task reaches the session that filed it once, on any flow that files tasks, and nothing a board owes waits for someone to touch it. Each debt is paid within seconds of its due time, after a crash too, by one pass at a time per session. What a user notices: a quiet conversation still hears how its tasks ended, a dependent starts on its own, and a crash in the middle loses nothing.
**Input:** A durable `createFlowState` host on a SQLite store, its router running the durability sweeper at its default interval. Two filers: a plain orchestration flow (no Workforce) and the Workforce session board on two flows. Deterministic workers, and a stand-in Error Reporter intake that records the occurrences it is sent. Run stamps make every goal and id unique per run.
**Signal:** Five legs, each failure tagged `<leg>:<assertion>`.
- **a** A done, a failed and a user-cancelled task are each heard once, on the plain flow and in a Workforce conversation. A waited task resumes its waiter and starts no `onTaskSettled`.
- **b** A second process is killed after a piece's ending is written and before its notice is sent. After a restart, with no touch, the filer hears it and the parent whose last piece ended settles, each within the notice's due time plus 2 s.
- **c** A dependent starts within 5 s of its dependency ending, with no read of the board. No two passes run at once in one session, and two triggers sent at once are both answered.
- **d** A final failure: one failure notice with its error, naming the dependent it cancelled, and none for the dependent. One task occurrence at the intake. No report marker on any row.
- **e** A second process is killed while a worker holds a claim. After a restart, with no touch, within the lease's end plus 2 s the row is reclaimed or settled.
**Anti-game:** No spies on sends and no stubbed sweeper. Requests are read from the engine's request store, rows through the store, and each worker writes its own proof from inside its run. The kills are real process exits, and the restarted host gets no action on any board, so only a wake can pay what is owed.
**Model:** n/a, model-free.
**Run:** `pnpm tsx goals/task-board/every-ending-reaches-its-filer/run.mts`
**Control:** `GOAL_CONTROL=no-sweeper-payment` turns the sweeper's wake step off (a scratch patch to the engine as it loads). It must FAIL leg b on *the filer hears within due time*, and leg e.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-21 | fix/FIX-2078 (pre-PR) | n/a (model-free) | PASS | Five runs in a row. a: Workforce heard 3 endings and the plain flow 3; the waiter got its answer. b: the notice fell due about 1.9 s after the restart; the filer heard it 0.55 s and the parent settled 0.59 s after that. c: the dependent started 62 to 101 ms after its dependency ended; 12 passes, none overlapping; two at once both answered `ok`. d: one errored notice naming the cancelled dependent; 1 occurrence at the intake. e: the row was on attempt 2, reclaimed at its lease's end. |
| 2026-10-21 | fix/FIX-2078 merged with `main` (FIX-2080, FIX-2076 in) | n/a (model-free) | PASS | The boards on FIX-2076's rules: the plain flow's board declares `mode: "delegation"`, and a worker files its pieces for a helper. b: the filer heard 0.55 s and the parent settled 0.60 s after the notice's due time; c: 11 passes, none overlapping. |
| 2026-10-21 | same, `GOAL_CONTROL=no-sweeper-payment` | n/a (model-free) | FAIL (expected) | b: 0 notices after the restart, and the parent still parked. e: 2.5 s past the lease the row is in progress on attempt 1. Recorded as the evidence that b and e are paid by the wake and nothing else. |
| 2026-10-21 | earlier runs on the same branch | n/a (model-free) | FAIL, then fixed | Three runs crashed after the main host's shutdown: a pass a wake started was still writing when the store closed. The host's shutdown now waits for the requests its wakes start (engine test `wake-fires-entry`, which fails without it). |

> Against `main` before this issue the script does not load: it imports `NOTICE_DUE_MS` and the delivery entry this issue adds. The control above is the discriminating run.
