---
sidebar_position: 3
---

# Your First Flow

The [Quick Start](/docs/getting-started/quick-start) gives you a working app fast. This page is for the other reader — the one who wants to understand what each piece does before they trust it.

We'll build the same chat, but slowly. By the end you'll know what a block is, what a flow adds on top, why generators read history automatically, and where state lives. Roughly twenty minutes of reading and typing.

## What we're building

A streaming chat with a message counter. Each turn calls the LLM with conversation history and bumps a counter in session state.

That's small enough to fit on one screen but big enough to introduce the four ideas you'll use in every flow:

1. A **block** does one typed unit of work.
2. A **sequencer** chains blocks.
3. A **flow** mounts blocks under named actions and gives you a server-ready unit.
4. **Scopes** are where state lives — `session`, `request`, `user`, `org`.

We'll build it in five steps. Each step is runnable on its own.

## Step 0. Prerequisites

If you haven't yet, follow [Setting Up Models](/docs/getting-started/setting-up-models) to install the framework and configure an API key. The rest of this page assumes you have `@flow-state-dev/core`, `@flow-state-dev/server`, `@flow-state-dev/react`, and `zod` installed, and that one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` is set in your environment.

## Step 1. A generator on its own

A **generator** is one of the four block kinds. It calls an LLM. Every other block kind exists for the things around the LLM call — validation, dispatch, branching, persistence — but the generator is the one that actually talks to the model.

```ts title="src/flows/hello-chat/blocks.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const inputSchema = z.object({ message: z.string() });

export const chat = generator({
  name: "chat",
  model: "preset/small",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
});
```

A few things to notice:

- **`name`** is the block's identifier. It shows up in traces and the DevTool.
- **`model`** is a string. `"preset/small"` resolves at runtime to the first small-tier model whose provider has a key. See [Setting Up Models](/docs/getting-started/setting-up-models).
- **`inputSchema`** is a Zod schema. It's what the framework validates incoming data against, and what TypeScript uses to type the `input` parameter in `user`.
- **`history: true`** tells the generator to read prior conversation turns out of the session and include them in the LLM call. You don't manage messages yourself.
- **`user`** is a function that builds the user message from the input. The system prompt comes from `prompt`.

The block is a value. Once you wrap it in a flow (step 4), you can run it from the CLI without a server or browser:

```bash
fsdev run hello-chat chat -i '{"message": "Hello!"}'
```

Streaming text appears in your terminal as NDJSON. That's the first idea worth holding onto: **blocks are typed units, decoupled from how they run.** The same block runs over HTTP, in the CLI, and inside larger sequencers — composition is optional.

## Step 2. Add session state

A chat needs somewhere to put per-conversation state. In flow-state.dev that goes in **session scope**.

There are four scopes you'll see in practice:

| Scope | Lifetime | Example |
|-------|----------|---------|
| `request` | One action call | Tool call IDs, intermediate computations |
| `session` | One conversation | Message count, conversation summary |
| `user` | Across all sessions for a user | Preferences, model overrides |
| `org` | Shared across users in an org | Team-wide settings |

We're using `session`. Define the schema, then use a second block to mutate it.

For state-mutation-only work, the right pattern is a handler attached with `.tap()`. `.tap()` runs the handler for its side effects but passes the upstream value through unchanged. That keeps the items log clean (no echoed input) and gives the handler a reason to exist that isn't "transform this value."

```ts title="src/flows/hello-chat/blocks.ts"
import { generator, handler } from "@flow-state-dev/core";
import { z } from "zod";

export const inputSchema = z.object({ message: z.string() });

export const sessionStateSchema = z.object({
  messageCount: z.number().default(0),
});

export const chat = generator({
  name: "chat",
  model: "preset/small",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
});

export const bumpCounter = handler({
  name: "bump-counter",
  inputSchema: z.string(),
  sessionStateSchema,
  execute: async (_input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
  },
});
```

Two things worth pointing out:

- The handler's `inputSchema` is `z.string()` because it sits after the generator, which produces the assistant's response as a string. We don't use the value — we just need the type to match.
- `execute` is `async` and takes `(input, ctx)`. The context exposes the scopes (`ctx.session`, `ctx.user`, etc.). We call `incState` to atomically bump the counter.

The handler doesn't `return` anything. That matters: handlers used with `.tap()` shouldn't return their input verbatim, and shouldn't manufacture output they don't have. State mutation is the whole job.

## Step 3. Compose with a sequencer

We have two blocks. We want the second to run after the first. That's a **sequencer**.

```ts title="src/flows/hello-chat/blocks.ts"
import { generator, handler, sequencer } from "@flow-state-dev/core";
// ...keep the previous code...

export const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(chat)
  .tap(bumpCounter);
```

`.then(chat)` says "run `chat` next, with the upstream value as its input." The sequencer carries types through the chain, so TypeScript knows `bumpCounter` will be called with the generator's output (a string).

`.tap(bumpCounter)` runs the handler for its effect and forwards the upstream value to the next step. Compare to `.then`, which would replace the value with whatever the handler returned.

Sequencers have more methods — `.parallel`, `.work`, `.doUntil`, `.rescue` — but you only need `.then` and `.tap` to get this far. See [Sequencers](/docs/sequencers/overview) when you want the rest.

## Step 4. Wrap it as a flow

A sequencer is composable but not deployable. To call it over HTTP, mount it in a **flow**.

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { chatPipeline, inputSchema, sessionStateSchema } from "./blocks";

export default defineFlow({
  kind: "hello-chat",
  actions: {
    chat: {
      inputSchema,
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: sessionStateSchema,
  },
})();
```

What the pieces do:

- **`kind`** is the flow's identifier. The HTTP path includes it (`/api/flows/hello-chat/...`).
- **`actions`** is the public surface. Each action has an input schema and a block. Clients call actions, not blocks directly.
- **`userMessage`** tells the framework which part of the input is the human-readable user message. That's what gets persisted into history for `history: true` to read on the next turn. For the generator-side counterpart that resolves this turn's LLM input, see [Generator context > User slot](../advanced/generator-context.md#user-slot) — wiring both to the same source is safe.
- **`session.stateSchema`** is the typed shape of session state. The framework validates state writes against it.
- **`defineFlow(...)`** returns a factory. Calling it with no arguments produces the registerable instance. You can also pass `{ id, kind, actions, ... }` overrides for variants.

That's the whole flow.

## Step 5. Mount it and render it

The server side is a config object plus a single route. Describe the runtime with `createFlowState`:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import chatFlow from "@/flows/hello-chat/flow";

export const flowstate = createFlowState({
  flows: { chatFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

The handler returns standard `GET`/`POST`/`PATCH`/`DELETE` handlers. They handle action dispatch, SSE streaming with sequence-based resume, session creation, and state snapshots. `stores` names where state lives; `primary` is the catch-all slot. See [Server Setup](/docs/server/setup) for swapping in SQLite or Postgres.

The React side uses three pieces from `@flow-state-dev/react`:

```tsx title="src/app/page.tsx"
"use client";
import { FlowProvider, ItemsRenderer, useFlow, useSession } from "@flow-state-dev/react";

export default function Page() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser">
      <Chat />
    </FlowProvider>
  );
}

function Chat() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <div>
      <ItemsRenderer items={session.items} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const message = new FormData(e.currentTarget).get("message") as string;
          session.sendAction("chat", { message });
          e.currentTarget.reset();
        }}
      >
        <input name="message" placeholder="Type a message..." />
        <button type="submit" disabled={session.isStreaming}>
          {session.isStreaming ? "Working..." : "Send"}
        </button>
      </form>
    </div>
  );
}
```

Three new ideas:

- **`FlowProvider`** sets the flow kind and user identity for everything beneath it. You only need one near the root of your app.
- **`useFlow` and `useSession`** are the two hooks you'll use most. `useFlow` discovers or creates a session. `useSession` subscribes to its items, state snapshot, and streaming status.
- **`ItemsRenderer`** is the default plural item renderer. It dispatches each item to a built-in renderer based on its type — text messages, reasoning blocks, tool output, errors. You can register custom renderers later, but the defaults give you a working chat for free.

The counter you bumped in step 2 lives in session state. To surface it in the UI, the typed path is `clientData` — see [State and Scopes](/docs/fundamentals/state-and-scopes). For now it's enough to know it's there.

## What just happened

You wrote four things: a generator, a handler, a sequencer that chains them, and a flow that exposes the sequencer over HTTP. The framework gave you streaming, history, validation, persistence, and a React rendering layer.

The shape of every flow you write will be the same. You'll add more blocks, sometimes new kinds (a router for branching, a sequencer-of-sequencers for sub-pipelines), sometimes more scopes (user state, resources, work-pool jobs). But the primitive set doesn't grow. That's the design.

## Where to go from here

- **[Blocks](/docs/fundamentals/blocks)** — All four kinds in detail, including the rules for tool emission and sub-agents.
- **[Flows](/docs/fundamentals/flows)** — Actions, lifecycle hooks, authentication, resources.
- **[State and Scopes](/docs/fundamentals/state-and-scopes)** — When to put data in `session` versus `user` versus a resource.
- **[Sequencers](/docs/sequencers/overview)** — `parallel`, `work`, loops, `rescue`, and conditional steps.
- **[Streaming](/docs/streaming/overview)** — How items, deltas, and the SSE wire format fit together.
