# task-tools › steer an open task, and correct a finished one with a follow-up

**Issue:** FIX-2086 (epic FIX-2056). Its spec's goal: `specs/issues/FIX-2086/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** every word sent into an open task reaches the work through one write, `updateTask`'s `message`, without using an attempt or ending the task; and a finished task's output never changes, because a correction is a follow-up.

**Input:** a real `createFlowState` host with durable execution on a SQLite store, with Workforce's real worker flows: the `coordinator` (`desk`, delegates `writer`, `helper` and `coder`), the built-in `agent` flow (`writer`, delegate `helper`; `helper`), and a goal-local coding worker flow (`coder`) built the way a host builds one: a `harnessManager` over the conversation's board, behind `workerTaskEntry`, with `harnessSessionDoor` as its door and `steerTurnEntry` for a late steer. The agent workers' model is one scripted step model the generator drives step by step: it records what each model call was given, and acts on the tag its turn's message carries. The coding harness is a fake that names a session, resumes by session id, and, until stopped, works until its signal fires and exits. Alice acts over the host's HTTP router as a verified user; task words are made at run time.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a` (a steer to an open task): one before start (filed held, steered, released) is in the first model call's brief. One to a running request (its first model call holding while the steer lands) is in its next model call and not the one before. One to a task waiting on the task it filed starts a turn with the steer while that piece is still open. For each, at the steer: `attempts` unchanged, no ending, status unchanged; and the task completes on attempt 1.
- `b` (a steer after the last model call): it gets one more turn before the settle, and the task settles once, after it, on attempt 1. Variant: the worker checkpointed before the steer; where the steer turn checkpoints, its checkpoint is the output, and where it doesn't, the earlier one stands.
- `c` (a steer to a coding run): the running harness step ends, and the next run resumes the same coding session with the message, in the same request, on attempt 1; the task completes once.
- `d` (a finished task): `updateTask({ message })` is refused naming the rule; a follow-up runs in its session; the original's output reads byte-identical; `getTask` shows the follow-up's output as `current`. A follow-up of a routed task (filed `session: "ongoing"`, `resultTo: "conversation"`) runs in the delegate's ongoing session it ran in (FIX-2111).
- `e` (typing in the task's session): a line in an open task's session is a steer from the user, and no reply runs beside it; in a finished one, a reply that names what the task did, and the row is unchanged.

**Not run here:** the spec's sub-leg of `a` for a suspended request (a worker stopped for an approval, steered, then resumed). The built-in `agent` flow's task entry is not durable, so its worker can't stop for an approval on this host. The steer would reach it through the same read every model call makes (the one the running sub-leg proves), but that is a claim this check doesn't make.

**Anti-game:** model input is graded as the scripted model received it (every model call's options, whole). Rows are read through the public read actions (`getTask_tasks`, `listTasks_tasks`), never the collection. A turn acts only on the tag its own message opens with, and the steer turn's message is the steers it took, so no turn invents a steer.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/task-tools/steer-and-follow-up/run.mts`. On demand only, never a CI gate.

**Controls:** each is a scratch patch to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run (a patch spanning lines, `reopen`'s on the resource backing, is not printed), and refused when it never reached the code.

- `GOAL_CONTROL=drop-late-steer`: the claim gate's check (rule 6) settles a task over a steer no request took (`packages/orchestration/src/task-board/task-request.ts`). Must fail leg `b` on **"one more turn before the settle"**.
- `GOAL_CONTROL=reopen`: a message on a finished task is taken, as before FIX-2086: it puts the task back in the queue, where the next attempt replaces its output (`task-tools-capability.ts`, `steers.ts`, and the resource backing the conversation board writes through). Must fail leg `d` on **"byte-identical"**.

On `main` before FIX-2086 the check cannot build its host (not run, read from the code): `harnessSessionDoor`, `steerTurnEntry` and `STEER_TURN_ENTRY` do not exist there, and `updateTask` takes no `message`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-22 | fix/FIX-2086 on 4ce7fb055 (WIP: this goal uncommitted) | n/a | PASS | a: a steer before start was in the first call's brief; a2's two calls, the steer in the second only; a4's steer turn ran with its piece in progress; each steer left status, attempts and completion as they were, each task completed once on attempt 1. b: b1's steer (a line in its session) got a turn before its one settle; b2's output `b2-second` (the steer turn's checkpoint), b3's `b3-first`. c: two harness steps, the first stopped, the second resumed `sess_fake_1` in the same request with the steer. d: refused `task_finished: a finished task takes no message; file a follow-up…`; the follow-up ran in d1's session; `current` the follow-up's output. e: talk answered "Earlier I said: e2 found licence KESTREL-41", row unchanged |
| 2026-10-22 | fix/FIX-2086 on 4ce7fb055 | n/a | FAIL (control `drop-late-steer`, expected) | Leg b only: "one more turn before the settle", no model call carried b1's steer and the task settled with "b1 answer"; b2 read `b2-first` |
| 2026-10-22 | fix/FIX-2086 on 4ce7fb055 | n/a | FAIL (control `reopen`, expected) | Leg d only: the message was taken (`{"ok":true}`), the task went back to `pending`, and its re-run replaced the output: "byte-identical" failed, "d1 original answer" → "done d1" |
| 2026-10-22 | fix/FIX-2086 on eda282f1e (review batch: settle fence, step fences, door chain, message alone) | n/a | PASS | Legs a–e as before: a1's brief carried its steer, a2's second call alone carried it, a4's steer turn ran with its piece in progress; b1's steer turn ran before its one settle, b2 `b2-second`, b3 `b3-first`; c's first step stopped and the next resumed `sess_fake_1` in the same request; d refused naming the rule, `current` the follow-up's; e's talk named KESTREL-41 with the row unchanged |
| 2026-10-22 | fix/FIX-2086 on eda282f1e | n/a | FAIL (control `drop-late-steer`, expected) | Now patches both the owe and the settle-time fence. Leg b only: "one more turn before the settle", no call carried b1's steer and it settled on "b1 answer"; b2 read `b2-first` |
| 2026-10-22 | fix/FIX-2086 on eda282f1e | n/a | FAIL (control `reopen`, expected) | Leg d only: the message was taken (`{"ok":true}`), the task went to `pending`, and its re-run replaced the output ("d1 original answer" → "done d1") |
| 2026-10-22 | fix/FIX-2086 on fc2d710a0 (delta review, merged with main after FIX-2088) | n/a | PASS | Legs a–e as before: a1's brief carried its steer, a2's second call alone carried it, a4's steer turn ran with its piece open; b1's steer turn ran before its settle, b2 `b2-second`, b3 `b3-first`; c's first step stopped and the next resumed `sess_fake_1`; d refused naming the rule, `current` the follow-up's (`d2 corrected answer`); e's talk named KESTREL-41 |
| 2026-10-22 | fix/FIX-2086 on fc2d710a0 | n/a | FAIL (control `drop-late-steer`, expected) | Leg b only: "one more turn before the settle", no call carried b1's steer and it settled on "b1 answer"; b2 read `b2-first` |
| 2026-10-22 | fix/FIX-2086 on fc2d710a0 | n/a | FAIL (control `reopen`, expected) | Leg d only: the message was taken (`{"ok":true}`), the task went to `pending`, and its re-run replaced the output ("d1 original answer" → "done d1") |
| 2026-10-23 | fix/FIX-2083 on 52ad9b934 (the merge with FIX-2082) + the `dispatchTask` removal, uncommitted | n/a | PASS | Legs a to e. Leg a releases the held a1 with `updateTask_tasks { id, status: "pending" }` |
| 2026-10-23 | fix/FIX-2111 on 14778344c, the follow-up placement change reverted (`main`'s behaviour) | n/a | FAIL (expected) | Leg d only: "a follow-up of a routed task runs in the session it ran in", d3 ran in the writer's ongoing session and its follow-up in a new one |
| 2026-10-23 | fix/FIX-2111 on 14778344c | n/a | PASS | Legs a to e; d's routed follow-up ran in the session d3 ran in |
