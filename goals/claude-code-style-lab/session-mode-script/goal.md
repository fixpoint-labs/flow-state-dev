# claude-code-style-lab › session mode runs the scripted session on the real packages

**Issue:** FIX-2153 (epic FIX-2152, leg a)

**Outcome:** In the Claude Code-style lab, a person picks a project, asks the main session for
something, and sees it work the way Claude Code does: its own text first, background tasks in the
right pane, a quick task's result taken into the turn that is still running, a task stopped by
asking for it, and a one-line code change made by Claude Code in a clone of the project's
repository. All of it on the workforce package, a real model and a durable store, with nothing
in the lab but configuration, React UI and small flows.

**Input:** `fixtures/input.json`: a project name, the ask (a comparison with one quick and one
long research task), the line that asks to stop the long one, and the code change, with a marker
the script fills in per run. It is **held-out**: no worker file, prompt or flow names any of it,
so another ask with a quick and a long piece passes a correct lab.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, with a fresh data folder and a fresh `file://` repository.

- **0** *New session* asks for a project (the *New project* form makes one), and the header shows
  `in project: <name>` once it is picked.
- **1** your line shows in the thread.
- **2** the main session's own text shows before any task row.
- **3** at least two task rows show, each one on this session's board as `listTasks` reads it.
- **4** a result card shows while the working indicator is on, and text after it in the same turn
  names the result. The card, the indicator and that text all carry the request id of your first
  `respond`, read from the server's requests, so a second request started by the settled notice
  does not count.
- **5** after you ask to stop the other task, its row reads `cancelled` through `listTasks`, and
  the pane shows it.
- **6** (harness leg) ask for a one-line change to `README.md`: a task to `desk.coder` settles
  `completed`; its work view shows the harness's steps; a branch of the run's clone of the
  project's repository holds the change; the repository itself and the lab's checkout are
  untouched.

**Anti-game:** every signal reads the rendered page (`data-entry`, `data-request-id`,
`data-task-status`, the header) or the server's own records (requests, `listTasks_tasks`, the
clone's git log). Nothing asserts on the adapter's return values, the fake in `test/`, or React
state. The stop is asked for in the composer, never sent through `updateTask`. An empty timeline
or an empty pane is CAN'T TELL, not PASS.

**Retries:** up to `GOAL_ATTEMPTS` (3) fresh runs, only when the model gave nothing to grade:
fewer than two tasks filed, both tasks finished before the ask to stop, or no task settled before
the first turn ended. A task that settled while the turn ran with no card inside it is the
mechanism failing, and is graded at once.

**Model:** real — `openai/gpt-5.4` (the lab's default; `gpt-5.4-mini` ends its turn before a quick
task settles), through the AI Gateway. Claude Code needs `ANTHROPIC_API_KEY`.

**Run:** `pnpm tsx goals/claude-code-style-lab/session-mode-script/run.mts`

**Controls:**
- `GOAL_CONTROL=answer-again-off`: the lab with `CLAUDE_CODE_STYLE_ANSWER_AGAIN=off`. Must FAIL
  signal 4: the result arrives in a second request after the turn.
- `GOAL_CONTROL=no-project`: a session made with no project. Must FAIL signals 0 and 6: the
  composer stays closed and asks, and no run clones anything.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | d86b248 | openai/gpt-5.4 | PASS | Attempt 1 of 3. 135 page polls through the first turn; 2 task rows; the card, the indicator and the text after it all on the first `respond`'s request; the long task read `cancelled` through `listTasks` after the ask; Claude Code committed `Update README first line…` on the run's `conductor/…--work` branch in the clone; the work view showed 6 harness entries; repository and lab checkout untouched |
| 2026-10-28 | d86b248 tree, pre-commit | openai/gpt-5.4 | FAIL (control `answer-again-off`) | Signal 4 only: a task settled while the first turn ran and no card showed inside it; 5 and 6 passed |
| 2026-10-28 | d86b248 tree, pre-commit | openai/gpt-5.4 | FAIL (control `no-project`) | Signal 0 (header reads *no project*) and signal 6 (no run cloned anything); the composer stayed closed and asked once; lab checkout untouched |
| 2026-10-28 | d86b248 tree, pre-commit | — | FAIL (control `planted-glue`) | `inventory: other: src/glue.ts is not config, UI, a small flow, a check or a fixture` |
| 2026-10-28 | e2cdf9a | openai/gpt-5.4 | PASS | Rerun after the review fixes (phase `code`, harness read through `resolveWorker`, graded retries): attempt 1 of 3, 110 polls, 2 task rows, 6 harness entries, the change on the run's branch in the clone |
