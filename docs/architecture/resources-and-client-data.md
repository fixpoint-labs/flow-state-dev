# Resources and Client Data

Resources are persisted, typed data with an intrinsic `scope` (`session` / `user` / `org`); client data is what a scope deliberately projects to the browser. Authoring is user-facing: [Resources overview](../../apps/docs/docs/resources/overview.md), [Client Access](../../apps/docs/docs/resources/client-access.md), [State vs Resources](../../apps/docs/docs/resources/storage.md), [Resource Edges](../../apps/docs/docs/resources/edges.md), [State mutation model](../../apps/docs/docs/state/mutation-model.md). Collections: [Resource Collections](./resource-collections.md). This page holds the storage, write and exposure contracts.

## Identity and storage keys

- The accessor name in a `resources` map is only a typed handle. **Storage is keyed by ref identity**: the same `DefinedResource` under two accessor names shares one slot; different references under one accessor throw at build.
- Without an explicit `ref`, the storage key falls back to the **first accessor encountered in declaration order**, which makes a dual-registered user/org resource's key depend on ordering. **Set `ref` on any non-session resource registered under more than one name**, or a refactor silently moves its data.
- Build-time collisions: (1) same accessor, different references; (2) different accessors resolving to the same `(scope, ref, flowIsolation, flowInstanceId?)`, which would silently share storage. Identity-equal re-registration (capability diamonds) is always fine.
- `defineFlow` merges block declarations from every reachable block (composition and static `tools`, including tools contributed by `uses`). Flow-level declarations win. Function-valued `tools` aren't collected; declare their resources on the flow.

### `flowIsolation`

User/org resources are **shared** across flows by default (BP-027). `flowIsolation: true` makes one flow-private, keyed by the resolved **instance** id (so two copies of a collection definition isolate; a singleton's id is its kind, so its keys don't change). Flow-level `isolateUserState` / `isolateOrgState` are defaults; a resource's own declaration wins. `flowIsolation` on a session resource is a build error (sessions are already flow-bound).

| `scope` | `flowIsolation` | Key |
|---|---|---|
| session | n/a | `(sessionId, ref)` |
| user | false | `(userId, ref)`; owner-pinned instance: `(userId:~org:orgId, ref)` ([the owner-pinned cell](./state-and-scopes.md#the-owner-pinned-cell)) |
| user | true | `(userId, flowInstanceId, ref)` |
| org | false | `(orgId, ref)` |
| org | true | `(orgId, flowInstanceId, ref)` |

**A resource's state and content share one coordinate**: two stores, one cell. Anything that moved one without the other would split the resource.

## State storage

Resource state (singles and collection instances) lives per key in `ResourceStateStore` `(scopeType, scopeId, resourceKey)`, not on the scope record (whose old inline `resources` field is no longer read or written). A write touches only its key, removing the old N-instance write amplification. Content lives in `ContentStore` with the same lifecycle. The two are independent (state without content and vice versa), with distinct payload types and adapters.

- Execution contexts load into an in-memory per-scope cache; reads during execution are synchronous against it. State routes and debug snapshots read the stores fresh.
- **Content writes don't bump the scope record's `version` / `updatedAt`.**
- **Scope deletion calls `ContentStore.deleteAll()` before removing the record**, so no orphaned content.
- Legacy: records carrying the removed inline `resourceContent` field silently drop it on their next round-trip. Content that must survive needs copying into `ContentStore` (`stores.content.set(...)` per entry) before upgrading.
- `edges: true | { vocabulary?, maxEdges? }` injects an `edges: Edge[]` field into the state schema, so edges persist as ordinary state with no new key or adapter change; traversal is in memory. `.edges` mutators go through `updateState` (same `resource_change` events); `supersede` is a bi-temporal close, never a hard delete. The `maxEdges` cull drops superseded tombstones first, then lowest-confidence edges, and never the edge just added.

## Three-wave loading

A request loads only what its action and blocks declare:

1. **Flow-level** eager resources, in `createExecutionContext` at request start.
2. **Action-tree** resources, also in `createExecutionContext`, in one parallel burst. It lives there, not in `runAction`, because a context is bound to exactly one action, so there's no later "action start". Sibling actions' resources never load.
3. **Per-block lazy** single resources, loaded by the block runtime's `run` (`_loadDeclaredResources`) when the block dispatches. Lazy collections defer further, to each access.

- **Dedupe.** `loadedCollectionPrefixes` per scope (seeded by wave 1) prevents re-scans; singles are tracked by presence in the cache. `inflightLoads` single-flights concurrent loads (e.g. a `.sideChain()` fan-out) and clears in `finally` so a failure retries instead of poisoning the map. Lazy accessors share both.
- **Cache writes are per key, in place** (`cache[key] = value`), never whole-map replacement. `.parallel`/`.forEach` branches share one context, so this is what lets a convergence `.list()` after a fan-out see every branch's instance.
- **Validation:** `prefetchMode: 'lazy'` on a flow-level single resource throws (no dispatch to trigger it). Lazy plus non-`none` eviction throws (a partial cache can't evict correctly). `maxInstances` and eviction are exact under eager, best-effort under lazy.

## The five state writers

`patchState`, `setState`, `updateState` compute the next state; `incState`, `pushState` describe a delta. All five resolve to `void` (read `ref.state` after), exist on both single and instance refs, and honour `writable: false`. A handle from `ctx.resources.<name>` is `ResourceRef<any>`, so wrong-kind checks there are runtime only.

- **Atomic per key through `runResourceCAS`** (`engine/src/stores/resource-cas.ts`). The mutator is *intent*: re-run against refreshed state on each retry, so a loser recomputes against the winner instead of committing a stale value. That's what makes two concurrent `incState`s both land. It's only as strong as the store's CAS: memory, SQLite and Postgres compare-and-swap in the store; **the filesystem store guards per key on the store instance**, so two instances pointed at one directory aren't coordinated.
- **Refusals.** `incState` refuses a non-number field and a non-finite *result* (`z.number()` accepts `±Infinity`, and adapters disagree on storing it: memory keeps it, JSON adapters store `null`). `pushState` refuses a non-array. Code `resource_delta_refused`, not retryable. A multi-field call is one mutation: one bad field applies none.
- **A refusal is judged against a verified basis and writes nothing.** The mutator runs unguarded before persistence, so a throw would otherwise fail terminally over a cached row the store may no longer hold. Instead a refusing attempt returns the basis **unparsed**; the CAS driver treats it as a no-op and verifies it: versions match → the refusal stands; the key moved → refresh and re-run. Schema rejections are deferred the same way (an `incState` off a stale `calls: 10` against `.max(10)` re-runs). **Unparsed is load-bearing**: normalising (filling a `.default()`, dropping a retired key) would make an untouched row look like a write and get persisted and version-bumped before the refusal surfaced. A refused write persists nothing, bumps nothing, emits no `resource_change`.
- **Absent and `null` are empty, not wrong kinds**: `incState` starts from `0`, `pushState` from `[]` (BP-023 makes untouched fields `null`). Presence is `Object.hasOwn` and the write is `Object.defineProperty`, because inherited `Object.prototype` names would otherwise misfire and `__proto__` would set a prototype. Field names come from callers, so both paths are reachable. (Zod itself rebuilds objects by assignment, so a field literally named `__proto__` doesn't survive `parseResourceWriteState` on an object schema.)
- **Schema failure throws `ValidationError`, state untouched.** A whole-row `.catch()` (even under `.nullable()`/`.default()`/`.readonly()`) is not a write success: the write path peels it and the candidate must satisfy the inner schema. Field-level `.catch()` is ordinary normalisation. Schema-valid `null` on a `.nullable()` resource is the documented reset and persists as `{}`. A single resource's stored value that no longer validates falls back to its default on read (load-time recovery); collection-instance reads return the stored object as-is.

### `stateSchema` must be a fixed point

A single resource is parsed on read *and* write, so a schema rewrite lands twice per read-modify-write; a collection instance is parsed on writes only (`createNamespaceInstanceRef` returns the cached object, and its loaders skip `normalizeResourceState`). A rewrite that settles is fine and load-bearing (it's how pre-existing rows gain new defaults, BP-030). One that doesn't settle (`z.number().transform(v => v + 1)`) drifted stored values on every write while reporting success.

So `parseResourceWriteState` (`engine/src/resources/normalize-resource-state.ts`), the single parse path for every resource write (all setters on singles and instances, `collection.create()`, both `upsert` branches, and the `POST` create route), **refuses a parsed value that isn't a fixed point** with `ValidationError`. It short-circuits when the first parse changed nothing, assuming parse is pure. Legacy rows under a settling schema converge on their next write; rows under a non-settling schema can't be mutated at all (`assertStableResourceState`) until the schema is made idempotent.

When a helper must report *what it did* from an updater, use `updateStateWith` (`@flow-state-dev/core/helpers`): the updater can run more than once on the CAS path, so a value captured outside it describes the last attempt, not the committed one.

Scope state (`ctx.session.state`, etc.) stays separate from resources: state slices are namespaces many unrelated blocks contribute keys to; resources have identity and carry their scope.

## Owner-private collections

A collection declaring `ownerPrivate: { param }` owns every key whose first `~`-prefixed segment sits at that parameter. Core validates the shape at definition (parameter occurs once, no `**`, no browser read of state or content). Engine enforces it in one module:

- **The key fence, always on.** A key's first `~` segment is its owner. Such a key is served only through an owner-private collection, only with that segment at its owner parameter, and only to the user `ownerSegment` encodes. Later `~` segments are data. Every other collection lists without it, reads it as absent and is refused on write: through the handle, the request-start seed cache, projected collections, browser resource routes, `/state` and debug endpoints. It reads only the key, so it holds in every process.
- **The startup fence, armed by a declaration.** Once `FlowRegistry` holds a flow with an owner-private collection, it refuses any flow with another same-scope collection whose pattern can reach those keys, checking held flows and every later one. **Never cleared, even across unregister**, because the rows outlive the registration.
- **Single resources, always.** Every registry refuses a single resource whose storage key (`ref`, else accessor) has a `~` segment: a single's key is the same for every caller, so it's never an owner's own.

Workforce's private roster is the first consumer; engine knows it only as an owner-private collection.

## Client data

**Scope state is server-private by default.** A scope's `client` block declares what crosses: `expose` (top-level fields, verbatim) and `derived` (computed from `{ state, resources }` of **that scope only**, returning `JsonValue` with no runtime schema). Both land at `clientData.<scope>.<name>`; they share one namespace, so a name in both throws at `defineFlow`. A scope without `client` exposes nothing, and a new state field doesn't reach the wire until named.

Resource-level `client` is the second channel: `client.data` projects metadata into the snapshot, `client.content` gates content endpoints (`create`/`update`/`delete` are collection-only, a type error on singles). No `client` → invisible. The snapshot carries metadata and `clientData` only; content is fetched lazily unless `prefetch: true`. A never-written single resource's content endpoint returns its declared `content`/`contentFile`, the same body a run starts from.

`ClientDataOf<typeof def>` extracts the projected type, a phantom `ClientType` derived from `expose`/`exclude`/`data`'s awaited return/identity; React hooks take it as `TClient`. Type-level only: `resolveClientProjection` and the `JsonValue` wire contract are unchanged. Annotate a `data` function's return type to get a precise shape.

### Collection write routes: state first, then content

`ResourceStateStore` is versioned, `ContentStore` is unversioned by decision. Both write routes **settle the state key first, then touch content**; a request that loses the state race gets `409` and never reaches `ContentStore`.

- **`POST`** inserts at `expectedVersion: 0` (create-if-absent), then writes content. Concurrent creates → one `201`, one terminal `409`; the body is always the winner's. Its seed (`stateSchema.parse({})`) goes through `parseResourceWriteState` like every other write, so a schema that can't seed gets `400`, not a `201` over an unmutable row. This is the only engine path that writes resource state from outside the registry.
- **`DELETE`** reads the version, deletes state conditionally, then content. Absent topic → idempotent `200`. The version is the one the *route* reads, so it closes only the route's own read→write window; a caller-supplied precondition isn't supported.

**Accepted residuals** (a create is two writes to two stores), pinned in `packages/engine/test/resource-collection-routes.test.ts`:

| Window | Outcome |
|---|---|
| Content write fails | **The request fails but the item exists**, live and listable, with no content row; retries get `409`; repair is `PATCH` if granted |
| `DELETE` lands in the window | The create's body is orphaned behind the tombstone; a later contentless create revives the row over it, surfacing deleted content as current. No error |
| `PATCH` lands in the window | Acknowledged `200`, then overwritten by the in-flight create. No error |

- **A missing body reads as `null`, not `""`** (`renderContent` returns `null` for undefined raw content). Code branching on `content === ""` takes the wrong path.
- **Template-backed collections** render from state regardless (the template branch never consults `rawContent`), so readability is unaffected, but the create route writes content with no template guard, so the **half-commit is just as real**.
- Why not fenced: versions are per key, not per generation, so a create's own row and a successor generation's can both be version 2; a generation token still couldn't fence an unversioned store. Closing these needs cross-record atomicity.
