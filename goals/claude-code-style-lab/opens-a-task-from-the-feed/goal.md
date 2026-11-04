# claude-code-style-lab › it opens a task from the feed

**Issue:** FIX-2399 (epic FIX-2369), the Claude Code-style lab

**Outcome:** In the Claude Code-style lab, a person gets from any line in the main thread that
names a task (its result line, or the line where the main session started it) to that task's full
run in one press, sees the task's status as it is now on that line, and finds the same task marked
in the pane.

**Input:** `fixtures/input.json`: two project names, the two coding tasks' goals, and the ask that
has the main session start a background task. It is **held-out**: no worker file, flow or page
names any of it. Leg 1's tasks are filed and one cancelled on the session's board through its own
`createTask` and `updateTask` actions, as the main session files and cancels them.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, a fresh data folder per leg, every coding task on
harness-manager's scripted coder (`CLAUDE_CODE_STYLE_HARNESS=stub`, a step every 2 s).

- **Leg 1, no model.** One task completes and one is cancelled; each ending lands as a result line
  before any model turn.
  - **opens-from-result**: the completed task's line's *Open task* opens the dialog
    `Work: <title>`, and the page's address names that task.
  - **row-marked**: that task's row in the pane is visible, with `aria-expanded="true"` (it sits
    in *Done*).
  - **dot-is-live**: after *Retry* in the cancelled task's sheet, within 15 s the cancelled line's
    dot is labelled with the status `listTasks` reads for the row (not cancelled), and its words
    still say cancelled.
- **Leg 2, the lab's default model.** The main session is asked to start a background task.
  - **opens-from-start-line**: the line that started it names a task `listTasks` lists, its dot's
    label matches that row's status, and its *Open task* opens `Work: <the row's title>`.

**Anti-game:** every signal reads the rendered page and compares it with `listTasks`; nothing
asserts on the adapter, the fake in `test/` or React state. The page is only clicked. Missing
result lines, an empty board or no start line is CAN'T TELL (`tell.over`), not PASS.

**Model:** leg 1 n/a (its server gets no model credential); leg 2 the lab's default, through the
AI Gateway.

**Run:** `pnpm tsx goals/claude-code-style-lab/opens-a-task-from-the-feed/run.mts`

**Controls** (each planted in the lab's source for the run and put back; pages rebuilt):
- `GOAL_CONTROL=no-feed-open`: the open the main thread hands its lines does nothing
  (`src/components/Thread.tsx`). Must FAIL opens-from-result, row-marked and opens-from-start-line.
- `GOAL_CONTROL=frozen-dot`: a result line's dot reads the line's own status
  (`src/components/Entry.tsx`). Must FAIL dot-is-live.
- `GOAL_CONTROL=done-shut`: *Done* is not opened for the open task (`src/components/TasksPane.tsx`).
  Must FAIL row-marked.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | a4b541ef | lab default | FAIL (control `no-feed-open`) | opens-from-result, row-marked (row hidden, aria-expanded=false) and opens-from-start-line only; dot-is-live passed, the sheet opened from the pane |
| 2026-11-04 | a4b541ef | lab default | FAIL (control `frozen-dot`) | dot-is-live only: the cancelled line's dot read "cancelled" while the row was in_progress |
| 2026-11-04 | a4b541ef | lab default | FAIL (control `done-shut`) | row-marked only: the row was marked (aria-expanded=true) but hidden in the shut Done |
| 2026-11-04 | a4b541ef | lab default | PASS | sheet `Work: Note the finished run`, address named it; Done row shown and marked; retried line's dot "running" for row in_progress after 71 ms, words "cancelled · now running"; start line opened `Work: Add line to NOTES.md`, dot "running" for row in_progress |
