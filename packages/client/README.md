# @flow-state-dev/client

**Connect to flows from anywhere. Actions, sessions, streaming — no framework lock-in on the client side.**

Works in Node, the browser, edge runtimes. No React dependency. No DOM dependency. Just HTTP and SSE.

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({ flowKind: "my-app", userId: "user_1" });

// Send an action and get back a request ID
const { requestId } = await client.sendAction("chat", { message: "Hello" });

// Or use a typed client for compile-time action safety
const typed = createTypedClient({ flow: myFlowDefinition, userId: "user_1" });
await typed.actions.chat({ message: "Hello" });
```

## Streaming

Subscribe to a request's SSE stream with typed event handlers:

```ts
import { createSSEClient } from "@flow-state-dev/client";

const stream = createSSEClient({
  url: `/api/flows/my-app/requests/${requestId}/stream`,
  onItemAdded: (event) => {
    // New item appeared (message, reasoning, component, etc.)
  },
  onContentDelta: (event) => {
    // Text chunk arrived — append to the current item's content
  },
  onRequestStatus: (event) => {
    if (event.status === "completed") {
      // Refetch state snapshot for the authoritative final state
    }
  },
});
```

Resume after disconnect — pass a sequence cursor and the server replays missed events:

```ts
const stream = createSSEClient({
  url: `/api/flows/my-app/requests/${requestId}/stream?starting_after=${lastSeq}`,
  // ...handlers
});
```

## Session management

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "/api" });

// State snapshot with projections and items
const snapshot = await sessions.getSessionState("sess_1", {
  includeItems: true,
  projections: ["session.artifactsList", "user.preferences"],
});
```

## `createClient` vs `createTypedClient`

| | `createClient` | `createTypedClient` |
|--|----------------|---------------------|
| Action calls | `sendAction("chat", input)` | `actions.chat(input)` |
| Type safety | Runtime only | Compile-time + runtime |
| Best for | Generic UIs, devtools | App code with known flow definitions |

## Public API

- `createClient(options)` — Dynamic action client
- `createTypedClient(options)` — Flow-bound typed client
- `createSessionClient(options)` — Session CRUD and state snapshots
- `createSSEClient(options)` — Request stream consumer
- `createUserSSEClient(options)` — User-level stream consumer
- `ClientHttpError` — Typed HTTP error class

## Notes

- `userId` is required for Phase 1 action/session calls
- Stream resume supports both `Last-Event-ID` header and `starting_after` query param
- When both are supplied, `starting_after` takes precedence

## Scripts

```bash
pnpm --filter @flow-state-dev/client build
pnpm --filter @flow-state-dev/client typecheck
pnpm --filter @flow-state-dev/client test
```

## Architecture reference

- [Server and Client](../../docs/architecture/server-and-client.md) — Routes, transport, React hooks contract
- [Streaming](../../docs/architecture/streaming.md) — Item/content model, SSE protocol, resume semantics
