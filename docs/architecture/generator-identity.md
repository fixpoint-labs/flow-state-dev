# Generator Identity

The generator block classifies its emissions using a single identity primitive: `agentType` plus an optional `agentName`. Identity determines who the generator is in the composition, which governs visibility, history scoping, and rendering.

## The three identities

```ts
type AgentType = "primary" | "sub" | "trace";

generator({
  name: "chatbot",
  agentType: "primary",    // classifies the identity
  agentName: "chatbot",    // optional; defaults to `name`
  // ...
});
```

| `agentType` | Auto-emits? | Client stream | Conversation history | Default `<ItemsRenderer>` |
|-------------|:-----------:|:-------------:|:--------------------:|:-------------------------:|
| `"primary"` | ✓ | ✓ | ✓ | rendered inline |
| `"sub"`     | ✓ | ✓ | — | **hidden** (opt in via `showSubAgents`) |
| `"trace"`   | ✓ | — | — | not in client stream |
| *unset*     | — | n/a | n/a | n/a |

A generator with no `agentType` is a pure transformer — it runs the model, returns typed `block_output` via graph edges, and produces no session items. Use this for structured-output generators that feed downstream blocks.

### Why three values

The three buckets answer distinct product questions:

- **`"primary"`** — the user is talking to this thing. Messages go to the UI, and future turns in the session see them.
- **`"sub"`** — this thing is doing work on behalf of a primary agent. The user can watch it live (observability) but the broader conversation doesn't inherit its chatter.
- **`"trace"`** — this thing is an internal observer. The devtool wants to see its items for debugging, but the user shouldn't, and the LLM definitely shouldn't.

## No position-inferred defaults

Every generator declares its own identity explicitly. There is no "sub if nested, primary if top-level" inference — nesting is irrelevant. Pattern factories set `agentType` on their internal generators; user-composed generators declare `agentType` at the callsite.

Rationale: position-inferred defaults silently change emission based on where a block happens to be composed, making the system hard to reason about. Explicit identity means every generator's classification is visible in its own config.

## Items inherit identity from the producing generator

Every auto-emitted item is stamped with `{ agentType, agentName }`. Structural items (status, component, container, block_output, etc.) also carry identity when emitted from inside a generator's scope, but their visibility is fixed per type — the identity is metadata for filtering and rendering, not visibility.

## Multi-peer agents

Two generators with `agentType: "primary"` and distinct `agentName`s can coexist in the same session. Both see user messages and each other's messages via `history: true`.

```ts
const planner = generator({ name: "planner", agentType: "primary", agentName: "planner", /* ... */ });
const executor = generator({ name: "executor", agentType: "primary", agentName: "executor", /* ... */ });
```

When the planner runs, its history includes the user's messages plus prior planner and executor messages. Same for the executor.

## Parallel sub-agents — collaborative vs. isolated

`agentName` is how you choose between collaborative and isolated parallel work:

```ts
// Collaborative: three workers sharing an identity. They show up as one
// logical "researcher" in selectForContext queries, can share prior outputs.
const researcher = generator({
  name: "researcher",
  agentType: "sub",
  agentName: "researcher",  // all parallel instances share this name
  outputSchema: z.object({ findings: z.array(z.string()) })
});

// Isolated: each instance has a unique identity. selectForContext can
// address them individually; they don't spill into each other.
const makeIsolated = (id: string) => generator({
  name: `researcher-${id}`,
  agentType: "sub",
  agentName: `researcher-${id}`,
  outputSchema: z.object({ findings: z.array(z.string()) })
});
```

The pattern author picks without writing a custom store.

## Custom history via `selectForContext`

`session.items.history()` returns the conversation history — user messages + `primary`-typed conversational items. It's the ambient "what did we say so far?" view.

For anything else — a long-running sub-agent pulling its own prior outputs, a coordinator aggregating peer agent outputs — use `session.items.selectForContext(query)`:

```ts
const researcher = generator({
  name: "researcher",
  agentType: "sub",
  agentName: "researcher",
  context: (input, ctx) => {
    const priorFindings = ctx.session.items.selectForContext({
      agentName: "researcher",
      itemTypes: ["message"],
      limit: 10
    });
    return `<past-findings>${formatAsText(priorFindings)}</past-findings>`;
  },
  // ...
});
```

`selectForContext` returns raw `SessionItem[]` — no visibility filtering, no conversation-history filter, no formatting. You get exactly the slice you asked for, so you can build whatever prompt context you need. It respects `includeTransient` and honors `agentType` / `agentName` / `itemTypes` filters.

## Pattern factories take explicit identity knobs

Patterns expose `*AgentType` config fields per internal role. Defaults match the common case, but the pattern author can override:

| Pattern | Knobs |
|---------|-------|
| Supervisor | `workerAgentType` (default `"sub"`), `workerAgentName`, `synthesizerAgentType` (default `"primary"` if present) |
| Plan & Execute | `plannerAgentType`, `stepExecutorAgentType`, `evaluatorAgentType`, `replannerAgentType` (all default `"sub"`), `synthesizerAgentType` (default `"primary"`) |
| Coordinator | `workerAgentType` (default `"sub"`), `workerAgentName`, `plannerAgentType`, `mergerAgentType` |
| Blackboard | `controllerAgentType` (default `"sub"`), `synthesizerAgentType` (default `"primary"`) |
| Reactive Blackboard | `actorAgentType` (default `"sub"`) |
| Response Auditor | `auditorAgentType` (default `"sub"`) |
| Event Queue | `workerAgentType` (default `"sub"`) |
| RLM | `rootAgentType`, `subQueryAgentType` |

Thought-fabric-core background blocks (memory, metacognition) default to `agentType: "trace"` — their items appear in the devtool for debugging but never reach the client stream or history.

## Handler emits

Handlers (non-generator blocks) can emit items via `ctx.emitMessage`, `ctx.emitComponent`, etc. Those helpers accept optional `agentType` / `agentName` in their options. Without them, the item has no identity — conversational items fall back to agent-equivalent visibility (`client: true, history: true`), preserving ergonomic handler emits.

```ts
// From a handler — implicit agent-equivalent visibility:
ctx.emitMessage("Hello, user.");

// Explicit identity, e.g. for a handler that spawns work under a named agent:
ctx.emitMessage("Background audit complete.", { agentType: "trace", agentName: "auditor" });
```

## Default client rendering

The React `<ItemsRenderer>` filters `agentType === "sub"` items by default. Opt in with `<ItemsRenderer items={session.items} showSubAgents />` to surface them inline. For richer per-agent UIs (collapsed panels, tabs), use `session.getItemsByAgent(name)` to pull the slice you want and render it yourself.

`agentType: "trace"` items never reach the client via SSE — the devtool is the only consumer.

## Design rationale

- **Identity metadata, not type remapping.** Sub-agent text is still a `message` item, not a "pseudo-reasoning" item. The semantic type is preserved; identity is metadata. Clients decide rendering.
- **One conversation-history filter.** `history()` means "conversation history." Any richer slicing (per-agent, per-thread, topic-based) lives in pattern author territory, reached via `context` + `selectForContext`.
- **Explicit over inferred.** Position-inferred defaults would silently reclassify emissions based on composition shape, making behavior hard to predict. Every generator declares.
- **`agentName` as first-class identity.** Not just a label — the identity primitive that lets parallel workers share (collaborate) or diverge (isolate) without custom infrastructure.
