# FIX-1903 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story is written once here. Each child drafts its own specifics in its own `DOCS.md`.
The profile's name below, `fsd`, is a working name; FIX-1904 owns the final one. The coder
sentence assumes [Q1](DECISIONS.md#q1) goes as recommended and changes with it.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "Working on Shift Manager itself"

Replaces the section's first paragraph, which says `dev` runs the `devteam` profile.

> In this repository, `pnpm shift-manager:dev` opens the `fsd` profile: a Lab for working on
> this repository with Shift Manager itself. It has two projects from the start. **FSD** is the
> framework packages, and **Shift Manager** is this app. Both are shared with everyone in the
> Lab, and both point at this repository.
>
> Ask the chief of staff for work on either project, naming the Linear issue, for example
> "work FIX-1234 on Shift Manager". A coding agent picks it up in a fresh worktree of your
> checkout, on a branch of its own. Review it in that worktree, or from your checkout with
> `git diff main...<branch>`; the branch stays checked out in its worktree, so git won't check
> it out a second time in yours. Two items on the two projects run side by side, each in its own
> worktree.
>
> The coding agent is Claude Code. Sign in to Claude Code, or set `ANTHROPIC_API_KEY`, before
> you start; without either, the Lab refuses to start and says so. To run the scripted coder
> instead, which writes one file and costs nothing, set `DEVFORCE_LAB_HARNESS=stub`. Open
> **Settings** and paste a Linear API key, and every coding run you ask for on either project
> can read and update Linear, as you. Each person sets their own. A run for someone who hasn't
> set one works without Linear and says so. For runs with nobody at the keyboard, such as CI,
> `LINEAR_MCP_API_KEY` stands in for the Lab's own user until that user sets a key.
>
> `--dev` serves Shift Manager's pages from source, so a change to a screen shows as you save
> it. `start` runs the same profile on the built pages, and builds them first when they're
> older than their source. To open the `devteam` profile instead, pass its config:
> `pnpm --filter @flow-state-dev/shift-manager dev --config teams/devteam/fsdev.config.mts`.

## UPDATE · `apps/docs/docs/workforce/projects.md` · "A project's code and files"

A new subsection after "Coding work in a project".

> ### Tools a project's coding work gets
>
> A project can name MCP servers, and every coding run for the project gets their tools: a
> tracker, a docs search, anything the agent should reach while it works. The server running
> your workers decides which MCP servers exist: its config gives each one a name and its
> address. A project picks from those names:
>
> ```ts
> // the server's config
> mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } }
>
> // a project
> { id: "fsd", title: "FSD", repository: "https://github.com/acme/fsd.git", mcpServers: ["linear"] }
> ```
>
> A project can't name an address or a key, and a name the server doesn't know is refused when
> the project is saved. Each person sets their own key for a server, on Shift Manager's Settings
> page, and a run uses the key of the person it works for. The server holds the connection and
> hands the agent the tools, not the key or the address. A run without a sandbox runs as the same
> operating-system user as the server, so it could read the server's store.
> If the person has no key, the run goes ahead without the server, and its session says so.

The field and option names above are illustrative; FIX-1905's spec pins them. The review sentence in the first draft holds unless FIX-1906 detaches a settled run's branch, which is its choice.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| "Working on Shift Manager itself", above, and the same paragraph in `packages/shift-manager/README.md` | FIX-1904, Linear sentences added by FIX-1905 | This document |
| "The `devteam` profile" section: what it is for now (the goal Lab), and that it is opened with `--config` | FIX-1904 | Its `DOCS.md` |
| "Tools a project's coding work gets", above; the Claude Code harness's `mcpTools` option in `packages/claude-code/README.md`; the Settings page, in `apps/docs/docs/shift-manager/` | FIX-1905 | Its `DOCS.md` |
| A checkout on the host's machine: how a host maps a remote to it, where branches land, in `projects.md` and `packages/workspace/README.md` | FIX-1906 | Its `DOCS.md` |

Publish each specific with its implementation. The shared paragraph waits until the behaviour it
promises is on `main`; FIX-1904 publishes it without the Linear sentences, which FIX-1905
adds. No published page names an issue, and none says "seat".
