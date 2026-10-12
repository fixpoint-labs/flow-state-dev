# FIX-1905 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue owns the MCP rows of [the epic's ownership table](../../epics/FIX-1903/DOCS.md#ownership).
The prose below replaces the epic's illustrative draft of "Tools a project's coding work gets",
with the names pinned in [PLAN.md](PLAN.md#pinned-names) and one correction: the epic's draft
said the agent's shell never sees the key. It can, in Claude Code's own process arguments
([D2](DECISIONS.md#d2)), so the page says what is actually promised. Voice: no "seamless" or
"powerful", introduce MCP on first use, few em-dashes, and "worker" for a team's agents ([ER-16](../../epics/FIX-1903/BUSINESS-RULES.md#what-no-child-may-do)).

## UPDATE · `apps/docs/docs/workforce/projects.md` · new `###` after "Coding work in a project"

> ### Tools a project's coding work gets
>
> A project can name MCP servers, and every coding run on the project gets them. MCP, the Model
> Context Protocol, is how an agent reaches a tool outside its checkout: an issue tracker, a docs
> search, a database. A run gets the project's servers however the work reached it: from a
> workstream, from the project's conversation, or from a task that names the project.
>
> The server running your workers decides which MCP servers exist. Its config gives each one a
> name, an address, and the environment variable that holds its credential. A project picks from
> those names, and only those:
>
> ```ts
> // the server's config, for example in a Shift Manager Lab
> mcpServers: { linear: { url: "https://mcp.linear.app/mcp", credentialEnv: "LINEAR_MCP_API_KEY" } }
>
> // a project, at create
> { id: "fsd", title: "FSD", repository: "https://github.com/acme/fsd.git", mcpServers: ["linear"] }
>
> // later, from a member's session; [] turns them all off
> { project: { visibility: "shared", id: "fsd" }, mcpServers: ["linear"] }
> ```
>
> `setMcpServers` replaces the list whole and returns `{ project }`. Only members can call it.
> Both writes refuse a name the server doesn't offer with `unknown-mcp-server`, naming the ones
> it does, and anything that isn't a plain name (lowercase letters, digits and hyphens) with
> `invalid-mcp-server`. A project row can't hold an address, a variable name or a credential.
>
> Any member can turn a server on for the whole project. Every coding run on it then acts in
> that tool as whoever owns the server's credential, so only offer a server whose credential
> you'd let every project member use.
>
> A project that names no servers gets none: its runs don't pick up MCP servers from the
> server machine's own Claude Code settings, or the connectors of the Claude account it's signed
> in with, either. A list changed while work is running applies
> from the next attempt.
>
> If a server's variable isn't set, the server says so once when it starts, and each run that
> misses it says so in its session. The run still goes ahead without that server. The same
> happens for a name the server has stopped offering, and for a server Claude Code can't connect
> to or needs a sign-in for.
>
> The credential isn't put in the run's environment, its logs, its session or the run's record.
> It is handed to the Claude Code process that holds the MCP connection, so a run with a shell
> and no sandbox can still find it there, as it can find anything else the server's own user can
> read. Give the server a credential scoped to what the runs need.
>
> To wire this yourself, give the projects' writes the names your server offers, and hand Claude
> Code the run's servers in your harness:
>
> ```ts
> import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
> import { harnessManager } from "@flow-state-dev/harness-manager";
> import { defineProjectBlocks, projectMcpServers, projectWorkspaceCapability } from "@flow-state-dev/workforce";
>
> const servers = { linear: { url: "https://mcp.linear.app/mcp", credentialEnv: "LINEAR_MCP_API_KEY" } };
> const projects = defineProjectBlocks({ mcpServers: Object.keys(servers) });
>
> harnessManager({
>   // ...the workspace and board, as above
>   harness: (feeds) =>
>     claudeCodeAgent({
>       ...feeds,
>       detached: true,
>       mcpServers: projectMcpServers(servers),
>       uses: [projectWorkspaceCapability],
>     }),
>   uses: [projectWorkspaceCapability],
> });
> ```
>
> Only Claude Code runs get a project's servers today. A Codex or Cursor run on the same project
> works without them.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "Working on Shift Manager itself"

Two sentences added to the paragraph FIX-1904 publishes, after the coding agent's sentence, as
[the epic's shared draft](../../epics/FIX-1903/DOCS.md) places them:

> Set `LINEAR_MCP_API_KEY` to a Linear API key and every coding run on either project can read
> and update Linear, as the key's owner. Without it the Lab starts, says Linear is off, and runs
> work without it.

## UPDATE · `packages/shift-manager/README.md` · the same paragraph

The same two sentences, in the same place FIX-1904 puts the paragraph.

## UPDATE · `packages/claude-code/README.md` · "Controlling what a run reads and what it runs in"

Add `mcpServers` to the example's options, after `sandbox`:

> ```ts
>   // The run's MCP servers, exactly: a value, or a resolver read once per run.
>   mcpServers: async (ctx) => ({
>     tracker: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: `Bearer ${await tokenFor(ctx)}` } },
>   }),
> ```

and a paragraph after the one on `env`:

> **`mcpServers` is the run's whole MCP set.** Set it, even to `{}`, and the run uses those
> servers and none from settings files or your claude.ai connectors, so a server in your own
> `~/.claude.json` doesn't leak into a run you configured. Each server's tools are allowed without asking; name one in
> `disallowedTools` to keep it out. A resolver is handed the run's context only, like `cwd`, so
> a server can't be chosen by whatever the caller sent. The config goes to the Claude Code
> process as its own MCP config, outside the run's `env`; a run with a shell can still read that
> process's arguments. If Claude Code reports a server as failed or needing sign-in when it
> starts, the run's session says so. Leave it unset and nothing changes.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "Configuring the run"

Add `mcpServers` to the example after `sandbox`, as in the README, and this after the example:

> `mcpServers` gives the run MCP servers: tools outside its checkout, such as an issue tracker.
> It takes the same shape the Agent SDK does, keyed by the name the tools are prefixed with
> (`mcp__tracker__…`). Set, it is the run's complete set: settings files and claude.ai connectors add none. A coding run
> on a Workforce project can take its project's servers this way; see
> [Tools a project's coding work gets](../workforce/projects.md#tools-a-projects-coding-work-gets).

## UPDATE · `packages/workforce/README.md` · Projects, and the API table

In Projects, after the `setRepository` bullet:

> - **`setMcpServers { project: { visibility, id }, mcpServers }`** replaces the project's list of
>   MCP server names; `[]` clears it. Members only. A name the host doesn't offer is refused with
>   `unknown-mcp-server`, a value that isn't a plain name with `invalid-mcp-server`.
>   `createProject` takes the same `mcpServers`.

After the `projectWorkspace()` bullet:

> - **`projectMcpServers(servers)`** is a resolver for a coding harness's per-run MCP servers.
>   It finds the run's project the way `projectWorkspace()` does, and joins each name on it to
>   `servers` (`{ [name]: { url, credentialEnv, transport? } }`), reading the credential from the
>   environment. A name with no entry or no value is skipped, and the run's session says so.
>   The harness block must hold `projectWorkspaceCapability`.

API table: `defineProjectBlocks({ mcpServers? })` gains `setMcpServers` and the option (the
names the host offers; none when omitted). A new row for `projectMcpServers(servers)`.

## Not changed

`apps/docs/docs/tools/mcp.md` describes MCP for FSD's own generators, a separate path; a
coding run's MCP client is Claude Code's. `apps/docs/docs/orchestration/harness-manager.md`: the
slot is unchanged.
