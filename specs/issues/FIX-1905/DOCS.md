# FIX-1905 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue owns the MCP rows of [the epic's ownership table](../../epics/FIX-1903/DOCS.md#ownership).
The prose below replaces the epic's illustrative draft of "Tools a project's coding work gets",
with the names pinned in [PLAN.md](PLAN.md#pinned-names). It departs from the epic's draft where
Jake's calls moved the design: the key is each person's own, set in Shift Manager rather than an
environment variable, and FSD holds the connection ([EVOLUTION.md](EVOLUTION.md)). Voice: no
"seamless" or "powerful", introduce MCP on first use, few em-dashes, "worker" for a team's agents
([ER-16](../../epics/FIX-1903/BUSINESS-RULES.md#what-no-child-may-do)).

## UPDATE · `apps/docs/docs/workforce/projects.md` · new `###` after "Coding work in a project"

> ### Tools a project's coding work gets
>
> A project can name MCP servers, and every coding run on the project can use their tools. MCP,
> the Model Context Protocol, is how an agent reaches a tool outside its checkout: an issue
> tracker, a docs search, a database. A run gets the project's servers however the work reached
> it: from a workstream, from the project's conversation, or from a task that names the project.
>
> Three parties each decide one thing. The server running your workers decides which MCP
> servers exist, and their addresses. A project picks from those names. Each person sets their
> own key for a server, and a run uses the key of the person it works for, so it acts in that
> tool as them.
>
> ```ts
> // the server's config, for example in a Shift Manager Lab
> mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } }
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
> `invalid-mcp-server`. A project row can't hold an address or a key.
>
> FSD holds the connection, not the coding agent. When a run starts, FSD connects to each of the
> project's servers with the requester's key, and the agent gets the servers' tools. It never
> gets the key or the address: not on its command line, in its environment, in its MCP config or
> in its session. The connections close when the run ends.
>
> A project that names no servers gets none: its runs don't pick up MCP servers from the server
> machine's own Claude Code settings, or the connectors of the Claude account it's signed in
> with. A list or a key changed while work is running applies from the next attempt.
>
> If the requester hasn't set a key for one of the project's servers, the run goes ahead without
> it, and its session says which key is missing. The same happens for a name the server stopped
> offering, and for a server FSD can't connect to.
>
> Keys are stored in the server's own store, as written. A run with a shell and no sandbox runs
> as the same operating-system user as the server, so it could read that store. Sandbox the run
> if that matters, and use a key scoped to what runs need.
>
> Only Claude Code runs get a project's servers today. A Codex or Cursor run on the same project
> works without them, and says so.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "Working on Shift Manager itself"

Replaces the two Linear sentences [the epic's shared draft](../../epics/FIX-1903/DOCS.md) places
after the coding agent's sentence:

> Open **Settings** and paste a Linear API key, and every coding run you ask for on either
> project can read and update Linear, as you. Each person sets their own. A run for someone who
> hasn't set one works without Linear and says so. For runs with nobody at the keyboard, such as
> a goal check or CI, `LINEAR_MCP_API_KEY` stands in for the Lab's own user until that user sets
> a key.

## NEW · `apps/docs/docs/shift-manager/settings.md` (`sidebar_label: Settings`)

> # Settings
>
> Settings is where you give the Lab your keys for the tools its coding runs can use. It lists
> each MCP server the Lab offers, such as Linear, and whether you've set a key for it, with the
> date you did.
>
> Paste a key to set it, paste another to replace it, or clear it. The page never shows a key
> back, not even its last characters, so keep your own copy if you need one. Your keys are
> yours: a run you ask for uses them, and nobody else's run does.
>
> A project turns a server on for its runs. Your key is what each of your runs uses on it. Both
> are needed: a key with no project naming the server does nothing, and a project naming it
> with no key from you gives your runs no access, said in each run's session.

## UPDATE · `packages/shift-manager/README.md`

The overview paragraph above, in the same place FIX-1904 puts it, and one line under the routes:
`/settings` · your keys for the Lab's MCP servers.

## UPDATE · `packages/claude-code/README.md` · "Controlling what a run reads and what it runs in"

Add `mcpTools` to the example's options, after `sandbox`:

> ```ts
>   // Tools this process serves to the run, grouped by server: a value, or a resolver per run.
>   mcpTools: async (ctx) => ({
>     tracker: { tools: await trackerToolsFor(ctx), close: async () => {} },
>   }),
> ```

and a paragraph after the one on `env`:

> **`mcpTools` gives the run tools your process serves.** Each entry becomes an MCP server inside
> your process, named by its key, and the run calls its tools as `mcp__tracker__…`. Each tool is
> a name, a description, a JSON Schema for its input and a `call` function. The run never sees
> where a tool's work happens or what credential it uses: the option can't carry an address or
> headers. Set it, even to `{}`, and it is the run's whole MCP set: no servers from settings
> files or your claude.ai connectors. The tools are allowed without asking; name one in
> `disallowedTools` to keep it out. A resolver gets the run's context only, like `cwd`. Each
> `close` is called when the run ends. Leave it unset and nothing changes.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "Configuring the run"

Add `mcpTools` to the example after `sandbox`, as in the README, and after it:

> `mcpTools` hands the run tools that run in your own process, presented to it as MCP servers.
> Set, it is the run's complete MCP set. A coding run on a Workforce project gets its project's
> servers this way; see
> [Tools a project's coding work gets](../workforce/projects.md#tools-a-projects-coding-work-gets).

## UPDATE · `packages/workforce/README.md` · Projects, and the API table

In Projects, after the `setRepository` bullet:

> - **`setMcpServers { project: { visibility, id }, mcpServers }`** replaces the project's list of
>   MCP server names; `[]` clears it. Members only. Refusals: `unknown-mcp-server`,
>   `invalid-mcp-server`. `createProject` takes the same `mcpServers`.

After the `projectWorkspace()` bullet:

> - **`projectMcpTools(servers, { operator })`** is a resolver for a coding harness's per-run
>   tools. It finds the run's project and owner the way `projectWorkspace()` does, connects to
>   each named server in `servers` (`{ [name]: { url, seedEnv? } }`) with the owner's stored key,
>   and answers in `claudeCodeAgent`'s `mcpTools` shape. `seedEnv` is read only for `operator`,
>   and only while that user has no stored key. A server without a key is skipped, and the run's
>   session says so.

API table: `defineProjectBlocks({ mcpServers? })` gains `setMcpServers`; new rows for
`projectMcpTools` and the `mcp-credentials` collection (client-readable: `setAt` only).

## UPDATE · `apps/docs/docs/tools/mcp.md`

One sentence where `createMcpManager` is introduced: the same manager is what a Workforce coding
run's tools are relayed through, with a link to the projects section.

## Not changed

`apps/docs/docs/orchestration/harness-manager.md`: the slot is unchanged.
