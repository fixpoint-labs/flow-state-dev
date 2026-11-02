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
pnpm add @flow-state-dev/cursor @cursor/sdk@1.0.40
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
  model: "openai/gpt-6-luna",
  uses: [
    createCursorAgentCapability({
      cwd: async (ctx) => checkoutForThisRun(ctx),
      // Cursor's model, in Cursor's own ids.
      model: "composer-2.5",
    }),
  ],
});
```

**Cursor needs a model.** Its SDK refuses to open a local agent without one, so
name one with `model`. It takes an id, a model with its settings
(`{ id, params: [{ id, value }] }`, Cursor's own parameter list, such as a
reasoning effort), or a resolver returning either, asked once per run. The result
goes to the agent on create and on resume alike, so a resolver that reads the
session can run a different model and settings for each one.
`Cursor.models.list()` in the SDK enumerates what your account can select.

A resolver that returns `null`, `undefined` or an empty id names no model. With no
model named from `model` or `agent.model`, Cursor's SDK refuses to open the agent
and the run fails. `agent.model` also takes `{ id, params }`, is the model when
`model` is unset, and is one value for every run. `model` beside `agent.model` or `send.model` throws
when the block is built; `agent` and `send` are Cursor's own option bags, described
under [As a sequencer step](#as-a-sequencer-step).

## As a sequencer step

```ts
import { sequencer } from "@flow-state-dev/core";
import { cursorAgent } from "@flow-state-dev/cursor";

const pipeline = sequencer({ name: "do-the-work" }).step(
  cursorAgent({
    cwd: (ctx) => workspacePathFor(ctx),
    resume: (ctx) => previousAgentIdFor(ctx),
    onSession: (id, ctx) => rememberAgentId(id, ctx),
    // A Cursor model id, not a flow-state-dev one, read per run. A resumed agent gets it too.
    model: (ctx) => modelPickedFor(ctx),
    // Options passed straight to Cursor, in Cursor's own vocabulary.
    agent: {
      mode: "agent",
      local: { sandboxOptions: { enabled: true } },
    },
  }),
  { abortSignal: () => AbortSignal.timeout(runTimeoutMs) },
);
```

The block's input is the prompt, and nothing else. Everything that decides where
a run writes, which conversation it continues or which model it runs is configuration. The same block
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
| `agent.model`, `send.model` beside `model` | Each names the model a run uses; keep one. |

## What it emits

| Cursor output | flow-state-dev item |
|---|---|
| Assistant text | `message` |
| Thinking | `reasoning` |
| Tool call | `tool_output`, opened when the call starts and settled with its result |
| A change to Cursor's to-do list | `tool_output`, like any tool call. With `recordPlan`, also rows in the run's plan record ([Recording the run's plan](#recording-the-runs-plan)) |
| Run and task lifecycle | transient `status` |
| Run end | `status`, kept in the session's history, saying how long the run took: `Cursor run completed in 5 mins, 24 seconds.` A run that fails ends with a kept status that says it errored and why, `Cursor run errored (<reason>).` |
| Errors | `error` |

Every item carries provenance, so the devtool shows the full trace of what the
run did.

Output this package doesn't recognize becomes a status note rather than an
error, so unfamiliar output doesn't fail the run.

Token counts never reach the stream. They ride the handle.

Cursor's own `onStep` and `onDelta` observers are forwarded through `send`
untouched. The item stream is built from the run's messages rather than from
those callbacks, so taking both shows you the same run twice. With `env` set
they can't be passed, because the runtime runs in another process
([Choosing the environment the run starts with](#choosing-the-environment-the-run-starts-with)).

## Recording the run's plan

Cursor keeps a to-do list while it works, and updates it as it goes. Turn on `recordPlan` and
the block records that list in the run's plan record, the `observed-plan` collection every
harness writes in the same shape ([the run's plan](./coding-agents.md#the-runs-plan)):

```ts
cursorAgent({
  cwd, resume, onSession,
  recordPlan: true,
});
```

Each row is one to-do item: its wording (`title`) and Cursor's own word for its status
(`status`): `pending`, `inProgress`, `completed` or `cancelled`. Read the status as text. A
later Cursor may add a word.

The record always holds the whole list as Cursor last confirmed it. An update Cursor sends can
change only part of the list, so the block writes nothing until Cursor answers with the list as
it now stands. An update Cursor rejects changes nothing. You still see every update as a tool
call in the stream. The block writes through core's `replacePlanList`, the same helper every
harness whose plan arrives as a whole list uses, so the plan's list marker
(`observed-plan-list`) says whether that list was saved in full.

The plan belongs to the Cursor agent, which is the conversation every turn of a session
continues. Rows and their marker are keyed under `conversation/<agent id>`, so a later run of
the same agent updates the list an earlier run recorded, and a run that doesn't touch its list
leaves the plan as it was. A different agent has its own plan. Each run also writes a pointer
under its own namespace (`<requestId>/<run>`) when the agent is created or resumed, which is how
a reader that knows only the request finds the plan
([reading a request's plan](./coding-agents.md#reading-a-requests-plan)).

Cursor doesn't tell the SDK which item is which, so a row is an item's place in the list. If
Cursor changes an item's status, its row keeps the old one as `previousStatus`. If Cursor
rewords the item at a place, the row takes the new wording and `previousStatus` is cleared. If
the list gets shorter, the rows past its end are removed. If Cursor reorders its list, rows after
that point describe different items, so don't follow one item across a reorder.

An agent that has never updated its list has no plan: no rows and no list marker, only the
runs' pointers. A list Cursor empties is different: the marker says the list is complete with
nothing in it. If a write fails partway, the marker says the list is
incomplete, with the error, so a reader never shows a half-written list as the plan. Cursor's
plan-mode document, the one `mode: "plan"` produces, is not recorded.

`recordPlan` is off by default. Off, the block declares no session state, exactly as before,
which is what lets a task board dispatch it without any further option.

## Where the run works

`cwd` is a function you write. It is called once per run, before anything is
opened, and its answer becomes the directory the local agent works in. It is
handed the block context and never the prompt, for the reason
[Coding agents](./coding-agents.md#the-prompt-is-the-input-everything-else-is-configuration)
gives. Leave it out and the run works in the host process's own directory, which
is rarely what you want.

It is a working directory, not a fence: the run can still address paths outside
it. `local.sandboxOptions` on `agent` is the fence.

Cursor fails a run whose sandbox can't start rather than running without it.
`probeCursorSandbox` reports whether the sandbox can start for a run in `cwd`
with that `env`, without starting a run. It takes about a second, so call it
once, from a startup or health check.

```ts
import { probeCursorSandbox } from "@flow-state-dev/cursor";

const result = await probeCursorSandbox({ cwd: repoDir, env });
// { supported: true } or { supported: false, reason: "<Cursor's message>" }
```

The sandbox needs a helper binary from Cursor's platform package, which this
package installs. With `env` set (next section), no extra dependency is needed.
Without `env`, under pnpm, add `@cursor/sdk-<platform>-<arch>` to your app's
dependencies, or the sandbox can't start and the run fails.

## Choosing the environment the run starts with

Cursor's SDK runs in your server's process, and every shell command Cursor runs
gets a copy of that process's environment: every key, token and connection string
your server was started with. The SDK has no option to narrow it, and its sandbox
limits files and network, not environment variables.

Set `env` and the block runs Cursor's runtime in a separate Node process whose
environment is exactly what you pass, with nothing inherited. Commands Cursor
runs start with only those variables. Build it from names with `harnessEnv` from
`@flow-state-dev/core`:

```ts
import { harnessEnv } from "@flow-state-dev/core";

cursorAgent({
  cwd, resume, onSession,
  env: harnessEnv({ pass: ["PATH", "HOME", "CURSOR_API_KEY"] }),
});
```

Name `PATH`, since commands are found through it. Name `HOME` too: Cursor keeps
its agents and its stored login under it, so a run started with a different
`HOME` can't resume an agent or find a login. Pass `CURSOR_API_KEY` unless the key
goes in `agent.apiKey`.

If you'd rather not write the list yourself, the package exports one.
`CURSOR_PASS` names what a run needs to work: `PATH`, `HOME`, `USER`, `SHELL`
and `TMPDIR`, `CURSOR_API_KEY`, and the proxy and CA settings a proxied network
needs, in upper and lower case.

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { CURSOR_PASS, cursorAgent } from "@flow-state-dev/cursor";

cursorAgent({ cwd, env: harnessEnv({ pass: CURSOR_PASS }) });
```

When your runs need a key of their own, say a GitHub token for `gh`, add its
name to the list: `harnessEnv({ pass: [...CURSOR_PASS, "GH_TOKEN"] })`.
Anything you pass is readable by every command the run starts, so the model can
print it, and it can end up in a log or a commit.

The options cross into that process as data, so with `env` set a function anywhere
in `agent` or `send` (`onStep`, `onDelta`, custom tools) is refused when the block
is built, and so is your own `resolveCursorClient`, which would run Cursor outside
the separate process. If the process can't start, or dies, the run fails with the
reason. It never falls back to running in your server's process.

Leave `env` out and the runtime runs in your process, as before.

`env` decides what commands start with. It is not a security boundary. The
separate process still runs as the same operating-system user as your server, and
on Linux a process can read the environment of any other process its user owns,
your server's included, through `/proc`. So a command that goes looking can still
find your server's secrets. When that matters, run the server, or Cursor's
runtime, as a separate user or in its own container.

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
hold is left exactly as it was rather than being overwritten with a dead one. When
the reason is that Cursor doesn't know the agent, the error says so in the
framework's own terms: `harnessFailureKind(error)` from `@flow-state-dev/core`
reads `"unknown-conversation"`. Any other failure reads `null`, including one after
Cursor has resumed the agent.

Keeping no session state also means the block declares none, which is what lets a
task board dispatch it without any further option. `recordPlan` is the one option
that adds some, and it is off by default.

## Steering a running turn

A message can join a turn while it's still running. Pass `onSteerable`, and once
the prompt is sent the block calls it with a `steer` function. When the turn is
over, it calls it again with `null`.

```ts
cursorAgent({
  // …
  onSteerable: (steer, ctx) => (steer ? holdSteer(ctx, steer) : dropSteer(ctx)),
});
```

`steer(text)` resolves `"delivered"` when Cursor took the line into the turn in
flight. It resolves `"refused"` when Cursor said the line should wait for the next
turn, when the call failed, or when the turn had already ended. A refused line
was not taken, so send it as the next prompt. When the run ends on its own, the
block waits for every `steer` call still in flight to answer before it returns. A
run stopped by its deadline doesn't wait.

Only local runs whose SDK offers steering get a `steer`. Otherwise `onSteerable`
is never called. To steer from a session, hand it `harnessSteering().onSteerable`
from `@flow-state-dev/core` ([Steering a running turn](./coding-agents.md#steering-a-running-turn)). The [harness manager](../orchestration/harness-manager.md#steering-a-run)
uses this hook to hand a task's new messages to the running step.

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
| `env` with a function in `agent` or `send`, or with `resolveCursorClient` | `CursorAgentConfigError` when the block is built |
| Cursor doesn't know the agent `resume` named | `CursorAgentRunError` whose `harnessFailure` is `"unknown-conversation"` |
| The SDK throws opening the agent, sending, or streaming | `CursorAgentRunError`, carrying what it said |
| With `env` set, the runtime's process can't start or dies | `CursorAgentRunError`, with the reason |
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
