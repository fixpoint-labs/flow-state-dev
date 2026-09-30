# FIX-1174 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Published prose follows `docs/contributing/user-docs.md`: no issue or PR numbers, and no story of
what the package used to do. Unchanged sections are not repeated here.

## REMOVE · `apps/docs/docs/tools/claude-code-cli.md`

Delete the page. Remove `"tools/claude-code-cli"` from the Tools category in
`apps/docs/sidebars.ts`. Add to the `@docusaurus/plugin-client-redirects` list in
`apps/docs/docusaurus.config.ts`, with the existing comment above the list extended by one
clause ("the Claude Code remote dispatch page was removed; its address points at the SDK agent"):

```ts
{
  from: "/docs/tools/claude-code-cli",
  to: "/docs/tools/claude-code-sdk",
},
```

## UPDATE · `apps/docs/docs/tools/overview.md` · the tools list

Delete the bullet `[Claude Code remote dispatch](/docs/tools/claude-code-cli) — …`. The SDK agent
bullet below it stays as written.

## UPDATE · `apps/docs/docs/cli/overview.md` · after "Engine setup and Deployment"

Delete the paragraph beginning "This page is about running *your own* flows locally." Nothing
replaces it: without a cloud-dispatch feature there is nothing to disambiguate.

## UPDATE · `apps/docs/docs/tools/coding-agents.md` · "Not every dispatch is a harness"

Delete the section, heading included. Every coding agent the site now documents is a harness.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · intro and Related

Replace the paragraph "This is the companion to [Claude Code remote dispatch]…" with nothing; the
paragraph after it ("It is one of two harnesses…") already orients the reader. In *Related*,
delete the bullet `[Claude Code remote dispatch](./claude-code-cli.md) — the fire-and-forget cloud
alternative`.

## UPDATE · `packages/claude-code/README.md`

**Intro** — replace the first two paragraphs with:

> Claude Code integration for flow-state-dev. The `/sdk` entry runs a Claude Code agent
> in-process and streams its work through the flow's item stream, backed by the optional
> `@anthropic-ai/claude-agent-sdk` peer dependency.
>
> It is a **harness**: a coding agent driven as a block, returning the neutral run handle declared
> in `@flow-state-dev/core`. [`@flow-state-dev/codex`](../codex) is another, and
> [`@flow-state-dev/harness-manager`](../harness-manager) drives either from a task board.
>
> The `/cli` entry exports a small resolver seam for hosts that run the local `claude` binary
> themselves: `defaultResolveClaudeCli`, `defaultClaudeCliExec`, and their types. A resolver
> supplies the binary path, working directory, environment and the function that runs it, so the
> subprocess stays host-controlled and mockable.

**Installation** — drop the sentence about the Claude Code CLI and claude.ai subscription auth;
keep the `pnpm add` line and point at *Quick start (SDK)* for the peer.

**Remove** — *Quick start* (CLI), *How it works (CLI)*, *Trust model* and its *Dispatching
`--remote` needs a TTY* subsection (the resolver sentence moves into the intro above), the remote
handle block at the top of *Session state*, *Limitations*, and *Choosing `/cli` or `/sdk`*. The
SDK subsections now under *Session state* (background work, working directory, containment,
recording, resources) keep their text; give them a parent heading that says what they are, and
move *Quick start (SDK)* ahead of them so the file opens on the working example.

**Documentation line** — delete the `Claude Code remote dispatch` link.

## UPDATE · `packages/claude-code/package.json` · `description`

> Claude Code integration for flow-state-dev: run a Claude Code agent in-process as a block.

## UPDATE · `CLAUDE.md` · package map row

> `@flow-state-dev/claude-code` | Claude Code integration — run a Claude Code agent in-process as a harness block (Agent SDK)

## CREATE · `.changeset/<name>.md`

```md
---
"@flow-state-dev/claude-code": minor
---

Remove the experimental `claude --remote` dispatch path from `@flow-state-dev/claude-code/cli`.
These exports are gone: `claudeRemoteDispatch`, `ClaudeRemoteDispatchOptions`,
`claudeRemoteTasksSchema`, `CLAUDE_REMOTE_TASKS_KEY`, `createClaudeCliCapability`,
`CreateClaudeCliCapabilityOptions`, `scriptPtyClaudeCliExec`, `resolvePtyClaudeCli`, `stripAnsi`,
`parseRemoteDispatchOutput`, `ParsedRemoteDispatch`, `CLAUDE_CLI_REMOTE_SOURCE`,
`claudeRemoteHandleSchema`, `ClaudeRemoteHandle`, `ClaudeCliNotFoundError` and
`ClaudeRemoteDispatchError`. Handles already written to `claudeRemoteTasks` in session state are
no longer read by anything in this package.

There is no drop-in replacement. The nearest alternative is `claudeCodeAgent` from
`@flow-state-dev/claude-code/sdk`, which runs the agent in-process and streams its work instead of
handing it to a cloud session. The `/cli` resolver seam (`defaultResolveClaudeCli`,
`defaultClaudeCliExec` and their types) is unchanged.
```

## No other impact

No guide, blog post or architecture doc names the path (the reference scan reads every tracked
file). Changelogs and archived changesets keep their history.
