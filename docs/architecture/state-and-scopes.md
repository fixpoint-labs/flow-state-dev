# State and Scopes

Scopes are `request → session → user → org`. The state verbs, scope handles, session items, journal, metadata and persistence adapters are user-facing: [State & Scopes](../../apps/docs/docs/fundamentals/state-and-scopes.md), [State Operations](../../apps/docs/docs/fundamentals/state-operations.md), [State mutation model](../../apps/docs/docs/state/mutation-model.md), [Block State](../../apps/docs/docs/advanced/block-state.md), [Sharing State Across Flows](../../apps/docs/docs/advanced/flow-isolation.md), [Persistence](../../apps/docs/docs/persistence/overview.md). This page is the concurrency, isolation and identity contract. **Read [Atomicity Guarantees](#atomicity-guarantees) before relying on any bag verb under concurrency.**

## Atomicity Guarantees

The seven bag verbs (`patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`) don't share one guarantee. The split is by **hint shape and adapter capability**, not verb name: `createScopePersist` sets `expectedVersion: "any"` from the commutative hint alone, before any store lookup, and only when the adapter advertises the matching delta verb; otherwise it does a full-record `set` at the **held** version.

Every unchecked verb applies store-side against the record as found, so **writes to unrelated paths always survive**. That's narrower than "no lost updates". On the *same* path:

| Class | Verbs | Same-path outcome |
|---|---|---|
| Unchecked, commutative | `pushState`; single-field `incState` | Hint carries the delta, so **both writers land** (append order affects position only) |
| Unchecked, **not** commutative | `setStateRecord`, `deleteStateRecord` always; single **literal**-field `patchState` | Hint carries an absolute value, so **last write wins and both calls return `true`**; neither writer learns of the race |
| Version-checked | multi-field `incState` / `patchState`, `patchState` updater form, `setState`, `atomicState` | Can raise `ConcurrentModificationError` on retry exhaustion |

- **The version check is not the safety property**; the retry's mutator is. `setState`'s mutator is a constant, so its retry re-applies the **same whole state** and discards the winner's change: checked, and the most destructive verb. Multi-field `patchState` merges fixed values (unnamed fields survive, named ones overwrite). Multi-field `incState`, the updater form and `atomicState` **re-run** against the winner, so they genuinely merge. Use `atomicState` or the updater form when a same-path write must read what's there.
- **Adapter capability varies by scope.** Session/user/org: memory, SQLite and Postgres advertise all four delta verbs; filesystem lacks `deleteField`. Request scope: **no shipped adapter advertises `deleteField`**, so `ctx.request.deleteStateRecord` always falls back.
- **The fallback fails silently.** It sends the held version but nothing retries: `runDurableMutation` routes to `runCommutative` on the hint before any store call, and `runCommutative` persists once. A version mismatch returns a bare `false`, never `ConcurrentModificationError`, indistinguishable from the [no-op guard](#no-op-guard)'s `false`. A `setStateRecord`/`deleteStateRecord` that quietly doesn't land: check the adapter's verbs before hunting for a race.
- **Unchecked isn't immune to deletion.** Every delta store refuses a missing record before comparing versions, `"any"` included.

### Delta verb routing

| Op | Shape | Store verb | Version |
|---|---|---|---|
| `patchState({ foo })` | one own non-function field | `patchField` | `"any"` |
| `patchState(key, updater)` | keyed updater | `patchField` | **held** (it reads to compute) |
| `patchState({ foo, bar })` / function value / `setState` / `atomicState` | | `set` | held |
| `incState({ f })` | one numeric field | `incField` | `"any"` |
| `incState({ a, b })` | multi | `set` | held |
| `pushState` | | `pushToArray` | `"any"` |
| `setStateRecord` / `deleteStateRecord` | depth-2 path | `patchField` / `deleteField` | `"any"` |

Storage verb and version check are two decisions (the keyed updater shows it). Multi-field patches stay on one `set` because N `patchField`s would bump the version per field, multiply retry exposure and expose intermediate states. Delta verbs are optional on `Store`; `createScopePersist` feature-detects per call.

### No-op guard

Every write compares next vs current by structural equality (`Object.is` for primitives, so `NaN` equals `NaN` and `+0 ≠ -0`; recursive for plain objects/arrays; `getTime()` for dates). Equal → no persist, no `state_change`, resolves `false`. Non-JSON shapes (Map, Set, RegExp, functions) throw `TypeError`. CAS retries are unaffected.

### Transient slots

`transientSlot()` on a sequencer `stateSchema` field keeps it in memory for the run but out of `state_change` and `state_snapshot`, so it **resets to its default on resume**. Apply it **last** in the chain (after `.optional()`, `.default()`) so the marker is on the outermost schema the parent shape references. Mixed patches emit only the non-transient keys.

## CAS and Concurrency

### Scope records

- Records are created **at version `0`**, so `expectedVersion: 0` means "stored at version 0" (every first CAS write depends on it). "Must not exist" is the word `"absent"`: `set(id, record, "absent")` writes only if nothing exists and otherwise returns the conflict with the winner's record. It exists because `get`-then-`set` can't decide a create race (`set` upserts, so the second writer silently wins).
- Scope `delete` is a **hard delete with no tombstone**; a recreated id may reuse versions. Scope versions detect concurrent modification; they are not identity.
- `session`/`user`/`org` drive `runWithCAS`. Request scope runs the same driver under `withScopeLock` (`serialize: true`), so a same-process fan-out queues rather than exhausting retries.
- The per-request `MemoryStateContainer.read()` returns its internal reference uncopied: **callers must treat it as immutable** (in-tree ops spread before mutating). The clone was removed from the CAS hot path deliberately.

### Resource state

`ResourceStateStore` is compare-and-swap: `set`/`delete` take an `ExpectedVersion` and return `SetResult`; reads carry the version.

- Versions start at `1`. **`0` = no live row** (create-if-absent; a tombstone satisfies it, which is what recreation after delete rides on). **`"absent"` = no row at all** (a tombstone conflicts), which lets the store tell never-written from deleted. `delete` rejects `"absent"`. Non-integer or negative numbers throw (a call-site bug, not a lost race).
- Deletes **tombstone**: mark `lifecycle`, keep the version, drop the payload; `deleteAll` bulk-marks. Reads filter to live. Which predicate a write uses is decided by intent inside the CAS, because reads can't tell tombstone from absent: `create()` writes at `0`; `patchState`/`setState`/`updateState` at the observed version, or `"absent"` if none observed.
- **Retention is the guarantee**: versions are never reused and tombstones never age out, so a pre-delete observer can never match the replacement row. Cost: one row per deleted key, forever.

**Tombstone reclamation on scope re-creation.** Scope records hard-delete, resource state tombstones, so a reused session id would inherit refusals and its **static** resources (no create-if-absent fallback) would be permanently unwritable. So `purgeTombstones` runs at exactly one moment: **when a session record is created under that id, never when one is deleted**. The three creators (create-session route, `ensureSessionRecord`, the dispatch seam's child mint) reclaim **immediately before** their create-if-absent, after checking no record exists.

- **Reclaim first, then create**, because there's no cross-store transaction: create-first would leave a committed session on intact tombstones if reclamation failed, and nothing retries (a second create 409s; an action-driven create adopts). Reclaim-first commits nothing until it succeeds.
- It removes **tombstones only**, never live rows (state written before its scope record exists is a real pattern). It gives up ABA across incarnations: a reclaimed key restarts at version `1`.
- **Known limit, not fenced against a concurrent creator.** Two creators both see no record; the winner creates and deletes resource `R`; the delayed loser reclaims (removing that tombstone) before losing the session CAS. The next ordinary `patchState` on `R` writes at `"absent"` and revives it, and every fresh request holds no version, so this is reachable. The remedy is a **scope generation** (FIX-1000), not a second primitive, and specifically not `lineageId`, which answers a different question.

**Resource CAS has its own driver** (`stores/resource-cas.ts`), at the registry's read/mutate seam rather than the persister, because by the persister intent has become a value and a retry could only overwrite. It re-runs the op's real mutator. Six of `runWithCAS`'s decisions differ (tombstone conflicts and lost create-if-absent are terminal, cancellation is honoured, no-ops are suppressed only against a re-read version, nothing commutative is inherited); **the policy table lives in that module's header**, not here.

### Shared names are not shared guarantees

| Bag verb | Resource handle |
|---|---|
| `patchState`, `setState`, `incState`, `pushState` | same names |
| `atomicState` (partial, shallow-merged) | `updateState` (whole next state, re-parsed, so omitted fields **don't** survive). Analogue, not equivalent |
| `setStateRecord`, `deleteStateRecord` | deliberately absent: the resource *is* the per-key row |

On a bag, `incState`/`pushState` are the unchecked commutative path. On a resource handle they're version-checked like every state mutator: both writers still land (the delta re-runs), but they can exhaust retries, and are refused against a tombstone. `writeContent` carries no version at all.

### Resource write errors

| Situation | Reported as |
|---|---|
| No live row and the mutator asks for no change | not an error: a verified no-op (nothing written, nothing revived) |
| A mutation reaches a tombstone | `ResourceDeletedError`, terminal |
| A create-if-absent lost | `ResourceAlreadyExistsError`, terminal, **carrying the winner's row** |
| A delete's version check failed against a live row | `ConcurrentModificationError` (nothing was deleted) |
| Retry budget exhausted | `ConcurrentModificationError` |

**Who carries a version.** Find writers with `grep -a "resourceState[?.]*\.\(set\|delete\|deleteAll\)(" packages/*/src` (`-a` because `resource-registry.ts` contains a NUL byte). Version-checked: every registry write op on singles and instances plus `upsert`'s patch, `create()` at `0`, `collection.delete()` and `evictInstance` at the observed version. **Unconditional by design:** `create({ replace: true })` on a writable collection (an explicit overwrite; on `writable: false` it is create-if-absent and a live row is the read-only refusal), `deleteAll` (a scope operation), the `@flow-state-dev/testing` seed helpers (fresh scope). The collection HTTP routes write the store directly with their own versions and surface conflicts rather than retrying ([Resources](./resources-and-client-data.md#collection-write-routes-state-first-then-content)).

- Cancellation uses the request's **background** signal, not the transport signal (a disconnect must not abandon a `.sideChain()` task's writes).
- **Two quiet orderings:** `create()` evicts for `maxInstances` only **after** its CAS commits (evicting first lets a losing create tombstone an unrelated instance). First-touch APIs translate a terminal already-exists into their contract: `getOrCreate` returns the winner, `upsert` applies as a patch.
- **Not closed by per-key CAS:** a create of a never-existed key racing `deleteAll` lands (`0` is satisfied by a key that never existed), and `maxInstances` is a read-then-act on a set. Both are cross-key invariants.
- Real CAS on memory, SQLite, Postgres; filesystem compares under a per-key mutex on the store instance (in-process only).

### Same-key concurrency in fan-outs

Instance writes commit per key and update the per-scope cache in place, so distinct-key writes from `parallel`/`forEach` branches all survive into the request's view. **On the same key, what the writer supplies decides the rule**: a **derivation or delta** (`updateState`, `incState`, `pushState`) re-runs against the committed row, so both land; **fixed values** (`setState`, `patchState`) are last-writer-wins on the fields they name. `getOrPatchState` is a first-touch memoise (patches only an absent key, single-flighted per request), so it follows `patchState`. `writeContent` is last-writer-wins outright. Avoid read-modify-write in fan-outs without these, or cap with `maxConcurrency`.

## Block-level own state

Any block with an effective `stateSchema` (its own or capability-contributed) gets a per-scope-node container; the gate used to be `kind === "sequencer"` at four call sites (`_withExecutionScope`, sequencer child dispatch, root `executeBlock`, the tool executor's `ExecutionParent`).

- **One container, four addresses:** `ctx.self` (bound to the current node, never by name, so never ambiguous); `ctx.parent` (present whenever the parent has state; `parentStateSchema` only types it); `ctx.sequencer`; `ctx.targets.<name>` / `getTarget`. A child reaches its owner without naming it: the skills tool → generator write is `ctx.parent`.
- Each `forEach`/`parallel` iteration and each `loopBack` re-run is a fresh node, so **private state per iteration**; a loop-owning sequencer keeps its container across passes.
- **Routers may read `ctx.self`/`ctx.parent` but must not write** ([router purity](./execution-and-errors.md#routers-under-resume)); put the write in a preceding `.tap()`.
- **Non-sequencer block state is in memory only**: no checkpoint, so it doesn't survive suspend/resume (that needs a path-based key, a snapshot call site and suspension stamping). Its `state_change` uses `scope: "block_instance"` and is transient in production.
- Capability-contributed own state merges with collision detection by reference ([Capabilities](./capabilities.md#merge-semantics-by-field)). The runtime has one container but the config surface still has four schema keys (`stateSchema`, `sequencerStateSchema`, `targetStateSchemas`, `parentStateSchema`).

## Tenant Identity

`tenantId` comes from a header (`x-tenant-id`, configurable via `tenantIdHeader`) and is optional; single-tenant apps never send it.

- **Session storage** keys become `${tenantId}:${sessionId}` (`resolveSessionStorageKey`), for the record and session-scoped content/resource state. With no tenant the key is byte-identical, so there's no migration.
- **Request records** keep a bare `sessionId` plus a `tenantId` field; history isolates by filtering with `sessionRequestScope` (bare id, tenant, the session's owner, org and flow). An explicit `undefined` tenant filter matches only tenantless records.
- **User and org stay shared across tenants** by design.
- The public session id is always bare (`ctx.session.identity.id`, events, HTTP).

### Key ambiguity and the binding check

The key alone can't isolate: session ids may contain `:` and both parts are caller-supplied, so tenant `acme` + session `chat-1` equals tenantless session `acme:chat-1`. **Every load-and-act path checks `tenantMatches`** against the record's stored tenant (`createExecutionContext` throws `TenantBindingMismatchError`; routes 404; `session.create` keeps a raw existence check so a colliding id 409s rather than overwriting). Tenant ids may not contain `:` (400 at extraction); session ids still may.

### A session id is an address, not an ownership

The session key carries the tenant but no user, so two users in one tenant address one key. The stored `userId` keeps them apart, compared on every path, and **a session that isn't the caller's answers exactly like an unused id**:

- **Routes:** another user's session gets the route's not-found (`unknownSessionResponse`, or the debug routes' `session_not_found` after their own gate), never a revealing 403, and before a legacy session's `409 migration-required` (the owner's to hear). Org mismatch for the session's own user is 403.
- **Dispatch:** `runAction` and the transport host refuse at admission with `UserBindingMismatchError`, **before anything is registered, written or acknowledged, and before the flow-instance check**, so the caller learns nothing about which flow holds it (HTTP: `404 Unknown session`). `createExecutionContext` repeats it for a session created after admission. The error names the session, never its owner, because it reaches the caller as an error item.
- `session.create` answers `409` for an id in use, whoever holds it.

### A `requestId` is an address, not an ownership

Request ids aren't secret: callers may choose them (`body.requestId`, for retry), and they travel in headers, 202 bodies, URLs and logs. The stored record is checked on every path that writes, attaches to or resumes a request:

- **Writing or adopting.** A dispatch touches a record only if it's the same principal: user, tenant, and org when recorded (`context/request-principal.ts`). Fresh ids are claimed create-if-absent (`claimRequestRecord`) by the host's enqueue stub, by `runAction` before it registers or acknowledges, and by `createExecutionContext`'s create race, so only one of two racers is acknowledged. A foreign record → `RequestOwnerMismatchError` before writing; a setup-failure settlement never marks another principal's record. This sits beside the flow-instance check (`context/record-owner.ts`); both must pass.
- **Reusing another principal's id.** The HTTP action route gives the caller its own request under an id derived from the caller and the id sent (so its retries converge), never touching the other record. A race the route can't see → `409 request-id-in-use`; a retry resolves to the caller's derived id.
- **Attach and resume** authorise on the stored record (owning instance, and in an authenticating app the principal vs `userId`/`orgId`). Foreign requests get the unused-id answer on every route; a stream whose record is gone gets it too. Resume re-dispatches under the stored `tenantId`.
- Legacy records keep working: checks read fields they already carry; no org → decided by user and tenant (BP-030).

### A request id names one request only while its record exists

Retention deletes records, freeing ids for anyone. State keyed on the id that outlives the record (e.g. a `scope: "run"` bash workspace directory) would pass to the next request. So every record carries an **incarnation**, minted once by `createInitialRequestRecord` and never rewritten (`claimRequestRecord`'s same-owner hand-off keeps it; every context reads it from the record it claimed). Blocks see `ctx.request.incarnation`; legacy records get a `legacy_`-prefixed value derived from `createdAt` (`resolveRequestIncarnation`). `isSameRequest` compares incarnations, so two records under one id in the same millisecond are still two requests.

**Anything keyed on a request id that can outlive the request must key on `[tenant, requestId, incarnation]`** (as `packages/workspace/src/scope-identity.ts` does). The cancel route's `setFieldsIfStatus` and every registered abort controller are fenced on incarnation the same way.

## Cross-Flow State: Shared vs Isolated

User and org records are **shared across every flow by default**, keyed by bare `userId`/`orgId`: right for shared concepts (preferences, quotas), data loss when two flows declare incompatible schemas on the same key. Owner-pinned instances are the exception ([below](#the-owner-pinned-cell)).

### Cross-flow schema registry

`FlowRegistry.register` compares each new flow's `user`/`org` state schemas and user/org resource schemas against every other flow's with a conservative structural check: same reference merges; overlapping compatible keys merge (warning on extensions); a shared required field with disagreeing types, non-object schemas of different kinds, or two shared resources at one `ref` with incompatible schemas throw `CrossFlowSchemaConflictError` (naming both flows, the scope, the path, the reason).

- **Scope `stateSchema`** follows the flow-level `isolateUserState`/`isolateOrgState`: an isolating flow contributes none.
- **Resources** are compared by `(scope, ref)`, never accessor name, and each participates on its **own** effective `flowIsolation` (isolated resources can't collide and are dropped first), independent of the flow flag.
- **Coarse by design**: false-positive conflicts over silent data loss. Two overlaps are **not** detected: a collection pattern overlapping a concrete ref (`files/*` vs `files/a`, though the collection's `a` is that same cell), and two instances of one kind with disagreeing `resources` overrides (same-kind pairs are skipped).

### Per-flow isolation

Isolation keys a user/org cell by **instance** (`${id}:${flow.id}`). Two layers:

- **Flow-level** `isolateUserState`/`isolateOrgState` keys the scope record's `state` blob and is the default for that scope's resources.
- **Resource-level** `flowIsolation` decides that resource's key and wins in both directions. A flow can hold shared and isolated resources at once.
- **The coordinate is the instance, not the kind.** A singleton's id is its kind, so nothing moved. Two collection copies get two buckets. **There is no kind fallback on read** (a key doesn't say which copy owned it); pre-instance collection history is migrated by the offline cutover in the persistence docs, whose stop condition is the same `migration-required` the runtime raises.
- **Non-goals:** no migration when flipping isolation or renaming an instance (stable instance ids are a persistence commitment); no re-parse of stored state on read.

### The owner-pinned cell

An instance registered with an owner pin keys its **shared** user data (scope record and every non-isolated user resource) at `<person>:~org:<org>`. The org comes **from the pin**, never the session, a header or the body (BP-031); the person is the admitted caller. So a person's pinned instances in one org share, their instances pinned elsewhere start empty, and unpinned flows keep the person's cross-org cell, which no pinned instance touches. An org-only pin keys per caller. Workforce seats are the user.

- Unchanged: unpinned flows, flow-isolated keys, org-scoped keys. The three-part key is escaped per component, so it can't equal a one- or two-part key.
- **No fallback read of the cross-org cell**: that fallback is exactly the leak the cell closes. Pre-cell data moves only by the operator step in the persistence docs.
- A run refused at the pin writes no user record (`createExecutionContext` creates it only after every check).
- `UserRecord.id`/`OrgRecord.id` hold the (possibly namespaced) key; `userId`/`orgId` stay bare, so list-by-user returns shared and isolated records.

### Storage-key derivation

All in `packages/engine/src/stores/scope-keys.ts`; **never reimplement keys**, since every component goes through `encodeScopeKeyComponent` (escaping `:` and `\`, so the `(identity, instance)` pair is recoverable; ordinary ids encode to themselves). The scope record keys on the flow flag (`resolveUserStorageKey`); resources resolve per resource (`resolveResourceIsolation` → `resolveResourceScopeId`).

- **One persisted-read function**, `getPersistedData`, serves `/state`, resource routes, the debug snapshot and sibling transports, so no two derive different keys. `toIsolationFlow` is its single coercion and forwards `ownerPin`. The one outside reader (the scheduled transport's dynamic resolver) uses `resolveUserStorageKey` with `ScheduleResolutionContext.ownerPin`.
- Read projections resolve the record's owning instance once, then enumerate that flow's buckets (`resourceScopeIds`). `flowKind` alone doesn't isolate sessions: two collection instances share a kind and are two owners.
- An instance id is a storage coordinate, not an authorization.

## Child sessions and scope

Dispatched work runs in a **child session**, a different `session` cell, not a new scope level. Lifetime, topology and recovery: [Dispatched Work](./dispatched-work.md).

- The id is derived (`deriveDispatchRunSessionId`): tenant, user, parent session, lineage, `dispatch` namespace and key, length-framed, hashed to `dsx_<sha256[0:32]>`. The caller supplies the target, never the authority.
- A same-instance child inherits `flowId`/`flowKind`, `userId`, `tenantId`, `orgId`, `lineageId` and records `parentSessionId`; a cross-instance child takes the target's `flowId`/`flowKind` and roots its own lineage. `evaluateAdoption` re-checks everything before adopting (the public create route can pre-create a record at the derived id). `createExecutionContext` checks owner, user, tenant and org, **not** `parentSessionId`.

| Scope | In the child |
|---|---|
| request | fresh |
| session | **separate cell**: own state, items, history, journal, metadata, resources, except `sharedToLineage` resources |
| user | shared cell = the parent's (or `${userId}:~org:${pin.orgId}` on a pinned instance; bare again on an unpinned flow). Isolated cell keys on the **running** instance, so a cross-instance child reads the target's, not its parent's |
| org | same rule on `orgId` / `isolateOrgState` |

**Don't rely on an isolated user/org cell being shared across a cross-instance dispatch.** Pass data in the payload, leave it shared, or use `sharedToLineage`.

What connects a child to its parent: user/org scope (keyed to the principal, not the conversation); the dispatch payload (frozen); provenance labels (display only); `parentTask()`/`settleParentTask()` (one row). **There is no live read or write of the parent session's state from a child, and none is planned.**

### Resources shared to the lineage

A session-scoped resource or collection with `sharedToLineage: true` stores against the **lineage**, so a parent and all descendants address one cell through the ordinary resource API. It changes only where the resource stores: no new verb, no cross-session read path.

- **The lineage id is minted, not derived.** A root session mints `SessionRecord.lineageId` at creation; descendants copy it verbatim; the address *is* the id. A recreated session id gets a new record and so a new lineage, so a surviving descendant of the old one keeps its own address. (A derived `(tenant, user, root id)` address was tried and kept growing seams.)
- Records without `lineageId` (pre-field development records only; nothing was ever published with them) fall back to a value derived from the session key **with a prefix so it never equals that key**. The prefix is load-bearing: storage scope is decided by comparing the resolved address against the lineage id, so an unprefixed fallback would route unshared resources into the lineage namespace.
- **Two invariants for every production creator:** stamp a `lineageId` before the record lands, and land via create-if-absent, not `get`-then-`set` (or a concurrent loser overwrites the winner with a different id, stranding its writes). `ensureSessionRecord` (`context/ensure-session-record.ts`) satisfies both for **minting** creators (`createExecutionContext`, the CLI `run`, the webhook session resolver); callers must use the record it returns (the winner's on a lost race). Two creators satisfy them inline: the public create route (it owes a `409`), and `create-request-host.ts` (children must **inherit**, and `SessionRecordSeed` omits `lineageId` so it can't be supplied). **A new child-side creator that reaches for `ensureSessionRecord` mints a fresh lineage and silently splits shared resources from their conversation.**
- The lineage id is also in the child-id derivation; otherwise a recreated session dispatching the same key would adopt the dead lineage's child.
- `createTestContext`/`testFlow` seed sessions without `lineageId` (written `"any"`), so tests exercise the fallback and nothing drives the minting path (removing the mint leaves suites green; FIX-1132).
- **The lineage is its own storage scope** (`StorageScopeType` `lineage`), unaddressable from the session namespace, because session ids are caller-chosen and unvalidated. Adapters treat it as opaque text; no migration.

**Resolution** (`packages/engine/src/resources/lineage-scope.ts`). `sessionRoutingIndex` walks session declarations once (singles by storage key, collections by prefix, each with its flag). `createExecutionContext` builds session buckets from it and refuses collections sharing a prefix but disagreeing on the flag. HTTP routes **must pick the helper matching what they hold, or it's a cross-session read**:

- `sessionKeyScopeId` for a **concrete key** (collection CRUD), because a broad pattern accepts keys a narrower sibling owns, so the addressed declaration's flag isn't the key's owner.
- `readSessionScopeWithLineage` for a **prefix or whole scope** (`getPersistedData`, state route, listing): drops shared keys from the session's own rows before folding in the lineage's.
- `sessionStorageScope` for the scope kind of a resolved address (it and `createExecutionContext`'s `storageScopeOf` must agree; they once didn't).
- `sessionResourceScopeId` answers from a declaration and **has no callers**; every candidate turned out to hold a key.

**Ownership is one rule**, `resolveOwnershipFlag`: an exact single wins outright, then the longest matching collection prefix. Both execution and whole-scope reads call it. It matters because an **empty-prefix** shared collection (any parameterised pattern like `[topic]/x`) matches every key, and a **private prefix nested under a shared one** (`tasks/meta/*` under `tasks/**`) must be owned by the longer prefix. So every prefix scan (eager waves and lazy `getByPrefix`) re-checks each key against per-key routing.

**Filtering a scan changes its coverage**: `loadedCollectionPrefixes` records `(scopeId, prefix)`, not the bare prefix, or `isMissAuthoritative` would call a row in another bucket absent.

**Sharing doesn't serialise.** Two children writing one shared resource is ordinary same-resource contention under `expectedVersion`.
