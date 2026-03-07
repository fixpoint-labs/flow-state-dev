# State and Scopes

Flow State Dev manages state across four hierarchical scopes, each with typed atomic operations and CAS-based concurrency control.

## Scope Hierarchy

```
request → session → user → project
  (per request)  (per session)  (per user)  (shared)
```

- **Request**: Ephemeral, exists for one action execution
- **Session**: Persisted, user-bound, carries conversation history
- **User**: Persisted, spans sessions, holds user preferences/resources
- **Project**: Persisted, shared across users

**Phase 1 policy:** User context is required for all flow execution. Sessions are always available — ephemeral sessions auto-create when no `sessionId` is provided.

## State Operations

Each scope provides the same set of atomic operations via `ScopeStateOps<TState>`:

```ts
// Merge partial updates into state
await ctx.session.patchState({ messageCount: count + 1 });

// Replace entire state
await ctx.session.setState({ mode: "edit", messageCount: 0 });

// Atomic increment (safe for concurrent writes)
await ctx.session.incState({ messageCount: 1 });

// Push to an array field
await ctx.session.pushState("tags", "new-tag");

// Set a key in a record field
await ctx.session.setStateRecord("preferences", "theme", "dark");

// Delete a key from a record field
await ctx.session.deleteStateRecord("preferences", "theme");

// Custom atomic transform (CAS-guarded)
await ctx.session.atomicState((state) => ({
  ...state,
  messageCount: state.messageCount + 1,
}));
```

### Atomicity Guarantees

- `incState`, `pushState`, `setStateRecord`, `deleteStateRecord` are internally atomic per scope write
- Each operation is a single CAS-guarded mutation, not client-side read-modify-write
- Concurrent calls won't lose updates
- `patchState`/`setState` are NOT automatically commutative — use `atomicState` for custom concurrent transforms

## CAS and Concurrency

Every persisted scope state is versioned. Writes provide an expected version; mismatches trigger optimistic retry.

```ts
// The framework handles CAS internally. You just use the ops.
await ctx.session.patchState({ count: newCount });
// If another concurrent write bumped the version, the framework retries with bounded retries.
```

On retry exhaustion, a `ConcurrentModificationError` is thrown.

### CAS cloning guidance

- CAS containers use deep cloning to preserve immutable write semantics and avoid accidental shared mutation.
- This trade-off is acceptable for typical Phase 1 scope state payloads (targeting small, kilobyte-scale objects).
- The runtime emits warnings when scope state exceeds the default `10KB` threshold so integrators can spot large-state pressure early.

**Concurrency guidance:**
- Avoid read-modify-write patterns inside `parallel`/`forEach` unless using atomic ops
- Prefer `incState`, `pushState`, `setStateRecord` for concurrent writes
- Use `maxConcurrency` on `parallel`/`forEach` when shared state writes are unavoidable

## Scope Handles

Each scope is accessed through a typed handle on `BlockContext`:

```ts
// Request scope (always available)
ctx.request.state          // Readonly<TRequestState>
ctx.request.patchState()   // + all ScopeStateOps

// Session scope (always available in Phase 1)
ctx.session.state          // Readonly<TSessionState>
ctx.session.resources      // ResourceRegistry
ctx.session.items          // SessionItemViews (client/llm views)
ctx.session.appendJournal()
ctx.session.getJournal()

// User scope (always available in Phase 1)
ctx.user.state             // Readonly<TUserState>
ctx.user.resources         // ResourceRegistry

// Project scope (optional)
ctx.project?.state         // Readonly<TProjectState>
ctx.project?.resources     // ResourceRegistry
```

### Partial State Schemas

Blocks declare only the state fields they need — not the full flow-level schema:

```ts
const incrementCounter = handler({
  name: "increment-counter",
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  // This block only sees/types messageCount, even if session has more fields
  execute: async (input, ctx) => {
    await ctx.session.patchState({ messageCount: ctx.session.state.messageCount + 1 });
    return input;
  },
});
```

This keeps blocks portable and self-documenting about their state dependencies.

## Session Items and Messages

Sessions provide two audience-specific views on accumulated request items:

```ts
// Client view: items visible to the UI
ctx.session.items.client()
ctx.session.items.client({ limit: 50 })

// LLM view: messages suitable for model context (async)
await ctx.session.items.llm()
await ctx.session.items.llm({ limit: 20 })
await ctx.session.items.llm({ limit: { tokens: 20_000 } })
```

The LLM view converts completed request items with `llm` or `both` visibility into `{ role, content }` message pairs for model context assembly.

## Session Journal

Append-only log for session-level notes:

```ts
await ctx.session.appendJournal({
  text: "User switched to edit mode",
  source: "mode-router",
  tags: ["mode-change"],
});

const entries = await ctx.session.getJournal({ limit: 10 });
```

## Persistence Adapters

Phase 1 ships two adapters:

- **Filesystem** (runtime default): Durable, human-inspectable, CAS via versioning
- **In-memory** (testing): Fast, isolated, no persistence

```ts
import { createFilesystemStores, createInMemoryStores } from "@flow-state-dev/server";
```

## State Schema Bubbling

Block-level state declarations bubble upward for compatibility checking. This enables:
- Early detection of schema conflicts in nested compositions
- Type safety preservation across sequencer steps
- Recursive shadowing rules for nested sequencers

## Resource Declaration Bubbling

Similar to state schemas, block-level resource declarations (`sessionResources`, `userResources`, `projectResources`) bubble upward through the composition hierarchy. Sequencers collect declared resources from all child blocks, and `defineFlow` merges them into the flow's scope configs automatically. Flow-level resource declarations take priority over block-declared ones. See [Resources and Client Data](./resources-and-client-data.md) for the full collection and merge model.

## Streaming Integration

State and resource mutations emit streaming events:

- `state_change` items track each scope operation
- `resource_change` items track resource mutations
- These are **invalidation signals** — clients should refetch snapshots for source-of-truth reads
- In production mode, these items are transient (stream-only, not persisted)
- Set `persistStateChanges: true` on the flow to persist them (useful for devtools state timeline)

## Canonical Authority

For full type signatures, resource/clientData details, and edge cases, see `../preperation/architecture/STATE_AND_SCOPES.md`.


### Token-aware MessageLimit

`session.items.llm({ limit: { tokens: N } })` now performs token-aware packing from newest to oldest using the configured flow `tokenCounter` and the active resolved model ID from generator execution.

