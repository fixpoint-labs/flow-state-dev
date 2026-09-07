---
sidebar_position: 8.5
sidebar_label: Cursor (SDK agent)
---

# Cursor SDK agent

`@flow-state-dev/cursor` — run Cursor's coding agent as a block. You hand it a
prompt, it works in a directory you point it at, and it hands back a handle
describing the run. What it says, what it runs, and what it changes show up in
your flow's item stream as it goes.

[Coding agents](./coding-agents.md) covers what the harnesses have in common:
the handle they all return, and the configuration contract underneath `cwd`,
`resume` and `onSession`. This page is the Cursor half.

## When to use it

Reach for this when you want coding work done by Cursor specifically, or when
you want a choice. A step that reads a handle rather than a vendor's own result
can run any of the harnesses, so switching is a configuration change rather than
a rewrite.

Cursor owns its own loop. flow-state-dev does not drive it step by step or
re-implement its tools. It runs the Cursor SDK, which starts Cursor's local
runtime, watches the run's message stream, and turns each thing that happens into
a canonical item.

## Installation

The SDK is an optional peer dependency, pinned to an exact version:

```bash
pnpm add @flow-state-dev/cursor @cursor/sdk@1.0.31
```

Cursor ships its local runtime as a platform-specific native binary and its
message wire can change between patch releases, so building a block against any
other installed version fails immediately, naming both versions. There is no
option to override it. The way to take a newer Cursor is a release of
`@flow-state-dev/cursor` that has been tested against it.

Building also fails if an SDK is installed but its version cannot be read, which
can happen under Yarn PnP or a custom loader.

The SDK brings its own runtime, so the Cursor editor is not required. At runtime
it needs an API key: set `CURSOR_API_KEY` and the SDK reads it itself, or pass
one on `agent.apiKey`.

## Quick start

A capability is a reusable bundle you attach to a block. Installing this one
lets a generator hand work to Cursor as a tool:

```ts
import { generator } from "@flow-state-dev/core";
import { createCursorAgentCapability } from "@flow-state-dev/cursor";

const planner = generator({
  name: "planner",
  // The generator's own model, as a flow-state-dev model id.
  model: "openai/gpt-5.4-mini",
  uses: [
    createCursorAgentCapability({
      cwd: async (ctx) => checkoutForThisRun(ctx),
      // Cursor's model, in Cursor's own ids.
      agent: { model: { id: "composer-2.5" } },
    }),
  ],
});
```

**Cursor needs a model.** Its SDK refuses to open a local agent without one, so
`agent.model` is not optional in practice. It takes `{ id }`, plus an optional
`params` list of `{ id, value }` pairs for whatever that model exposes.
`Cursor.models.list()` in the SDK enumerates what your account can select.

## As a sequencer step

```ts
import { sequencer } from "@flow-state-dev/core";
import { cursorAgent } from "@flow-state-dev/cursor";

const pipeline = sequencer({ name: "do-the-work" }).step(
  cursorAgent({
    cwd: (ctx) => workspacePathFor(ctx),
    resume: (ctx) => previousAgentIdFor(ctx),
    onSession: (id, ctx) => rememberAgentId(id, ctx),
    // Options passed straight to Cursor, in Cursor's own vocabulary — `model`
    // here is a Cursor model id, not a flow-state-dev one.
    agent: {
      model: { id: "composer-2.5" },
      mode: "agent",
      local: { sandboxOptions: { enabled: true } },
    },
  }),
  { abortSignal: () => AbortSignal.timeout(runTimeoutMs) },
);
```

The block's input is the prompt, and nothing else. Everything that decides where
a run writes or which conversation it continues is configuration. The same block
can be handed to a model as a tool, and a field on the input is a field the model
could set.

`agent` and `send` are Cursor's own option bags, forwarded as they are: `agent`
to the create-or-resume call, `send` to the prompt. Four keys are refused when
the block is built:

| Refused | Because |
|---|---|
| `agent.agentId` | `resume` decides which conversation a run continues. |
| `agent.local.cwd` | `cwd` decides where a run works. The rest of `local` is forwarded. |
| `agent.cloud`, `send.cloud` | Cursor's cloud agents are not supported here. |

## What it emits

| Cursor output | flow-state-dev item |
|---|---|
| Assistant text | `message` |
| Thinking | `reasoning` |
| Tool call | `tool_output`, opened when the call starts and settled with its result |
| Run and task lifecycle | transient `status` |
| Errors | `error` |

Every item carries provenance, so the devtool shows the full trace of what the
run did.

Output this package doesn't recognize becomes a status note rather than an
error, so unfamiliar output doesn't fail the run.

Token counts never reach the stream. They ride the handle.

Cursor's own `onStep` and `onDelta` observers are forwarded through `send`
untouched. The item stream is built from the run's messages rather than from
those callbacks, so taking both shows you the same run twice.

## Where the run works

`cwd` is a function you write. It is called once per run, before anything is
opened, and its answer becomes the directory the local agent works in. It is
handed the block context and never the prompt, for the reason
[Coding agents](./coding-agents.md#the-prompt-is-the-input-everything-else-is-configuration)
gives. Leave it out and the run works in the host process's own directory, which
is rarely what you want.

It is a working directory, not a fence: the run can still address paths outside
it. `local.sandboxOptions` on `agent` is the fence.

Deriving a safe directory per run is a recipe rather than a one-liner, and the
Claude Code page works one through in
[Reusing a directory across runs](./claude-code-sdk.md#reusing-a-directory-across-runs).
It applies here unchanged. If your work arrives as rows on a task board, the
[harness manager](/docs/orchestration/harness-manager) derives and provisions the
checkout for you.

## Continuing an agent

Cursor calls the durable conversation an *agent*, and each prompt you send is one
*run* inside it. `sessionId` on the handle is the agent id, not the run id, and
the agent id is what `resume` takes.

Continuing one is two halves, and you write both:

```ts
cursorAgent({
  resume: (ctx) => myState(ctx).cursorAgentId,     // read: null starts fresh
  onSession: (id, ctx) => myState(ctx).save(id),   // write: called mid-run
});
```

This package keeps no session state of its own. `resume` reads the agent id from
wherever you keep it, and `null`, `""` and `undefined` all mean "open a fresh
one". `onSession` is called with the id the moment the SDK opens the agent,
which is before the prompt is sent, so a run that is later cancelled is still
resumable. [Coding agents](./coding-agents.md#the-prompt-is-the-input-everything-else-is-configuration)
covers why the hook exists alongside the handle's own `sessionId`.

A resume Cursor refuses throws instead of opening an agent, so the id you already
hold is left exactly as it was rather than being overwritten with a dead one.

Keeping no session state also means the block declares none, which is what lets a
task board hand it off without any further option.

## How a run ends

The outcome comes from the run's terminal record, not from the messages on the
stream. Cursor's lifecycle messages arrive as status notes and nothing more, so
don't read the outcome off them.

`outcome` is `"finished"` or `"failed"`. Cursor reports no turn or budget cap, so
`"stopped-at-limit"` never appears here. A run Cursor reports as cancelled reads
`"failed"`, with the reason on `failureMessage`. A run your own deadline stopped
throws rather than returning a handle.

`status` follows `outcome`: `"completed"` on a finished run, `"errored"`
otherwise. A returned handle is always terminal, so `"running"` and
`"dispatched"` never appear on one.

## Usage and cost

The handle carries the two token counts every harness reports, plus Cursor's full
breakdown under `cursorUsage`: cache reads, cache writes, the total, and
reasoning tokens. Reasoning tokens are a subset of the output count and the total
already excludes them, so adding them yourself double-counts.

Cost is an estimate, derived from flow-state-dev's model price table, and
`cost.basis` always reads `"estimated"`. It is `null`, never `0`, when the model
is unknown, when the table has no priced row for it, or when the run reported no
usage.

In practice most Cursor runs report no cost. Cursor spells its model ids its own
way (`composer-2.5`, `claude-4.5-sonnet`) and the price table does not carry those
spellings, so no row matches and the field stays `null`. Read `cursorUsage` for
the raw counters when you want to price a run yourself.

Cursor's SDK exposes a dollar figure of its own on `agent.getUsage()`. For a local
agent it totals the whole agent rather than the one run you just watched, and it
is eventually consistent, so it is not what the handle reports.

## Errors

Every one of these is fatal for the run that raised it. Each class carries a
stable `code`, so a caller can branch on the failure without matching on a
message:

| Situation | What happens |
|---|---|
| Empty prompt | `CursorAgentRunError`, before anything is opened |
| SDK not installed | `CursorSdkNotInstalledError` on the first run, with an install hint |
| A different SDK version installed, or one whose version cannot be read | `CursorSdkVersionMismatchError` when the block is built |
| A refused key in `agent` or `send` | `CursorAgentConfigError` when the block is built |
| The SDK throws opening the agent, sending, or streaming | `CursorAgentRunError`, carrying what it said |
| Your signal fires | `CursorAgentAbortedError`, carrying the agent id on `sessionId` |

A run Cursor itself fails is not in that list. It comes back as a handle with
`status: "errored"` and `outcome: "failed"`, and Cursor's message on
`failureMessage`. Nothing here retries.

## Cancelling

Nothing to write. The block races your signal against Cursor's stream, asks the
runtime to stop, releases it, and throws. The agent id has already reached
`onSession` by then, and it is on the thrown error too, so the run can be
continued.

The deadline bounds Cursor, not what Cursor ran. A command Cursor started can
outlive the runtime being released. The sandbox setting is what bounds that class
of thing.

## Limitations

- One run per call. The block sends a prompt, watches the run to its end, and
  returns.
- Local agents only. A `cloud` bag on either option group is refused when the
  block is built.
- No images and no structured output.

## Related

- [Coding agents](./coding-agents.md) — the harness contract every agent implements
- [Codex SDK agent](./codex.md) — another harness, same handle
- [Claude Code SDK agent](./claude-code-sdk.md) — another harness, same handle
- [Harness manager](/docs/orchestration/harness-manager) — driving this one from a
  task board, with a checkout and a verdict
- [Background work](../server/background-work.md) — running one off the request
  path
