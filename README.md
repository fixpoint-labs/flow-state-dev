# @flow-state-dev

**Build AI workflows with blocks. Get streaming, state, retries, and type safety for free.**

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";

const chat = generator({
  name: "chat",
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
});

const trackUsage = handler({
  name: "track-usage",
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
    return input;
  },
});

const pipeline = sequencer({ name: "chat-pipeline" })
  .step(chat)
  .step(trackUsage);

export default defineFlow({
  kind: "my-app",
  actions: {
    chat: { block: pipeline, userMessage: (i) => i.message },
  },
  session: { stateSchema: z.object({ messageCount: z.number().default(0) }) },
})({ id: "default" });
```

That's a streaming chat with conversation history, session state, and atomic counters. No transport wiring. No SSE plumbing. No retry logic. The framework handles all of it.

## What you get

**Four block primitives. Infinite compositions.**

| Block | What it does |
|-------|-------------|
| **handler** | Pure logic — validate, transform, mutate state, implement tools |
| **generator** | Call an LLM with managed tool loops, streaming, and structured output repair |
| **sequencer** | Compose blocks into pipelines with `.step()`, `.parallel()`, `.rescue()`, `.forEach()`, and 10 more DSL methods |
| **router** | Dispatch to different pipelines at runtime based on input or state |

Any block or sequence of blocks can be used as a tool. A single tool call can trigger an entire multi-step pipeline — your AI's tools can be as sophisticated as any other part of your workflow.

**Scoped state that scales.** Four isolation levels — request, session, user, project — each with atomic operations (`patchState`, `incState`, `pushState`, `atomicState`). Every block declares only the state fields it needs. Type-safe all the way down.

**Resumable streaming out of the box.** Items stream over SSE as blocks execute. Disconnect mid-response? Reconnect with a sequence cursor and pick up exactly where you left off. No data loss. No duplicate events.

**Resources: hybrid memory and filesystem.** Each resource combines rich text content with structured atomic state — like files that carry metadata. An artifact can hold a document's full text alongside its title, tags, and timestamps. Scoped to sessions, users, or projects. Projections derive client-safe views from state and resources, giving the frontend exactly the shape it needs without manual data wiring.

**First-class error handling.** Retry policies per block. Type-based rescue routing. Non-aborting work queues for side-chain operations. Normalized error model with codes, scopes, and retry signals.

**Full-stack type safety.** Define a schema once in Zod. It validates at runtime, infers at compile time, and flows from server blocks through the client SDK to React hooks. One type system, zero glue code.

## The developer experience

**Flows are full APIs.** Register a flow and you get action execution, session management, SSE streaming, and state snapshots — zero route wiring:

**Server** — Three lines to a complete API:

```ts
const registry = createFlowRegistry();
registry.register(myFlow);
export const { GET, POST, DELETE } = createFlowApiRouter({ registry });
```

**Client** — Connect from anywhere, framework handles SSE and state sync:

```ts
const client = createClient({ flowKind: "my-app", userId: "user_1" });
await client.sendAction("chat", { message: "Hello" });
```

**React** — Hooks that wire streaming, items, and clientData to your UI:

```tsx
<FlowProvider flowKind="my-app" userId="user_1">
  <ChatUI />
</FlowProvider>

function ChatUI() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <>
      {session.items.map(item => <ItemRenderer key={item.id} item={item} />)}
      <button onClick={() => session.sendAction("chat", { message: "Hi" })}>
        Send
      </button>
    </>
  );
}
```

**Testing** — Deterministic tests with generator mocks, no real LLM calls:

```ts
import { testBlock, testItems } from "@flow-state-dev/testing";

const result = await testBlock(pipeline, {
  input: { message: "Hello" },
  session: { state: { messageCount: 0 } },
  generators: { "chat": mockGenerator({ script: [{ text: "Hi there!" }] }) },
});

const items = testItems(result.items);
expect(items.messages()).toHaveLength(1);
expect(result.output).toBeDefined();
```

**Built for an ecosystem.** Blocks and flows are portable. Share a tool block, a validation handler, or a complete agentic flow across projects. The uniform block contract means community blocks compose with yours out of the box.

## When this framework is for you

- You're building AI-powered features and tired of reinventing orchestration, streaming, and state management every time.
- You want composable primitives, not a rigid agent framework that prescribes how you structure your AI.
- You want tools that can be as powerful as your workflows — multi-step pipelines, not just function wrappers.
- You want your AI to have a real workspace: persistent resources with rich content and typed state, not just chat history.
- You care about execution semantics — retry, rescue, lifecycle hooks — being explicit and testable, not hidden in application glue.
- You want one coherent stack across server, client, React, CLI, and tests.

## Packages

| Package | Purpose |
|---------|---------|
| [`@flow-state-dev/core`](packages/core) | Block builders, flow definitions, type contracts, item taxonomy |
| [`@flow-state-dev/engine`](packages/engine) | Execution runtime, stores, SSE streaming, HTTP routes |
| [`@flow-state-dev/client`](packages/client) | Isomorphic API client — actions, sessions, streams |
| [`@flow-state-dev/react`](packages/react) | React hooks and renderers |
| [`@flow-state-dev/testing`](packages/testing) | Test harnesses and generator mocks |
| [`@flow-state-dev/cli`](packages/cli) | Terminal interface (`fsdev run`, `fsdev dev`) |
| [`@flow-state-dev/devtool`](packages/devtool) | Pre-built DevTool assets for `fsdev dev` |
| [`apps/devtool`](apps/devtool) | DevTool source app |

## Quick start

```bash
# Prerequisites: Node.js >=22, pnpm@10.4.1
pnpm install
pnpm typecheck
pnpm test
```

## Apps and Examples

Two directories, different purposes:

- `apps/*` — full reference applications we maintain, test against, and use for day-to-day feature work. Larger in scope; multiple flows; polished UI.
- `examples/*` — minimal, focused, pedagogical. Each example fits in a single README section.

**[apps/kitchen-sink](apps/kitchen-sink)** — Reference app. Hosts the `chat-agent` flow (handler + generator + router + sequencer, resources, clientData, capabilities, tool-use) and everything the framework can do in a full Next.js UI.

**[examples/hello-chat](examples/hello-chat)** — Minimal chat flow. Generator + handler + sequencer in ~50 lines. Start here.

## Architecture

The framework ships as six packages with strict dependency boundaries:

```
core ← server ← testing
core ← client ← react ← apps/devtool
```

- `server` never depends on `client` or `react`
- `react` wraps `client` — no transport logic in the UI layer
- `apps/devtool` uses only public APIs

Request lifecycle:
```
POST /api/flows/{kind}/actions/{action}
  → 202 Accepted (async execution)
  → SSE stream: items, content deltas, status events
  → request.completed
  → Client refetches state snapshot
```

Resume after disconnect: `Last-Event-ID` or `starting_after` query param replays events from the sequence cursor.

## Documentation

**Architecture** (`docs/architecture/`):
- [Overview](docs/architecture/overview.md) — System architecture, data flow, core abstractions
- [Blocks](docs/architecture/blocks.md) — Handler, generator, sequencer, router deep dive
- [Flows and Actions](docs/architecture/flows-and-actions.md) — defineFlow, actions, lifecycle hooks
- [State and Scopes](docs/architecture/state-and-scopes.md) — Four scopes, atomic ops, CAS concurrency
- [Streaming](docs/architecture/streaming.md) — Item/content model, SSE protocol, resume semantics
- [Execution and Errors](docs/architecture/execution-and-errors.md) — Retry, rescue, work queue
- [Resources and Client Data](docs/architecture/resources-and-client-data.md) — Typed data containers and derived client views
- [Sequencer DSL](docs/architecture/sequencer-dsl.md) — Full method reference
- [Server and Client](docs/architecture/server-and-client.md) — Routes, transport, React hooks

**Contributing** (`docs/contributing/`):
- [Best Practices](docs/contributing/best-practices.md) — Implementation standards
- [Architecture Reference](docs/contributing/architecture-reference.md) — Locked contracts
- [Development Setup](docs/contributing/development-setup.md) — Monorepo workflow
- [Wave Process](docs/contributing/wave-process.md) — Wave execution protocol

## Current status

Phase 1 (Foundation) — Waves 1.a through 1.k are complete. Core contracts, block builders, server runtime, client transport, React bindings, and testing utilities are all implemented and tested. CLI and devtool are in active development.

## Contributing

- See [`AGENTS.md`](AGENTS.md) for the process protocol
- See [`docs/contributing/`](docs/contributing/) for standards and setup
- Keep implementation standards in `docs/contributing/best-practices.md`
- See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidelines
- See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for community standards

## License

MIT — see [`LICENSE`](LICENSE) for details. Copyright (c) 2026 Fixpoint Labs.
