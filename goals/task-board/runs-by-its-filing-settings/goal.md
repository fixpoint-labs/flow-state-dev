# task-board › a delegated task runs by the settings it was filed with

**Issue:** FIX-2080 (epic FIX-2056). Its spec's goal: `specs/issues/FIX-2080/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a delegated task runs where, when and how often its filer chose at filing. Nothing waits on work that will never finish: no row stays pending for good, no filed task outlives the task that filed it, and no busy session refuses a task.

**Input:** a real `createFlowState` host on a SQLite store, with the Workforce session board on two flows. `desk` is the conversation that files. `doer` is the flow of the delegate whose task sessions do the work and file pieces, and of the helper those pieces go to (a worker files no task for itself: its own steps are a plan's). Both workers are deterministic scripts, driven over the host's HTTP router as a verified caller. Each run picks its task words and ids at run time.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a` (start): a dependent starts after its dependency ends. A held task starts only on release. A dependency on another board, or a dependency that closes a loop, is refused and files nothing. After a retry, attempts and dependencies refuse an edit.
- `b` (session and result): a follow-up filed while its task runs waits, then runs in that task's session. An ongoing task runs in the delegate's session for the conversation. From a task's session, both conversation settings are refused, and so is a wait on a conversation-result task.
- `c` (attempts): a task filed with 3 attempts fails after the third failure, and each retry runs in one session.
- `d` (cascades): a cancel, a retry and a final failure each cancel the open filed task. A failed dependency and a cancelled dependency each cancel a two-deep chain. A second process on the same store is killed between an ending and its cascade; on the next touch, the filed child and the dependent are cancelled.
- `e` (retired rows): a `blocked` row and a recorded-not-started row, stored as before the change, read as `held` and start on release. A stored post row keeps its status, read as a routed task since FIX-2083 turned its entry on. The stored `parked` split and the row parked for a person's turn left this leg with FIX-2131, which retired the status with stores reset.

**Anti-game:** the check grades the stored rows, or the proof each worker wrote from inside its own run (session, request, attempt). It never grades what the board says about itself. The kill leg dies in a real child process at the point where the ending's own pass would pay the cascade, so only the debt on the stored row can make the next touch pay it.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/task-board/runs-by-its-filing-settings/run.mts`. On demand only, never a CI gate.

**Controls:** a scratch patch to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=no-cascade`: no ending records the cascade debt (`packages/orchestration/src/tasks/collection/internal.ts`), and a touch doesn't sweep for dependents an ending missed (`packages/orchestration/src/tasks/collection/cascade.ts`), so neither cascade is paid. Must fail leg `d` on "the open filed task is cancelled" and "the dependent chain is cancelled".

On `main` before FIX-2080 the check fails legs `a`, `b`, `d` and `e`: refused filings are stored, there is no settings edit, a follow-up of a running task is refused, there is no ongoing session, and a retired row reads as stored.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-21 | fix/FIX-2080 on 2f0d88a1a (WIP) | n/a | PASS | a: the dependent started 34 ms after its dependency ended; refusals `dependency_not_on_board`, `dependency_loop`, 0 rows stored. b: the follow-up ran once in its root's session; two ongoing tasks ran in one session; 2 filings refused from a task's session. c: 3 runs. d: pieces cancelled by a cancel, a retry and a final failure; both chains cancelled, labelled `skipped`. Kill: X errored with its debt owed; the touch cancelled Y and the piece |
| 2026-10-21 | fix/FIX-2080 on 2f0d88a1a (WIP) | n/a | FAIL (control `no-cascade`, expected) | Leg d only: each open filed piece stays `in_progress` or `completed`; both dependent chains stay `pending` with no `causedBy`; after the kill, the piece and the dependent stay open |
| 2026-10-21 | origin/main 3dd603586 (orchestration and workforce `src` swapped in) | n/a | FAIL (expected) | a: 3 refused filings stored, no settings edit. b: the follow-up of a running task refused (`follow_up_of_unfinished`), no ongoing session, nothing refused from a task's session. d: no cascade. e: the retired rows read `blocked` and `pending` and never run |
| 2026-10-21 | fix/FIX-2080 on 1602e6233 (main with FIX-2076 merged in; review fixes) | n/a | PASS | Pieces now go to `eng.helper`: FIX-2076 refuses a worker filing a task for itself. a: the dependent started 76 ms after its dependency ended; both refusals; nothing stored. b, c, d and the kill leg as before |
| 2026-10-21 | fix/FIX-2080 on 1602e6233 | n/a | FAIL (control `no-cascade`, expected) | Leg d only, every assertion: the pieces stay open or complete, both chains stay `pending` with no `causedBy`, and after the kill the piece and the dependent stay open. The control now also removes the touch's sweep, which would otherwise cancel the chains |
| 2026-10-22 | fix/FIX-2082 13088b0a5 | n/a | PASS | The waits now use `waitOnTask`. a: the dependent started 35 ms after its dependency ended; both refusals; 0 rows stored. b, d and the kill leg as before |
| 2026-10-26 | `fix/fix-2131` on `f32747683`, uncommitted | n/a | PASS | Leg e without the stored `parked` rows (FIX-2131); every leg green. |
