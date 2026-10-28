# shift-manager › a fresh open works FSD and Shift Manager

**Issue:** FIX-1919, the closure of epic FIX-1903. Its goal: `specs/epics/FIX-1903/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** On a fresh open of `pnpm shift-manager:dev`, with no config edited, a person sets their Linear key on Settings, asks the Shift Coordinator for one item on FSD and, while it works, one on Shift Manager. Claude Code works each in its own worktree of their checkout, on its own branch, and the FSD run reads its Linear issue.

**Input:** The command as a person types it, from the checkout's root, with no flags but a free port and no browser. The shipped store (`packages/shift-manager/.fsdev/fsd.sqlite`) is moved aside first and put back after, so the open is fresh. A held-out Linear issue picked at run time from Linear's API, read only: one whose identifier and title the checkout's HEAD never mentions. The person's Linear key is `LINEAR_API_KEY`, pasted on Settings; neither it nor `LINEAR_MCP_API_KEY` is in the command's environment. Leg b's item carries a stamp picked at run time.

**Signal:** Chromium, as the Lab's owner (the page as served).

- **key**: on `/settings`, the `linear` row takes the key and reads *set*.
- **a**: in the Shift Coordinator's composer, "On FSD: have the coder read Linear issue `<id>` and answer with its title, exactly as Linear has it. Change no files." The composer reads *delivered*.
- **b**: straight after, in the same composer, "On Shift Manager: have the coder create the file `<file>` containing exactly the line `<stamp>`, and commit it on its branch."

Then, read from git and the Lab's routes: `a:completed`, `b:completed` (each task settles `completed`); `worktrees-in-checkout` (`git worktree list` in the checkout names exactly two new places under `.fsdev/fsd-runs`, each on a branch); `b:while-a-works` (one poll, from before a is asked, saw both tasks unsettled with both worktrees present); `<leg>:branch-in-checkout`; `b:commits-the-file` (the file on b's branch is exactly the stamped line); `a:changes-nothing` (a's branch carries no commits); `a:linear-call` (a's run session holds an `mcp__linear__` tool call); `a:title` (a's answer carries the title Linear's API gives); `<leg>:no-demo-brief` (no branch commits `greeting.js` or carries a DevTeam test marker, the demo brief's or the commit-style skill's, and a's answer doesn't talk about `greet()`); `page` (the page threw nothing).

**Anti-game:** The prompt carries the issue's id, never its title, so the title in the answer can only come from Linear. No assertion reads a child's own output, the page's state or a profile file: tasks and items are read through the Lab's routes, places and branches with git. The check sets no variable a person wouldn't and edits no config; the store is moved, not configured. It removes the worktrees and branches it made, pass or fail.

**Model:** real. The Shift Coordinator's (`anthropic/claude-haiku-5-5`), the EM's (`openai/gpt-5.4-mini`), and Claude Code through its Agent SDK.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/a-fresh-open-works-fsd-and-shift-manager/run.mts`. Needs `LINEAR_API_KEY`, a Claude Code credential, the Shift Coordinator's and EM's model keys, `git`. Up to twenty minutes.

**Controls** (`GOAL_CONTROL=list`):

- `GOAL_CONTROL=no-linear`: FSD's MCP servers cleared through the projects flow (`setMcpServers []`) before asking. Must FAIL `a:title`.
- `GOAL_CONTROL=no-key`: the Settings step skipped, with `LINEAR_MCP_API_KEY` unset. Must FAIL `a:title`.
- Today's `main` before the epic: `GOAL_CHECKOUT=<a checkout of that commit, installed>`. Must FAIL both legs (no FSD project, no Settings).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-13 | 25636f11 + this check | chief of staff `anthropic/claude-haiku-5-5`, Claude Code (Agent SDK 0.3.234) | FAIL | Twice (FIX-1957, FIX-1960 held out): both coder rows errored in a second, no worktree. The chief of staff's `dispatchTask` sent `input` as a JSON string, so the project source refused `no-project`. Filed FIX-1965 |
| 2026-10-13 | e15b2f0b (before the epic) via `GOAL_CHECKOUT` | same | FAIL (control, as required) | `key:set-on-settings` (no Settings), `a:completed` errored, `b:completed` never filed, `worktrees-in-checkout` 0, `a:title`, `a:linear-call` |
| 2026-10-14 | PR #3308 head fd84e4f3 (FIX-1965 fix, before merge) via `GOAL_CHECKOUT` | same, EM `openai/gpt-5.4-mini` | FAIL | Everything held but one: key set on Settings; FIX-1970 held out, a read it through Linear and answered its title, changing nothing; b committed its stamped file (`8fa4cbc5`); two worktrees of the checkout, both unsettled together, both completed. `b:no-demo-brief`: b's commit message carries `FEATURE-BRIEF-E61B8`, the DevTeam demo brief's marker. Filed FIX-1971 |
| 2026-10-14 | 209017ce (after FIX-1965, FIX-1966, FIX-1971) | same | FAIL (the check) | Every leg held, but `<leg>:no-demo-brief` read the branches against the checkout's local `main`, which was behind HEAD, so it counted main's own commits (FIX-1971's, which name the markers) as the run's. The check now reads against HEAD, the commit the runs' branches are cut from |
| 2026-10-14 | 209017ce + that fix | same | **PASS** | FIX-373 held out: key set on Settings; a answered its title after 2 `mcp__linear__` calls, committing nothing; b committed its stamped file (`bac69151`), no DevTeam marker or `greeting.js`; two worktrees of the checkout, unsettled together, both completed |
| 2026-10-14 | 209017ce | same | FAIL (control `no-linear`, as required) | `a:title`, `a:linear-call` (a parked on no Linear tool) |
| 2026-10-14 | 209017ce | same | FAIL (control `no-key`, as required) | `a:title`, `a:linear-call` (a parked on no key) |
| 2026-10-14 | 209017ce + PR #3367 review fixes | same | **PASS** | FIX-1973 held out. After the review round (store sidecars move with it and come back on any setup failure, no Linear key in the command's environment, branches read against every base the host can cut from, watching starts before a is asked, b's file is exactly the line, a commits nothing): same result as the row above |
| 2026-10-14 | 209017ce + PR #3367 review fixes | same | FAIL (control `no-key`, as required) | FIX-1990: `a:completed` (parked), `a:linear-call`, `a:title`, and nothing else |
