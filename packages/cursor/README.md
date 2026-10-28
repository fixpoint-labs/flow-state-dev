# @flow-state-dev/cursor

Run Cursor's coding agent as a flow-state-dev block. Hand it a prompt, point it at
a directory, get back the framework's neutral harness handle. It is the same shape
`@flow-state-dev/claude-code` and `@flow-state-dev/codex` return, so a caller that
reads the handle can drive any of them.

[`@flow-state-dev/harness-manager`](../harness-manager) drives any of the three
from a task board without knowing which one it has.

Full guide: [Cursor SDK agent](https://flow-state.dev/docs/tools/cursor). The
contract every harness implements is
[Coding agents](https://flow-state.dev/docs/tools/coding-agents).

## Install

```bash
pnpm add @flow-state-dev/cursor @cursor/sdk@1.0.40
```

The SDK is an **exact-pinned optional peer**, and the pin is enforced: building a
block against any other installed version throws, naming both versions. Cursor's
SDK ships its local runtime as a platform-specific native binary and its message
wire can change between patch releases, so every Cursor upgrade is a tested
release of this package. There is no override option.

An SDK that is present but whose version cannot be determined (Yarn PnP, a custom
loader) is refused too.

At runtime Cursor needs an API key. Set `CURSOR_API_KEY` and the SDK reads it
itself, or pass one on `agent.apiKey`. You do not need the Cursor editor installed
— the SDK brings its own runtime.

## Use

```ts
import { cursorAgent } from "@flow-state-dev/cursor";

const agent = cursorAgent({
  cwd: (ctx) => workspacePathFor(ctx),              // where the run works
  resume: (ctx) => storedAgentId(ctx),              // which agent to continue
  onSession: (id, ctx) => storeAgentId(id, ctx),    // called the moment one is opened
  model: (ctx) => storedModel(ctx) ?? "composer-2.5", // which model, per run (or a fixed id)
  agent: { apiKey: process.env.CURSOR_API_KEY },
});
```

`createCursorAgentCapability(options)` takes the same options and exposes the
block to a generator as a tool.

**A model is required.** Cursor's SDK refuses to create a local agent without one.
Name it with `model`: an id, a model with its settings
(`{ id, params: [{ id, value }] }`, Cursor's own parameter list, such as a
reasoning effort), or a resolver returning either, asked once per run. The result
goes to the agent on create and on resume alike, so a resolver that reads the
session can run a different model and settings for each one.
`Cursor.models.list()` from the SDK enumerates what your account can select.

A resolver that returns `null`, `undefined` or an empty id names no model. With no
model named from `model` or `agent.model`, Cursor's SDK refuses to open the agent
and the run fails. `agent.model` also takes `{ id, params }`, is the model when
`model` is unset, and is one value for every run. `model` beside `agent.model` or `send.model` throws
when the block is built; `agent` and `send` are the SDK's option groups, described
under [Option groups](#option-groups).

**The block's input is the prompt and nothing else.** Where a run writes, which
conversation it continues and which model it runs are configuration, because the same block can be handed
to a model as a tool, and a field on the input is a field the model could set. The
resolvers are handed the block context alone and never the prompt, so a path or a
session id cannot be derived from text the model wrote.

**`onSession` is the write side of `resume`.** It is called with the agent id the
moment the SDK opens one, before the prompt is sent. A cancelled or crashed run
returns no handle, so this is the only carrier that reaches your state in the case
resuming exists for. A resume Cursor refuses throws instead of opening an agent,
so the id you already hold is left untouched.

**`onSteerable` lets the running turn take a line.** Once the prompt is sent, the
block calls it with a `steer` function, and with `null` when the turn is over.
`steer(text)` hands the line to the turn in flight and resolves `"delivered"` when
Cursor took it into that turn, or `"refused"` when it didn't (Cursor answered that
the line should wait for the next turn, the call failed, or the turn had already
ended). A refused line was not taken, so send it as the next turn. A run that ends
on its own waits for any `steer` call still in flight to answer before it returns;
one stopped by its deadline doesn't. Only local
runs whose SDK offers steering get a `steer`; otherwise `onSteerable` is never called.

```ts
const agent = cursorAgent({
  // …
  onSteerable: (steer, ctx) => (steer ? holdSteer(ctx, steer) : dropSteer(ctx)),
});
```

## Option groups

`agent` and `send` are the SDK's own option bags — `AgentOptions` for
`Agent.create` / `Agent.resume`, `SendOptions` for `agent.send` — forwarded
verbatim. Three keys are refused when the block is built:

| Refused | Why |
|---|---|
| `agent.agentId` | The `resume` resolver owns which conversation a run continues. |
| `agent.local.cwd` | The `cwd` resolver owns where a run works. The rest of `local` is forwarded. |
| `agent.cloud`, `send.cloud` | This version drives Cursor's **local** runtime only. |

`recordPlan: true` records Cursor's to-do list in the run's plan record, `observed-plan`, the
shape every harness shares and `@flow-state-dev/core` defines. The record holds the whole list
Cursor last confirmed, one row per place in the list, with Cursor's own status words. The plan
is the agent's: rows and their marker are keyed under `conversation/<Cursor agent id>`, so a
later run of the same agent that doesn't touch its list leaves the plan as it was, and a
different agent has its own. Each run writes a pointer to that plan when the agent is created
or resumed; core's `readPlanTarget` follows it from a request id. Off by default; off, the block
declares no session state. Guide:
[Recording the run's plan](https://flow-state.dev/docs/tools/cursor#recording-the-runs-plan).

`env` is the environment Cursor's runtime sees. Set it and the block runs the runtime in a
separate process with exactly those variables, so commands Cursor runs start with only them
rather than a copy of your server's environment. It is not a security boundary: the process runs
as the same OS user, and on Linux a command can still read another process's environment, your
server's included, through `/proc`. Use a separate user or a container when that matters. Name
`PATH`, `HOME` and `CURSOR_API_KEY` in it (`harnessEnv({ pass: [...] })` from
`@flow-state-dev/core`). With `env` set, functions in `agent` or `send` and a custom
`resolveCursorClient` are refused when the block is built, because they can't reach that process.
Leave it out and the runtime runs in your process, as before. Guide:
[Choosing the environment the run starts with](https://flow-state.dev/docs/tools/cursor#choosing-the-environment-the-run-starts-with).

`agent.local.sandboxOptions: { enabled: true }` asks Cursor to confine the run's writes to its
`cwd`. Cursor fails a run whose sandbox can't start, rather than running without it. The sandbox
needs a helper binary from Cursor's platform package (`@cursor/sdk-darwin-arm64` and the like).
This package depends on the platform packages, so a run with `env` set finds the helper under any
package manager. Without `env`, under pnpm, your app must depend on the platform package too.

`probeCursorSandbox({ cwd, env })` asks the SDK whether the sandbox can start for a run in `cwd`,
the way a run with that `env` would, without starting one. It returns `{ supported: true }` or
`{ supported: false, reason }` with Cursor's own message. It takes about a second, so call it once,
from a startup or health check.

## Sign-in check

`cursorSignIn(env)` tells you whether Cursor is signed in, without starting a run. Pass the same
environment you give the block's `env`.

```ts
import { cursorSignIn } from "@flow-state-dev/cursor";

const signIn = await cursorSignIn(runEnv);
if (signIn.status === "none") console.warn(`Cursor is not signed in: ${signIn.reason}`);
```

It returns a `CursorSignIn`:

- `{ status: "key" }` when `env` has a non-empty `CURSOR_API_KEY`. This answer needs nothing from
  the SDK, so it holds even where `@cursor/sdk` (an optional peer) is not installed.
- `{ status: "login" }` when there is no key and the SDK finds an unexpired stored login. A stored
  login is the API key that `Cursor.auth.login()` saves to `~/.cursor/sdk/auth.json` after a
  browser sign-in.
- `{ status: "none", reason }` otherwise. `reason` is a message for people, not a value
  to match on, for example `"no CURSOR_API_KEY in the run's environment and no stored login"`.

The stored login is looked up under the `HOME` of the process that calls `cursorSignIn`.
`env.HOME` is not used. A run with `env` set reads its stored login under `env.HOME` instead, so
when the two differ, a `login` answer says nothing about that run. Keep them the same.
`login` also means only that the file is there and unexpired; it does not check that Cursor still
accepts the key.

Without a key, the SDK must be installed. If it can't be loaded, the call rejects with the
import's own error, such as Node's `ERR_MODULE_NOT_FOUND`. A missing, unreadable or malformed
`auth.json` is not an error: the SDK reports it as no stored login, so the result is `none`.

## The handle

The neutral harness handle (`source: "cursor/sdk"`, `status`, `sessionId`, `url`,
`dispatchedAt`, `outcome`, `finalMessage`, `usage`, `cost`), plus two fields only
Cursor can fill: `cursorUsage` (the full token breakdown, including cache reads
and writes and reasoning tokens) and `failureMessage`.

`sessionId` is the **agent** id, not the run id — a Cursor agent is the durable
conversation, and each prompt is one run inside it. That is what `resume` takes.

`outcome` is `"finished"` or `"failed"`. Cursor reports no turn or budget cap, so
`"stopped-at-limit"` never appears here, and a run stopped by your deadline throws
rather than returning a handle. A run Cursor reports as cancelled by something
other than your deadline reads `"failed"` with the reason on `failureMessage`.

The outcome comes from `run.wait()` and from nowhere else. The lifecycle messages
on the stream are mirrored as status notes, so a stream that ends early can never
disagree with the SDK about how the run finished.

## Cost

An estimate, always, from core's model price table, so `cost.basis` reads
`"estimated"`. It is `null`, never `0`, when the model is unknown, when the table
has no priced row for it, or when the run reported no usage.

**Most Cursor runs report no cost today**, and that is honest rather than broken.
Cursor spells its model ids its own way (`composer-*`, `claude-4.5-sonnet`) and
core's table does not carry those spellings, so no priced row matches and the
field is `null`. Teaching the table Cursor's ids — and settling what a Composer
token costs — is a pricing decision, not an adapter one. Until it lands, read
`cursorUsage` for the raw counters.

Cursor's own `agent.getUsage()` does report dollars, and this package deliberately
does not use it: for a local agent it totals the whole **agent** rather than one
run, its per-turn entries are keyed by a usage UUID that cannot be correlated to
the run just observed, and the SDK documents the figure as eventually consistent.
Read at the moment a run ends it can say `0` for a run whose billing has not
landed, and `0` reads as "this was free".

## What a run spent

`cursorAgent` reports its spend to the request with `reportHarnessSpend` as the run goes, under one `runId` for the run, each report replacing the last: once the run is sent, with the configured `model` and `null` tokens; at the end of each turn, with the tokens so far; and when the run ends, however it ends. `harness: "cursor"`, the tokens Cursor reported, added up turn by turn so a stopped run keeps the turns it finished, and `costUsd` and `billing` both `null`. A run that failed before any turn reports `null` tokens. Guide: [what a run spent](https://flow-state.dev/docs/tools/coding-agents#what-a-run-spent).

## Tests

```bash
pnpm --filter @flow-state-dev/cursor test
pnpm exec turbo run typecheck --filter=@flow-state-dev/cursor --force
```

Every spec scripts the Cursor client through the `resolveCursorClient` seam and
starts no runtime, so CI needs no API key and makes no network call.
`test/installed-sdk.spec.ts` is the one that touches the real package: it loads
the **installed** `@cursor/sdk` and asserts the entry points this package drives
are still there, and that the version reader finds exactly the pin. That is what
makes the pin mean something — it goes red when a Cursor bump moves the surface.

It does not exercise a real run. Cursor's local runtime is a native binary talking
to Cursor's backend, with no path override and no offline mode, so there is no
subprocess-level fake to point it at the way `@flow-state-dev/codex` points the
Codex SDK at a fake `codex` binary. A live check belongs in `goals/`, not in CI.
