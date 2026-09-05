---
sidebar_position: 7
sidebar_label: Codex (SDK agent)
---

# Codex SDK agent

`@flow-state-dev/codex` — run OpenAI's Codex agent as a block. You hand it a
prompt, it works in a directory you point it at, and it hands back a handle
describing the run. What it says, what it runs, and what it changes show up in
your flow's item stream as it goes.

A *harness* is a coding agent driven as a block like this. flow-state-dev ships
two, and they agree on the handle they return: the same `status`, `outcome`,
`sessionId`, `usage` and `cost` fields, whichever one ran. The companion page is
[Claude Code SDK agent](./claude-code-sdk.md).

## When to use it

Reach for this when you want coding work done by Codex specifically, or when you
want a choice. A step that reads a handle rather than a vendor's own result can
run either harness, so switching is a configuration change rather than a rewrite.

Codex owns its own loop. flow-state-dev does not drive it step by step or
re-implement its tools. It runs the
[Codex SDK](https://developers.openai.com/codex/sdk), which spawns the Codex CLI
in a subprocess, watches the stream, and turns each thing that happens into a
canonical item.

One honest difference from the Claude Code page: Codex reports how many tokens a
turn used but never what they cost, so the cost on the handle is an estimate we
derive. The handle says so.

## Installation

The SDK is an optional peer dependency, pinned to an exact version:

```bash
pnpm add @flow-state-dev/codex @openai/codex-sdk@0.152.1
```

The pin is enforced, not advisory. Codex's JSONL output sits behind the CLI's
`--experimental-json` flag and can change in a lockstep CLI and SDK release, so
building a block against any other installed version fails immediately, naming
both versions. There is no option to override it. The way to take a newer Codex
is a release of `@flow-state-dev/codex` that has been tested against it.

Building also fails if an SDK is installed but its version cannot be read, which
can happen under Yarn PnP or a custom loader. A gate that guessed in that case
would be no gate at all. Point `resolveCodexClient` at your own client if you
need to run in a layout the check cannot see.

The SDK brings the `codex` binary with it, so there is no separate CLI to
install. At runtime it needs either `CODEX_API_KEY` in the environment or a
logged-in Codex account. It also expects to work inside a git repository; pass
`skipGitRepoCheck` if you mean not to.

## Quick start

A capability is a reusable bundle you attach to a block. Installing this one lets
a generator hand work to Codex as a tool:

```ts
import { generator } from "@flow-state-dev/core";
import { createCodexAgentCapability } from "@flow-state-dev/codex";

const planner = generator({
  name: "planner",
  model: "openai/gpt-5.4-mini",
  uses: [createCodexAgentCapability({ cwd: async () => checkoutForThisRun() })],
});
```

## As a sequencer step

```ts
import { sequencer } from "@flow-state-dev/core";
import { codexAgent } from "@flow-state-dev/codex";

const pipeline = sequencer({ name: "do-the-work" }).step(
  codexAgent({
    cwd: (ctx) => workspacePathFor(ctx),
    resume: (ctx) => previousSessionIdFor(ctx),
    onSession: (id, ctx) => rememberSessionId(id, ctx),
    thread: { model: "gpt-5.4-codex", sandboxMode: "workspace-write", approvalPolicy: "never" },
  }),
  { abortSignal: () => AbortSignal.timeout(runTimeoutMs) },
);
```

The block's input is the prompt, and nothing else. Everything that decides where
a run writes or which conversation it continues is configuration, for a reason
worth stating: the same block can be handed to a model as a tool, so a field on
the input is a field the model could set.

## What it emits

| Codex output | flow-state-dev item |
|---|---|
| Agent message | `message` |
| Reasoning summary | `reasoning` |
| Shell command and its result | `tool_output`, opened when the command starts and settled with its exit code |
| File change | `tool_output` naming each path and whether it was added, updated or deleted |
| MCP tool call | `tool_output`, named `mcp:<server>/<tool>` |
| Web search, to-do list | `tool_output` |
| Thread and turn lifecycle | transient `status` |
| Errors | `error` |

Every item carries provenance, so the devtool shows the full trace of what the
run did.

Anything Codex emits that this version does not recognise becomes a status note
rather than an error. The output format is experimental, and a run should degrade
before it breaks.

## Where the run works

`cwd` is a function you write. It is called once per run, before anything is
spawned, and its answer becomes the directory Codex works in.

It is handed the block context and nothing else. The prompt is not available to
it, deliberately: the prompt is the one thing a model controls, so a directory
derived from it would be a path the model chose.

It is a working directory, not a fence: the run can still address paths outside
it. The sandbox setting is the fence. The Claude Code page's
[Where the run works](./claude-code-sdk.md#where-the-run-works) section derives a
safe path for a run and applies here unchanged.

## Continuing a thread

Codex calls a conversation a thread. Continuing one is two halves, and you write
both:

```ts
codexAgent({
  resume: (ctx) => myState(ctx).codexThreadId,   // read: null starts fresh
  onSession: (id, ctx) => myState(ctx).save(id),         // write: called mid-run
});
```

This package keeps no session state of its own. `resume` reads the thread id from
wherever you keep it, and `onSession` is called with the id the moment the run
names it, which is before the run does any work.

That ordering is the point. A run that is cancelled or dies partway through
returns no handle at all, so a host that only learned the thread id from the
returned handle would have nothing to continue. Because `onSession` fires during
the run, the conversation is still resumable.

`onSession` fires only when Codex actually names a thread. If you resume an id
Codex no longer has, it names none, the run fails, and the id you already hold is
left exactly as it was rather than being overwritten with a dead one.

## Cancelling

Nothing to write. The block forwards its own signal into the turn, and a fired
deadline throws rather than returning a handle. The thread id has already reached
`onSession` by then, so the run can be continued.

One limitation to know about: the deadline bounds Codex, not what Codex ran. A
command Codex started can outlive the process being killed. The sandbox setting
is what bounds that class of thing.

## Usage and cost

A completed turn reports token usage. The handle carries the two counts every
harness reports, plus Codex's full breakdown — cached input, cache writes and
reasoning output — under `codexUsage`.

Cost is an estimate, derived from flow-state-dev's model price table, and
`cost.basis` always reads `"estimated"`. It is absent rather than zero in three
cases:

- No model was configured, so the run used Codex's default. Nothing in the output
  names the model that ran, so there is nothing to price.
- The price table has no entry for the model. One patch release teaches it.
- The turn never completed, so there is no usage.

`null` means nobody knows what the run cost. It never means the run was free.

## Errors

Every one of these is fatal for the run that raised it:

| Situation | What happens |
|---|---|
| Empty prompt | Throws before anything is spawned |
| SDK not installed | Throws on the first run, with an install hint |
| A different SDK version installed, or one whose version cannot be read | Throws when the block is built |
| A working directory or a signal in `thread` or `client` | Throws when the block is built |
| The CLI exits non-zero | Throws, carrying its stderr |
| The deadline fires | Throws |

A turn the model itself fails is not in that list. It comes back as a handle with
`status: "errored"` and `outcome: "failed"`, and Codex's message on
`failureMessage`. Nothing here retries.

## Limitations

- One turn per call. The block runs a turn and returns.
- No images and no structured output.
- No approval prompts. A headless run is configured not to ask, so the sandbox
  and approval policy you set are the whole of the permission story.
- The `env` option on `client` replaces the CLI process's environment rather than
  adding to it. Spread `process.env` if you meant to add.

## Related

- [Claude Code SDK agent](./claude-code-sdk.md) — the other harness, same handle
- [Background work](../server/background-work.md) — running either one off the
  request path
