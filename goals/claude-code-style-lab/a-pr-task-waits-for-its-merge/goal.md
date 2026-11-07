# claude-code-style-lab › it keeps a PR task open until its pull request merges

**Issue:** FIX-2578 (epic FIX-2369), PR 2 (the apps)

**Outcome:** In the Claude Code-style lab, a coding task whose run opened a pull request does not
end when the run passes. It stays open, its card and view say **PR open · #7** with the link, and
its view keeps a box to type in, with *"Merged? Say so here and I'll check."*. A line typed there,
or a message delivered to the run's session, is one more run on the same attempt and session, and
the task waits again. Once the pull request is merged, a line completes the task with no run; once
it is closed unmerged, a line cancels it, *its pull request was closed without merging*. While
GitHub can't be read the task never settles, and the wait survives a host crash.

**Input:** `fixtures/input.json`: a project name, two tasks' titles and goals, the lines typed at
each leg and the delivered message's sender and words. **Held-out**: no worker file, flow or page
names any of it. The tasks are filed on the session's board through its own `createTask`, for
`desk.coder`.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, a fresh data folder, every coding run on harness-manager's
scripted coder (`CLAUDE_CODE_STYLE_HARNESS=stub`), and `bin/gh` first on the server's `PATH`: it
lists PR 7 (PR 8 for the second task) on the run's branch once the run did its work there, answers
`repos/acme/app/pulls/N` from a state file each leg writes, and logs each call. The delivered
message goes through `mail.mts` (loaded by `GOAL_FLOWS`), which writes one message row and
dispatches it to the run session's `onMessageReceived`, as a service will.

- **a:open** the row is `in_progress` with an open `external` hold (actor `system`) naming PR 7.
  **a:record** the run session's pull-request record has PR 7 at the stub's URL. **a:card** the
  task's card reads `PR open · #7`. **a:link** its view links `#7` to the stub's URL.
  **a:composer** its view draws the box to type in and the hint.
- **b:line** a line typed in the view's box; **b:message** a delivered message. Each:
  **one-run** exactly one harness run (the scripted coder's first step, counted in the run
  session's items), **same-attempt**, **same-session** (the row's run session), **waits-again**
  (a new open external hold). b:message also finds the row's steer from `service` by the sender.
- **e:unreadable** the stub `gh` exits non-zero: a line runs one run and the row waits again.
- **f:survives** the host is crashed (`crashAndRestart`) while waiting: the same hold and PR 7 on
  the record after it.
- **c:completed** stub merged, a line: the row is `completed`, its output's `pullRequests` names
  PR 7 merged; **c:no-run** no harness run after the line; **c:read** the wake read PR 7 from gh.
- **d:waits / d:cancelled** a second task waits on PR 8; stub closed, a line: `cancelled` with the
  error `its pull request was closed without merging`.

**Anti-game:** graded on the board's rows (`listTasks`, `getTask`), the run session's items and
pull-request record (public client), the stub's call log, and the rendered page. Runs are counted
from what the scripted coder narrates in the session, not from the manager's calls. The line in b
is typed in the page, which sends it as a board steer: a board steer that left the wait open
fails b:line (the `plain-steer` control). The coding harness session id isn't client-readable; the row's run session stands in.

**Not covered here:** the Teammates and Shift Manager legs on FIX-2543's Accept → Open a PR path.
Both apps turn `awaitPullRequests` on and show the line (their screen tests), but a goal leg needs
a landing that pushes to a GitHub remote; see the PR's notes.

**Model:** n/a. The server gets no model credential.

**Run:** `pnpm tsx goals/claude-code-style-lab/a-pr-task-waits-for-its-merge/run.mts`

**Controls:** each a scratch patch applied as the server loads (`goals/lib/module-patch`):

- `GOAL_CONTROL=no-wait`: the lab's managers built with `awaitPullRequests: false`. Must FAIL
  a:open (the row is `completed`); b, c are then not reached and d:waits fails too.
- `GOAL_CONTROL=ignore-pr-state`: the wake reads every pull request as merged. Must FAIL
  b:line:waits-again (the line completes the task) and d:cancelled (it completes instead).
- `GOAL_CONTROL=plain-steer`: orchestration's `steerWrite` keeps a board steer as a plain steer,
  leaving the wait open. Must FAIL b:line:waits-again (the row stays in_progress with no new wait
  and no run).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-07 | on 8b61b2fd (PR 1), this change pre-commit | n/a | PASS | a: in_progress, one external hold on github.com/acme/app/7; card "PR open · #7", view links #7 to the stub's URL and keeps its box and hint. b:line and b:message: 1 run each, attempt 1, same run session, waiting again; the message's steer is `service` by github.reviewer. e: 1 run, waiting again. f: same hold after the crash. c: completed, output PR 7 merged, no run. d: cancelled, "its pull request was closed without merging". 15 gh calls |
| 2026-11-07 | same | n/a | FAIL (expected, `no-wait`) | a:open: the row reads completed, no external hold; b and c not reached; d:waits: the second task completed |
| 2026-11-07 | same | n/a | FAIL (expected, `ignore-pr-state`) | b:line:waits-again: the line completed the task; c not reached; d:cancelled: completed instead of cancelled. a passed |
