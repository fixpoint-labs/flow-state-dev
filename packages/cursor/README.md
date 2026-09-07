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
pnpm add @flow-state-dev/cursor @cursor/sdk@1.0.31
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
  agent: {
    model: { id: "composer-2.5" },
    apiKey: process.env.CURSOR_API_KEY,
  },
});
```

`createCursorAgentCapability(options)` takes the same options and exposes the
block to a generator as a tool.

**A model is required.** Cursor's SDK refuses to create a local agent without one,
so `agent.model` is not optional in practice. `Cursor.models.list()` from the SDK
enumerates what your account can select.

**The block's input is the prompt and nothing else.** Where a run writes and which
conversation it continues are configuration, because the same block can be handed
to a model as a tool, and a field on the input is a field the model could set. The
resolvers are handed the block context alone and never the prompt, so a path or a
session id cannot be derived from text the model wrote.

**`onSession` is the write side of `resume`.** It is called with the agent id the
moment the SDK opens one, before the prompt is sent. A cancelled or crashed run
returns no handle, so this is the only carrier that reaches your state in the case
resuming exists for. A resume Cursor refuses throws instead of opening an agent,
so the id you already hold is left untouched.

## Option groups

`agent` and `send` are the SDK's own option bags — `AgentOptions` for
`Agent.create` / `Agent.resume`, `SendOptions` for `agent.send` — forwarded
verbatim. Three keys are refused when the block is built:

| Refused | Why |
|---|---|
| `agent.agentId` | The `resume` resolver owns which conversation a run continues. |
| `agent.local.cwd` | The `cwd` resolver owns where a run works. The rest of `local` is forwarded. |
| `agent.cloud`, `send.cloud` | This version drives Cursor's **local** runtime only. |

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
