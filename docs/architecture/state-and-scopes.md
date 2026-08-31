# State and Scopes

Flow State Dev manages state across four hierarchical scopes, each with typed state operations. Concurrency control is compare-and-swap on most writes and deliberately absent on a set of blind ones, not all of which compose — [Atomicity Guarantees](#atomicity-guarantees) is the single statement of which is which.

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

The verbs do not share one guarantee, and the split is by **hint shape and adapter capability**, not
by verb name. `createScopePersist` computes `expectedVersion: "any"` from the commutative hint alone,
before any store lookup, and only when the adapter advertises the matching delta verb; otherwise it
falls through to a full-record `set` at the **held** version.

Every unchecked verb applies store-side against the record as found rather than against a snapshot
the caller is holding, so **writes to unrelated paths all survive** — no writer clobbers a field it
did not name, which a stale full-record `set` would. That is the shared guarantee, and it is
narrower than "no lost updates". On the **same** path the unchecked set splits in two, and what
separates them is whether the hint carries a *delta* or an *absolute* value.

- **Unchecked and genuinely commutative, so both writers land** (on an adapter advertising the
  verb): `pushState`, and
  `incState` given a **single** field. The hint carries the delta itself — `hint.delta` for
  `incField`, `hint.values` for `pushToArray` — so the store adds to, or appends to, whatever it
  finds. Two concurrent writers to the same field both survive; for an append, order affects
  position only.
- **Unchecked but *not* commutative** (same adapter condition): `setStateRecord` and
  `deleteStateRecord` always, and `patchState` given exactly one **literal** field. The hint carries
  no delta — `createScopePersist` reads an *absolute* value out of the mutator's `nextState` to send
  with `patchField`, and `deleteField` sends the path alone — so on the same key the store
  overwrites rather than composes. **Last write wins, the first value is gone, and both calls return
  `true`**: neither writer is told a race happened. Use `atomicState`, or the `patchState` updater
  form, when a same-path update has to read what is already there.
- **Version-checked:** multi-field `incState`, multi-field `patchState`, the `patchState` updater
  form, `setState`, and `atomicState`. These can raise `ConcurrentModificationError` on retry
  exhaustion. **The version check is not the safety property** — it decides whether a race can be
  reported, not whether you keep the other writer's update. What the mutator does on retry decides
  that, and the five do not agree. `setState`'s mutator is a constant, so its retry re-applies the
  **same whole state** and discards the winner's change outright — checked, the most destructive
  verb here, and the one whose name most invites reaching for it. Multi-field
  `patchState` merges its fixed values onto the refreshed state, so unnamed fields survive and named
  ones overwrite. Multi-field `incState`, the updater form and `atomicState` **re-run** against the
  winner's state, so they genuinely merge.
- **Adapter capability decides the first two bullets, and it varies by scope as well as by adapter.**
  For **session / user / org**, the memory, SQLite and Postgres stores advertise all four delta
  verbs; the **filesystem** stores advertise `patchField` / `incField` / `pushToArray` but **not**
  `deleteField`, so `deleteStateRecord` alone falls back there. For **request** scope no shipped
  adapter advertises `deleteField` at all — memory, filesystem, SQLite and Postgres each expose only
  the other three on their request store — so `ctx.request.deleteStateRecord` takes the fallback on
  every adapter we ship.
- **The fallback is not the version-checked path, and it fails silently.** It does send the **held**
  version, but nothing retries it: `runDurableMutation` branches to `runCommutative` on the hint
  *before* any store call, and `runCommutative` calls persist exactly once. On a version mismatch
  the store returns a conflict, `runCommutative` returns a bare `false`, and that is the whole
  outcome — **no retry, and never `ConcurrentModificationError`**. The `false` is also
  indistinguishable from the one the [no-op guard](#no-op-guard) returns when the write matched
  current state. So a `setStateRecord` or `deleteStateRecord` that quietly fails to land is the
  symptom to recognise: check whether that scope's adapter implements the verb before hunting for a
  race.
- **Unchecked is not immune.** Every shipped delta store refuses a **missing record** before it
  compares versions, `"any"` included — so a commutative write racing a record delete is still
  refused. Skipping the version check buys freedom from *concurrent state writes*, not from
  deletion.

`patchState`/`setState` are not automatically commutative in their general form — reach for
`atomicState` for a custom concurrent transform over multiple fields.

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

The sentinel is a word rather than a number because **`0` was already taken here.** Scope records are created *at* version `0`, so a v0 record is live, and `expectedVersion: 0` means "stored at version 0" — the first CAS write of every new session, user and org depends on it. That is the opposite of resource state below, which starts its versions at `1` and spends its `0` on create-if-absent.

`ResourceStateStore.set` honours `"absent"` too, with the same meaning — "no record exists" — but it is **not** an alias for that store's `0`. A tombstone is a record, so `"absent"` refuses one where `0` admits it, and that gap is what lets the resource side tell a never-written key from a deleted one. `delete` still rejects the word, since `0` already answers "no live row, so the terminal state holds."

Scope `delete` is a hard delete with no tombstone, so a recreated id may reuse versions — stated rather than defended. The scope store's versions detect concurrent modification; they are not an identity, and nothing in the framework treats them as one.

**Resource state is versioned too.** The four scopes above hold one state record each; resource state lives in `ResourceStateStore`, keyed per resource, and was originally modelled on `ContentStore` as plain last-write-wins. That model is wrong for structured state concurrent workers read-modify-write, so the store contract is now compare-and-swap: `set` and `delete` take an `ExpectedVersion` and return a `SetResult`, and the three reads carry the version alongside the state.

`0` means *no live row*, so it is create-if-absent and a tombstone satisfies it — that is what explicit recreation after a delete rides on. `"absent"` is the stricter form: no row **at all**, so a tombstone conflicts. A numeric expected version must be a non-negative integer; anything else throws, since the union admits values the contract has no meaning for, and a mistake at the call site is not a lost race to report as a conflict. Deletes mark a `lifecycle` column rather than removing the row, retain the version, and drop the payload; `deleteAll` bulk-marks the scope. Reads filter to `live`, so a tombstone is indistinguishable from an absent key to callers.

Which of the two a write asks for is decided by intent, not by the caller: an explicit `create()` writes at `0`, and a `patchState` / `setState` / `updateState` writes at the version its context observed — or at `"absent"` when it observed none. Reads cannot make that distinction (both a tombstone and a never-written key read as absent), which is exactly why it has to be made inside the atomic compare-and-swap rather than by looking first.

**Retention is the guarantee.** Versions are never reused, and a tombstone keeps its version, so an observer from before a delete can never match the row that replaces it — at key altitude and at scope altitude alike. Nothing ages a tombstone out: no sweep, no timer, no retention window. The cost is one row per deleted key, in every scope.

**A scope's re-creation is where that stops applying.** The two stores disagree about a reused id on purpose, and the disagreement has to be resolved somewhere. Scope `delete` is a hard delete, so a session id is genuinely free the moment its record is gone; resource state tombstones, so the same id still carries refusals. Left alone, those refusals outlive the session that earned them, and the next session under `chat-42` finds every **static** resource permanently unwritable — a static reference has no create-if-absent verb to fall back on the way a collection instance does. So `purgeTombstones` clears them, and the engine calls it at exactly one kind of moment: when a session record is *created* under that id — never when one is deleted. Three paths create one (the create-session route, a first action reaching `ensureSessionRecord`, and a detached child spawn), and each reclaims **immediately before** its create-if-absent, having first checked that no record exists. While a session is merely gone, its tombstones are still doing their job.

The ordering carries the weight, because there is no transaction across the two stores. Creating first and reclaiming second would leave a committed session record sitting on intact tombstones whenever the reclamation failed or the process died between the two — and nothing retries it, since a second create answers 409 and an action-driven create adopts the record without reaching the reclamation. That session's static resources would be bricked for its whole life, which is the original defect made permanent. Reclaiming first commits nothing until it has succeeded, so a failure at either step leaves no record and the retry starts clean.

**Known limit: the reclamation is not fenced against a concurrent creator.** Two creators can both read the id and both find nothing; the winner creates the session, its request deletes resource `R`, and the delayed loser then reclaims — removing the winner's tombstone before losing the session CAS itself. The next ordinary `patchState` on `R` holds no version, writes at `"absent"`, finds no row, and brings `R` back. That last step is not a rare actor: every fresh request legitimately holds no version, so the exposure is a deleted resource returning on the next normal write. The existence check narrows this to a genuine create race but cannot close it, because there is no cross-store transaction.

Closing it needs a **scope generation**, which is already tracked and specced as FIX-1000 ("A create racing session deletion lands in a purged, caller-reusable scope — fence the scope generation"). That is the one remedy: don't reach for a second primitive, and in particular not for `lineageId`, which is a workstream address (FIX-1068) answering a different question. Until that lands, both orderings have a door, and reclaim-first is the one whose door is recoverable.

It removes tombstones only, never a live row — state written under a scope id before that scope's record exists is a real pattern, and a blanket purge would silently delete it. What it does give up is the ABA guarantee *across* incarnations: a reclaimed key's version restarts at `1`, so a straggler from the previous session holding version `N` can match a row in the new one. That window opens only after a deliberate re-create under a reused id, and closing it is the same open problem `deleteAll` already has with a create of a never-existed key — both need a scope generation rather than a per-key predicate.

Resource state does **not** reuse `runWithCAS`, and the reason is policy rather than shape. It has its own driver (`stores/resource-cas.ts`), placed at the registry's read/mutate seam rather than at the persister: the persister is value-only, and by the time a write reaches it the caller's intent has already been materialized into an object, so a retry there could only overwrite a concurrent writer's field. The driver takes each write op's real mutator and re-runs it against refreshed state.

Six of `runWithCAS`'s decisions do not transfer: a conflict against a tombstone and a losing create-if-absent are **terminal** here rather than retryable, cancellation is honoured, a no-op is suppressed only against a re-read version, and nothing on the commutative path is inherited. **The policy table lives in one place — the `stores/resource-cas.ts` module header** — beside the code it governs and with the source citations that go stale the moment `cas.ts` is edited. Read it there rather than a copy; `cas.ts` carries the matching pointer back, so a reader arriving at either driver can see there are two and why.

The trap worth knowing at this altitude: `createScopeStateOps` lives in `state-container.ts`, and four of its seven ops — `patchState` / `setState` / `incState` / `pushState` — carry exactly the names the registry's resource ops carry. Reaching for the scope ones is the natural move and the wrong one, because the shared name is not a shared guarantee: for `incState` / `pushState` the two sides disagree about whether the write is version-checked at all, which the split below works through. The same goes for `createScopePersist`, which downgrades `expectedVersion` to `"any"` for commutative hints on adapters advertising a delta verb.

**How the seven bag ops line up against the resource handles.** They are not seven ops with no resource counterpart; they split three ways:

- **Shared** — `patchState` / `setState` / `incState` / `pushState`, declared on both `ResourceContext` and `ResourceRef`.
- **Analogue, not equivalent** — `atomicState` corresponds to `updateState`, and the two are *not* interchangeable. `atomicState` returns a partial that is shallow-merged; `updateState` returns the whole next state, which is re-parsed against the resource's `stateSchema`, so a field the callback omits does not survive.
- **Deliberately absent** — `setStateRecord` / `deleteStateRecord`, because a resource *is* the per-key row and the storage key already does that addressing.

A shared name is not a shared guarantee, and `incState` / `pushState` are where that bites. On a scope bag they are the unchecked commutative path: the delta itself goes to the store, so both writers land and neither can be told a race happened. On a resource handle they carry a version like every other state mutator there — the driver re-runs the delta against refreshed state, so both writers still land, but the write can exhaust the retry budget and raise, and it is refused outright against a tombstone. Every resource *state* mutator is version-checked; `writeContent` is the exception, and it carries no version predicate at all.

**Error taxonomy — the write path reports what actually happened**, which is this epic's whole thesis pointed at its own store. Three distinct states must not collapse into one error:

| Situation | Reported as |
|---|---|
| No live row (a declared resource living on its schema default, or a deleted one), mutator asks for no change | **Not an error** — a verified no-op. Nothing was written, so nothing can have been revived |
| A mutation reaches a tombstone — whether it held a live version and lost it, or never held one at all | `ResourceDeletedError`, terminal |
| A create-if-absent lost its race | `ResourceAlreadyExistsError`, terminal, **carrying the winner's row** so the first-touch APIs can finish as a read |
| A delete's version check failed against a **live** row (deleted and recreated under us) | `ConcurrentModificationError` — nothing was deleted, so a deletion error would report the opposite |
| Retry budget exhausted | `ConcurrentModificationError` |

**Which writers carry a version, and which deliberately do not.** The list is a search result rather than a judgement — the store's mutating surface is three methods on one named field, so `grep -a "resourceState[?.]*\.\(set\|delete\|deleteAll\)(" packages/*/src` decides it. (The `-a` matters: `resource-registry.ts` carries a NUL byte, so plain `grep` reports it binary and prints nothing.)

Version-checked, through the driver above:

- every registry write op — single-resource and collection-instance `patchState` / `setState` / `updateState` / `incState` / `pushState`, plus `upsert`'s patch path
- `create()` at `expectedVersion: 0`, terminal on conflict
- both delete writers, `collection.delete()` and `evictInstance`, at the version the context observed

Deliberately unconditional, each for a stated reason rather than because it was missed:

- **`create({ replace: true })`** writes at `"any"`. It is an explicit overwrite of a key the caller has decided it owns; opting out of the version check is the posture being requested
- **`deleteAll`** takes no expected version at all. It is a scope operation, not a key operation — a bulk lifecycle mark over every live key
- **the two seed helpers in `@flow-state-dev/testing`** pass `"any"` when priming a fresh scope, where no concurrent writer exists by construction
- **scope state** — `session` / `user` / `org` drive `runWithCAS` directly. Request scope runs that same driver under `withScopeLock` (`serialize: true`), so a same-process fan-out serializes rather than exhausting the retry budget, and the budget stays for a writer the queue cannot see. `createScopePersist` still downgrades to `"any"` for commutative hints on adapters advertising a delta verb, as described above

The collection-item HTTP routes write this store directly, outside the registry and its queue, so they carry their own versions and surface a conflict to the client rather than retrying it. Their request/response contract — including when a caller sees a 409 — is [the resource client reference](./resources-and-client-data.md)'s, not this document's.

Cancellation uses the request's **background** abort signal, not the transport signal. The transport signal fires on client disconnect, which must not abandon the writes of a `.sideChain()` task the request is still running; and there is no per-scope signal available at this seam anyway, since persisters and `ResourceRef`s are built once per context while `ctx.signal` is per execution scope.

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
- Prefer `incState` and `pushState` for concurrent counters and appends — those compose store-side
  even against the same field. `setStateRecord` is safe across **distinct** keys and last-writer-wins
  on the same key. Which forms skip the version check, and on which adapters and scopes, is
  [Atomicity Guarantees](#atomicity-guarantees) — read it before relying on any of them. None of
  them survives a concurrent record **delete**: a missing record is refused before versions are
  compared, so these verbs protect against competing writers, not against the record going away
- Use `maxConcurrency` on `parallel`/`forEach` when shared state writes are unavoidable
- Resource-collection instance writes (`create` / `setState` / `patchState` / `updateState` /
  `incState` / `pushState` / `getOrPatchState` / `writeContent`) commit per key and update the
  per-scope cache in place
  (FIX-744), so distinct-key writes from concurrent `parallel`/`forEach` branches all survive into
  the same-request view — a convergence `.list()` after a fan-out sees every instance. **Same-key
  concurrent writes do not share one rule, and what the writer supplies decides which one it gets.**
  The state mutators run through the version-checked driver, which refreshes and re-runs the op's
  real mutator on conflict: a writer supplying a **whole value** is last-writer-wins on the fields
  it names, while one supplying a **derivation or a delta** is re-run against the row it commits
  against, so both writers land. `updateState`, `incState` and `pushState` are the second kind —
  the callback derives the next state from the current one, and the two delta verbs re-apply their
  delta to it, so two concurrent increments or appends both land. `setState` and `patchState`
  supply fixed values, so the fields they name are last-writer-wins. `getOrPatchState` is a
  first-touch memoize rather than an updater — it patches a single key only when that key is absent
  — so it follows `patchState`, not `updateState`; concurrent callers for one key inside a request
  are single-flighted. `writeContent` carries no version predicate at all — `ContentStore.set`
  creates or overwrites — so it is last-writer-wins outright.

### Delta verb routing (FIX-405)

The framework routes scope-state ops through the cheapest available write path on each adapter. Single-field patches map to native atomic ops (Postgres `jsonb_set`, future Upstash `HINCRBY`, future Mongo `$inc` / `$push`); multi-field patches fall back to a full-record `set`.

| Scope op | Shape | Routes to | Version check |
| -- | -- | -- | -- |
| `patchState({ foo: value })` | Single own-property, non-function value | `patchField` | skipped (`"any"`) |
| `patchState(key, updater)` | Keyed-updater form | `patchField` | **checked** |
| `patchState({ foo, bar })` | Multi-field | `set` | checked |
| `patchState({ foo: () => ... })` | Function value | `set` | checked |
| `setState(value)` | Full replacement | `set` | checked |
| `incState({ field: delta })` | Single numeric field | `incField` | skipped (`"any"`) |
| `incState({ a: 1, b: 1 })` | Multi-field | `set` | checked |
| `pushState(field, value)` | Always | `pushToArray` | skipped (`"any"`) |
| `setStateRecord(field, key, value)` | Depth-2 path | `patchField` | skipped (`"any"`) |
| `deleteStateRecord(field, key)` | Depth-2 path | `deleteField` | skipped (`"any"`) |
| `atomicState(mutator)` | Any | `set` | checked |

**The storage verb and the version check are two decisions, not one.** `patchState(key, updater)` is
the row that makes the difference visible: it routes to `patchField` exactly like a literal
single-field patch, but it reads the current value to compute the next one, so it keeps the held
version and can be refused. A row marked *skipped* also falls back to `set` at the held version
wherever the adapter does not advertise its verb — see [Atomicity Guarantees](#atomicity-guarantees)
for which those are.

**Why multi-field patches stay on `set`:** decomposing `{ a: 1, b: 2 }` into N `patchField` calls would bump the version counter per field, multiply CAS-retry exposure under contention, and make intermediate states visible to concurrent readers. A single `set` preserves single-version semantics for one logical mutation. The cost (whole-record UPDATE) is identical to today's behavior — no regression.

**Capability advertisement:** the delta verbs are optional on the `Store` interface. `createScopePersist` feature-detects per call, so a store that does not implement the verb a hint names receives a full-record `set` at the held version instead, transparently. Every adapter that ships today — in-memory, filesystem, SQLite, Postgres — implements `patchField` / `incField` / `pushToArray`. `deleteField` is the uneven one; [Atomicity Guarantees](#atomicity-guarantees) above records which stores carry it. Future Upstash and Mongo adapters ship the verbs as required.

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
ctx.session.items          // SessionItemViews (client/llm views)
ctx.session.getJournal()
ctx.session.setMetadata()

// User scope (always available in Phase 1)
ctx.user.state             // Readonly<TUserState>

// Org scope (optional)
ctx.org?.state             // Readonly<TOrgState>

// Flat resource registry (every declared resource, any scope)
ctx.resources              // ResourceRegistry — keyed by accessor, routed by resource.scope
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

The `sessionTitleGenerator` utility block reads recent conversation messages and asks the LLM for a short title. It is designed for use as a `.sideChain()` background block:

```ts
import { utility, sequencer } from "@flow-state-dev/core";

const autoTitle = utility.sessionTitleGenerator({
  name: "auto-title",
  model: "openai/gpt-5.4-mini"
});

const pipeline = sequencer({ name: "chat", inputSchema })
  .step(mainGenerator)
  .sideChain(autoTitle);     // runs in background, sets session title
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

`FlowRegistry.register` collects `user.stateSchema`, `org.stateSchema`, and user/org resource schemas from every registered flow. At registration time, each new flow's schemas are compared against every other flow's schemas using a conservative Zod structural check:

| Scenario | Outcome |
|----------|---------|
| Same Zod reference | Merge (identical). |
| Object shapes with overlapping keys whose types agree | Merge. Disjoint fields or compatible extensions emit a `console.warn`. |
| Shared required field whose types disagree | Throw `CrossFlowSchemaConflictError`. |
| Non-object schemas of different kinds | Throw `CrossFlowSchemaConflictError`. |
| Two shared user/org resources at the same `ref` with incompatible `stateSchema` | Throw `CrossFlowSchemaConflictError`. |

The error names both flow kinds, the scope (`user` or `org`), the field path (`stateSchema` or `resources.<ref>`), and a reason. Resolution is either reconciling the schemas or opting into isolation.

**What each half compares.** The two halves of the check follow the two storage-key rules below, so they drop out of the shared view at different granularities:

- The **scope record's `stateSchema`** is one blob per scope, so it follows the flow-level `isolateUserState` / `isolateOrgState` flag. A flow that isolates a scope contributes no `stateSchema` to it.
- **Resources** are compared when two flows declare a shared resource at the same `(scope, ref)` — never by the accessor name they hang off `ctx.resources.<key>`, which is a naming choice rather than a storage identity. Effective `flowIsolation` decides *participation* rather than forming part of that key: an isolated resource is flow-namespaced and so cannot collide, and it is dropped before any comparison. Each resource is judged on its own `flowIsolation`, independently of the flow-level flag — a flow that isolates a scope still participates for a resource declaring `flowIsolation: false`, and a shared flow does not participate for a resource declaring `flowIsolation: true`.

The checker is coarse by design — Wave 1 accepts false-positive conflicts (ask the developer to reconcile or isolate) over false negatives (silent data loss). Two overlaps are the exception, and are **not** detected today:

- **A collection pattern overlapping a concrete ref.** Refs are compared exactly, so a collection at `files/*` and a resource at `files/a` index separately even though the collection's `"a"` instance resolves to that same cell. Two collections declaring the *same* pattern are compared normally — a collection indexes on its `pattern`, which is what its instance keys derive from.
- **Two instances of one flow kind whose `resources` overrides disagree.** Participants are retained per `flowKind` and same-kind pairs are skipped, so per-instance overrides are never compared against each other.

### Per-flow isolation (opt-in)

Isolation promotes a user/org-scope storage cell to a flow-namespaced key (`${id}:${flowKind}`) so it can't be read or overwritten by other flows. Two layers decide it, at two different granularities (FIX-735):

- **Flow-level**: `isolateUserState: true` / `isolateOrgState: true` on the `FlowDefinition`. Two roles: (1) it keys the **scope record** — the scope's single `state` blob (`ctx.user.state` / `ctx.org.state`) — and (2) it is the default `flowIsolation` for resources at that scope that don't declare their own. A flow that isolates a scope contributes no `stateSchema` to the registry schema merge for it, but still participates for any resource that opts back out.
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

## Workstreams and Scope

A workstream is a **child session**, not a new scope level. The hierarchy stays `request → session → user → org`; a workstream occupies a different `session` cell and inherits the rest of its identity from the request that started it.

This section covers what a workstream *addresses*. For what happens to it over its lifetime — where it runs per topology, whether it survives the process, what `dispose()` settles, and what recovers an abandoned run — see [Detached Work](./detached-work.md).

`startDetached` derives the child's session id rather than accepting one (`deriveChildSessionId`, `packages/engine/src/context/detached-child.ts`). The key material is the running request's `tenantId`, `userId` and `parentSessionId` plus the caller's routing seed (`topic` + optional `key`), each length-framed, hashed to `dsx_<sha256[0:32]>`. The caller supplies the *target* of the operation and never the *authority* for it. The derivation is deterministic, which is what makes "adopt if it already exists" the ordinary second-task-same-topic path rather than a conflict.

The child inherits `flowKind`, `userId`, `tenantId` and `orgId`, and records `parentSessionId`. `evaluateAdoption` re-checks all five before adopting a record found at the derived key — the public session-create route lets a same-principal caller pre-create a record sitting at that deterministic id, and `createExecutionContext` validates user, tenant and org bindings but not `flowKind` or `parentSessionId`.

### What each scope resolves to inside a workstream

| Scope | In the child |
|---|---|
| `request` | Fresh — the child's own dispatch |
| `session` | **A separate cell.** Own state blob, own items and history, own journal, own metadata, own session-scoped resources — except a resource declared `sharedToWorkstream` (below) |
| `user` | **The parent's cell.** `userId` is inherited, and `isolateUserState` keys on `${userId}:${flowKind}` with `flowKind` inherited too — so isolated and shared both resolve to the record the parent reads |
| `org` | The parent's cell, by the same reasoning |

Tenant follows identity: the child's session storage key is `${tenantId}:dsx_...` under `resolveSessionStorageKey`, exactly as for any other session.

### What connects a child to its parent today

Four channels, and none of them is shared session state:

1. **User and org scope** — live and shared, but keyed to the *principal*, not to the parent session. Two unrelated conversations belonging to the same user read the same cell.
2. **`input` at spawn** — a one-shot payload handed to the dispatched request, frozen at dispatch.
3. **`record` on `StartDetachedInput`** — caller bookkeeping persisted on the child session record. Metadata rather than state, and also frozen.
4. **`parentTask()` / `settleParentTask()`** — one board row, server-stamped at spawn and closed over. Deliberately not a cross-session browser: one coordinate, one row.

**There is no live read or write of the parent session's STATE from inside a child**, and none is planned. The request host is a **sealed** seam — adding a verb to it is a decision someone reviews, not a surface that grows by transitivity — and it passes behaviour rather than handles: no type on it names a store, a session record or a task row. Read the verbs off the `RequestHost` interface rather than off a count in prose; the seal is a property, and messaging (`sendMessage`) is the one place it has been deliberately reopened since.

### Resources shared to the lineage (FIX-1068)

Resources close the gap that state does not, and they close it without a cross-session seam. A session-scoped resource or collection declaring `sharedToWorkstream: true` resolves against the **lineage root** rather than the running session, so a parent and every descendant address one storage cell through the ordinary resource API. There is no new verb, no direction, and no cross-session read path: whether a resource is shared changes only where it stores.

**The lineage identity is minted, not derived.** A root session mints
`SessionRecord.lineageId` when its record is created; every descendant inherits
that same literal value at spawn, and the storage address *is* that id. Nothing
is reconstructed at read time, so there is nothing for a parent and a descendant
to compute their way to differently.

That is the whole reason the hard cases need no handling. A session id can be
deleted and recreated by anyone, but a recreate produces a new record and
therefore a new lineage — so a surviving descendant of the old one keeps its own
address, with neither the owner nor an incarnation nonce conjoined in to tell
them apart. An earlier design derived the address from `(tenant, user, root
session id)` and had to keep growing to stay ahead of the ways session identity
is not stable; each component it grew added a seam — inheritance, adoption,
legacy fallback, concurrent minting — that then had to be kept consistent. The
minted id is the same guarantee without any of them.

A record written before the field existed has no `lineageId` and falls back to a
value derived from its session storage key, prefixed so it can never *equal* that
key. This is defensive hygiene for records left by earlier commits in
development, **not** an upgrade path from a released version — no version of this
package has been published, so no deployed store holds session records or
Workstream addresses predating any of this. The prefix is load-bearing: the storage scope is decided by
comparing a resolved address against the lineage id, and if the fallback were the
session key itself, an unstamped session's shared and unshared buckets would be
indistinguishable — routing unshared resources into the lineage namespace.

**Where the id comes from, and where it must not come from.** Two invariants
hold for every creator on the production path, however it writes: the record is
stamped with a `lineageId` before it lands, and it lands through
create-if-absent rather than `get`-then-`set`. Both halves are the point. A creator that omits the id leaves
a session on the derived fallback, where delete-and-recreate lands on the same
address again; and `get`-then-`set` lets a concurrent first action's loser
overwrite the winner with a *different* id, stranding its shared writes at an
address nothing reads.

`ensureSessionRecord` (`context/ensure-session-record.ts`) is how a creator that
**mints** satisfies both at once — it generates the id and writes `"absent"`, so
the caller describes the record it wants, chooses neither the id nor the write
predicate, and must use the record that comes back (on a lost race, the
winner's, not its own). `createExecutionContext`, the CLI's `run`, and the
webhook and chat-SDK session resolvers all go through it.

Two creators satisfy the invariants without it, and neither is an oversight:

- **`routes/session-routes.ts`** (the public create-session route) mints inline
  and writes `"absent"` itself, because it owes the caller a `409` naming the
  conflict rather than the helper's adopt-the-winner return.
- **`context/create-request-host.ts`** (the Workstream path) *cannot* use it.
  `SessionRecordSeed` is `Omit<SessionRecord, "lineageId">`, so a caller is
  structurally forbidden from supplying an id — and a child must inherit its
  parent's **verbatim**, not mint a new one. It also runs `evaluateAdoption` on
  a conflict, which the helper has no notion of.

So the rule a third creator has to follow is the pair of invariants, not the
helper. **A new creator on the child side that reaches for `ensureSessionRecord`
mints a fresh lineage for a session that should have inherited one** — which
silently splits a Workstream's shared resources away from the conversation that
owns them.

**The testing helpers are outside this contract, and that costs coverage rather
than correctness.** `createTestContext` and `testFlow` seed a session record
directly — no `lineageId`, written `"any"` — so a session either one creates
lands on the derived fallback instead of a minted lineage. The consequence is
not a broken invariant in production but an unguarded one: a test whose session
comes from a helper exercises the fallback, and the lineage tests that do exist
hand-seed a `lineageId` themselves, so nothing in the suite drives the minting
path. Removing the mint from `ensureSessionRecord` entirely leaves both the
engine and integration suites green. FIX-1132 tracks closing that.

Descendants get the id from `createRequestHost.startDetached`, copied verbatim.
It is also part of the derived child session id, because otherwise a recreated
session spawning the same seed derives the same child and *adopts* the previous
lineage's workstream, silently inheriting a dead conversation's address.

**The lineage is its own storage scope.** `StorageScopeType` adds `lineage`
alongside the three declared scopes, so a lineage bucket is not addressable from
the session namespace at all. Session scope ids are caller-chosen and nothing
validates them, so a lineage bucket sharing that space would be one a caller
could occupy by picking the right session id — unguessable is a weaker property
than unaddressable. Adapters treat the value as opaque (a plain `TEXT` column,
no constraint), so this needed no schema change and no migration.

**Where resolution happens.** On the execution path, `resolveConfigScopeId` and `resolveResourceStorageScopeId` in `packages/engine/src/context/createExecutionContext.ts`. Both route the session scope on a `sharedToWorkstream` bucket map built the same way user/org build their `flowIsolation` buckets: singles by canonical storage key, collection instances by longest-matching prefix. Collections sharing a storage prefix must agree on the flag, refused at context construction like the `flowIsolation` case.

The HTTP read/write routes need the same answer and derive it from `packages/engine/src/resources/lineage-scope.ts`. **Which helper depends on what the route holds, and getting that wrong is a cross-session read:**

- `sessionKeyScopeId` for a concrete storage key — the collection CRUD routes. A route names a collection by ref, and a broad pattern accepts keys a narrower sibling owns (`tasks/**` accepts `tasks/meta/a`), so the addressed *declaration's* flag is not the key's owner.
- `readSessionScopeWithLineage` for anything spanning a prefix or a whole scope — `getPersistedData`, the state route, and collection listing. It drops shared keys from the session's own rows before folding in the lineage's, so a child's view is exactly what a block resolves rather than a union of two sessions' resources.
- `sessionStorageScope` for the scope kind that goes with a resolved address. It and
  `createExecutionContext`'s `storageScopeOf` answer one question, and they have already
  disagreed once about which namespace an unstamped session's shared bucket lives in.

The module also exports `sessionResourceScopeId`, which answers from a
declaration rather than a key. **It has no callers.** Every route that looked
like its case turned out to hold a key, not a declaration — which is the
distinction the first bullet exists for — so reach for it only if a caller
genuinely arrives holding the declaration and nothing else, and read
`sessionKeyScopeId`'s contract first to be sure that is what you have.

**Ownership is one rule, in one place.** `resolveOwnershipFlag` (`resources/lineage-scope.ts`) decides which declaration owns a storage key: **an exact single wins outright, then the longest matching collection prefix.** Both `createExecutionContext`'s bucket resolution and the whole-scope reads call it, because two implementations of "longest prefix wins" is how the execution view and the HTTP view drift into disagreeing about which session holds a key.

Two shapes make that precedence load-bearing rather than cosmetic:

- A shared collection with an **empty storage prefix** — any parameterized pattern, e.g. `[topic]/observations` — matches every key in the scope. Treating "matches a shared prefix" as "is shared" hands the whole scope to the root and discards the child's private rows.
- A **private prefix nested under a shared one** (`tasks/meta/*` under `tasks/**`) is owned by the longer prefix. A collection is loaded by prefix, so the broad scan sweeps up keys the narrow sibling owns; every prefix scan (the eager waves and the lazy `getByPrefix` alike) therefore re-checks each returned key against per-key routing and keeps only what that bucket is the address for. Without it, which copy survives depends on declaration order.

**Filtering a scan changes what it covers.** `loadedCollectionPrefixes` records coverage per `(scopeId, prefix)`, not per prefix, because a filtered scan read one bucket and may legitimately have returned nothing for keys another bucket owns. Recording the bare prefix would claim coverage the scan never had, and `isMissAuthoritative` would then answer "absent" for a row that exists — the read suppressed by its own correctness.

**Sharing does not imply serialization.** Two workstreams writing one shared resource is ordinary same-resource contention, governed by the `expectedVersion` + `SetResult` contract every `ResourceStateStore` adapter implements (FIX-992). Nothing queues, locks or orders those writes.

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

