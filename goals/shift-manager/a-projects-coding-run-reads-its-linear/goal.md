# shift-manager › a project's coding run reads its Linear

**Issue:** FIX-1905 (epic FIX-1903)

**Outcome:** A coding run on a project that names Linear can read the Linear issue it was given, through FSD's own connection, with the requester's key, however the work reached it; a run on a project that names none reaches no MCP server, and the key never reaches the run.

**Input:** A held-out Linear issue picked at run time from Linear's API, named by identifier only: one whose identifier and title neither this repository's HEAD nor the run's base mentions (`git grep -i -F`). The key is set through the Lab's key route (`POST /api/flows/mcp-credentials/linear`, the route Settings writes through) as the filing user, from `LINEAR_API_KEY`, with `LINEAR_MCP_API_KEY` unset in the Lab's process, so the stored path is what passes.

**Signal:** the `fsd` profile's Lab, opened in-process through `openLab` with the profile's tree, its projects and MCP servers (`fsd-projects.mts`) and Claude Code through its Agent SDK as the coder. The chief of staff files one task for the coder on FSD (`input.project`), whose goal names the issue's identifier and no title. While the run works, every process whose working directory is in the run's places is read from `/proc`. The run's processes are Claude Code and everything it starts. The Lab's own processes there (the harness manager's `git` reads of the run's commits, started by the Lab and carrying the server's environment) are listed but not graded: the key is never handed to the run, and the server's own environment is not the run's ([FIX-1905 D2](../../../specs/issues/FIX-1905/DECISIONS.md)). PASS when the task's answer (the run's final message, as its manager reports it) carries the title Linear's API gives, the run's items hold at least one `mcp__linear__` tool call, at least one Claude Code process was read while it ran, and the key is in none of the run's processes' command lines or environments, the items, the request records, the sessions or the task.

**Anti-game:** No title in the prompt. No assertion on a resolver's output or a stub: the answer is Claude Code's, after a real call through FSD's connection to Linear. The server machine's own Claude Code MCP settings and its account's claude.ai connectors can't count: a run is handed exactly the project's servers (`strictMcpConfig`, connectors off), and the `no-linear` control is the run with FSD's servers cleared. Two departures from serving the profile, each because of the check, not the product: the runs' checkout is a scratch repository mapped as the profile maps this one (a check must not add worktrees to the checkout it runs in, as `fsd-checkout.test.ts` does), and the chief of staff's model is scripted to file the one task (its judgment is not under test). The coder's judge runs as the profile's does, on `typesafe-ai/jev` through the real resolver. The profile's start probe (`startHarness`) is skipped: a Claude Code login through the environment it runs in can work while the probe reports no account.

**Model:** real — Claude Code's own, through the Agent SDK, and the coder's judge on `typesafe-ai/jev` through the AI Gateway. The chief of staff's is scripted.

**Run:** `pnpm tsx goals/shift-manager/a-projects-coding-run-reads-its-linear/run.mts`

Needs `LINEAR_API_KEY`, `AI_GATEWAY_API_KEY` for the judge, a Claude Code that can run (signed in, or `ANTHROPIC_API_KEY`), and `git`.

**Controls:** `GOAL_CONTROL=list` prints them.

- `GOAL_CONTROL=no-linear` — FSD's servers cleared on the project with `setMcpServers []` before filing. Must FAIL on *the title*.
- `GOAL_CONTROL=no-key` — the filer's key cleared on the key route before filing. Must FAIL on *the title*.
- `GOAL_CONTROL=key-in-run` — the key handed to the run's environment, appended to `NO_PROXY` (a name the run is passed, so nothing else about the run changes). Must FAIL on *the key in a Claude Code process's environment*, which proves the narrowed process check still reads the run.

Today's `main` has no `mcpServers` on a project and no key route, so the check can't be set up there; it fails at setup.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-13 | working tree on 3cc37915b (FIX-1905) | Claude Code (Agent SDK 0.3.234) | PASS | FIX-1951: the answer carried its title after one `mcp__linear__get_issue` call; one process read in the run's places; the key in none of its command line or environment, nor the items, requests, sessions or task |
| 2026-10-13 | working tree on 3cc37915b (FIX-1905) | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-linear`, expected) | FIX-1924: "the title" and "no mcp__linear__ tool call". The run said no Linear tool was connected. The `claude` process was read in the run's places |
| 2026-10-13 | working tree on 3cc37915b (FIX-1905) | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-key`, expected) | FIX-1897: "the title" and "no mcp__linear__ tool call"; the session said the owner's key for `linear` isn't set |
| 2026-10-14 | 209017ce + FIX-1919's goal commits | Claude Code (Agent SDK 0.3.234) | FAIL | FIX-1983 held out: the answer carried its title after one `mcp__linear__get_issue` call, but the key was in the environment of the harness manager's `git log` read in the run's place (FIX-1927). The check's own process held `LINEAR_API_KEY` and the host's children inherit it. Filed FIX-1991. FIX-2002 since grades only the run's processes, so the check no longer drops the key |
| 2026-10-14 | 209017ce + FIX-1991's fix (dropping the key; superseded by FIX-2002) | Claude Code (Agent SDK 0.3.234) | PASS | FIX-1948: the title after one `mcp__linear__get_issue` call; one process read in the run's places; the key in none of its command line or environment, nor the items, requests, sessions or task |
| 2026-10-14 | 209017ce + FIX-1919's goal commits | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-linear`, expected) | FIX-1983: "the title" and "no mcp__linear__ tool call" |
| 2026-10-14 | 209017ce + FIX-1919's goal commits | Claude Code (Agent SDK 0.3.234) | FAIL (control `no-key`, expected) | FIX-1940: "the title" and "no mcp__linear__ tool call" |
| 2026-10-14 | working tree on e2ee2c18 (FIX-2002) | Claude Code (Agent SDK 0.3.234), Jev judge | PASS | FIX-1997: its title after one `mcp__linear__get_issue` call; one Claude Code process read, the key in none of its command line or environment. The judge resolved and gave its verdict |
| 2026-10-14 | working tree on e2ee2c18 (FIX-2002) | Claude Code (Agent SDK 0.3.234), Jev judge | FAIL (control `key-in-run`, expected) | "the key is in process 2622's environment", the Claude Code process; the title was read |
| 2026-10-14 | working tree on e2ee2c18 (FIX-2002) | Claude Code (Agent SDK 0.3.234), Jev judge | FAIL (control `no-key`, expected) | FIX-1944: "the title" and "no mcp__linear__ tool call" |
| 2026-10-14 | working tree on e2ee2c18 (FIX-2002) | Claude Code (Agent SDK 0.3.234), Jev judge | FAIL (control `no-linear`, expected) | FIX-1995: "the title" and "no mcp__linear__ tool call"; the run's shells and `bfs` children were read and graded as the run's |
