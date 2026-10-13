# shift-manager › a fresh open works FSD and Shift Manager

**Issue:** FIX-1919, the closure of epic FIX-1903. Its goal: `specs/epics/FIX-1903/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** On a fresh open of `pnpm shift-manager:dev`, with no config edited, a person sets their Linear key on Settings, asks the chief of staff for one item on FSD and, while it works, one on Shift Manager. Claude Code works each in its own worktree of their checkout, on its own branch, and the FSD run reads its Linear issue.

**Input:** The command as a person types it, from the checkout's root, with no flags but a free port and no browser. The shipped store (`packages/shift-manager/.fsdev/fsd.sqlite`) is moved aside first and put back after, so the open is fresh. A held-out Linear issue picked at run time from Linear's API, read only: one whose identifier and title the checkout's HEAD never mentions. The person's Linear key is `LINEAR_API_KEY`, pasted on Settings; `LINEAR_MCP_API_KEY` is unset. Leg b's item carries a stamp picked at run time.

**Signal:** Chromium, as the Lab's owner (the page as served).

- **key**: on `/settings`, the `linear` row takes the key and reads *set*.
- **a**: in the chief of staff's composer, "On FSD: have the coder read Linear issue `<id>` and answer with its title, exactly as Linear has it. Change no files." The composer reads *delivered*.
- **b**: straight after, in the same composer, "On Shift Manager: have the coder create the file `<file>` containing exactly the line `<stamp>`, and commit it on its branch."

Then, read from git and the Lab's routes: `a:completed`, `b:completed` (each task settles `completed`); `worktrees-in-checkout` (`git worktree list` in the checkout names exactly two new places under `.fsdev/fsd-runs`, each on a branch); `b:while-a-works` (one poll saw both tasks unsettled with both worktrees present); `<leg>:branch-in-checkout`; `b:commits-the-file`; `a:linear-call` (a's run session holds an `mcp__linear__` tool call); `a:title` (a's answer carries the title Linear's API gives); `<leg>:no-demo-brief` (no branch commits `greeting.js` or the DevTeam demo brief's commit marker, and a's answer doesn't talk about `greet()`); `page` (the page threw nothing).

**Anti-game:** The prompt carries the issue's id, never its title, so the title in the answer can only come from Linear. No assertion reads a child's own output, the page's state or a profile file: tasks and items are read through the Lab's routes, places and branches with git. The check sets no variable a person wouldn't and edits no config; the store is moved, not configured. It removes the worktrees and branches it made, pass or fail.

**Model:** real. The chief of staff's (`anthropic/claude-haiku-5-5`), the EM's (`openai/gpt-5.4-mini`), and Claude Code through its Agent SDK.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/a-fresh-open-works-fsd-and-shift-manager/run.mts`. Needs `LINEAR_API_KEY`, a Claude Code credential, the chief of staff's and EM's model keys, `git`. Up to twenty minutes.

**Controls** (`GOAL_CONTROL=list`):

- `GOAL_CONTROL=no-linear`: FSD's MCP servers cleared through the projects flow (`setMcpServers []`) before asking. Must FAIL `a:title`.
- `GOAL_CONTROL=no-key`: the Settings step skipped, with `LINEAR_MCP_API_KEY` unset. Must FAIL `a:title`.
- Today's `main` before the epic: `GOAL_CHECKOUT=<a checkout of that commit, installed>`. Must FAIL both legs (no FSD project, no Settings).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
