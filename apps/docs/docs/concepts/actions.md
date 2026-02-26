---
sidebar_position: 3
---

# Actions

Actions are the entry points into a flow. When a client wants to do something — send a message, reset state, trigger processing — it invokes an action.

## Defining Actions

Actions are defined inside `defineFlow`:

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
  },
});
```

Each action has:
- **`inputSchema`** — Zod schema for validating action input
- **`block`** — The block (or pipeline) to execute
- **`userMessage`** (optional) — Extracts a user message string from the input, emitted as a `message` item before block execution

## Invoking Actions

### From the client

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({ flowKind: "my-app", userId: "devuser" });

// Dynamic action name
await client.sendAction("chat", { message: "Hello!" });

// With an existing session
await client.sendAction("chat", { message: "Hello!" }, { sessionId: "sess_123" });
```

### From React

```tsx
const session = useSession(sessionId);

// Primary pattern — via useSession
await session.sendAction("chat", { message: "Hello!" });
```

### HTTP API

Actions are exposed at:

```
POST /api/flows/:kind/actions/:action              # New session
POST /api/flows/:kind/:sessionId/actions/:action    # Existing session
```

The server returns `202 Accepted` immediately with a `requestId`. Execution happens asynchronously — the client connects to the SSE stream to receive results:

```
GET /api/flows/:kind/requests/:requestId/stream
```

## Execution Flow

```
Client                        Server
  │                             │
  ├─ POST /actions/chat ──────►│
  │   { input, userId }        ├─ validate input
  │                             ├─ resolve/create session
  │◄── 202 { requestId } ──────┤
  │                             ├─ execute block (async)
  ├─ GET /requests/:id/stream ►│
  │◄── SSE events ─────────────┤  item.added, content.delta, ...
  │◄── request.completed ──────┤
  │                             │
```

## Action Lifecycle

1. **Validate** — Input is checked against `inputSchema`
2. **Session** — Resolved from `sessionId` or created new
3. **User message** — `userMessage(input)` emitted if defined
4. **Execute** — Block runs asynchronously
5. **Complete or Error** — Lifecycle hooks fire, stream closes

## Typed Actions

For compile-time type safety, use `createTypedClient`:

```ts
import { createTypedClient } from "@flow-state-dev/client";

const client = createTypedClient({ flow: myFlow, userId: "devuser" });

// Type-safe action methods
await client.actions.chat({ message: "Hello!" });
// TypeScript error: Property 'invalid' does not exist
await client.actions.invalid({ message: "Hello!" });
```
