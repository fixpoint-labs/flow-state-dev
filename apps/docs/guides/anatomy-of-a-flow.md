---
sidebar_position: 1
title: Anatomy of a Flow
---

# Anatomy of a Flow

This guide gives you a mental map of how a flow-state-dev application fits together. No code to build. Just concepts, connections, and orientation.

If you're new to the framework, read this first. It explains what the pieces are and why they exist.

## 1. Blocks are the building units

Everything executable in flow-state-dev is a block. There are exactly four kinds:

- **Handler** — Pure logic. Validates input, transforms data, mutates state. No LLM. Think of it as a function that can read and write scope state. Handlers are silent by default: they don't emit messages or components unless you call `ctx.emitMessage()` or similar.
- **Generator** — LLM calls. The framework handles prompt assembly, tool loops, streaming, and output parsing. This is where AI happens. Generators automatically emit messages, reasoning traces, and tool call items as the model produces them.
- **Sequencer** — Composes blocks into pipelines. Chains steps, runs them in parallel, adds error recovery. The composition primitive. A sequencer is itself a block, so you can nest sequencers inside other sequencers or pass them to routers.
- **Router** — Selects one block at runtime based on input or state. Mode switching, intent routing, conditional flows. The router's `execute` function returns the block to run. The framework then executes that block with the router's input.

All blocks share the same contract: input in, output out. Any block composes with any other. No special cases. This uniformity is deliberate: you don't need different composition rules for "AI blocks" vs "logic blocks."

## 2. Sequencers compose blocks

A sequencer replaces the agent-vs-workflow split you see in other frameworks. You don't choose between "agentic" and "deterministic." You chain blocks. Each step's output becomes the next step's input.

```ts
const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(chatGen)  // output: assistant message
  .tap(counter);  // counter only mutates state, so the chain attaches it as a tap
```

The order matters. In this example, the generator produces the response. The counter runs after, incrementing session state. Because it has no transformation, we attach it with `.tap()` so the assistant message flows through as the pipeline's result. Data flows in one direction.

Sequencers also support conditional steps (`thenIf`), parallelism (`parallel`), loops (`doUntil`, `doWhile`), and error recovery (`rescue`). You can branch to different blocks based on conditions. The key idea: composition is the primary abstraction, not "agent" vs "workflow."

## 3. Flows tie it together

A flow is the deployable unit. It bundles blocks, state, and client visibility into one registerable object.

- **`kind`** — The identifier. Becomes the URL path (`/api/flows/hello-chat/...`). Clients use this to target the right flow.
- **`actions`** — Entry points. Each action maps to a root block. When a client calls `sendAction("chat", { message: "Hi" })`, the framework looks up the "chat" action, validates the input, and runs its block.
- **State schemas** — For request, session, user, and project scopes. Blocks declare partial schemas; the flow merges them into full scope contracts.
- **Resources** — Named, typed data stores attached to scopes. Blocks can declare resource dependencies; the flow wires them up.
- **`client` block** — The privacy gateway. Each scope's `client` block declares what state crosses to the browser via `expose` (verbatim field names) and `derived` (computed projections). State without a `client` entry stays on the server.

A minimal flow:

```ts
defineFlow({
  kind: "my-app",
  requireUser: true,
  actions: {
    chat: { inputSchema, block: chatPipeline, userMessage: (i) => i.message },
  },
  session: { stateSchema, client: { expose: ["count"] } },
});
```

`defineFlow` returns a flow type. You call it with `({ id: "default" })` to produce an instance you register with the server. Instances support merge-based overrides if you need to swap actions or config at creation time.

## 4. Actions are the public API

Clients invoke actions by name. The framework:

1. Validates input against the action's `inputSchema` — Zod validates before any block runs. Invalid input returns a validation error without touching your blocks.
2. Resolves or creates a session — If the client sends a `sessionId`, the framework loads that session. Otherwise it creates an ephemeral one (or a persisted one, depending on flow config). Sessions carry state and items across requests.
3. Executes the root block — The block runs in an execution context with access to scopes, emission, and model resolution. Items stream out as blocks emit them.
4. Streams results via SSE — The client opens a stream for the `requestId` returned in the POST response. Events arrive in order with sequence numbers.
5. Persists state when the run completes — When the block finishes, the framework commits scope mutations, fires lifecycle hooks, and marks the request complete.

The HTTP flow: `POST /api/flows/:kind/actions/:action` (or with `:sessionId` for an existing session). The server returns `202 Accepted` immediately with a `requestId`. Execution happens asynchronously. The client connects to the SSE stream for that `requestId` to receive items and deltas in real time.

## 5. State lives in scopes

Four nested levels, each with typed atomic operations:

| Scope   | Lifetime                 |
|---------|--------------------------|
| Request | Single action run        |
| Session | Across requests (a conversation) |
| User    | Across sessions for a user |
| Project | Shared across users      |

Request scope exists only for the duration of one action. Session scope is where most state lives for chat-style apps: conversation mode, message counts, in-progress drafts. User scope spans sessions: preferences, feature flags, usage quotas. Project scope is shared across users: team config, shared resources.

Blocks declare partial schemas: they only specify the fields they read or write. A counter block doesn't need to know about preferences. The framework merges these declarations at the flow level. This keeps blocks portable and self-documenting.

Operations like `incState` and `pushState` are CAS-guarded. Concurrent requests won't lose updates. Each write is atomic. The framework handles version conflicts and retries internally.

## 6. Items are the data model

Every output in the framework is a typed item: messages, reasoning, tool calls, state changes, custom components. Items persist in sessions, stream to clients, and feed back into LLM context (when their type permits).

Items are the durable record of what happened. They have a lifecycle: `in_progress` → `completed` (or `failed`, `incomplete`). Content streams within items via delta events. A message item might receive many `content.delta` events before it's finalized.

Item types determine audience routing. Some types go to the client UI (messages, components, status). Some go only to the LLM (context, tool results). Some are internal (block_output for devtools). You don't configure this per block; the framework routes by type.

## 7. Streaming happens automatically

SSE with sequence numbers. Clients can disconnect and resume from where they left off. No manual reconnection logic. The client SDK and React hooks handle it.

The stream carries `item.added`, `content.delta`, `item.done`, and terminal events like `request.completed`. Each event has a sequence number for ordering and replay. Clients send `Last-Event-ID` or `starting_after` on reconnect; the server replays missed events then continues live. No data loss, no duplicates.

## 8. The server is generated

Register flows. Get a full REST API. No route wiring.

You create a registry, register your flow instances, and pass the registry to `createFlowApiRouter`. That router exposes POST for actions, GET for streams and state snapshots, DELETE for session cleanup. One catch-all route in Next.js is enough.

## 9. React hooks make it reactive

- **FlowProvider** — Sets `flowKind` and `userId` context. Wraps your app or a section of it. Registers custom renderers for item types (messages, reasoning, components). Nested providers merge renderers; child keys override parent.
- **useFlow** — Session lifecycle. Create sessions, switch between them, track the active one. With `autoCreateSession: true`, creates a session on mount if none exists. Returns `sessions`, `activeSessionId`, `createSession()`, `selectSession()`.
- **useSession** — Connects to the SSE stream for a session. Delivers items in real time. Provides `sendAction` and `isStreaming`. Configure `items.visibility` to filter which items appear (e.g. "ui" for client-visible only). Re-renders when items change, streaming status changes, or the session detail updates.
- **useClientData** — Reads the latest state snapshot. Only sees what the flow's `clientData` entries expose. Specify which keys to subscribe to: `{ session: ["messageCount", "mode"] }`. Refetches after `request.completed` and when state invalidation events arrive.

The hooks subscribe to the right streams and re-render when data changes. You don't manage connections manually. The client package handles HTTP, SSE, reconnection, and cursor-based resume.

## 10. Testing is deterministic

The testing harness uses mocked generators. No real LLM calls. No network. Same contracts as production: validation, session resolution, block execution, state persistence, lifecycle hooks.

You run flows and blocks in an isolated runtime with in-memory stores. Seed state with `seed.session`, `seed.user`, or `seed.project` to simulate specific scenarios. Tests stay fast and reproducible.

`testFlow` returns the full result: items, session state, request metadata. Assert on what matters: item types and content, final state values, error messages. For blocks in isolation, use `testBlock` from the same package. It runs a single block with optional scope seeding and mocked dependencies. Both use the same execution engine as production; only the stores and model resolution differ.

---

## Go deeper

- [Blocks](/docs/fundamentals/blocks) — Handler, generator, sequencer, router in detail
- [Flows and Actions](/docs/fundamentals/flows) — Flow definition, actions, lifecycle
- [State and Scopes](/docs/fundamentals/state-and-scopes) — Scope hierarchy, partial schemas, CAS
- [Streaming](/docs/streaming/overview) — Items, content model, resume semantics
- [Server Setup](/docs/server/setup) — Registry, router, model resolution
- [React Integration](/docs/client/react) — Hooks, renderers, clientData
- [Testing](/docs/testing/overview) — Test harness, mocks, seeding
