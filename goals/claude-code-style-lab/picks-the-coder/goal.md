# claude-code-style-lab › the Coder chip picks who makes a code change

**Issue:** FIX-2390 (epic FIX-2369)

**Outcome:** In the Claude Code-style lab, a person picks on the composer's *Coder* chip whether a
code change is planned first or which harness makes it, and the change goes to the worker that
choice names. *Plan first* reads, changes nothing and answers with a plan. *Auto* keeps today's
Claude Code coder (the session-mode and threads-mode scripts cover that).

**Input:** `fixtures/input.json`: a project name and three changes, each with a marker the script
fills in per run. It is **held-out**: no worker file, prompt or flow names any of it.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, with a fresh data folder and a fresh `file://` repository the
lab may cut worktrees from (`CLAUDE_CODE_STYLE_REPOSITORIES`).

- **1** session mode, the chip on *Codex*: your line shows `Coder: Codex`, and the first coding
  task on the session's board (`listTasks_tasks`) is for `desk.coder-codex`.
- **2** the chip on *Plan first*: the next coding task is for `desk.coder-plan`; it completes with a
  result that is a plan naming README.md; no commit in the repository or any clone under the data
  folder holds the line it was asked to plan.
- **3** threads mode, the chip on *Codex*: the coding thread is for `desk.thread-coder-codex`, and
  its card and board row are both tagged *Codex*.
- Throughout: the project's checkout and the lab's checkout are untouched, and the page throws
  nothing.

The Codex legs grade where the change was filed and how it is tagged, not how the run ends, so
they need no Codex sign-in. *Plan first* runs Claude Code for real.

**Anti-game:** every signal reads the rendered page or the board's own records and git history.
Nothing asserts on the adapter, the fake in `test/`, or React state. The chip is picked and the
line typed in the browser.

**Retries:** up to `GOAL_ATTEMPTS` (3) fresh runs, only when the model filed no coding task at
all in session mode. Never under a control, and never after a signal failed.

**Model:** real — `openai/gpt-5.4` (the lab's default), through the AI Gateway. *Plan first*
needs `ANTHROPIC_API_KEY`.

**Run:** `pnpm tsx goals/claude-code-style-lab/picks-the-coder/run.mts`

**Controls** (`GOAL_CONTROL=<name>`; each plants its change for the run and puts it back):
- `no-hint`: the composer sends what you typed without the chip's line. Must FAIL signals 1 and 3.
- `no-delegates`: the new coders taken off `desk.main`'s and `desk.lead`'s delegates, the routing
  text kept. Must FAIL signals 1 and 3.

A first control, `no-route` (the routing text taken out, the delegates kept), **passed**: the
`Coder:` line and each coder's own description route the change without it. So the routing text
isn't what files a change to the right coder; the delegate list and the line are, and the
controls plant those.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | 1971676 (local) | openai/gpt-5.4, Claude Code | FAIL | Signals 1 and 3 passed. Signal 2 read the plan off `listTasks`, which carries no output; the check now reads it with `getTask` |
| 2026-10-31 | 1971676+wip (local) | openai/gpt-5.4, Claude Code | FAIL | Signals 1 and 3 passed. Signal 2: the goal judge read the plan as "not done" ("doesn't show the work, such as reading the code"), and the retry ended errored. The routing text now has a plan goal name the files it read and what they hold |
| 2026-10-31 | 1971676+wip (local) | openai/gpt-5.4 | FAIL (control `no-hint`) | Signals 1, 2 and 3: every change went to `desk.coder` / `desk.thread-coder`, and Plan first's line was committed |
| 2026-10-31 | 1971676+wip (local) | openai/gpt-5.4, Claude Code | PASS (control `no-route`, since replaced) | The routing text isn't what routes: the `Coder:` line and the coders' own descriptions do. Replaced by `no-delegates` |
| 2026-10-31 | d4e72dd (local) | openai/gpt-5.4, Claude Code | PASS | Attempt 1 of 3: filed to `desk.coder-codex`; `desk.coder-plan` answered a 1,933-character plan and nothing was committed; `desk.thread-coder-codex`, card and row tagged Codex |
| 2026-10-31 | d4e72dd (local) | openai/gpt-5.4 | FAIL (control `no-delegates`) | Signal 1 went to `desk.coder`; signal 2 filed no coding task; signal 3 went to `desk.thread-coder`, untagged Codex |
