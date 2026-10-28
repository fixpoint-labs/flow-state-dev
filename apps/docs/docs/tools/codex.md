---
sidebar_position: 8
sidebar_label: Codex (SDK agent)
---

# Codex SDK agent

`@flow-state-dev/codex` — run OpenAI's Codex agent as a block. You hand it a
prompt, it works in a directory you point it at, and it hands back a handle
describing the run. What it says, what it runs, and what it changes show up in
your flow's item stream as it goes.

This is one of two harnesses flow-state-dev ships. [Coding agents](./coding-agents.md)
covers what they have in common — the handle they both return, and the
configuration contract underneath `cwd`, `resume` and `onSession`. This page is
the Codex half.

## When to use it

Reach for this when you want coding work done by Codex specifically, or when you
want a choice. A step that reads a handle rather than a vendor's own result can
run either harness, so switching is a configuration change rather than a rewrite.

Codex owns its own loop. flow-state-dev does not drive it step by step or
re-implement its tools. It runs the
[Codex SDK](https://developers.openai.com/codex/sdk), which spawns the Codex CLI
in a subprocess, watches the stream, and turns each thing that happens into a
canonical item.

## Installation

The SDK is an optional peer dependency, pinned to an exact version:

```bash
pnpm add @flow-state-dev/codex @openai/codex-sdk@0.164.0
```

Codex's JSONL output sits behind the CLI's `--experimental-json` flag and can
change in a lockstep CLI and SDK release, so building a block against any other
installed version fails immediately, naming both versions. There is no option to
override it. The way to take a newer Codex is a release of
`@flow-state-dev/codex` that has been tested against it.

Building also fails if an SDK is installed but its version cannot be read, which
can happen under Yarn PnP or a custom loader.

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
  // The generator's own model, as a flow-state-dev model id.
  model: "openai/gpt-6-luna",
  // Codex's model is set separately, in its own ids — see the next example.
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
    // A Codex model id, not a flow-state-dev one. A fixed id, or one read per run.
    model: (ctx) => modelPickedFor(ctx),
    // Options passed straight to Codex, in Codex's own vocabulary.
    thread: { sandboxMode: "workspace-write", approvalPolicy: "never" },
  }),
  { abortSignal: () => AbortSignal.timeout(runTimeoutMs) },
);
```

The block's input is the prompt, and nothing else. Everything that decides where
a run writes, which conversation it continues or which model it runs is
configuration. The same block can be handed to a model as a tool, and a field on
the input is a field the model could set.

`model` is asked once per run, so one block can run a different model for each
session, and a resumed thread gets it too. Codex's SDK can't list its models, so
the ids come from you; `codex debug models` shows what the installed Codex knows.
`thread.model` still works for a fixed id, but not together with `model`.

## What it emits

| Codex output | flow-state-dev item |
|---|---|
| Agent message | `message` |
| Reasoning summary | `reasoning` |
| Shell command and its result | `tool_output`, opened when the command starts and settled with its exit code |
| File change | `tool_output` naming each path and whether it was added, updated or deleted |
| MCP tool call | `tool_output`, named `mcp:<server>/<tool>` |
| Web search, to-do list | `tool_output` |
| Thread and turn lifecycle, reconnect attempts | transient `status` |
| Warnings, such as a setting the model doesn't support | `status`, kept in the session's history |
| Run end | `status`, kept in the session's history, saying how long the run took: `Codex run completed in 5 mins, 24 seconds.` A run that fails ends with a kept status that says it errored and why, `Codex run errored (<reason>).`, besides the `error` item below. |
| A failed run | `error`: one line saying why, with everything Codex printed under `details.output` |

Every item carries provenance, so the devtool shows the full trace of what the
run did.

In the version this package supports, Codex doesn't send a to-do list, and a Codex block
records no [run's plan](./coding-agents.md#the-runs-plan). Show its plan as not reported
rather than empty.

Output this package doesn't recognize becomes a status note rather than an error.
The format is experimental, so unknown output doesn't fail the run.

## Where the run works

`cwd` is a function you write. It is called once per run, before anything is
spawned, and its answer becomes the directory Codex works in. It is handed the
block context and never the prompt, for the reason
[Coding agents](./coding-agents.md#the-prompt-is-the-input-everything-else-is-configuration)
gives.

It is a working directory, not a fence: the run can still address paths outside
it. `sandboxMode` on `thread` is the fence.

Deriving a safe directory per run is a recipe rather than a one-liner, and the
Claude Code page works one through in
[Reusing a directory across runs](./claude-code-sdk.md#reusing-a-directory-across-runs).
It applies here unchanged. If your work arrives as rows on a task board, the
[harness manager](/docs/orchestration/harness-manager) derives and provisions the
checkout for you.

## Environment variables

Leave `client.env` unset and the Codex CLI process starts with your server's
entire `process.env`: every API key, token and connection string in it, readable
by any shell command the model runs. Setting `client.env` replaces that
environment. It does not add to it.

To hand the run only what it needs, build `client.env` with `harnessEnv` from
`@flow-state-dev/core`:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { codexAgent } from "@flow-state-dev/codex";

codexAgent({
  cwd: (ctx) => workspacePathFor(ctx),
  client: { env: harnessEnv({ pass: ["PATH", "HOME", "CODEX_API_KEY"] }) },
});
```

Only the named variables are passed. Nothing is implicit, so name `PATH` and
`HOME` yourself; the run's shell commands and git are found through `PATH`. A
named variable that isn't set on the server is left out, and one set to an empty
string is kept. Values are read once, when `harnessEnv` is called. Called inline
as above, that is when the block is built, so a variable set after that never
reaches the run.

To add a fixed value, spread the allowlist and set it beside it:
`{ ...harnessEnv({ pass: [...] }), CI: "1" }`. Spreading `process.env` there
hands the run every secret the server holds.

## Checking for a credential before you start

A run with no credential fails on its first turn, which for a server can be
long after it started. `probeCodexAccount` asks up front whether Codex has
something to run on, and starts no model turn:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { probeCodexAccount } from "@flow-state-dev/codex";

const env = harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME", "CODEX_API_KEY"] });
const account = await probeCodexAccount({ env });
if (account.status !== "account") throw new Error(`Codex can't run: ${account.reason}`);
```

A `CODEX_API_KEY` in `env` answers on its own, since a run given a key uses it
whatever login Codex has saved. Otherwise it runs `codex login status` with the
CLI that `@openai/codex-sdk` brings. Pass the `env` your runs get, so the check
sees the sign-in the run will see.

It never throws, and resolves to one of:

| `status` | When | Also carries |
|---|---|---|
| `account` | A key is set, or `codex login status` succeeds | `source`: `"api-key"` or `"login"` |
| `none` | Codex says nobody is signed in, or gave no answer: it didn't answer within `timeoutMs` (10 seconds by default), the `signal` aborted, or the CLI couldn't start | `reason`, a sentence you can show the user, and `unanswered: true` when Codex gave no answer |
| `sdk-missing` | `@openai/codex-sdk` couldn't be loaded, so there is no CLI to ask | `reason`, with the load error |

It checks where a credential would come from, not that it works. A key that is
set but rejected still reads as `account`, and the run fails on its first turn.

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
names it, which is before the run does any work — early enough that a run which is
later cancelled is still resumable. [Coding agents](./coding-agents.md#the-prompt-is-the-input-everything-else-is-configuration)
covers why the hook exists alongside the handle's own `sessionId`.

`onSession` fires only when Codex actually names a thread. If you resume an id
Codex no longer has, it names none, the run fails, and the id you already hold is
left exactly as it was rather than being overwritten with a dead one.
`harnessFailureKind(error)` from `@flow-state-dev/core` returns
`"unknown-conversation"` for that failure, and `null` for any other, including a
sign-in error before Codex names a thread.

Keeping no session state also means the block declares none, which is what lets a
task board dispatch it without any further option. The Claude Code harness needs
`detached: true` for the same effect.

## Cancelling

Nothing to write. The block forwards its own signal into the turn, and a fired
deadline throws rather than returning a handle. The thread id has already reached
`onSession` by then, so the run can be continued.

The deadline bounds Codex, not what Codex ran. A command Codex started can
outlive the process being killed. The sandbox setting is what bounds that class
of thing.

## Usage and cost

A completed turn reports token usage. The handle carries the two counts every
harness reports, plus Codex's full breakdown — cached input, cache writes and
reasoning output — under `codexUsage`.

Cost is an estimate, derived from flow-state-dev's model price table, and
`cost.basis` always reads `"estimated"`. It is absent rather than zero when:

- No model was named (`model` or `thread.model`), so the run used Codex's default. Nothing in the output
  names the model that ran, so there is nothing to price.
- The price table has no entry for the model. One patch release teaches it.
- The turn never completed, so there is no usage.

## Reading usage left

A ChatGPT plan gives Codex a limit per time window, such as five hours or a
week, and a run fails once a window is used up. `readCodexUsage` asks Codex how
much of each window is used, without starting a run:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { readCodexUsage } from "@flow-state-dev/codex";

const reading = await readCodexUsage({
  env: harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME"] }),
});

if (reading.status === "windows") {
  for (const w of reading.windows) {
    console.log(w.id, w.minutes, `${w.usedPercent}% used`, w.resetsAt && new Date(w.resetsAt));
  }
} else {
  console.log(reading.reason); // "Codex uses an API key: no subscription limit"
}
```

Pass the same `env` your runs get, so the read and the runs see one sign-in. It
starts the Codex CLI that `@openai/codex-sdk` brings, asks it, and stops it.

The result is the shared [usage reading](./coding-agents.md#subscription-usage),
and the call never throws:

| `status` | When |
|---|---|
| `windows` | Signed in with ChatGPT. Every window Codex reports, each with `usedPercent` (0 to 100), its length in `minutes`, and `resetsAt` in epoch ms, plus `plan` and `accountId`. |
| `api-key` | Codex runs on an API key, which has no subscription limit. |
| `signed-out` | Nobody is signed in to Codex. |
| `unavailable` | The read couldn't be made: the CLI wasn't found, it stopped, or it didn't answer within `timeoutMs` (10 seconds by default). `reason` says which, in plain words. |

`signal` stops a read early; it then returns `unavailable`. The three statuses
other than `windows` carry a `reason` and no windows, and none of them means 0%.

**Local only.** OpenAI permits this sign-in on your own machine, not in a
hosted service. Use it in a tool that runs where you are signed in to
Codex, and don't wire it into a server you host for others.

To keep the last reading and serve it to a page or a worker, register it as the
`codex` reader of the [harness manager's usage query](/docs/orchestration/harness-manager#subscription-usage).

## Errors

Every one of these is fatal for the run that raised it:

| Situation | What happens |
|---|---|
| Empty prompt | Throws before anything is spawned |
| SDK not installed | Throws on the first run, with an install hint |
| A different SDK version installed, or one whose version cannot be read | Throws when the block is built |
| A working directory or a signal in `thread` or `client` | Throws when the block is built |
| The CLI exits non-zero | Throws, carrying its stderr |
| Codex doesn't have the thread `resume` named | Throws a `CodexAgentRunError` whose `harnessFailure` is `"unknown-conversation"` |
| The deadline fires | Throws |

A turn the model itself fails is not in that list. It comes back as a handle with
`status: "errored"` and `outcome: "failed"`, and Codex's message on
`failureMessage`. Nothing here retries.

## Limitations

- One turn per call. The block runs a turn and returns.
- No images and no structured output.
- No approval prompts. A headless run is configured not to ask, so the sandbox
  and approval policy you set are the whole of the permission story.
- With `client.env` unset, the run can read every variable in your server's
  environment. See [Environment variables](#environment-variables).
- Reading usage left works only on your own machine. See
  [Reading usage left](#reading-usage-left).

## Related

- [Coding agents](./coding-agents.md) — the harness contract both agents implement
- [Claude Code SDK agent](./claude-code-sdk.md) — the other harness, same handle
- [Harness manager](/docs/orchestration/harness-manager) — driving this one from a
  task board, with a checkout and a verdict
- [Background work](../server/background-work.md) — running either one off the
  request path
