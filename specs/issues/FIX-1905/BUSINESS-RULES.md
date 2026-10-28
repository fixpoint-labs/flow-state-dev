# FIX-1905 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. The epic's ER-5, ER-6, ER-7, ER-12 and ER-14 are
this issue's to build, as amended by Jake's calls ([EVOLUTION.md](EVOLUTION.md)); these rows are how.

## What a project can say

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A project is created naming `mcpServers: ["linear"]` on a Lab that offers `linear` | The row stores `["linear"]` ([D1](DECISIONS.md#d1)) | CI |
| BR-2 | A create or `setMcpServers` names a server the Lab doesn't offer, or it offers none | Refused, `unknown-mcp-server`, naming what it offers (or that it offers none). Nothing is written | CI |
| BR-3 | A value is not a bare name: a URL, an object, a `$VAR`, an upper-case or spaced name | Refused, `invalid-mcp-server`. The refusal does not repeat a value that looks like a URL or a key | CI |
| BR-4 | A member calls `setMcpServers` with a list, or `[]` | The list is replaced whole; `[]` turns them off. Nothing else on the row changes | CI |
| BR-5 | A non-member calls `setMcpServers` | Refused, `not-a-member`, as `setRepository` is | CI |
| BR-6 | A row stored before this field existed is read | It names no servers. No migration ([ER-12](../../epics/FIX-1903/BUSINESS-RULES.md#what-no-child-may-do)) | CI, on a row written without the key |
| BR-7 | The same name is listed twice | Stored once | CI |

## What a person can set

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | Any signed-in user sets a key for a server the Lab offers | It is stored for that user only, replacing any earlier one. No role is checked: each user sets their own ([D4](DECISIONS.md#d4)) | CI |
| BR-9 | A user reads Settings | Each offered server, with *set* and when, or *not set*, for that user alone. No read path, page, client field or response anywhere returns a value or part of one | CI, on every client read of the record · V-page |
| BR-10 | A user clears a key, or sets one for a server the Lab doesn't offer, or sends an empty value or one with whitespace | Clear removes it. The others are refused (`unknown-mcp-server`, `invalid-mcp-credential`), without echoing the value | CI |
| BR-11 | A key is set | The value is not in the request record, the active-request record, a trace, an emitted item, a log line, or the response ([D4](DECISIONS.md#d4)) | CI: a sentinel value searched for in each after a write. **Plant** it in one once and see the check fail |

## What a run reaches

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A run's project names no servers | The run reaches no MCP server, including any in the machine's own Claude Code settings and any claude.ai account connector. If one still connects, the session says so | CI, on the options handed to the SDK · the goal check's control · one real run on a signed-in account with a connector |
| BR-13 | A coding run starts on a project naming `linear`, on any of the three paths (workstream, the conversation's project, the task's project), and its owner has a key | FSD connects to the host's address with the owner's key; Claude Code receives `linear`'s tools as an in-process server. The project and the owner come from the run's session and held task row, never a hand-over's payload | CI, model-free, one case per path · the goal check |
| BR-14 | Whose key | The run's owner: the user its session belongs to, as harness-manager records it. An Inbox approval by another member does not change it | CI, two users with different keys |
| BR-15 | The run's lookup refuses (no project, not a member) | The run is refused by its source as today, before any key is read | Existing suite |
| BR-16 | The list or the owner's key changes between two attempts | The second attempt gets the new ones | CI |
| BR-17 | A relayed tool is called | It is allowed without asking; `disallowedTools` still blocks one. The call reaches the server through FSD's connection, and its result returns to the run | CI, scripted server · the goal's Linear call |
| BR-18 | The run ends, completes, fails or is aborted | Its connections are closed | CI |
| BR-19 | DevTeam's Lab, or any host not given server config, runs Claude Code | The same SDK options as today: no MCP servers, no strict flag | CI, options compared with `main`'s |

## When a server can't be had

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | The Lab starts with servers configured | One line names them, and says whether the operator identity has a key, stored or seeded ([ER-7](../../epics/FIX-1903/BUSINESS-RULES.md#what-a-person-gets-and-what-they-dont), amended) | CI, on the start output |
| BR-21 | A run's owner has no key for a named server | The run gets its other servers; its session says which is missing and that Settings is where to set it. A degraded run, not a pass | CI · the goal's `no-key` control must FAIL its title |
| BR-22 | The run's owner is the Lab's operator identity, with no stored key, and `seedEnv`'s variable is set | The seed is the key. For any other user it is never used | CI, operator and non-operator |
| BR-23 | A named server is no longer offered, or FSD's connection to it fails or is refused | The run goes on without it, and its session names the server and why, never its address, headers or key | CI, on a scripted failure |
| BR-24 | The run uses a harness that takes no relayed tools (Cursor, Codex, the scripted coder) on a project naming servers | Its session says it runs without them ([D3](DECISIONS.md#d3)) | CI |

## Where the key goes

| # | When | Then | Proved by |
|---|---|---|---|
| BR-25 | A run is relayed a server | The key is not in the Claude Code process's command line, environment, MCP config, the session's items, the run record, a log line or anything the page reads ([D2](DECISIONS.md#d2)) | CI: a sentinel key searched for in the SDK options, the env, logs, items and run row · the goal check, on the live process |
| BR-26 | A project row is read by any client | It shows the names. No address, variable or key exists on it | CI |

## The option, outside Workforce

| # | When | Then | Proved by |
|---|---|---|---|
| BR-27 | `claudeCodeAgent` is built without `mcpTools` | The SDK call is the same as today, key for key | CI |
| BR-28 | `mcpTools` is a value, or a resolver | A value: every run gets it. A resolver: called once per run, before the SDK call, with the run's context only. `{}`: no server, and still none from settings or the account | CI |

## Failure taxonomy

Nothing here is fatal to a run. A refused write is fatal to that write and names why. A missing
key, an unoffered name or a failed connection degrades the run to fewer servers and says so in
its session. Nothing retries a connection inside a run; the next attempt reconnects. The one
fatal case is a host misconfigured at start (a malformed name or address), refused before the
Lab serves.

**What the key promise is, and isn't.** The key is never *handed* to the run. An unsandboxed run
runs as the Lab's own OS user, so its shell could still read the Lab's store, files or process.
The docs say so; sandboxing the run is what closes that.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on the dev profile, with the filer's key
set on Settings, a run filed through the chief of staff with a Linear id only answers with that
issue's title after a Linear tool call, with the key absent from its process; the same run fails
with FSD's servers cleared and with the key cleared. Every row above has its CI check green, and
the closure ([FIX-1919](https://linear.app/fixpoint-labs/issue/FIX-1919)) consumes this.
