# shift-manager › a project's coding run reads its Linear

**Issue:** FIX-1905 (epic FIX-1903)

**Outcome:** A coding run on a project that names Linear can read the Linear issue it was given, through FSD's own connection, with the requester's key, however the work reached it; a run on a project that names none reaches no MCP server, and the key never reaches the run.

**Input:** A held-out Linear issue picked at run time from Linear's API, named by identifier only: one whose identifier and title neither this repository's HEAD nor the run's base mentions (`git grep -i -F`). The key is set through the Lab's key route (`POST /api/flows/mcp-credentials/linear`, the route Settings writes through) as the filing user, from `LINEAR_API_KEY`, with `LINEAR_MCP_API_KEY` unset in the Lab's process, so the stored path is what passes.

**Signal:** the `fsd` profile's Lab, opened in-process through `openLab` with the profile's tree, its projects and MCP servers (`fsd-projects.mts`) and Claude Code through its Agent SDK as the coder. The chief of staff files one task for the coder on FSD (`input.project`), whose goal names the issue's identifier and no title. While the run works, every process whose working directory is in the run's places is read from `/proc`. PASS when the task's answer (the run's final message, as its manager reports it) carries the title Linear's API gives, the run's items hold at least one `mcp__linear__` tool call, at least one process was read while it ran, and the key is in none of those processes' command lines or environments, the items, the request records, the sessions or the task.

**Anti-game:** No title in the prompt. No assertion on a resolver's output or a stub: the answer is Claude Code's, after a real call through FSD's connection to Linear. The server machine's own Claude Code MCP settings and its account's claude.ai connectors can't count: a run is handed exactly the project's servers (`strictMcpConfig`, connectors off), and the `no-linear` control is the run with FSD's servers cleared. Three departures from serving the profile, each because of the check, not the product: the runs' checkout is a scratch repository mapped as the profile maps this one (a check must not add worktrees to the checkout it runs in, as `fsd-checkout.test.ts` does), the chief of staff's model is scripted to file the one task (its judgment is not under test), and the check drops `LINEAR_API_KEY` from its own environment once it has read it, since the Lab runs in its process and a person's server holds the Settings key in its store, not its environment. The profile's start probe (`startHarness`) is skipped: a Claude Code login through the environment it runs in can work while the probe reports no account.

**Model:** real — Claude Code's own, through the Agent SDK. The chief of staff's is scripted.

**Run:** `pnpm tsx goals/shift-manager/a-projects-coding-run-reads-its-linear/run.mts`

Needs `LINEAR_API_KEY`, a Claude Code that can run (signed in, or `ANTHROPIC_API_KEY`), and `git`.

**Controls:** `GOAL_CONTROL=list` prints them. Each must FAIL on *the title*.

- `GOAL_CONTROL=no-linear` — FSD's servers cleared on the project with `setMcpServers []` before filing.
- `GOAL_CONTROL=no-key` — the filer's key cleared on the key route before filing.

Today's `main` has no `mcpServers` on a project and no key route, so the check can't be set up there; it fails at setup.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-13 | working tree on 3cc37915b (FIX-1905) | Claude Code (Agent SDK 0.3.234) | PASS | FIX-1951: the answer carried its title after one `mcp__linear__get_issue` call; one process read in the run's places; the key in none of its command line or environment, nor the items, requests, sessions or task |
| 2026-10-13 | working tree on 3cc37915b (FIX-1905) | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-linear`, expected) | FIX-1924: "the title" and "no mcp__linear__ tool call". The run said no Linear tool was connected. The `claude` process was read in the run's places |
| 2026-10-13 | working tree on 3cc37915b (FIX-1905) | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-key`, expected) | FIX-1897: "the title" and "no mcp__linear__ tool call"; the session said the owner's key for `linear` isn't set |
| 2026-10-14 | 209017ce + FIX-1919's goal commits | Claude Code (Agent SDK 0.3.234) | FAIL | FIX-1983 held out: the answer carried its title after one `mcp__linear__get_issue` call, but the key was in the environment of the harness manager's `git log` read in the run's place (FIX-1927). The check's own process held `LINEAR_API_KEY` and the host's children inherit it. Filed FIX-1991; the check now drops the key from its environment once read |
| 2026-10-14 | 209017ce + FIX-1991's fix | Claude Code (Agent SDK 0.3.234) | PASS | FIX-1948: the title after one `mcp__linear__get_issue` call; one process read in the run's places; the key in none of its command line or environment, nor the items, requests, sessions or task |
| 2026-10-14 | 209017ce + FIX-1919's goal commits | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-linear`, expected) | FIX-1983: "the title" and "no mcp__linear__ tool call" |
| 2026-10-14 | 209017ce + FIX-1919's goal commits | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-key`, expected) | FIX-1940: "the title" and "no mcp__linear__ tool call" |
