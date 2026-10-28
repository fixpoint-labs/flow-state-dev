# claude-code-style-lab › threads mode runs the scripted threads on the real packages

**Issue:** FIX-2157 (epic FIX-2152, leg c)

**Outcome:** In the Claude Code-style lab's Projects view, a person picks a project and asks the
main session, a coordinator, for three pieces of work. They see it start three threads, each a
task in a session of its own, running side by side; answer the one that asks them a question,
inside that thread; see it become ready for review; and resolve it. Then they ask for a code
change and see it run through Claude Code in a worktree of the project's repository, judged
against its goal, wait for their review, and resolve. All of it on the workforce package, a real model and a durable store, with
nothing in the lab but configuration, React UI and small flows.

**Input:** `fixtures/input.json`: a project name, the ask (three vendors, one thread each), your
answer to a thread's question, and the code change, with a marker the script fills in per run.
It is **held-out**: no worker file, prompt or flow names any of it. The thread worker's
instructions say to ask which region matters, so step 3 doesn't hang on the model's choice.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, with a fresh data folder and a fresh `file://` repository, which the lab is told it may cut
worktrees from (`CLAUDE_CODE_STYLE_REPOSITORIES`).

- **setup** the Projects view's *New session* asks for a project (the *New project* form makes
  one), and the header shows `in project: <name>`.
- **1** your line shows, marked *Sent to a thread*.
- **2** through `listTasks_tasks`, three tasks for `desk.thread` on this session's board are open
  at once, none `pending`, each with a run session of its own; three thread cards and three
  board rows show for them.
- **3** one row is under *Waiting on you* while its task holds a question; you type the answer in
  that thread's view; `getTask_tasks` shows the question closed on the same attempt, with a steer
  carrying your words that answers it, and the row leaves *Waiting on you*.
- **4** that row moves to *Ready for review*, and `getTask_tasks` shows the task holding a review.
- **5** you press *Resolve* on its card; `getTask_tasks` reads `completed`, and the row shows
  under *Resolved*.
- **6** you ask for a code change: a task to `desk.thread-coder` is filed; its card and row are
  tagged *Claude Code*; it waits on your review (answering a question first, in its thread, if
  the run asks), under *Ready for review*, with the judge's line on its card; *Resolve* completes
  it with output `review: "accepted"` and moves it under *Resolved*. The run worked in a worktree
  of the project's repository under the lab's data folder, whose branch, also in the repository,
  holds the CHANGELOG line; the repository's checked-out branch and files and the lab's checkout
  are untouched.

**Anti-game:** every signal reads the rendered page (`data-entry`, `data-task-id`,
`data-column`, the header) or the board's own records (`listTasks_tasks`, `getTask_tasks`, the
clone's git log). Nothing asserts on the adapter's return values, the fake in `test/`, or React
state. The answer is typed in the thread's view and *Resolve* is clicked; neither goes through a
package call from the script.

**Retries:** up to `GOAL_ATTEMPTS` (3) fresh runs, only when the model gave nothing to grade: no
thread filed, or no thread asked a question. Never under a control, and never after a signal
failed.

**Model:** real — `openai/gpt-5.4` (the lab's default), through the AI Gateway. Claude Code needs
`ANTHROPIC_API_KEY`.

**Run:** `pnpm tsx goals/claude-code-style-lab/threads-mode-script/run.mts`

**Controls** (`GOAL_CONTROL=<name>`; each plants its change for the run and puts it back):
- `no-delegates`: the lead's `WORKER.md` with `delegates: []`. Must FAIL signal 2.
- `ongoing`: the lead told to file each thread with `session: "ongoing"`. Must FAIL signal 2: the
  threads share the delegate's one session and wait in line.
- `no-review`: the thread worker's `WORKER.md` without its review line. Must FAIL signal 4.
- `no-project`: a lead session made with no project. Must FAIL signal 6: the composer stays
  closed and asks, and no run clones anything.
- `no-mapping`: the lab started with no repository to cut worktrees from. Must FAIL signal 6: the
  run works in a clone.
- `planted-glue`: a planted `src/glue.ts`. The inventory must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | 32b5f0b | openai/gpt-5.4 | PASS | Attempt 1 of 3. Three `desk.thread` tasks open at once, each in its own run session; "Statuspage vendor research: Atlassian Statuspage" asked which region, your answer typed in its thread closed the question on attempt 1 with your steer, it moved to *Ready for review*, and *Resolve* completed it under *Resolved*. The coding thread was tagged *Claude Code*, waited on your review with the judge's line, and *Resolve* completed it with `review: "accepted"`; the CHANGELOG line is on the run's branch in the clone under the data folder; repository and lab checkout untouched |
| 2026-10-28 | 41423b4 | openai/gpt-5.4 | PASS | Attempt 1 of 3, after merging 4543a90 (task listing runs only while the board can move). Same signals as above: three threads side by side, the answered thread resolved, and the coding thread resolved with its line on the clone's branch |
| 2026-10-28 | 32b5f0b | openai/gpt-5.4 | FAIL (control `no-delegates`) | Signal 2: the lead filed no thread (and signal 1: your line wasn't marked) |
| 2026-10-28 | 32b5f0b | openai/gpt-5.4 | FAIL (control `ongoing`) | Signal 2: three threads filed, one `in_progress` and two `pending` with no run, waiting in line behind the delegate's one session |
| 2026-10-28 | 32b5f0b | openai/gpt-5.4 | FAIL (control `no-review`) | Signal 4: the answered thread completed without waiting on your review |
| 2026-10-28 | 32b5f0b | openai/gpt-5.4 | FAIL (control `no-project`) | Signal 6: the composer stayed closed and asked once; the coding task errored and no run cloned anything |
| 2026-10-28 | 32b5f0b | — | FAIL (control `planted-glue`) | `inventory: other: src/glue.ts is not config, UI, a small flow, a check or a fixture` |
| 2026-10-28 | 619ac83 | openai/gpt-5.4 | FAIL | Signal 6: the lead filed the code change to `desk.thread`, not the coder. The lead's instructions named only `desk.thread` as the assignee; they now name the coder for code (29bd1b9) |
| 2026-10-28 | 29bd1b9 | openai/gpt-5.4 | FAIL | Signal 6: the review column was read before the page's next 2s read; the worktree and its branch were right. The check now waits for the page (10ed30d) |
| 2026-10-28 | 10ed30d | openai/gpt-5.4 | PASS | Attempt 1 of 3. Worktrees and the judge: the coding thread ran in a worktree of the project's repository under the data folder, its branch in the repository holding the CHANGELOG line, its card showed the judge's verdict, and *Resolve* completed it `review: "accepted"` |
| 2026-10-28 | 10ed30d | openai/gpt-5.4 | FAIL (control `no-mapping`) | Signal 6: `the run didn't work in a worktree of the project's repository (1 clone(s) under the data folder)` |
