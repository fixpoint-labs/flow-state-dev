# dispatching-work › it records a task without starting it, until something dispatches it

**Issue:** FIX-1875 (epic FIX-1870). Its spec's goal: `specs/issues/FIX-1875/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** on a conversation's board, writing a task down never starts it, even with an owner named, however often the board is touched. A release (`updateTask` with `status: "pending"`) starts it when asked, and `createTask` starts a new task the same way (`createTask` until FIX-2083). Another conversation can't reach a task that isn't on its board.

**Input:** a goal-local Lab (`lab/fsdev.config.mts` over the tree in `fixtures/workforce/`), the FIX-1817 Lab's shape: the real engine and a SQLite store, served over HTTP by Shift Manager's own command. Alice signs in with a verified bearer and acts through the shipped clients. `desk.lead` is a coordinator with two delegates, `desk.ops` and `desk.dev`, both on the built-in `agent` flow and the real model `openai/gpt-5.4-mini` through the AI Gateway. The coordinator's judgment turn, which each notice wakes, is scripted to note it. Held out, picked at run time: which delegate each task is for, and each task's words (a reference word and a subject). Every run records both forms: a task recorded for a delegate, and one recorded for nobody that gets its owner from the release.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `rec:not-started`: two tasks filed through `createTask_tasks` with `held: true` (`addTask_tasks` before FIX-2081; one for a delegate, one for nobody) are each `held` (FIX-2080; `pending` with the not-dispatched mark before it), with 0 attempts, no run and no task session, after 30 s in which the board is touched about once a second (`listTasks_tasks`).
- `lineage:refused`: `updateTask_tasks` releasing the recorded task, sent from Alice's other conversation with the same coordinator, answers `task_not_found`, and the stored row is byte-for-byte unchanged.
- `disp:ref-runs`: `updateTask_tasks` with each recorded task's `id` and `status: "pending"` (with an `assignee` for the one recorded for nobody) starts it: one task session, opened after the release request, one attempt, `completed` for that delegate, and one `completed` notice in the conversation.
- `disp:new-runs`: `createTask_tasks` with a new `goal` and a delegate runs the same way: once, `completed`, one notice.

**Anti-game:** the check writes no row, session or notice: every change is an action Alice sends. Every grade reads the store file the run wrote (`../../coordinators/files-tasks-down-the-owners-chain/store.mts`), except what the other conversation's dispatch answered. "Not started" is graded on the stored row and the sessions table, not on the recording's `status: "held"`, which the control leaves in place. "Started by the dispatch" is graded on the task session's creation time against the dispatch request's, so a row that started on its own and later reads `completed` does not pass `disp:ref-runs`.

**Attempts:** real model, so it runs until it first passes, up to two attempts (`GOAL_ATTEMPTS`), each on a fresh store and Lab. One attempt under a control.

**Model:** `openai/gpt-5.4-mini` through the AI Gateway (`AI_GATEWAY_API_KEY`); blocked, not failed, without the key.

**Run:** `pnpm tsx goals/dispatching-work/a-recorded-task-waits-for-dispatch/run.mts`. On demand only, never a CI gate.

**Controls:** a scratch patch to an Orchestration module, applied as the Lab loads it (`goals/lib/module-patch.mjs`), printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=add-starts`: the task tools drop `createTask`'s `held` setting and file the row ready (`packages/orchestration/src/skills/task-tools-capability.ts`), so writing a task down for a delegate starts it, as before FIX-1875. Must fail **`rec:not-started`** (the task recorded for a delegate). `disp:ref-runs` goes red with it, for the same row: its dispatch finds it already started. The task recorded for nobody passes `rec:not-started` under the control too, since with two delegates nothing starts an ownerless row; that is why every run records both.

On `main` before FIX-1875 there is no `dispatchTask_tasks` action, so `disp:ref-runs` and `disp:new-runs` cannot pass there, and `addTask_tasks` for a delegate starts the task, which is what `add-starts` reproduces.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-12 | fix/FIX-1875-P2 on 1ed413f25 (P1) + uncommitted | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `add-starts`, expected) | `rec:not-started`: the task recorded for desk.dev ran and `completed` during the touches. `disp:ref-runs` red with it for both rows: the first's dispatch answered `task_not_dispatchable … completed`, the second's (recorded for nobody, with no mark) `… already dispatched`, and the second never ran (two delegates, no owner). `disp:new-runs` green |
| 2026-10-12 | fix/FIX-1875-P2 on 1ed413f25 (P1) + uncommitted | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 2. 28 touches over 30 s, both recorded rows `pending` with no run. The other conversation's dispatch answered `task_not_found`, the row unchanged. Dispatched: the row for desk.dev, the row for nobody (given desk.ops), and a new row for desk.ops, each `completed` once with one notice |
| 2026-10-12 | 62b33726c (P2 committed on P1's last head 233e7e564; same code rebased onto `main` e8d6d93e2) | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `add-starts`, expected) | `rec:not-started`: the row recorded for desk.dev ran and `completed` during 28 touches. `disp:ref-runs` red with it for both rows, as before. `disp:new-runs` green |
| 2026-10-12 | 62b33726c (as above) | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 2. Both recorded rows `pending` with no run after 28 touches; the other conversation's dispatch `task_not_found`, row unchanged; three dispatched rows each `completed` once with one notice |
| 2026-10-21 | fix/FIX-2080 on 2f0d88a1a (WIP) | openai/gpt-5.4-mini (vercel gateway) | PASS | After FIX-2080. Attempt 1 of 2. Both recorded rows `held` with no run after 27 touches (the recording answered `status: "held"`); the other conversation's dispatch refused; the two released rows and a new row each `completed` once |
