# FIX-1905 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. The epic's ER-5, ER-6, ER-7, ER-12 and ER-14 are
this issue's to build; these rows are how.

## What a project can say

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A project is created naming `mcpServers: ["linear"]` on a server that offers `linear` | The row stores `["linear"]` ([D1](DECISIONS.md#d1)) | CI |
| BR-2 | A create or `setMcpServers` names a server the host doesn't offer, or the host offers none | Refused, `unknown-mcp-server`, naming what the host offers (or that it offers none). Nothing is written | CI |
| BR-3 | A value is not a bare name: a URL, an object, a `$VAR`, an upper-case or spaced name | Refused, `invalid-mcp-server`. The refusal does not repeat a value that looks like a URL or a key | CI |
| BR-4 | A member calls `setMcpServers` with a list, or `[]` | The row's list is replaced whole; `[]` turns them off. Nothing else on the row changes | CI |
| BR-5 | A non-member calls `setMcpServers` | Refused, `not-a-member`, as `setRepository` is | CI |
| BR-6 | A row stored before this field existed is read | It names no servers. No migration ([ER-12](../../epics/FIX-1903/BUSINESS-RULES.md#what-no-child-may-do)) | CI, on a row written without the key |
| BR-7 | The same name is listed twice | Stored once | CI |

## What a run reaches

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A coding run starts on a project naming `linear`, on any of the three paths (its workstream, the project its conversation belongs to, the project its task names) | Claude Code is handed `linear` with the host's address and the key's value, read from the project the run's own session and task row name, never from a hand-over's payload | CI, model-free, one case per path · the goal check, on the task path |
| BR-9 | A run's project names no servers | The run reaches no MCP server, including any in the server machine's own Claude Code settings and any claude.ai account connector its sign-in carries. If one still connects, the run's session says so (BR-16) | CI, on the options handed to the SDK · the goal check's control · one real run signed in to an account with a connector |
| BR-10 | A run's project lookup refuses (no project, not a member) | The run is refused by its source as today, before any server is read | Existing suite |
| BR-11 | The project's list changes between two attempts of one row | The second attempt gets the new list | CI |
| BR-12 | A handed server's tools are called | They are allowed without asking (`mcp__<name>__*`); `disallowedTools` still blocks a named one | CI, on the allowed-tools list · the goal check's Linear call |
| BR-13 | DevTeam's Lab, or any host not given server config, runs Claude Code | Its runs get the same options as today: no MCP config, no strict flag | CI, options compared with `main`'s |

## When a server can't be had

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | The Lab starts with a server whose variable is unset | One line at start names the server and the variable, and that runs go on without it ([ER-7](../../epics/FIX-1903/BUSINESS-RULES.md#what-a-person-gets-and-what-they-dont)) | CI, on the start output |
| BR-15 | A run's project names a server whose variable is unset, or that the host no longer offers | The run gets its other servers, its session carries one notice naming what it is missing and why, and the run runs. A degraded run, not a pass | CI · the goal check run with the variable unset must FAIL its title |
| BR-16 | Claude Code reports a handed server as failed or needing sign-in when it starts, or lists a server it wasn't handed | The run's session carries a notice naming the server and its status | CI, on a scripted init message |
| BR-17 | The dev profile runs the scripted coder | The start line says the scripted coder uses no MCP servers | CI |

## Where the key goes

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A run is handed a server with a key | The value is not in the run's environment, a log line, a session item, the run record, or anything the page reads ([ER-6](../../epics/FIX-1903/BUSINESS-RULES.md#what-a-person-gets-and-what-they-dont)). It is in Claude Code's own process arguments ([D2](DECISIONS.md#d2)) | CI: a sentinel key value searched for in the env handed to the SDK, the captured logs, the session's items and the run row |
| BR-19 | A project row is read by any client | It shows the names. No address, variable or key exists on it to show | CI |

## The option, outside Workforce

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | `claudeCodeAgent` is built without `mcpServers` | The SDK call is the same as today, key for key | CI |
| BR-21 | `mcpServers` is a value | Every run gets it | CI |
| BR-22 | `mcpServers` is a resolver | It is called once per run, before the SDK call, with the run's context only | CI |
| BR-23 | The resolver answers `{}` | No server, and still none from settings files or the account (BR-9) | CI |

## Failure taxonomy

Nothing here is fatal to a run. A refused write is fatal to that write and names why. A missing
key, an unoffered name or a failed connection degrades the run to fewer servers and says so in
its session. Nothing retries a connection: Claude Code owns it. The one fatal case is a host
misconfigured at start (a malformed name or address in its own config), refused before the Lab
serves.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on the dev profile, a run filed through
the chief of staff with a Linear id only answers with that issue's title after a Linear tool
call, and the same run fails with FSD's servers cleared. Every row above has its CI check green,
and the closure ([FIX-1919](https://linear.app/fixpoint-labs/issue/FIX-1919)) consumes this.
