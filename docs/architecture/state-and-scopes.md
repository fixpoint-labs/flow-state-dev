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

**Scope stores can also require a record to be absent.** `set(id, record, "absent")` writes only when nothing exists at that id, and returns the ordinary conflict — carrying the winner's record — when something does. It exists because a `get`-then-`set` cannot decide a create race: nothing stops a second writer landing between the two calls, and `set` is an upsert, so both writers won and the second silently overwrote the first. Deriving an id from the work it belongs to does not help; two requests deriving the same id is exactly the case.

The sentinel is a word rather than a number because **`0` was already taken here.** Scope records are created *at* version `0`, so a v0 record is live, and `expectedVersion: 0` means "stored at version 0" — the first CAS write of every new session, user and org depends on it. That is the opposite of resource state below, which starts its versions at `1` and spends its `0` on create-if-absent. `ResourceStateStore` therefore rejects `"absent"` rather than aliasing it: the two agree on `set` but not on `delete`, where "delete only if absent" has no meaning. Two spellings that each mean one thing, until a later change retires the resource side's `0`.

Scope `delete` is a hard delete with no tombstone, so a recreated id may reuse versions — stated rather than defended. The scope store's versions detect concurrent modification; they are not an identity, and nothing in the framework treats them as one.

**Resource state is versioned too.** The four scopes above hold one state record each; resource state lives in `ResourceStateStore`, keyed per resource, and was originally modelled on `ContentStore` as plain last-write-wins. That model is wrong for structured state concurrent workers read-modify-write, so the store contract is now compare-and-swap: `set` and `delete` take an `ExpectedVersion` and return a `SetResult`, and the three reads carry the version alongside the state.

`0` means *no live row*, so it is create-if-absent and a tombstone satisfies it. A numeric expected version must be a non-negative integer; anything else throws, since `number | "any"` admits values the contract has no meaning for, and a mistake at the call site is not a lost race to report as a conflict. Deletes mark a `lifecycle` column rather than removing the row, retain the version, and drop the payload; `deleteAll` bulk-marks the scope. Reads filter to `live`, so a tombstone is indistinguishable from an absent key to callers.

**Retention is the guarantee.** Versions are never reused, and a tombstone keeps its version, so an observer from before a delete can never match the row that replaces it — at key altitude and at scope altitude alike. Nothing reclaims a tombstone; that is deliberate, and it is why the ABA argument needs no sweep, no timer and no retention window. The cost is one row per deleted key, in every scope.

Resource state does **not** reuse `runWithCAS`, and the reason is policy rather than shape. It has its own driver (`stores/resource-cas.ts`), placed at the registry's read/mutate seam rather than at the persister: the persister is value-only, and by the time a write reaches it the caller's intent has already been materialized into an object, so a retry there could only overwrite a concurrent writer's field. The driver takes each write op's real mutator and re-runs it against refreshed state.

Six of `runWithCAS`'s decisions do not transfer: a conflict against a tombstone and a losing create-if-absent are **terminal** here rather than retryable, cancellation is honoured, a no-op is suppressed only against a re-read version, and nothing on the commutative path is inherited. **The policy table lives in one place — the `stores/resource-cas.ts` module header** — beside the code it governs and with the source citations that go stale the moment `cas.ts` is edited. Read it there rather than a copy; `cas.ts` carries the matching pointer back, so a reader arriving at either driver can see there are two and why.

The trap worth knowing at this altitude: `createScopeStateOps` lives in `state-container.ts` and its ops are named `patchState` / `setState` / `updateState`, the same names as the registry's resource ops. Reaching for it is the natural move and the wrong one. The same goes for `createScopePersist`, which downgrades `expectedVersion` to `"any"` for commutative hints on adapters advertising a delta verb.

**Error taxonomy — the write path reports what actually happened**, which is this epic's whole thesis pointed at its own store. Three distinct states must not collapse into one error:

| Situation | Reported as |
|---|---|
| Key never persisted (a declared resource living on its schema default), mutator asks for no change | **Not an error** — a verified no-op. Nothing was written and nothing was taken away |
| We held a live version and the row is now a tombstone | `ResourceDeletedError`, terminal |
| A create-if-absent lost its race | `ResourceAlreadyExistsError`, terminal, **carrying the winner's row** so the first-touch APIs can finish as a read |
| A delete's version check failed against a **live** row (deleted and recreated under us) | `ConcurrentModificationError` — nothing was deleted, so a deletion error would report the opposite |
| Retry budget exhausted | `ConcurrentModificationError` |

**Which writers carry a version, and which deliberately do not.** The list is a search result rather than a judgement — the store's mutating surface is three methods on one named field, so `grep -a "resourceState[?.]*\.\(set\|delete\|deleteAll\)(" packages/*/src` decides it. (The `-a` matters: `resource-registry.ts` carries a NUL byte, so plain `grep` reports it binary and prints nothing.)

Version-checked, through the driver above:

- every registry write op — single-resource and collection-instance `patchState` / `setState` / `updateState`, plus `upsert`'s patch path
- `create()` at `expectedVersion: 0`, terminal on conflict
- both delete writers, `collection.delete()` and `evictInstance`, at the version the context observed

Deliberately unconditional, each for a stated reason rather than because it was missed:

- **`create({ replace: true })`** writes at `"any"`. It is an explicit overwrite of a key the caller has decided it owns; opting out of the version check is the posture being requested
- **`deleteAll`** takes no expected version at all. It is a scope operation, not a key operation — a bulk lifecycle mark over every live key
- **the two seed helpers in `@flow-state-dev/testing`** pass `"any"` when priming a fresh scope, where no concurrent writer exists by construction
- **scope state** — `request` / `session` / `user` / `org` — is not this driver's at all. It keeps `runWithCAS`, and `createScopePersist` downgrades to `"any"` for commutative hints on adapters advertising a delta verb, as described above

The collection-item HTTP routes write this store directly, outside the registry and its queue, so they carry their own versions and surface a conflict to the client rather than retrying it. Their request/response contract — including when a caller sees a 409 — is [the resource client reference](./resources-and-client-data.md)'s, not this document's.

Cancellation uses the request's **background** abort signal, not the transport signal. The transport signal fires on client disconnect, which must not abandon the writes of a `.work()` task the request is still running; and there is no per-scope signal available at this seam anyway, since persisters and `ResourceRef`s are built once per context while `ctx.signal` is per execution scope.

Two orderings are load-bearing and quiet when regressed. `create()` defers its `maxInstances` eviction until **after** the CAS write commits — evicting first lets a create that loses its race still tombstone an unrelated instance, so the caller gets an exception *and* a net loss. And the first-touch APIs translate a terminal already-exists into their own contract rather than surfacing it: `getOrCreate` returns the winner's instance, `upsert` applies its update as a patch.

**What per-key CAS honestly does not close**, recorded so this is not read as full coverage: a create of a *previously-absent* key racing `deleteAll` still lands, because `expectedVersion: 0` is satisfied by a key that never existed and a bulk mark only touches rows that already exist. That is a cross-key invariant, and no per-key predicate expresses one. The `maxInstances` cap is the same shape — a read-then-act on a set.

Per-adapter guarantee: real CAS on memory, SQLite and Postgres; the filesystem adapter compares under a per-key mutex on the store instance, which closes the in-process race and not a cross-process one.

```ts
// The framework handles CAS internally. You just use the ops.
await ctx.session.patchState({ count: newCount });
// If another concurrent write bumped the version, the framework retries with bounded retries.
```

On retry exhaustion, a `ConcurrentModificationError` is thrown.

### Container contract

- The per-request `MemoryStateContainer` returns its internal state reference from `read()` without copying — callers MUST treat the result as immutable.
- All in-tree scope ops respect this by spreading into a fresh object (`{...state, foo: bar}`) before mutating.
- This was previously a deep clone on every read; FIX-405 removed the clone from the CAS hot path. The size-estimate warning that surfaced 10KB+ payloads was also removed — it ran inside the CAS loop on every attempt.

**Concurrency guidance:**
- Avoid read-modify-write patterns inside `parallel`/`forEach` unless using atomic ops
- Prefer `incState`, `pushState`, `setStateRecord` for concurrent writes
- Use `maxConcurrency` on `parallel`/`forEach` when shared state writes are unavoidable
- Resource-collection instance writes (`create` / `setState` / `patchState` / `writeContent`) commit per key and update the per-scope cache in place (FIX-744), so distinct-key writes from concurrent `parallel`/`forEach` branches all survive into the same-request view — a convergence `.list()` after a fan-out sees every instance. Same-key concurrent writes are last-writer-wins.

### Delta verb routing (FIX-405)

The framework routes scope-state ops through the cheapest available write path on each adapter. Single-field patches map to native atomic ops (Postgres `jsonb_set`, future Upstash `HINCRBY`, future Mongo `$inc` / `$push`); multi-field patches fall back to a full-record `set`.

| Scope op | Shape | Routes to |
| -- | -- | -- |
| `patchState({ foo: value })` | Single own-property, non-function value | `patchField` |
| `patchState(key, updater)` | Keyed-updater form | `patchField` |
| `patchState({ foo, bar })` | Multi-field | `set` |
| `patchState({ foo: () => ... })` | Function value | `set` |
| `setState(value)` | Full replacement | `set` |
| `incState({ field: delta })` | Single numeric field | `incField` |
| `incState({ a: 1, b: 1 })` | Multi-field | `set` |
| `pushState(field, value)` | Always | `pushToArray` |
| `setStateRecord(field, key, value)` | Depth-2 path | `set` (v1) |
| `deleteStateRecord` / `atomicState` | Any | `set` |

**Why multi-field patches stay on `set`:** decomposing `{ a: 1, b: 2 }` into N `patchField` calls would bump the version counter per field, multiply CAS-retry exposure under contention, and make intermediate states visible to concurrent readers. A single `set` preserves single-version semantics for one logical mutation. The cost (whole-record UPDATE) is identical to today's behavior — no regression.

**Capability advertisement:** the delta verbs are optional on the `Store` interface in v1. `createScopePersist` feature-detects per call: an adapter without `patchField` (filesystem, SQLite as of v1) continues to receive `set` calls transparently. Adapters that advertise the verbs (`@flow-state-dev/engine`'s in-memory adapter, `@flow-state-dev/store-postgres`) receive the delta routing. Future Upstash and Mongo adapters ship the verbs as required.

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
  .step(mainGenerator)
  .work(autoTitle);     // runs in background, sets session title
```

Internally it is a sequencer with two steps: a generator that produces the title, and a handler that calls `setMetadata` only if the title has changed. The whole block is marked `transient: true` so it produces no visible items in the stream.

`ctx.session.items.history()` includes items from the current in-flight request, so the title generator sees the just-completed generator output even on the first message of a session.

## Persistence Adapters

Adapters that ship today:

- **In-memory** (zero-config default): Fast, isolated, no persistence. Used when `createFlowApiRouter` is called without a `stores` option, and for tests.
- **Filesystem** (local development only): Durable and human-inspectable, but its event persistence is O(N²) per request and collapses under real load. Constructing it without `developmentOnly: true` logs a one-time warning steering you to SQLite (FIX-406).
- **SQLite** (recommended for a single server): Durable across restart for every store — scope records, request items and events, resource state, and resource content alike — single-file, indexed. `createSQLiteStores` lives in `@flow-state-dev/store-sqlite`. This is the default store for `fsdev dev`.
- **Postgres** (recommended for production / multi-instance): Shared, concurrency-safe store with cross-process live tail via `LISTEN/NOTIFY`. `postgresStores` lives in `@flow-state-dev/store-postgres`; `vercelPostgresStores` (`@flow-state-dev/vercel/store`) bakes in serverless pool tuning.

```ts
import { createInMemoryStores } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";

// Recommended for anything that needs to survive a restart:
const stores = createSQLiteStores({ filename: "./data/app.db" });

// Filesystem is local-dev only; acknowledge it explicitly:
import { createFilesystemStores } from "@flow-state-dev/engine";
const devStores = createFilesystemStores({ rootDir: "./data", developmentOnly: true });
```

## Block-Level State (FIX-914)

The per-execution-scope state container — originally gated to `kind === "sequencer"` — is generalized to any block that declares an own-state `stateSchema`. `config.stateSchema` already meant "this block's own state"; the change lifts the container-creation gate at four call sites (`createExecutionContext.ts`'s `_withExecutionScope`, `sequencer.ts`'s in-flow child dispatch, `executeBlock.ts`'s root dispatch, `tool-executor.ts`'s tool `ExecutionParent`) from `kind === "sequencer"` to "effective `stateSchema` present."

**One runtime primitive, four addressing modes**, all resolving over the same per-scope-node container:

- `ctx.self` — the current block's own container. Bound directly to the current scope node (not via `getTarget`, which resolves by name and can throw `AmbiguousBlockNameError` — `ctx.self` never needs a name).
- `ctx.parent` — the immediate parent's container, present when the parent has `stateSchema` (checked via `parentChain.previous.parentStateContainer`) — regardless of whether the child declares `parentStateSchema`. `parentStateSchema` is compile-time only today (typing `ctx.parent`'s state ops), mirroring the existing `parentInputSchema`; it doesn't gate runtime access. A child reaches its owner without naming it — the tool → generator write for skill activation is `ctx.parent`, not a new resolver.
- `ctx.sequencer` — nearest sequencer ancestor (unchanged; already implemented as `getTarget(nearestSequencerName)`).
- `ctx.targets.<name>` / `getTarget` — a named ancestor (unchanged); a named non-sequencer target now has state if it declared `stateSchema`.

**Fan-out / loop contract:** each `forEach`/`parallel` iteration and each `loopBack`-re-executed body is a fresh scope node → a fresh container → private state per iteration. A loop-owning sequencer keeps its own container across passes, so its `ctx.self` (or a step's `ctx.sequencer`) accumulates. This is emergent from the existing per-scope-node model, not new machinery.

**Router purity:** a router's `execute` can read `ctx.self`/`ctx.parent` but must not write to them — the suspendable-router purity contract (`execution-and-errors.md`) requires resume to re-run `execute` as a pure, read-only function. A preceding `.tap(handler)` performs any write a router-adjacent flow needs recorded.

**Durability boundary (PR1 scope):** block state is in-memory only. Durable checkpoint + suspend/resume persistence for non-sequencer block state is an explicit follow-up — the checkpoint store keys on `provenance.blockInstanceId` (not `item.key`), and retry-stable durability for an arbitrary block needs a path-based storage key, a new `emitStateSnapshot` call site, and suspension stamping/restore on the block's own path. Sequencer checkpoints are unchanged. `state_change` items for non-sequencer containers reuse the existing `scope: "block_instance"` emit path and are transient-by-default in production (`shouldPersistScopeChange`) — not a client-visible projection.

**Capability-contributed own state (FIX-914 PR2):** a capability can contribute to a block's own-state `stateSchema` — the seam a generator capability needs to give its host generator a working `ctx.self` container without the block author declaring `stateSchema` directly (the skills capability's `activeSkills` field, for example). Declared via `defineCapability({ stateSchema: z.object({...}) })` or the same field on a preset; valid on any block kind, since any block can hold state. Capabilities merge together and then with the block's own `stateSchema` via `mergeCapabilityOwnStateWithBlock` (`capability/merge.ts`), which is the collision-detecting counterpart to `sequencerStateSchema`'s `.extend()`-based merge: a field declared by two sources must be the same schema reference or the build throws — the same reference-equality rule the sibling `mergeTargetsInto`/`mergeResourcesInto` use, and no silent last-wins. (Reference-equality rather than a structural comparison, so a nested-object or parse-mode difference can't slip past a shallow check and diverge from the intersected `ctx.self` type.) `resolveCapabilities`'s `mergedSurface.stateSchema` is wired into the block's effective `config.stateSchema` at each factory (`handler`, `generator`, `router`, `sequencer`); type inference (`InferCapabilityOwnState`) intersects into `TSelfState` for handler/generator/router — sequencer capabilities stay runtime-only, matching `SequencerCtx`'s existing untyped `ctx.cap`. Removing the legacy `targetStateSchemas`/`sequencerStateSchema`/`parentStateSchema` declaration-key fragmentation in favor of one consolidated key is a later audit-then-remove issue — the *runtime* unifies onto one container now; the *config surface* still has four schema keys.

## State Schema Bubbling

Block-level state declarations bubble upward for compatibility checking. This enables:
- Early detection of schema conflicts in nested compositions
- Type safety preservation across sequencer steps
- Recursive shadowing rules for nested sequencers

## Resource Declaration Bubbling

Block-level resource declarations live in a single flat `resources` map (FIX-435). Each resource carries its intrinsic `scope` and `flowIsolation`, so the framework routes its storage automatically. Sequencers collect `declaredResources` from all child blocks, and `defineFlow` merges them into the flow's flat `resources` map at the top level. Flow-level declarations take priority on dedup; effective-storage-key collisions across distinct accessor keys are caught at flow-build time. See [Resources and Client Data](./resources-and-client-data.md) for the full collection, merge, and storage-key model.

## Tenant Identity

Every scope identity (`request`, `session`, `user`, `org`) carries an optional `tenantId`. The HTTP transport reads it from a configurable header — `x-tenant-id` by default, overridable via `createFlowApiRouter({ tenantIdHeader })` — and threads it onto the context, so handlers and lifecycle hooks can read `ctx.request.identity.tenantId` (or `ctx.session.identity.tenantId`) and branch on it.

```ts
const router = createFlowApiRouter({
  registry,
  stores,
  tenantIdHeader: "x-tenant-id" // default
});
```

The axis is optional. Single-tenant apps never send the header and `tenantId` stays `undefined`.

### Store-key isolation

When a `tenantId` is present, it namespaces session storage so two tenants sharing a session id never share data:

- The **session record** key and the **session-scoped** content / resource-state `scopeId` become `${tenantId}:${sessionId}` (via `resolveSessionStorageKey`). The session store is fetched by primary key, so the tenant lives in the key.
- **Request records** keep a bare `sessionId` and carry a separate `tenantId` field. Cross-turn history isolates by filtering `request.list({ sessionId, tenantId })`, not by namespacing the field — which keeps request recovery a clean pass-through (recovery re-derives the key from the bare `sessionId` + `tenantId`). The `tenantId` list filter exact-matches when present (an explicit `undefined` matches only no-tenant records) and is skipped when absent.
- **User and org** scopes stay shared across tenants by design — org-level policy and quota, and user preferences, are meant to span tenants.

The public session id stays bare everywhere it surfaces: `ctx.session.identity.id`, emitted events, and HTTP responses all return `sessionId`, never the namespaced key.

Single-tenant apps are unaffected: `resolveSessionStorageKey(sessionId, undefined) === sessionId`, so every key is byte-identical to a deployment without the axis. There is no migration for the common case. Persistence adapters add a nullable `tenant_id` column (SQLite/Postgres) via an idempotent `ADD COLUMN` migration; existing rows read back as no-tenant.

### Key ambiguity and the binding check

The `${tenantId}:${sessionId}` scheme is ambiguous because session ids may themselves contain `:` (chat ids like `slack:C123:...`) and both the tenant header and the session id are caller-supplied — tenant `acme` + session `chat-1` resolves to the same key as a *no-tenant* request using session id `acme:chat-1`. The key alone therefore can't isolate. Every load-and-act path closes this with a **tenant-binding check** (`tenantMatches`): the loaded record's stored `tenantId` must equal the request's, or the operation is rejected (`createExecutionContext` throws `TenantBindingMismatchError`; routes return 404; `session.create` keeps a raw existence check so a colliding id 409s rather than overwriting). To remove the ambiguity at the source, tenant ids themselves may not contain `:` (rejected with 400 at header extraction); session ids still may.

### What `requestId` gates, not tenant

Stream attach (`GET .../requests/:id/stream`) and suspension resume are authorized by `requestId` alone — an unguessable capability token — and are **not** re-checked against the tenant header. This is the pre-existing request-as-capability model and is deliberate: a `requestId` is only obtainable by the caller who created it. Resume re-dispatches under the original request's stored `tenantId`, so a resumed run still lands in the correct tenant's session. Session, state, and resource reads (addressed by the caller-supplied `sessionId`) do enforce the tenant binding, because their identifier is guessable.

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

Isolation promotes a user/org-scope storage cell to a flow-namespaced key (`${id}:${flowKind}`) so it can't be read or overwritten by other flows. Two layers decide it, at two different granularities (FIX-735):

- **Flow-level**: `isolateUserState: true` / `isolateOrgState: true` on the `FlowDefinition`. Two roles: (1) it keys the **scope record** — the scope's single `state` blob (`ctx.user.state` / `ctx.org.state`) — and (2) it is the default `flowIsolation` for resources at that scope that don't declare their own. A flow that isolates a scope does not participate in the registry schema merge for it.
- **Resource-level** (FIX-435): `defineResource({ scope: "user", flowIsolation: true })`. Decides **that resource's** storage key, and always wins over the flow default — in both directions. A library can ship a flow-private user-scoped resource without consumers flipping the flow flag, and a resource declared `flowIsolation: false` stays shared even when a sibling on the same flow is isolated.

Resources key **per resource**, not per flow. A flow may hold both shared and isolated user-scoped resources at once: each `flowIsolation: false` resource lives at the bare `{id}`, each `flowIsolation: true` resource at `{id}:{flowKind}`. The scope record's own `state` keys independently, on the flow-level flag alone.

Use isolation for internal-only flows, background jobs, library-private state, or domain-specific data that should not leak into shared surfaces.

The `UserRecord.id` / `OrgRecord.id` field holds the scope-record's (possibly namespaced) key so lookups by record id are consistent. The `userId` / `orgId` fields remain the bare identity — list APIs that filter by `userId` continue to return both shared and isolated records for a given user, which is useful for admin and devtool views.

### Storage-key derivation

Key resolution is centralized in `packages/engine/src/stores/scope-keys.ts`. The **scope record** keys on the flow-level flag:

```ts
export function resolveUserStorageKey(userId, flow): string {
  return flow.isolateUserState ? `${userId}:${flow.kind}` : userId;
}
```

**Resources** resolve a `scopeId` per resource from their effective isolation (the resource's `flowIsolation` if set, else the flow default):

```ts
const isolated = resolveResourceIsolation(resource.flowIsolation, flow, "user");
const scopeId = resolveResourceScopeId(userId, flow.kind, isolated); // bare id, or `${id}:${kind}`
```

`createExecutionContext` routes every per-resource `resourceState` / `content` read and write through the per-resource resolution; read-side projections (`/state`, the resource routes, sibling MCP adapters) enumerate the buckets a flow declares via `resourceScopeIds` and merge. Session and request scopes are unaffected — sessions already carry `flowKind` on the record and are effectively flow-isolated already.

### Non-goals

- **Schema versioning / migration.** Flipping `isolateUserState` (or a resource's `flowIsolation`) on an existing flow/resource is a data-affecting change — existing shared records become invisible; new isolated records start fresh. No automatic migration.
- **Cross-flow read validation.** The registry prevents incompatible writes; it does not re-parse stored state on every read.

## Streaming Integration

State and resource mutations emit streaming events:

- `state_change` items track each scope operation
- `resource_change` items track resource mutations. Content writes (`writeContent`) emit on both single resources and collection instances (FIX-756 parity) — always without a delta, since content carries no state projection; clients take the batched-refetch path for content
- `state_snapshot` items capture the full sequencer state at each step boundary (initial + after every step)
- `state_change` and `resource_change` items are **invalidation signals** — clients should refetch snapshots for source-of-truth reads
- In production mode, these items are transient (stream-only, not persisted)
- Set `persistStateChanges: true` on the flow to persist them (useful for devtools state timeline)
- Sequencer state snapshots are always trace-only and transient. The DevTool uses them to show state evolution across steps and loopBack iterations

## Canonical Authority

This document is authoritative for state and scope semantics. For full type signatures and resource/clientData details, refer to the published types in `@flow-state-dev/core`.


### Token-aware MessageLimit

`session.items.history({ limit: { tokens: N } })` now performs token-aware packing from newest to oldest using the configured flow `tokenCounter` and the active resolved model ID from generator execution.

