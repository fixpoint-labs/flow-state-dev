---
sidebar_position: 3
---

# Flows

A flow is the top-level unit — the thing you register with the server and clients connect to. It ties together your blocks, actions, state, resources, and client data into a single, deployable definition.

Think of a flow as the complete specification of an AI-powered feature: what actions users can trigger, what state is tracked, and what data is exposed to the frontend.

Every `defineFlow` field is tabulated in [Flow options](/docs/configuration/flow). This page teaches the shape; that page is the lookup.

## Defining a flow

```ts
import { defineFlow, defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const chatFlow = defineFlow({
  kind: "my-chat",               // Unique identifier — becomes the URL path
  requireUser: true,              // Require userId on every request

  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
    reset: {
      inputSchema: z.object({}),
      block: resetHandler,
    },
  },

  resources: {
    artifacts: defineResource({
      scope: "session",
      stateSchema: artifactSchema,
      writable: true,
    }),
  },

  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
    }),
    client: {
      expose: ["messageCount"],
    },
  },

  user: {
    stateSchema: z.object({
      preferences: z.object({ theme: z.string().default("light") }).default({}),
    }),
  },
});

export default chatFlow();
```

## FlowType vs FlowInstance

`defineFlow()` returns a **FlowType**, a factory. Calling it creates a **FlowInstance**, the thing you actually register with the server:

```ts
// FlowType — the blueprint
const chatFlow = defineFlow({ kind: "my-chat", ... });

// FlowInstance — what you register and deploy
export default chatFlow();
```

A definition describes a flow. A registered instance names one configured copy of it. Most flows have exactly one copy, and that is the default: a flow is a **singleton** unless you say otherwise, and its instance id is its `kind`. Calling the factory with no argument gives you that instance; `chatFlow({ id: "my-chat" })` is the same thing spelled out, and any other id is refused.

To run several configured copies of one definition on one server, declare the definition a **collection** and give every instance its own id:

```ts
const reviewFlow = defineFlow({
  kind: "review",
  cardinality: "collection",
  resources: { rubric: rubricResource },
  actions: { run: { block: review } },
});

export const east = reviewFlow({ id: "review-east", resources: { rubric: eastRubric } });
export const west = reviewFlow({ id: "review-west", resources: { rubric: westRubric } });
```

A collection instance has to be given an id. Ids are unique across the whole registry, whatever their kind, so registering two instances with the same id throws at registration time.

### Copies that differ by settings

Two copies of one definition can be set up differently. The definition declares what a copy may be
given with `configSchema`; each copy is created with a bag of values matching it, and every block
inside that copy reads them from `ctx.flow.config`.

The line to hold: **anything a copy is given goes in the bag; anything a copy learns goes in its own
storage.** A seat's harness and model are given. Its current task and its counters are learned —
those belong in [isolated state](../persistence/overview.md#who-owns-a-record), because the bag is
fixed when the copy is created and frozen for the copy's life.

```ts
import { z } from "zod";

const seatConfig = z.object({
  harness: z.enum(["claude-code", "codex", "cursor"]),
  model: z.string(),
  personaPath: z.string().optional(),
});

const engineerWork = handler({
  name: "engineer-work",
  // What this block needs of whatever flow installs it.
  flowConfigSchema: seatConfig,
  execute: async (input, ctx) => {
    const { harness, model } = ctx.flow.config;
    // ...
  },
});

const engineer = defineFlow({
  kind: "engineer",
  cardinality: "collection",
  configSchema: seatConfig,
  actions: { work: { block: engineerWork } },
});

export const alice = engineer({ id: "eng-alice", config: { harness: "claude-code", model: "opus" } });
export const bob = engineer({ id: "eng-bob", config: { harness: "codex", model: "gpt-5.4" } });
```

One definition, one block graph, two registered copies that behave differently. A roster mints the
rest in a loop — `engineer({ id: seat.id, config: seat.config })` per row — with no graph rebuilt.

A copy carries only settings the definition declared. A key that isn't in the schema throws where
the copy is created, naming the flow, the id and the key:

```
engineer({ id: "eng-carol", config: { harnes: "codex", model: "gpt-5.4" } })
// Flow "engineer" instance "eng-carol" has an invalid config bag:
// "harnes" is not a declared setting.
```

Keys are closed at the top level of the bag. A nested object is closed only if you close it, so add
`.strict()` to any nested shape you want typos refused in:

```ts
const seatConfig = z.object({
  harness: z.string(),
  limits: z.object({ retries: z.number().default(1) }).strict(),
});

engineer({ id: "eng-carol", config: { harness: "codex", limits: { retrys: 3 } } });
// Without .strict() on `limits`, `retrys` is dropped and `retries` quietly stays 1.
```

Without it, an undeclared key inside a nested object is dropped rather than refused whenever that
object's own keys are all optional or defaulted — the setting goes missing rather than coming out
wrong, but nothing tells you.

The schema must be a plain `z.object({ ... })` — not a union, an intersection, or an object wrapped
in `.refine()`. It also cannot carry a `.catchall(...)`, which would accept and keep undeclared keys.
A rule spanning two settings belongs in the block that reads them.

Omitting `config` doesn't skip the schema: the empty bag is parsed, so defaults apply and a required
setting throws. A flow whose settings all have defaults can be registered bare, and reads
those defaults. A flow with a required setting has to be minted with a bag before you register it.

The values stay in the process. They are not on the flow listing, not in DevTool, and not written to
any store, so a request that resumes after a deploy runs on the settings the process was started
with.

Blocks and their `flowConfigSchema` are covered in [Blocks](./blocks.md#reading-the-flow-copys-settings);
the field-by-field reference is in [Flow configuration](../configuration/flow.md).

### How an instance is addressed

Every entry point reaches an instance by its **id**. The HTTP action routes, the CLI, webhooks, schedules, MCP, and a queue worker all carry the id and nothing else.

For a singleton the id is the kind: `POST /api/flows/my-chat/actions/send`, `fsdev run my-chat send`. For a collection it is the id you registered: `POST /api/flows/review-east/actions/run`. The kind of a collection is not an address — `POST /api/flows/review/...` is a miss, not a fallback to whichever copy was registered first.

Route templates across these docs write the segment that carries the id as `:flowId`; some, following the router's own parameter name, write `:flowKind`. The value is the instance id either way.

The `kind` still says what an instance *is*. Sessions and requests record it alongside the id, listings group by it, and the definition-level transports below apply to every instance of the definition.

Saved work stays with the instance that created it. A session started through `review-east` records `review-east` as its owner, and a later call that names the same session through `review-west` is refused before anything runs. Every entry point enforces that, each in its own idiom:

| Surface | What a mismatched address gets you |
|---|---|
| [HTTP action route](/docs/server/setup#keeping-a-session-with-its-owner) | `409 wrong-instance-session` (or `wrong-instance-request` when the call names a request id), before the action runs |
| [Resume](/docs/advanced/durable-execution#resuming-a-suspended-request) | `404`, the same answer as a request that does not exist |
| [Retry and continue](/docs/advanced/durable-execution#resuming-a-suspended-request) | `400`, naming the instance that does own the request |
| [CLI](/docs/api/cli) | a non-zero exit, with the session untouched |
| [Queue worker](/guides/background-jobs-bullmq) | an unrecoverable job failure rather than a retry |
| [`runAction`](/docs/advanced/manual-flow-execution) | `FlowInstanceBindingMismatchError`, with nothing written |

[Persistence](../persistence/overview.md#who-owns-a-record) covers what is recorded, and how to attribute records that name no owner.

### What the definition owns

Inbound transports belong to the flow type. Declare `webhooks`, `schedules`, and `mcp` on `defineFlow()`:

```ts
const supportFlow = defineFlow({
  kind: "support",
  webhooks: { /* ... */ },
  schedules: { /* ... */ },
  actions: { /* ... */ },
});

export default supportFlow();
```

Every instance of a type serves the same transports. Pass one of the three to the instance call and TypeScript rejects it; a plain-JavaScript caller gets a thrown error naming the option. The `internal` and `task` entry maps described [below](#entries-only-the-flow-can-reach) are definition-only in the same way, and so is `configSchema` — the definition says what a copy may carry, and each copy supplies the values.

Everything else is settable per instance: `id`, `kind`, `config`, `actions`, `session`, `request`, `user`, `org`, `resources`, `tools`, `voice`, `authentication`, `requireUser`, `tokenCounter`, `costEstimator`, `isolateUserState`, and `isolateOrgState`.

`voice` sits on both sides. Unlike the three transports above, you can set it on `defineFlow()` as the default for every instance of the type, then override it on any single instance.

## Actions — the flow's public API

Each action is an entry point that maps a name to an input schema and a root block. Clients call actions by name — that's the only way to trigger execution.

```ts
actions: {
  chat: {
    inputSchema: z.object({ message: z.string() }),
    block: chatPipeline,
    userMessage: (input) => input.message,

    // Lifecycle hooks — observe, don't control
    onCompleted: async (result, ctx) => { /* succeeded */ },
    onErrored: async (error, ctx) => { /* failed */ },
  },
  reset: {
    inputSchema: z.object({}),
    block: resetHandler,
  },
},
```

When an action executes:
1. Input is validated against `inputSchema`
2. Session is resolved or created
3. `userMessage(input)` emits a user message item (if defined)
4. The root block executes asynchronously
5. Lifecycle hooks fire on completion or error

See [Actions](/docs/fundamentals/actions) for the full picture.

### Entries only the flow can reach

Beside `actions`, a flow can declare two more maps of entries. Each entry has the same shape as an action, `{ block, inputSchema?, concurrency?, onCompleted?, onErrored?, userMessage? }`, minus the client-facing `description` and `mcp`, and no client, MCP server, or HTTP caller can invoke one.

```ts
const documents = defineFlow({
  kind: "documents",
  actions: {
    upload: { block: summarizeInBackground },   // a dispatcher()
  },
  internal: {
    actions: {
      summarize: { block: summarizeDocument },  // reached by a dispatcher() in this flow
    },
  },
  task: {
    actions: {
      implement: { block: implementBlock },     // reached by a task-board seat in this flow
    },
  },
});
```

- **`internal.actions`** — reached by a `dispatcher({ action })` block running in this flow, which sends the work to a child session or an existing one. See [Starting a job from a flow](/docs/server/background-work#starting-a-job-from-a-flow).
- **`task.actions`** — reached by a `dispatcher({ action, session })` sitting as a seat on a task board, which hands each claimed task to a child session. See [Seats that hand off](/docs/orchestration/task-board#seats-that-hand-off).

Each map is looked up on its own. An action named `summarize` does not satisfy a dispatcher whose action is the internal entry `summarize`, and `defineFlow()` throws at definition time when a reachable dispatcher names an entry its map does not hold. Both maps nest under `actions`; the flat spelling `internal: { summarize: { block } }` is refused by name.

## Session configuration

Sessions carry state and a `client` block that persist across requests in a conversation. Resources live on the flow as a flat `resources` map — each resource's own `scope` decides where it is stored:

```ts
import { defineFlow, defineResource } from "@flow-state-dev/core";
import { z } from "zod";

defineFlow({
  kind: "my-app",
  resources: {
    plan: defineResource({
      scope: "session",
      stateSchema: z.object({
        steps: z.array(z.string()).default([]),
        status: z.enum(["draft", "active", "complete"]).default("draft"),
      }),
      writable: true,
    }),
  },
  session: {
    stateSchema: z.object({
      mode: z.enum(["chat", "agent"]).default("chat"),
      messageCount: z.number().default(0),
    }),
    client: {
      derived: {
        activePlan: (ctx) => ctx.resources.plan?.state ?? null,
      },
    },
  },
  actions: { /* ... */ },
});
```

### History windowing

`session.historyWindow` bounds how much cross-turn history each request loads:

```ts
session: {
  historyWindow: { turns: 50 },
},
```

`turns` (default 50) caps the number of recent completed turns the execution context loads per request, so per-turn cost stays flat as a conversation grows. A generator's `history` slot and `ctx.session.items.history()` see at most this many turns; a per-call `history({ limit })` narrows within the window but cannot widen it. The full session remains retrievable through the state endpoint. See [Flow-level history bounds](../advanced/generator-context.md#flow-level-history-bounds).

### Automatic resource collection

Blocks can declare resource dependencies directly with a flat `resources` map of `defineResource()` values. When `defineFlow` is called, it collects declared resources from all action blocks and merges them into the flow's `resources` map:

```ts
const planManager = handler({
  name: "plan-manager",
  resources: { plan: planResource },
  execute: async (input, ctx) => { /* uses ctx.resources.plan */ },
});

const myFlow = defineFlow({
  kind: "my-app",
  actions: { manage: { block: planManager } },
  // resources automatically includes { plan: planResource }
  // from the block — no need to declare it again here
});
```

Flow-level resource declarations take priority. If both a block and the flow declare a resource with the same name, the flow's version wins.

See [State](/docs/fundamentals/state-and-scopes) for details on scopes, resources, and the `client` block.

## Lifecycle hooks

Observe execution at both the action and request level:

```ts
// Action-level
actions: {
  chat: {
    onCompleted: async (result, ctx) => { /* action succeeded */ },
    onErrored: async (error, ctx) => { /* action failed */ },
  },
},

// Request-level
request: {
  onStarted: async (ctx) => { /* request began */ },
  onCompleted: async (ctx) => { /* request succeeded */ },
  onErrored: async (error, ctx) => { /* request failed */ },
  onFinished: async (ctx) => { /* always fires, success or failure */ },
  onStepErrored: async (error, ctx) => { /* non-terminal step failure */ },
},
```

Hooks are **observational** — they run after the fact and can't modify the result. The past-tense naming (`onCompleted`, not `onComplete`) makes this intent clear.

`request.concurrency` sets a flow-wide default concurrency policy that every action inherits unless it declares its own. See [Concurrency policies](../advanced/concurrency-policies.md).

### Block-level completion (`onCompleted`)

Individual blocks can also declare an `onCompleted` callback on their config. This is distinct from the action-level and request-level hooks shown above, which are lifecycle observers run by the request executor. A block-level `onCompleted` fires immediately after the block's `execute` succeeds:

```ts
generator({
  name: "my-gen",
  model: "intent/chat",
  prompt: "...",
  onCompleted: async (output, ctx, meta) => {
    // meta.model carries the resolved ModelIdentity (generators only)
  },
});
```

For generators, `meta` is a `GeneratorCompletedMeta` carrying `{ model: ModelIdentity }` — the concrete model that produced the output. Other block kinds receive only `(output, ctx)` with no `meta` argument. See [models — reading the resolved model at completion time](./models.md#reading-the-resolved-model-at-completion-time) for a worked example projecting the model into session state.

## Registration

Flows are registered with a server registry to be served via HTTP:

```ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/engine";

const registry = createFlowRegistry();
registry.register(chatFlow);
registry.register(agentFlow);

const router = createFlowApiRouter({ registry });
```

The registry indexes instances by id and routes requests to the one an address names. Several flows, and several instances of a collection flow, can coexist in the same server. See [`createFlowRegistry`](../api/server.md#createflowregistry) for how lookup, misses, and duplicate ids behave.
