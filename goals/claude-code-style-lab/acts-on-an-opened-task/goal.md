# claude-code-style-lab › it acts on an opened task

**Issue:** FIX-2382 (epic FIX-2369), the Claude Code-style lab's leg

**Outcome:** In the Claude Code-style lab, a person opens a background task from the tasks pane
and changes it from its sheet, with no model turn in between: types a line in **Steer** and the
running task has it; presses **Cancel**, confirms once, and the task is cancelled and its coding
run stops; presses **Retry** and the same task runs again. A task whose run failed shows, in its
sheet, the error its board recorded.

**Input:** `fixtures/input.json`: two project names, the two tasks' goals and the steer's words.
It is **held-out**: no worker file, flow or page names any of it, so other words and goals pass a
correct lab. The tasks are filed on the session's board through its own `createTask` action, as
the main session files them; the failing one is on a project whose repository is removed after
the project is made, so its run's checkout is refused.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, a fresh data folder, every coding task on harness-manager's
scripted coder (`CLAUDE_CODE_STYLE_HARNESS=stub`, a step every 6 s).

- **steer**: after the sheet's Steer box sends the words, the row's `steers` (the board's
  `getTask`) hold them within 15 s.
- **cancel**: the row is unchanged after the first click; after the confirm it reads `cancelled`
  (`listTasks`) within 15 s, the run's request (the row's `run`, in the run session's requests)
  leaves `in_progress` within 30 s after that, and the row still reads `cancelled` one step later.
- **retry**: the sheet offers Retry once the row is cancelled; after it, the same task id reads
  `pending` or `in_progress` with more attempts than before, within 15 s, and the board holds that
  one row, no new one.
- **error**: the failed task's sheet shows, as an alert, the `error` its `getTask` reads.

**Anti-game:** every leg grades the board's own records, read with the public client
(`listTasks`, `getTask`, the run session's requests); the page is read only for which buttons it
offers and, in the error leg, for the board's recorded words. Nothing asserts on the adapter, the
fake in `test/`, or React state. The steers read and the recorded error are floored with
`tell.over`, so an empty read is CAN'T TELL. A press that the page reports as done while the row
doesn't change fails its leg, which is what `wrong-board` proves. The error leg can't be failed by
`wrong-board` (it is no action of the row), so `no-error` is its own control.

**Model:** n/a. The server gets no model credential, so the main session's turn on a task's ending
fails rather than infers; nothing graded waits on it.

**Run:** `pnpm tsx goals/claude-code-style-lab/acts-on-an-opened-task/run.mts`

**Controls:**
- `GOAL_CONTROL=wrong-board`: the lab's action row bound to board `"plan"` instead of `"tasks"`
  (`src/adapter.ts`, planted and put back; pages rebuilt). Must FAIL steer, cancel and retry, with
  the refusal on the page.
- `GOAL_CONTROL=no-error`: the sheet's error drawn with nothing (`src/components/TasksPane.tsx`).
  Must FAIL error.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | b9da251a tree, pre-commit | n/a | FAIL (control `wrong-board`) | steer, cancel and retry only. The page showed the refusal `Request failed (500) Internal Server Error` for Steer and Cancel; no steer on the row; the row ran on to `completed`, so Retry was never offered. Error passed |
| 2026-11-04 | b9da251a tree, pre-commit | n/a | FAIL (control `no-error`) | error only: the sheet had no alert holding the recorded `[harness-manager] the workspace host refused this run (remote-unreadable): …`. Steer, cancel and retry passed |
| 2026-11-04 | b9da251a tree, pre-commit | n/a | PASS | steer on the row after 303 ms; row `cancelled` after 81 ms, its run's request `completed` 573 ms later and the row still `cancelled` a step after; Retry ran the same task, `in_progress`, attempt 2 (was 1); the failed task's sheet showed its recorded error |
