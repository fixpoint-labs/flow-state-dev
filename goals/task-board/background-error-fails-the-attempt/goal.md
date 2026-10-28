# task-board › a task's background error fails its attempt

**Issue:** FIX-2088 (epic FIX-2056). Its spec's goal: `specs/issues/FIX-2088/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** when background work errors in any request working a task, that task's attempt fails exactly as if the request had thrown: it retries while attempts are left, otherwise it fails, and its filer never hears "done" for it. A conversation turn, a message queued to the task's session (conversation after the task, not part of it), a cancel and a conversation-result task's failed capture are left as they are.

**Input:** a real `createFlowState` host on a durable SQLite store, with the Workforce session board on three flows. `desk` is the person's conversation that files tasks. `doer` is the flow of `eng.doer`, whose task sessions do the work and file pieces for `eng.helper`. `eng.memo` runs on the built-in `agent` flow, its answer scripted and its `afterAnswer` a capture that fails its first run in each task session. The doer is a deterministic script driven by marks in the task: `[bg:first]` / `[bg:always]` (the step after the answer throws on attempt 1, or always), `[each:first]` (a `.forEachSideChain` step), `[finish:always]` / `[completed:always]` (a step the flow's `onFinished`, or the entry's `onCompleted`, starts), `[checkpoint]`, `[hold:MS]`, `[cancel-steps]` (one step that stops on the cancel, one that throws 2.5 s later anyway), `[stop:R]` / `[stop-first:R]` with `[drop]` (the resumed turn drops the resume's caller), `[message-first]` (a peer's message on attempt 1, whose request's step throws), `[split:N:MS][woken-bg]` (the turn a piece's ending wakes has a step that throws), and `[before:always]` / `[before:first-run]` (a step before the turn, drained by a default `.waitForSideChain()`, failing always or on its first run only). Delays and step names are inputs; others must pass too.

**Signal:** each failure is tagged `<leg>:<assertion>`. "As a" means `done-on-attempt-2` (completed on attempt 2 with that attempt's answer), `no-attempt-1-result` (attempt 1's answer nowhere on the row) and `heard-once`. "As b" means `failed-after-1-attempt`, `names-the-step` (its error names the step) and `heard-once` (one failure notice).

- `a`: as a, for the step after the answer and for a `.forEachSideChain` step. With checkpoints on both attempts: completed on attempt 2 with that attempt's checkpoint, and `a:checkpoint-carries-over` (attempt 1's checkpoint on the row when attempt 2 began).
- `b`: one attempt, the step always throws: as b.
- `c`: one attempt each, a step `onFinished` starts and a step `onCompleted` starts: as b.
- `d`: the same flow as a plain request: `d:completed` (the request completed, its step threw) and `d:no-task-row`.
- `e`: a cancel (the task cancelled from the desk and its request stopped, as the abort route does): `e:cancelled` (cancelled on attempt 1, no error, never run again), `e:both-steps` (one step stopped on the cancel, one threw after it), `e:request-stopped`.
- `f`: the resume's caller drops, then the step throws: `f:dropped`, and as a.
- `g`: a queued message's request, its step throws: `g:message-ran` (a message turn ran in the task's session and its step threw), `g:outside-the-task` (every message turn ran after the task completed, holding no claim), `g:done-on-attempt-1` (completed on attempt 1 with that attempt's answer, no error, no feedback), `g:heard-once`.
- `h`: one attempt, the turn a piece's ending wakes has a step that always throws: as b.
- `i`: one attempt each, the step fails, the request stops (`external_event`), the resume reruns the step. `i:stopped`, `i:reran`. The rerun that throws: as b. The rerun that succeeds: `i:clean-rerun-done` (completed on attempt 1, no error, no feedback).
- `j`: one attempt, a default `.waitForSideChain()` drains the failure: `j:went-on` (the turn past the wait ran), and as b.
- `k`: `k:capture-failed` (once in each task). Filed `resultTo: "conversation"`: `k:conversation-done-on-attempt-1` (completed on attempt 1 with its answer, no error, no feedback). Filed to the filer: `k:done-on-attempt-2`. `k:heard-once` for each.

**Anti-game:** no grade reads the seam's input, a log line or a stubbed gate. It reads the stored rows (status, attempts, output, error, feedback), the requests the engine stored, the notices the desk acted on, and the proofs each worker and step wrote from inside its own run. The capture's log is printed as evidence only.

**Model:** n/a (model-free; `eng.memo`'s answer is a scripted mock generator).

**Run:** `pnpm tsx goals/task-board/background-error-fails-the-attempt/run.mts`. `GOAL_LEGS=a,b,...,k` runs some legs. On demand only, never a CI gate.

**Controls:** a scratch patch to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=drop-background-failures`: the claim gate is told of no background failures (`packages/orchestration/src/task-board/task-request.ts`). Runs every leg but e. Must fail **`a:done-on-attempt-2`**, **`f:done-on-attempt-2`**, **`b:failed-after-1-attempt`**, **`c:failed-after-1-attempt`**, **`h:failed-after-1-attempt`**, **`j:failed-after-1-attempt`**, **`i:failed-after-1-attempt`** (the throwing rerun) and **`k:done-on-attempt-2`** (the filer half). Leg d, leg g, `i:clean-rerun-done` and `k:conversation-done-on-attempt-1` must still pass, which shows the control is narrow.
- `GOAL_CONTROL=no-conversation-carve-out`: Workforce's after-answer step fails a conversation-result task's attempt too (`packages/workforce/src/agent-worker-flow.ts`). Runs leg k. Must fail **`k:conversation-done-on-attempt-1`**.

Before FIX-2088, `main` fails legs a and b: the step's failure is only logged, and the task completes on attempt 1 with attempt 1's answer.

**What leg e does not isolate:** the task is cancelled before its request is stopped, so the gate finds a cancelled row and writes nothing, whatever the engine hands it. The engine's own rule (a request whose cancel fired hands on no failures) is covered by `packages/engine/test/request-end-background-failures.test.ts`.

**Where a conversation-result answer lands** in the conversation is FIX-2083's. Leg k grades it on the row.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-22 | fix/FIX-2088 3221d0543 | n/a | PASS | a: plain, `.forEachSideChain` and checkpointed tasks each completed on attempt 2 with that attempt's answer or checkpoint; attempt 1's checkpoint was on the row when attempt 2 began. b, c (onFinished's and onCompleted's steps), h, j and i's throwing rerun: errored after 1 attempt, the error naming the step, one notice. d: completed, no row. e: cancelled on attempt 1, one step stopped on the cancel and one threw after it, the request aborted. f: the resume's caller dropped, done on attempt 2. g: the message's step failed attempt 1, done on attempt 2. i's clean rerun: completed on attempt 1, no error. k: conversation result completed on attempt 1 with its answer and no failure (the capture's failure logged once); filer result completed on attempt 2 |
| 2026-10-22 | fix/FIX-2088 3221d0543 | n/a | FAIL (control `drop-background-failures`, expected) | `a:done-on-attempt-2` (all three), `f:done-on-attempt-2`, `g:done-on-attempt-2`, `b`/`c`/`h`/`j`/`i:failed-after-1-attempt` (i's throwing rerun), `k:done-on-attempt-2`, with their `names-the-step` and `no-attempt-1-result`. Not failed: leg d, `i:clean-rerun-done`, `k:conversation-done-on-attempt-1` |
| 2026-10-22 | fix/FIX-2088 3221d0543 | n/a | FAIL (control `no-conversation-carve-out`, expected) | `k:conversation-done-on-attempt-1` only: the conversation-result task errored on attempt 1 over the capture |
| 2026-10-22 | `main` b43150fea (its packages, this goal copied in), `GOAL_LEGS=a,b` | n/a | FAIL (expected) | `a:done-on-attempt-2` and `a:no-attempt-1-result` (each task completed on attempt 1 with attempt 1's answer), `a:checkpoint-carries-over`, `b:failed-after-1-attempt`, `b:names-the-step` (completed on attempt 1, no error) |
| 2026-10-22 | fix/FIX-2088 c1e55648a (review round: timed-out waits, the durable-only late cancel, the purge) | n/a | PASS; control `drop-background-failures` FAIL and control `no-conversation-carve-out` FAIL, each on exactly the assertions above | As on 3221d0543 |
| 2026-10-22 | fix/FIX-2088 e4e50be3d (review round 3: a timed-out strict wait keeps its late failure) | n/a | PASS; control `drop-background-failures` FAIL and control `no-conversation-carve-out` FAIL, each on exactly the assertions above | As on 3221d0543 |
| 2026-10-23 | fix/FIX-2103 on e196901d5, leg g inverted, packages at `main` | n/a | FAIL (before-state, expected) | `GOAL_LEGS=g`. `g:outside-the-task` (the message's turn held the claim on attempt 1) and `g:done-on-attempt-1` (completed on attempt 2, its feedback naming the message request's `bg-after-answer`) |
| 2026-10-23 | fix/FIX-2103 on e196901d5, uncommitted | n/a | PASS; control `drop-background-failures` FAIL, as required | Legs a to k. g: the message ran after the task completed on attempt 1, outside it, and its step's failure was its own. The control fails a, b, c, f, h, i's throwing rerun, j and k's filer half; d, g, i's clean rerun and k's conversation half pass |
| 2026-10-28 | fix/FIX-2291 aff9b9c91 | n/a | PASS | Legs a to k. g: the message ran after the task completed on attempt 1, outside it. Its row is now written `unconfirmed`, as a send writes it; written `delivered` (as on `main` 0c9eb57) FIX-2240's take refuses it and `g:message-ran` fails with no turn |
