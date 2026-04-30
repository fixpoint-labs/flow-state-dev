# State and Scopes

Flow State Dev manages state across four hierarchical scopes, each with typed atomic operations and CAS-based concurrency control.

## Scope Hierarchy

```
request → session → user → org
  (per request)  (per session)  (per user)  (shared)
```

- **Request**: Ephemeral, exists for one action execution
- **Session**: Persisted, user-bound, carries conversation history
- **User**: Persisted, spans sessions, holds user preferences/resources
- **Org**: Persisted, shared across users

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

### No-op guard

Every write helper compares the proposed next state against the current state via structural equality. When the mutation produces a value deep-equal to the current state, the framework suppresses the persist call and the corresponding `state_change` SSE emission, and the helper resolves to `false` instead of `true`. CAS retry semantics are preserved — only the commit phase is short-circuited.

Comparison rules: `Object.is` for primitives (NaN equals NaN; +0 != -0), recursive structural equality for plain objects/arrays, `Date.getTime()` for dates. Non-JSON shapes (Map, Set, RegExp, functions) raise `TypeError` — state must be JSON-shaped.

### Transient state slots

A sequencer's `stateSchema` can mark individual top-level fields with `transientSlot()` from `@flow-state-dev/core`. Transient slots:

- Hold their value in memory across the sequencer's run (readable via `ctx.sequencer.state` from later steps).
- Do **not** emit `state_change` items on the SSE stream.
- Do **not** appear in `state_snapshot` payloads, so they never enter the durable checkpoint store and reset to their schema default on resume.

Apply `transientSlot()` last in the schema chain — after `.optional()`, `.default()`, etc. — so the marker sits on the outermost schema instance referenced by the parent ZodObject's shape. Mixed patches (transient + non-transient) emit a `state_change` whose delta carries only the non-transient keys.

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

**Resource content writes do not bump scope record version.** Resource content is persisted via `ContentStore`, separate from the scope record. Content writes do not update the scope record's `version` or `updatedAt` fields. The scope record version reflects state and metadata changes only.

## Scope Handles

Each scope is accessed through a typed handle on `BlockContext`:

```ts
// Request scope (always available)
ctx.request.state          // Readonly<TRequestState>
ctx.request.patchState()   // + all ScopeStateOps

// Session scope (always available in Phase 1)
ctx.session.state          // Readonly<TSessionState>
ctx.session.metadata       // Readonly<SessionMetadata> (title, description, tags)
ctx.session.resources      // ResourceRegistry
ctx.session.items          // SessionItemViews (client/llm views)
ctx.session.getJournal()
ctx.session.setMetadata()

// User scope (always available in Phase 1)
ctx.user.state             // Readonly<TUserState>
ctx.user.resources         // ResourceRegistry

// Org scope (optional)
ctx.org?.state         // Readonly<TOrgState>
ctx.org?.resources     // ResourceRegistry
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
await ctx.session.items.history()
await ctx.session.items.history({ limit: 20 })
await ctx.session.items.history({ limit: { tokens: 20_000 } })
```

The history view converts completed request items with `history: true` into `{ role, content }` message pairs for model context assembly.

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

## Session Metadata

Sessions carry first-class `title`, `description`, and `tags` fields alongside the free-form `metadata` bag. These fields are mutable after creation, enabling richer session management UIs without polluting workflow state.

### Creating sessions with metadata

```ts
// Via the client
const session = await sessionClient.createSession({
  flowKind: "my-flow",
  userId: "user_1",
  title: "Planning session",
  description: "Sprint 12 work breakdown",
  tags: ["planning", "sprint-12"]
});
```

### Reading metadata from a block

```ts
const { title, description, tags } = ctx.session.metadata;
```

`ctx.session.metadata` is a live getter backed by the in-memory session record — no database round-trip. It reflects any `setMetadata` calls made earlier in the same request.

`SessionMetadata` exposes the three first-class fields (`title`, `description`, `tags`). The free-form `metadata` bag is write-only via `setMetadata` and is not exposed on the read property to avoid `ctx.session.metadata.metadata` confusion.

### Updating metadata from a block

```ts
await ctx.session.setMetadata({
  title: "Updated title",
  description: "New description",
  tags: ["updated"],
  metadata: { custom: "value" }   // merges with existing metadata bag
});
```

`setMetadata` persists the changes to the session store and emits a `session.metadata.changed` event on the request SSE stream. Connected clients see updates in real-time.

### Updating metadata externally

```
PATCH /api/flows/sessions/:sessionId/metadata
Content-Type: application/json

{ "title": "New title", "tags": ["tag-a", "tag-b"] }
```

Fields are merged (last-write-wins). Only the fields you include in the body are updated.

### Auto-generating session titles

The `sessionTitleGenerator` utility block reads recent conversation messages and asks the LLM for a short title. It is designed for use as a `.work()` background block:

```ts
import { utility, sequencer } from "@flow-state-dev/core";

const autoTitle = utility.sessionTitleGenerator({
  name: "auto-title",
  model: "openai/gpt-5.4-mini"
});

const pipeline = sequencer({ name: "chat", inputSchema })
  .then(mainGenerator)
  .work(autoTitle);     // runs in background, sets session title
```

Internally it is a sequencer with two steps: a generator that produces the title, and a handler that calls `setMetadata` only if the title has changed. The whole block is marked `transient: true` so it produces no visible items in the stream.

`ctx.session.items.history()` includes items from the current in-flight request, so the title generator sees the just-completed generator output even on the first message of a session.

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

Block-level resource declarations live in a single flat `resources` map (FIX-435). Each resource carries its intrinsic `scope` and `flowIsolation`, so the framework routes its storage automatically. Sequencers collect `declaredResources` from all child blocks, and `defineFlow` merges them into the flow's flat `resources` map at the top level. Flow-level declarations take priority on dedup; effective-storage-key collisions across distinct accessor keys are caught at flow-build time. See [Resources and Client Data](./resources-and-client-data.md) for the full collection, merge, and storage-key model.

## Cross-Flow State: Shared vs Isolated

User- and org-scope records are not session-like — by default they are shared across every flow registered on a server, keyed by bare `userId` / `orgId`. A user has one `UserRecord`; every flow operating for that user reads and writes the same record. That is desirable when two flows genuinely share an identity concept (preferences, profile, quotas). It is a data-loss bug when two flows declare incompatible schemas over the same key.

Wave 1 (FIX-431) introduces two coexisting mechanisms.

### Cross-flow schema registry (default)

`FlowRegistry.register` collects `user.stateSchema`, `org.stateSchema`, and user/org resource schemas from every non-isolated registered flow. At registration time, each new flow's schemas are compared against every other flow's schemas using a conservative Zod structural check:

| Scenario | Outcome |
|----------|---------|
| Same Zod reference | Merge (identical). |
| Object shapes with overlapping keys whose types agree | Merge. Disjoint fields or compatible extensions emit a `console.warn`. |
| Shared required field whose types disagree | Throw `CrossFlowSchemaConflictError`. |
| Non-object schemas of different kinds | Throw `CrossFlowSchemaConflictError`. |
| Same-named user/org resource with incompatible `stateSchema` | Throw `CrossFlowSchemaConflictError`. |

The error names both flow kinds, the scope (`user` or `org`), the field path (`stateSchema` or `resources.<name>`), and a reason. Resolution is either reconciling the schemas or opting into isolation.

The checker is coarse by design — Wave 1 accepts false-positive conflicts (ask the developer to reconcile or isolate) over false negatives (silent data loss).

### Per-flow isolation (opt-in)

Two layers can promote a user/org-scope record to flow-isolated storage:

- **Flow-level**: `isolateUserState: true` / `isolateOrgState: true` on the `FlowDefinition`. Acts as the default for resources at the relevant scope that don't declare `flowIsolation` themselves. The flow does not participate in the registry schema merge for the isolated scope.
- **Resource-level** (FIX-435): `defineResource({ scope: "user", flowIsolation: true })`. Always wins. A library can ship a flow-private user-scoped resource, and consumers don't need to flip the flow flag.

When either layer marks a user/org-scope storage cell as isolated, its key becomes `${id}:${flowKind}`. Other flows cannot conflict with it, and it cannot read data written by other flows.

Use isolation for internal-only flows, background jobs, library-private state, or flows with domain-specific data that should not leak into shared surfaces.

The `UserRecord.id` / `OrgRecord.id` field holds the namespaced key so lookups by record id are consistent. The `userId` / `orgId` fields remain the bare identity — list APIs that filter by `userId` continue to return both shared and isolated records for a given user, which is useful for admin and devtool views.

### Storage-key derivation

Key resolution is centralized in `packages/server/src/stores/scope-keys.ts`:

```ts
export function resolveUserStorageKey(userId: string, flow: IsolationFlow): string {
  return flow.isolateUserState ? `${userId}:${flow.kind}` : userId;
}
```

`createExecutionContext` uses these helpers for every `user` / `org` read and write, including `ContentStore` operations. Session and request scopes are unaffected — sessions already carry `flowKind` on the record and are effectively flow-isolated already.

### Non-goals

- **Schema versioning / migration.** Flipping `isolateUserState` (or a resource's `flowIsolation`) on an existing flow/resource is a data-affecting change — existing shared records become invisible; new isolated records start fresh. No automatic migration.
- **Cross-flow read validation.** The registry prevents incompatible writes; it does not re-parse stored state on every read.

## Streaming Integration

State and resource mutations emit streaming events:

- `state_change` items track each scope operation
- `resource_change` items track resource mutations
- `state_snapshot` items capture the full sequencer state at each step boundary (initial + after every step)
- `state_change` and `resource_change` items are **invalidation signals** — clients should refetch snapshots for source-of-truth reads
- In production mode, these items are transient (stream-only, not persisted)
- Set `persistStateChanges: true` on the flow to persist them (useful for devtools state timeline)
- Sequencer state snapshots are always trace-only and transient. The DevTool uses them to show state evolution across steps and loopBack iterations

## Canonical Authority

For full type signatures, resource/clientData details, and edge cases, see `../preperation/architecture/STATE_AND_SCOPES.md`.


### Token-aware MessageLimit

`session.items.history({ limit: { tokens: N } })` now performs token-aware packing from newest to oldest using the configured flow `tokenCounter` and the active resolved model ID from generator execution.

