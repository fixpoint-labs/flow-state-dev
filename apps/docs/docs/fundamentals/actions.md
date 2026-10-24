---
sidebar_position: 4
---

# Actions

Actions are how the outside world talks to your flow. When a client sends a message, resets state, or triggers any processing — it invokes an action. Actions are the flow's public API: named entry points with validated input and a block to execute.

## Defining actions

Actions live inside `defineFlow`:

```ts
const myFlow = defineFlow({
  kind: "my-app",
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
    saveArtifact: {
      inputSchema: artifactInputSchema,
      block: updateArtifact,
    },
  },
});
```

Each action has:
- **`inputSchema`** — Zod schema that validates every incoming request. Invalid input is rejected before any block runs.
- **`block`** — The block (or pipeline) to execute. This is where the work happens.
- **`userMessage`** (optional) — Extracts a display string from the input. The framework emits it as a user-role `message` item before execution begins, so the conversation history shows what the user said. The emitted item is what transports, replay, and observability read; it also feeds future turns' `history`. It does not directly feed this turn's LLM call — that's the generator's `user` slot. Wiring both to the same source is safe; the framework deduplicates equivalent content at message assembly. See [Generator context > User slot](../advanced/generator-context.md#user-slot) for the generator-side counterpart.
- **`concurrency`** (optional) — Declares what happens when requests collide on the same session. See [Concurrency policies](../advanced/concurrency-policies.md).

## Invoking actions

### From the client SDK

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({ userId: "user_1", baseUrl: "http://localhost:3000" });
const app = fsd.flow("my-app");

// New session (auto-created)
const sent = await app.send("chat", { message: "Hello!" });

// Existing session
await app.send("chat", { message: "Hello!" }, { sessionId: "sess_123" });

// Wait for it to settle, or follow it live with sent.stream({ ... })
const { status } = await sent.wait();
```

### From React

```tsx
const session = useSession(sessionId);
await session.sendAction("chat", { message: "Hello!" });
```

### Over HTTP

```
POST /api/flows/:kind/actions/:action              # New session
POST /api/flows/:kind/:sessionId/actions/:action    # Existing session
```

The server returns `202 Accepted` immediately with a `requestId`. Execution happens asynchronously — the client connects to the SSE stream to receive results:

```
GET /api/flows/:kind/requests/:requestId/stream
```

## How an action executes

```
Client                        Server
  |                             |
  |-- POST /actions/chat ------>|
  |   { input, userId }        |-- validate input
  |                             |-- resolve/create session
  |<-- 202 { request: { id } }-|
  |                             |-- execute block (async)
  |-- GET /requests/:id/stream->|
  |<-- SSE events --------------|  item.added, content.delta, ...
  |<-- request.completed -------|
  |                             |
```

Step by step:
1. **Validate** — Input is checked against `inputSchema`. Bad input returns 400.
2. **Session** — Resolved from `sessionId` or created new.
3. **User message** — If `userMessage` is defined, a user-role message item is emitted to the stream.
4. **Execute** — The root block runs asynchronously. Items stream to the client as they're produced.
5. **Complete** — Lifecycle hooks fire. The stream emits `request.completed` (or `request.failed`).

## Typed actions

For compile-time type safety, pass your flow's type to `fsd.flow`. Action names and inputs are then checked against the flow definition:

```ts
import type { myFlow } from "./flows/my-app";

const app = fsd.flow<typeof myFlow>("my-app");

await app.send("chat", { message: "Hello!" });     // Type-checked
await app.send("reset", {});                       // Type-checked
await app.send("invalid", { message: "Hello!" }); // TypeScript error
```

Use `import type` so the flow's server code stays out of a browser bundle.
