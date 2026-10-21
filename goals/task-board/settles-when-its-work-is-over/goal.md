# task-board › a task settles when its work is over

**Issue:** FIX-2077 (epic FIX-2056). Its spec's goal: `specs/issues/FIX-2077/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a dispatched task is settled once, by the claim gate, only when its work is over: its request and all that request's background work have ended, no filed work is still holding it, and nothing is queued for it. A task that waits is never run twice.

**Input:** a real `createFlowState` host on a durable SQLite store, with the Workforce session board on two flows. `desk` is the person's conversation that files tasks for `eng.doer`. `doer` is the flow of `eng.doer`, whose task sessions do the work and file pieces for `eng.helper`, and of `eng.helper`. Both workers are deterministic scripts driven by marks in the task, over the host's HTTP router as a verified caller: `[background]` (the request's own side chain, and the one the flow's `onFinished` starts, write after it returns), `[split:N:MS]` (N pieces, each taking MS), `[after:MS]`, `[message]` and `[message-checkpoint]` (a peer's message reaches the task session mid-task; on the second, its turn reports a checkpoint), `[stop:REASON]` (`ctx.suspend`). A piece's notice wakes the doer's turn (the `judgment` policy). Delays, piece counts and the stop's reason are inputs; others must pass too.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a` (background work): `a:after-the-side-chains` the task completed after the last write of its request's side chain and of the one `onFinished` started. `a:once` one ending, heard once, with the work's answer.
- `b` (pieces): `b:waiting-while-open` while a piece is open the task is `in_progress`, `waitingOn: "filed"`, with no lease. `b:last-turns-answer` completed once with the answer of the last turn a piece's ending woke (its worker never checkpoints). `b:once` heard once, no running row left. Variant, the last piece ending during the task's own request: `b:piece-ends-during-request` it did, and `b:settles-after-woken-turn` that request's check left it running, and it completed with the woken turn's answer, not its own.
- `c` (a message queued mid-task): for each of `[message]` and `[message-checkpoint]`, `c:message-ends-first` the message's request ended before the task settled; `c:output` the output is the work's answer, or the checkpoint the message's request reported, never the message's answer; `c:once` heard once.
- `d` (a wait and a person's stop): `d:keeps-its-claim` a `human_input` stop and an `external_event` stop are each `in_progress`, waiting on `"person"` and `"wait"`, with no lease; `d:not-run-twice` past the lease the claim committed to (two minutes) and a pass of the board, each is still running on attempt 1 and its work never ran again; `d:resumes` and `d:done-after-resume` each resumed and completed on attempt 1 with the resumed answer.

**Anti-game:** no grade reads a call the gate made or a stub. It reads the stored rows (status, `waitingOn`, lease, attempts, output, timestamps), the requests the engine stored, the notices the desk acted on, and the proofs each worker wrote from inside its own run. A task's request arrived on the `task` source, which no public route re-enters, so leg d resolves the stop and continues the request through the engine, as a host's own answer surface does; the claim and the attempt it grades are the stored row's.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/task-board/settles-when-its-work-is-over/run.mts`. `GOAL_LEGS=a,b,c,d` runs some legs; leg d waits out a two-minute lease. On demand only, never a CI gate.

**Controls:** a scratch patch to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=settle-at-return`: the check runs where the task's entry returns, today's settle point, instead of after the request's last drain (`packages/orchestration/src/task-board/task-request.ts`, the request-end hook never registered). Runs legs a and c. Must fail **`a:after-the-side-chains`** and **`c:message-ends-first`**.

Before FIX-2077 the check fails legs b and d on `main`: a split task parks and settles as `{ answer, pieces }`, and a stopped task's lease lapses and it runs again.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
