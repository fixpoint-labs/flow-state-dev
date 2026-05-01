# Validation: Items Taxonomy, ClientData, and the Trace Channel

A second-pass review of three pushbacks raised by the maintainer against the original architecture-coherence findings. Goal: separate the claims that hold up under code inspection from the ones that overstate the friction.

The framework's stated identity is "production-grade with progressive disclosure." Privacy boundaries and trace separation are exactly the kind of advanced affordance that justifies the existence of the framework over Vercel AI SDK + a hand-rolled emitter. So before we soften clientData or collapse trace items, the bar is high: the simplification has to win without giving up a real production-grade property.

---

## Pushback 1 — Is `clientData` over-indexed on privacy?

### What the original review claimed

> "ClientData is over-indexed on privacy use case. Forces every flow to write per-field functions even when nothing is sensitive."

The recommended replacement: a default "expose all state" with an opt-out hidden list.

### What the code actually does

The first thing to verify: is `clientData` actually a privacy boundary today? The doc says yes:

> "Raw state never reaches the client. This is deliberate: you can't accidentally leak internal state because `clientData` is the sole data gateway."
> — `docs/architecture/overview.md:135`

But the snapshot route handler tells a different story. From `packages/server/src/routes/state-routes.ts:227-249`:

```ts
return jsonResponse(200, {
  sessionId: session.id,
  flowKind: session.flowKind,
  state: {
    request: latestRequest?.state,
    session: session.state,
    user: user?.state,
    org: org?.state
  },
  clientData: { session: …, user: …, org: … },
  resources: …,
  …
});
```

The response includes BOTH a `state` object containing the raw scope state AND a `clientData` object with the projections. The client-typed contract (`SessionStateSnapshotResponse` at `packages/client/src/types/index.ts:209`) declares both fields. The state field is `Record<string, unknown>` — no filtering, no allowlist.

**Verdict on the existing claim**: the privacy story `overview.md:135` advertises is not implemented. `clientData` today is a *derived-views convenience* that ships *alongside* raw state, not in place of it. So the original review's premise — that flows write per-field functions for privacy reasons — is itself working from the doc, not the code. The friction is real (kitchen-sink writes a 22-line `modeStatus` function in `apps/kitchen-sink/flows/chat-agent/flow.ts:447-470`); the privacy framing is aspirational.

### Walking the maintainer's three scenarios

The maintainer's question reframes well: **what should the default be — expose-all, expose-nothing, or explicit-projection?**

**Scenario 1 — chat app (hello-chat).** The state schema is `{ messageCount: number }`. There's nothing sensitive. The current `examples/hello-chat/src/flows/hello-chat/flow.ts` doesn't declare `clientData` at all — and it works because the route still returns `state.session` raw. If the framework actually enforced the documented privacy story, this app would silently fail (the count never reaches the client). With expose-all default + opt-out, no work needed; with expose-nothing default + opt-in, the developer adds `client: { expose: ['messageCount'] }`. Per-field functions: 22 lines for one field.

**Scenario 2 — agent with tools (chat-agent).** The session state has `mode`, `thinkingStyle`, `resolvedModel`, `requestCount`, `features`, plus `activeSkills` contributed by the skills capability. The `activeSkills` field is structured `Array<{ name, source, body, … }>`, but the UI only wants `{ name, source }`. This is the case where projection earns its place: the developer wants to expose part of an array of objects, not the whole thing. Expose-all default would leak skill `body` (which can be substantial — instruction text, internal heuristics) without the developer noticing. Expose-nothing default forces the explicit op-in. Per-field functions express the projection naturally.

**Scenario 3 — multi-step business process.** Imagine a sequencer that captures intermediate computation in session state: `{ pendingApproval: { ssn, dob, … }, currentStep: …, drafts: [...] }`. With expose-all, the SSN reaches every connected client. With expose-nothing or explicit-projection, the developer must opt in field by field. This is the case the maintainer correctly identifies — "I can see a lot of custom IP or application data being exposed that is not meant to be."

The first scenario favors expose-all. Scenarios 2 and 3 favor expose-nothing. The pattern: **the friction grows linearly with state size, but the cost of getting privacy wrong is unbounded.**

### The right default

A defensive framework picks the safer default and adds ergonomics for the simple case. Concretely:

- **Default**: state is private. Nothing reaches the client unless declared.
- **Sugar for the common case**: `client: { expose: ['mode', 'count'] }` whitelists fields verbatim.
- **Function form for projections**: `client: { derived: { activeSkills: (ctx) => ctx.state.activeSkills.map(s => ({ name: s.name })) } }` for cases where shape matters.
- **Hidden-list opt-out is wrong** as a primitive: a developer adding a new field forgets to add it to `hidden` and leaks it. New fields default to private; the framework rewards the hands-off path.

This is different from the original review's recommendation (expose-all + hidden list). The original review picked the wrong default in the name of convenience. The maintainer's instinct is correct.

The `client: { expose, derived }` shape gives:
- Zero friction for "simple projection of a primitive": `expose: ['count', 'mode']`.
- A function for the genuinely-derived case (Scenario 2's `activeSkills`).
- A static analysis surface — a linter can warn when a state field is in neither `expose` nor referenced by `derived`, prompting the developer to make a deliberate choice.

### The maintainer's alternative — drop `clientData`, use private resources + sequencer state

The maintainer asks: could the framework drop clientData entirely if developers had reliable ways to keep things server-side?

The relevant facts from the codebase:

1. **Sequencer state already isn't sent to the client.** It lives in the request record, scoped to a `blockInstanceId`, and isn't part of the snapshot response. `transientSlot()` (`packages/core/src/utils/transient-slot.ts`) further suppresses it from `state_snapshot` items. So sequencer state IS already a private workspace.
2. **The supervisor pattern uses sequencer state for everything.** `packages/patterns/src/supervisor/index.ts:362` stores `goal`, `status`, `workerOutput`, `reviewerFeedback` in sequencer state — not session state. None of it leaks to clients.
3. **Resources don't have `private: true` today.** They have `client.content.read` for content access and `client.data` for a snapshot projection. Omitting `client` makes them invisible (`resources-and-client-data.md:394`). So resources already have an opt-in client surface.

With those three facts, the maintainer's alternative is essentially: **make session state work the same way as resources.** State without an explicit `client` declaration is private by default, exactly like a resource without a `client` config.

Cost/benefit:

- **Benefit**: one mental model. State, resources, and sequencer state all default to private. The `clientData` concept disappears as a separate name; it becomes the `client.derived` field on a scope, mirroring `client.data` on a resource.
- **Cost**: every existing flow that doesn't declare `clientData` would silently lose its raw-state surface. Migration is real but mechanical: for each scope, add `client: { expose: Object.keys(stateSchema.shape) }` to preserve current behavior.
- **Cost**: the framework has to commit to actually enforcing the privacy boundary. The current state-route handler must stop returning raw state. That's the real change — without it, the new API is the same theatre.

**Verdict on Pushback 1: PARTIALLY RIGHT.**

The original review was right that the per-field-functions ergonomics are painful for trivial cases. It was wrong that the answer is expose-all. The maintainer is right that the right default is expose-nothing — but the framework currently does not enforce that, so the doc is lying. The right move is:

1. Make the doc true. Fix `state-routes.ts` to stop returning raw state.
2. Replace `clientData: { name: fn }` with `client: { expose: string[], derived: { name: fn } }`.
3. Drop the `clientData` term entirely; align resource-level `client.data` and scope-level `client.derived` under one mental model.

The original review's recommendation lands at the wrong default. Reject the "expose-all + hidden" form and adopt the maintainer's "private-by-default, expose-or-derive" form.

---

## Pushback 2 — Should observability items live alongside event-sourced items?

### What the maintainer asks

> "Having observability/trace level items mixed in to the normal items/event sourcing system, a good idea or not?"

This is the deeper architectural question. The original team-synthesis recommendation in Tier 3 was: cut item types from 15 to ~6, move `block_output`/`router_decision`/`state_snapshot`/`block_debug` to a parallel devtool channel, and the `BlockValue` ref/inline/structure machinery goes with them.

### What's load-bearing for production vs. devtool-only

**`block_output`**. Emitted by every block, post-execution. Carries `BlockValue<T>` discriminated output, status, timing, model usage, tool-call linkage. From `resolve-visibility.ts:35`: `block_output: { client: false, history: false }`. Filtered out by `client-filter.ts:25`. Two production callers I expected to find:

- `ctx.getBlockOutput()` in `packages/server/src/context/createExecutionContext.ts:2863`. Reads from a runtime-only `siblingRegistry`, NOT from items log. So getBlockOutput does not depend on `block_output` items.
- The response-auditor pattern's `AuditAnnotation` component in `packages/react/src/components/AuditAnnotation.ts:27`. Reads `block_output` items at runtime to resolve `BlockValue` refs. But: kitchen-sink doesn't actually use this version — `apps/kitchen-sink/components/flow-state/audit-annotation.tsx:90` consumes a `ComponentItem` instead. The react-package version appears to be an alternate API that nobody ships.

So for the live runtime, `block_output` is observability-only. The reason it's persisted is twofold: (a) the devtool reconstructs an execution trace from it post-hoc, and (b) `BlockValue` refs in pass-through composers point into the items log so historical data (e.g., a prior turn's tool output) can be resolved without duplicating storage.

**`router_decision`**. Emitted on route selection. Visibility `{ client: false, history: false }`. No production reader anywhere I could find. Devtool's `trace-tree.ts` consumes it.

**`state_snapshot`**. Sequencer state at step boundaries. Visibility `{ client: false, history: false }`. From `types.ts:284-319`: when `durable: true`, side-channeled to `stores.checkpoints` for the future durable-execution runtime (FIX-141). Items themselves stay out of the request items log. So state_snapshot is *already* not in the items log; it just shares the `OutputItem` union type because it goes through the same emitter pipeline.

**`block_debug`**. Resolved generator config (model, prompt, tools, history). Always transient and trace-only. Devtool-only.

### The `BlockValue` ref/inline/structure machinery

The FIX-413 union exists so that pass-through composers (`.then`, `.work`, `.tap`, routers, `.rescue`) don't duplicate content at every nesting level. A `s1 → s2 → s3 → generator` pipeline persists the LLM output exactly once, on the generator's item — intermediate sequencers carry a ~40-byte ref. Without refs, every wrapper layer re-stores the output.

Is this justified by real persistence needs? Yes, but only because `block_output` items are persisted *at all*. If `block_output` lived on a parallel trace channel that's only attached when the devtool connects, the union would still need to handle the inline-vs-aggregated case (a `.thenAll` produces a structured output that's not the same as any one child's), but the ref case (pointing one block's output at another's content-bearing item) becomes unnecessary because devtool consumers see all the items live.

So `BlockValue` is justified by a wire protocol that wants to compress historical persisted state. Cut the persistence and the union shrinks — `inline | structure` covers the live trace case. The ref kind is entirely a storage optimization for an item type that may not need to be stored.

### Two-channel architecture sketch

**Production items** (the canonical request output, stored in the request record):
- `message`, `reasoning`, `block_tool_output`, `component`, `container`, `source`, `status`, `error`, `step_error`, `state_change` (when `persistStateChanges: true`), `resource_change`.

That's 11 types — but really 5–6 conceptual buckets: messages (with reasoning), structured UI (component/container/source), progress (status), failures (error/step_error), invalidation (state/resource_change).

**Trace channel** (only attached when devtool connects, never persisted to the request items log):
- `block_output` (with full `BlockValue` resolution since the consumer is live), `router_decision`, `state_snapshot`, `block_debug`.

**Producing API**:
- `ctx.emit.message(...)`, `ctx.emit.component(...)` — production items.
- `ctx.emit.trace.blockOutput(...)`, `ctx.emit.trace.routerDecision(...)` — trace items.
- The framework's auto-emission code routes to one or the other based on the type.

**Wire protocol**:
- Today: one SSE stream, filtered per-connection by `createClientEventFilter` for clients vs. `?unfiltered=true` for devtool.
- Two-channel: same single SSE stream stays for production items. Trace events go on a secondary stream — the devtool opens both. The trace stream is opt-in and never exists for production clients.

**Storage**:
- `request.items` stores only production items. The events log keeps everything for devtool replay (already separate from items per `streaming.md:148-172`).
- `BlockValue.ref` becomes optional. The persisted form of `block_output` (in the events log only) can still use refs for compactness, but the union no longer needs to be part of the public `OutputItem` type.

### What this would actually save

Concretely, if the four trace types are pulled out:

1. The `OutputItem` union shrinks from 15 to 11. That removes ~4 dedicated rendering paths in `ItemRenderer.ts`, the `TRACE_ITEM_TYPES` set in `state-routes.ts:89`, and the special-case handling in `client-filter.ts`.
2. The `BlockValue<T>` discriminated union (with three cases, the `StructureShape`, the `resolveBlockValue` recursion, and the `ItemLookup` type) leaves the public surface. `packages/core/src/items/resolve-value.ts` (142 lines) becomes internal to a trace-channel package.
3. `state_snapshot` is already side-channeled to `stores.checkpoints` and not persisted in items — it just borrows the item type. With the trace channel, it stops being an item at all and is purely a checkpoint store concern.
4. `resolveItemVisibility`'s `STRUCTURAL_TYPE_DEFAULTS` table goes from 12 entries to 8.

**Risk**: the `BlockValue` ref machinery is also used to deduplicate output storage in pass-through composers. If `block_output` is no longer persisted with the production items, but persisted to the events log, the events-log adapter has to handle ref resolution. This isn't free. It moves the same problem from `OutputItem` into the events-log layer.

**Risk**: `state_change` and `block_output` both carry `provenance.blockInstanceId` for trace-tree reconstruction. If they're on different channels, the devtool has to merge them at consumption time. Today it gets a single ordered stream. The merge is straightforward (sequence numbers are already monotonic across the events log) but it's new code.

### Verdict on Pushback 2

**ORIGINAL CLAIM IS RIGHT, with a caveat**. Cleanly separating trace items from production items is a real simplification:

- It removes the production runtime's awareness of `block_debug`, `router_decision`, and `state_snapshot` types entirely — they become trace-channel concerns.
- It removes the `BlockValue` ref kind from the public `OutputItem` shape (the structure kind stays for `.thenAll`/`.parallel`/`.forEach` aggregation, even in production, because aggregator results genuinely have nested shape).
- It gives a clearer answer to "what items does my client see" — a single visibility table that doesn't have to special-case devtool-only types.

The caveat: this is not pure deletion. It's a refactor that moves complexity from `core/items` to `server/streaming` (the trace-channel publisher) and `devtool` (the trace-channel consumer). Fewer concepts in `core`, more in the devtool boundary. Net: smaller user-facing surface, bigger devtool implementation, modestly smaller framework total.

The "advanced affordance" framing applies here. Production-grade means the production runtime doesn't carry weight for things only the devtool needs. Today, the runtime carries the full `BlockValue` ref resolution path on every block emission. That's the cost of mixing.

---

## Pushback 3 — Can `state_change` and `resource_change` consolidate?

### What's actually different

From `packages/core/src/items/types.ts:241-258`:

```ts
type StateChangeItem = OutputItemBase & {
  type: "state_change";
  scope: "request" | "session" | "user" | "org" | "block_instance";
  blockInstanceId?: string;
  operation: "patch" | "set" | "increment" | "push" | "delete_key" | "atomic";
  path?: string;
  delta?: unknown;
  version: number;
};

type ResourceChangeItem = OutputItemBase & {
  type: "resource_change";
  scope: "request" | "session" | "user" | "org";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
  delta?: unknown;
  version?: number;
};
```

Differences:

1. **Scope set**. `state_change` includes `block_instance`; `resource_change` doesn't (resources don't live at block-instance scope).
2. **Identity**. `state_change` has `path` (key path within state); `resource_change` has `resourcePath` (the full storage key like `artifacts/foo`).
3. **Operation vocabulary**. State has `patch | set | increment | push | delete_key | atomic`. Resource has `created | updated | deleted`. Different concepts: state ops describe how the mutation happened (atomic CAS, push, etc.); resource changes describe lifecycle.
4. **Version**. State always has a version (CAS); resource version is optional (depends on whether the storage layer supports versioning per-resource).

### Consumer asymmetry

`useSession.ts:735` reacts to `resource_change` to flag a refetch on completion:

```ts
if (event.item.type === "resource_change") {
  resourceChangedDuringStreamRef.current = true;
}
```

There's no corresponding `state_change` handling. `useSession.ts` does not refetch on state changes — they're passed through to consumers as items, but the snapshot is never reloaded mid-request based on them. That's because state changes are typically observable through `clientData` recomputation on the next snapshot, while resources have separate content endpoints that may need fresh fetches.

So the two items have *different consumer semantics*: resource_change is an "external resource changed, refetch" signal; state_change is a "state was mutated, the next snapshot will reflect it" signal.

### Consolidation cost

A unified `change` item could look like:

```ts
type ChangeItem = OutputItemBase & {
  type: "change";
  target: "state" | "resource";
  scope: "request" | "session" | "user" | "org" | "block_instance";
  path: string;                      // "mode" for state, "artifacts/foo" for resource
  operation: "patch" | "set" | "increment" | "push" | "delete_key" | "atomic"
           | "created" | "updated" | "deleted";
  delta?: unknown;
  version?: number;
  blockInstanceId?: string;
};
```

The cost: every consumer that branches on `item.type === "state_change" | "resource_change"` now branches on `item.target === "state" | "resource"`. The operation union widens to 9 values, and "patch on a resource" is meaningless — invalid combinations have to be checked at construction time, not by the type system. The scope/blockInstanceId pair is meaningful for state but vestigial for resources.

### Verdict on Pushback 3

**ORIGINAL CLAIM IS PARTIALLY RIGHT.**

The semantics are close enough that consolidation is *possible*, but each item has a discriminator's worth of fields that are meaningful only to one side. Combining them produces a wider operation union and a shape with optional fields that have to be maintained "use only for state" or "use only for resource."

A better lens: these aren't candidates for collapse. They're candidates for **a shared base concept**:

```ts
type InvalidationItem = OutputItemBase & {
  scope: "request" | "session" | "user" | "org" | "block_instance";
  delta?: unknown;
  version?: number;
};

type StateChangeItem = InvalidationItem & {
  type: "state_change";
  blockInstanceId?: string;
  operation: "patch" | "set" | "increment" | "push" | "delete_key" | "atomic";
  path?: string;
};

type ResourceChangeItem = InvalidationItem & {
  type: "resource_change";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
};
```

This factors out the common fields without conflating the operations. Type-narrowing on `item.type` still works. Consumers that only care about "something changed in scope X" can consume `InvalidationItem`; consumers that need state-vs-resource semantics still get the typed shape.

The framework gets ~30% less duplication for ~0% loss of expressiveness. That's a smaller win than full consolidation but a real one.

**Recommendation**: keep two types, factor out the common base. Don't fold them together — the operation vocabularies are genuinely different and conflating them widens the API surface without simplifying consumers.

---

## Closing recommendations

Reconciling the three pushbacks:

### On clientData

- **Reject the original review's "expose-all + hidden" recommendation.** It picks the wrong default for production-grade software. New fields would silently leak.
- **Adopt the maintainer's "private by default, expose or derive" model.** Replace `clientData: { name: fn }` with `client: { expose: string[], derived: { name: fn } }`. Match resource-level `client.data` so there's one mental model.
- **Fix the actual privacy hole first.** Today, `state-routes.ts:230-235` returns raw state alongside clientData. The doc says the opposite. Make the implementation match the doc before changing the API.
- **Keep sequencer state and resources without `client` config as the privacy escape hatches.** They already work correctly — the supervisor pattern is the canonical example.

### On the items taxonomy

- **Move `block_output`, `router_decision`, `state_snapshot`, `block_debug` to a trace channel.** These four are devtool-consumed in practice; production code paths use `siblingRegistry` (in-process), `component` items, or the resource snapshot.
- **Strip the `BlockValue` ref kind from the public `OutputItem` type.** Keep `inline` and `structure` for live composition (aggregators emit a structure that is not equivalent to any single child output). Refs become an events-log encoding concern, internal to the trace channel.
- **Producing API**: split `ctx.emit.*` into `ctx.emit.<production item>` and `ctx.emit.trace.<trace item>`. The framework's auto-emitters route automatically; explicit user emits are explicit.
- **Wire protocol**: keep one production SSE stream, add a parallel trace stream that opens only when the devtool attaches. Today's `?unfiltered=true` query is the seed for this — make it a real second connection so production traffic never carries trace events.

### On state_change / resource_change

- **Don't fully consolidate.** The operation vocabularies and identity fields are different enough that a single type degrades into a wide union with conditional fields.
- **Factor out an `InvalidationItem` base.** Common fields (`scope`, `delta`, `version`) move up; type-specific fields stay specific. Saves real duplication without conflating semantics.
- **Resolve the consumer asymmetry.** `useSession` reacts to `resource_change` for refetch but ignores `state_change`. Document this as intended (state changes invalidate clientData on next snapshot; resource changes invalidate the content endpoints). If both should trigger refetch, make that consistent — currently it's accidental.

### Net effect on framework size and identity

If all three land:

- The `OutputItem` union goes from 15 to 11 production types + 4 trace types on a separate channel.
- `BlockValue<T>` leaves the public surface; resolves to a 2-case union (inline / structure) for live consumers.
- `clientData` as a name retires; merges into a unified `client: { expose, derived }` shape that mirrors the existing resource-level `client.data` field.
- Privacy becomes a real implemented contract instead of a documentation aspiration.

The framework's "production-grade with progressive disclosure" identity is *better served* by these changes, not weaker. Privacy by default is a production-grade default. Trace channel separation is exactly the kind of "you only pay for what you use" affordance that distinguishes this framework from a thin SDK wrapper. The maintainer's instincts on privacy are correct; the original review's instincts on trace separation are correct; the original review's instinct on collapsing change items needs a softer touch.
