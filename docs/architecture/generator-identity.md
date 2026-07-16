# Generator Identity

The generator block classifies its emissions using two identity primitives: `itemVisibility` (which governs what sees the output) and an optional `agentName` (which identifies the producing agent). Together they determine visibility, history scoping, and rendering.

## The visibility model

```ts
type ItemVisibility = { client: boolean; history: boolean };

generator({
  name: "chatbot",
  itemVisibility: { client: true, history: true },  // classifies visibility
  agentName: "chatbot",    // optional; defaults to `name`
  // ...
});
```

| `itemVisibility` | Auto-emits? | Client stream | Conversation history | Default `<ItemsRenderer>` |
|------------------|:-----------:|:-------------:|:--------------------:|:-------------------------:|
| `{ client: true, history: true }` | ✓ | ✓ | ✓ | rendered inline |
| `{ client: true, history: false }` | ✓ | ✓ | — | **hidden** (opt in via `showSubAgents`) |
| `{ client: false, history: false }` | ✓ | — | — | not in client stream |
| `{ client: false, history: true }` | ✓ | — | ✓ | not in client stream (private context) |
| *unset* | — | n/a | n/a | n/a |

A generator with no `itemVisibility` is a pure transformer — it runs the model, returns typed `block_trace` via graph edges, and produces no session items. Use this for structured-output generators that feed downstream blocks.

### Why two booleans

The `{ client, history }` pair answers two independent questions: should the user see this, and should the LLM see this? The common combinations map to familiar roles:

- **`{ client: true, history: true }`** — the user is talking to this thing. Messages go to the UI, and future turns in the session see them.
- **`{ client: true, history: false }`** — this thing is doing work on behalf of another agent. The user can watch it live (observability) but the broader conversation doesn't inherit its chatter.
- **`{ client: false, history: false }`** — this thing is an internal observer. The devtool wants to see its items for debugging, but the user shouldn't, and the LLM definitely shouldn't.
- **`{ client: false, history: true }`** — private/injected context. The LLM sees it in history but it never reaches the client. Previously impossible with the old three-value model.

## No position-inferred defaults

Every generator declares its own visibility explicitly. There is no "history: false if nested, history: true if top-level" inference — nesting is irrelevant. Pattern factories set `itemVisibility` on their internal generators; user-composed generators declare `itemVisibility` at the callsite.

Rationale: position-inferred defaults silently change emission based on where a block happens to be composed, making the system hard to reason about. Explicit visibility means every generator's classification is visible in its own config.

## Items inherit visibility from the producing generator

Every auto-emitted item is stamped with `{ itemVisibility, agentName }`. Structural items (status, component, container, etc.) also carry these fields when emitted from inside a generator's scope, but their visibility is fixed per type — the fields are metadata for filtering and rendering, not visibility. Trace types (`block_trace`, `router_decision`, `state_snapshot`) always resolve to `{ client: false, history: false }` regardless of what `itemVisibility` says.

## Multi-peer agents

Two generators with `itemVisibility: { client: true, history: true }` and distinct `agentName`s can coexist in the same session. Both see user messages and each other's messages via `history: true`.

```ts
const planner = generator({ name: "planner", itemVisibility: { client: true, history: true }, agentName: "planner", /* ... */ });
const executor = generator({ name: "executor", itemVisibility: { client: true, history: true }, agentName: "executor", /* ... */ });
```

When the planner runs, its history includes the user's messages plus prior planner and executor messages. Same for the executor.

## Parallel sub-agents — collaborative vs. isolated

`agentName` is how you choose between collaborative and isolated parallel work:

```ts
// Collaborative: three workers sharing an identity. They show up as one
// logical "researcher" in selectForContext queries, can share prior outputs.
const researcher = generator({
  name: "researcher",
  itemVisibility: { client: true, history: false },
  agentName: "researcher",  // all parallel instances share this name
  outputSchema: z.object({ findings: z.array(z.string()) })
});

// Isolated: each instance has a unique identity. selectForContext can
// address them individually; they don't spill into each other.
const makeIsolated = (id: string) => generator({
  name: `researcher-${id}`,
  itemVisibility: { client: true, history: false },
  agentName: `researcher-${id}`,
  outputSchema: z.object({ findings: z.array(z.string()) })
});
```

The pattern author picks without writing a custom store.

## Custom history via `selectForContext`

`session.items.history()` returns the conversation history — user messages + conversational items with `history: true` visibility. It's the ambient "what did we say so far?" view.

For anything else — a long-running sub-agent pulling its own prior outputs, a coordinator aggregating peer agent outputs — use `session.items.selectForContext(query)`:

```ts
const researcher = generator({
  name: "researcher",
  itemVisibility: { client: true, history: false },
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

`selectForContext` returns raw `SessionItem[]` — no visibility filtering, no conversation-history filter, no formatting. You get exactly the slice you asked for, so you can build whatever prompt context you need. It respects `includeTransient` and honors `itemVisibility` / `agentName` / `itemTypes` filters.

## Pattern factories take explicit visibility knobs

Patterns expose `*ItemVisibility` config fields per internal role. Defaults match the common case, but the pattern author can override:

| Pattern | Knobs |
|---------|-------|
| Supervisor | `workerItemVisibility` (default `{ client: true, history: false }`), `workerAgentName`, `synthesizerItemVisibility` (default `{ client: true, history: true }` if present) |
| Plan & Execute | `plannerItemVisibility`, `stepExecutorItemVisibility`, `evaluatorItemVisibility`, `replannerItemVisibility` (all default `{ client: true, history: false }`), `synthesizerItemVisibility` (default `{ client: true, history: true }`) |
| Coordinator | `workerItemVisibility` (default `{ client: true, history: false }`), `workerAgentName`, `plannerItemVisibility`, `mergerItemVisibility` |
| Blackboard | `controllerItemVisibility` (default `{ client: true, history: false }`), `synthesizerItemVisibility` (default `{ client: true, history: true }`) |
| Reactive Blackboard | `actorItemVisibility` (default `{ client: true, history: false }`) |
| Response Auditor | `auditorItemVisibility` (default `{ client: true, history: false }`) |
| Event Queue | `workerItemVisibility` (default `{ client: true, history: false }`) |
| RLM | `rootItemVisibility`, `subQueryItemVisibility` |

Thought-fabric-core background blocks (memory, metacognition) default to `itemVisibility: { client: false, history: false }` — their items appear in the devtool for debugging but never reach the client stream or history.

## Handler emits

Handlers (non-generator blocks) can emit items via `ctx.emit.message`, `ctx.emit.component`, etc. Those helpers accept optional `itemVisibility` / `agentName` in their options. Without them, conversational items fall back to default visibility (`{ client: true, history: true }`), preserving ergonomic handler emits.

```ts
// From a handler — default visibility (client + history):
ctx.emit.message("Hello, user.");

// Explicit visibility, e.g. for a handler that spawns work under a named agent:
ctx.emit.message("Background audit complete.", {
  itemVisibility: { client: false, history: false },
  agentName: "auditor",
});
```

## Default client rendering

The React `<ItemsRenderer>` filters items with `itemVisibility: { client: true, history: false }` by default. Opt in with `<ItemsRenderer items={session.items} showSubAgents />` to surface them inline. For richer per-agent UIs (collapsed panels, tabs), use `session.getItemsByAgent(name)` to pull the slice you want and render it yourself.

Items with `itemVisibility: { client: false, ... }` never reach the client via SSE — the devtool is the only consumer.

## Design rationale

- **Visibility metadata, not type remapping.** Sub-agent text is still a `message` item, not a "pseudo-reasoning" item. The semantic type is preserved; visibility is metadata. Clients decide rendering.
- **One conversation-history filter.** `history()` means "conversation history." Any richer slicing (per-agent, per-thread, topic-based) lives in pattern author territory, reached via `context` + `selectForContext`.
- **Explicit over inferred.** Position-inferred defaults would silently reclassify emissions based on composition shape, making behavior hard to predict. Every generator declares.
- **Two independent booleans over an enum.** The previous three-value `agentType` enum (`"primary"` / `"sub"` / `"trace"`) could not express the `{ client: false, history: true }` corner (private/injected context). Two booleans cover all four combinations without special-casing.
- **`agentName` as first-class identity.** Not just a label — the identity primitive that lets parallel workers share (collaborate) or diverge (isolate) without custom infrastructure.
