# Architecture Coherence Review

A first-principles look at whether `@flow-state-dev`'s conceptual model is coherent, minimal, and necessary. The framework is real and ships; this review is meant to feed simplification, not to defend the status quo.

The short version: most of the primitives have a defensible reason to exist, but the surface area between them has grown faster than the conceptual model has consolidated. There are two kinds of state, three kinds of data containers, four block kinds, four scopes, twenty-one sequencer methods, three error-handling mechanisms, and a "capability" layer that exists to spare you from passing arrays around. Several of these are load-bearing; several are not.

---

## 1. The four block kinds

> "Every piece of logic in the framework is one of exactly four block kinds."
> — `docs/architecture/overview.md:80`

The pitch is that `handler`, `generator`, `sequencer`, `router` form a clean primitive set. They don't, on inspection — they are three fundamentally different things wearing the same `BlockDefinition` interface.

- **handler**: code that runs.
- **generator**: an LLM call with a managed tool loop.
- **sequencer**: a composition operator (a tree node).
- **router**: a one-of dispatcher (also a composition operator).

`blocks.md:9` declares the shared contract:

```
interface BlockDefinition<TInput, TOutput> {
  kind: BlockKind;
  name: string;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  declaredResources?: DeclaredResources;
  run(input, ctx): Promise<TOutput>;
  ...
}
```

That uniformity is real and useful — the runtime can dispatch all four through `block.run(input, ctx)`. But the *kinds* don't carve at the joints.

**Where the boundaries blur:**

- **Handler vs. generator**: a handler that calls an LLM directly (e.g., bypassing the framework's tool loop because it needs custom retry shaping or a non-Vercel-AI-SDK provider) is functionally a generator without the auto-emissions. The distinction is "does the framework manage the tool loop and auto-emit message/reasoning items." Useful as an implementation flag, not a fundamental category.
- **Sequencer vs. router**: a router with two routes and a conditional `execute` is exactly `branch` on a sequencer. `sequencer-dsl.md:412` already documents `.branch(branches)` for "first branch whose condition is true." The router primitive duplicates that. The only real difference is that a router declares its candidate `routes` upfront for "type checking and devtools" (`blocks.md:374`), and emits a `router_decision` item. Both are branching dispatchers.
- **Sequencer vs. handler returning a sequence of awaits**: a handler can do `await a(); await b()` internally. The sequencer adds visibility (each step emits items, retry/rescue/work apply per step) and durable state checkpoints. That's a real difference, but the line "should this be a handler or a sequencer" is genuinely ambiguous in practice.

**BP-011 admits the rough edge.** From `CLAUDE.md`:

> "Never instantiate or call a block inside a handler's `execute`. Compose as a sequencer: `.then(generator).then(handler)`."

A best-practice rule against doing the natural thing inside a handler is a sign that handler/sequencer are not as cleanly separated as the model claims. If the system told you what to do, you wouldn't need a rule.

**Could it be fewer?**

A coherent two-primitive model:

- **Block** (`run(input, ctx) -> output`). One thing. Generators and handlers collapse into this — generators are blocks the runtime can detect (they declare `model`, `prompt`, `tools`, `agentType`) and instrument with the auto-tool-loop and auto-emissions. The "kind" tag becomes an implementation detail, not a public concept.
- **Compose** (a fluent DSL of operators over blocks: `then`, `branch`, `parallel`, `forEach`, `rescue`, `work`). Sequencers and routers collapse into this — a router is just a compose tree with a single `branch` node and a labeled candidate set.

**Verdict.** The four kinds are not first-principles. They are a useful implementation taxonomy that has been promoted to a public concept. I'd cut to two: `block` and `compose`. Generator behavior becomes "this block declares `model`, the runtime takes over the tool loop." Router becomes a `branch` operator with declared candidates for devtool affordance.

---

## 2. The state hierarchy

> "request → session → user → project (one run) (conversation) (across sessions) (shared across users)"
> — `docs/architecture/overview.md:113`

The doc currently spells the fourth scope inconsistently: `state-and-scopes.md:9` calls it `org`; the overview and `flows-and-actions.md` call it `project`. That alone is a code smell — the framework can't agree on the noun for a load-bearing concept.

**Are all four levels necessary?**

- **request** is genuinely needed if you want per-call state (cancellation tokens, in-flight metrics). But a substantial fraction of "request state" use cases are local variables in a sequencer's instance state. `state-and-scopes.md:64` introduces `transientSlot()` for sequencer state that "do not appear in `state_snapshot` payloads, so they never enter the durable checkpoint store" — a workaround for the request scope being heavier than callers want.
- **session** is the conversation. Genuinely needed.
- **user** is cross-session per identity. Genuinely needed for preferences, profile, quotas.
- **org/project** is shared across users. Real use case (team workspaces, multi-tenant), but can almost always be modeled as user-scope with a different identity. Wave 1 added a whole cross-flow registry plus opt-in isolation (`state-and-scopes.md:266-302`) which exists primarily to handle the fact that `user` and `org` records are *shared across flows* by default — a footgun the framework now mitigates with structural Zod compatibility checks.

The cross-flow registry is the smell. It's machinery that exists to clean up after a design choice (shared user/org records by default). If user state were flow-isolated by default with explicit opt-in to share, this entire subsystem would not need to exist.

**Is the CAS layer over-engineered?**

`state-and-scopes.md:50` says `incState`, `pushState`, `setStateRecord`, `deleteStateRecord` are atomic CAS-guarded ops, with bounded retries and `ConcurrentModificationError` on exhaustion. For Phase 1 use cases (chat apps, agentic workflows), the realistic concurrency on a single session is one. Most contention happens between request scope and lifecycle hooks running in parallel — and the cleaner fix there is a single-writer model per session, not generalized CAS.

`state-and-scopes.md:86`:

> "CAS containers use deep cloning to preserve immutable write semantics and avoid accidental shared mutation."

Deep cloning every state op for safety, then warning at 10KB, is paying a price for a property most apps don't need.

**Suggestion.** Collapse to two scopes for Phase 1: `session` (conversation, persisted) and `identity` (the union of user + org, with an explicit shape per flow). Drop `request` as a public concept — replace with sequencer instance state (already exists) and let the runtime handle ephemeral lifecycle bookkeeping internally. CAS stays for `identity` (real concurrent writers across sessions), drops to last-write-wins for session (one writer per request).

**Verdict.** The four-level hierarchy is invented complexity. Two scopes cover the realistic cases, with sequencer instance state filling the gap for "values that live across steps in one execution." `org` should be a label on `user`, not a separate scope.

---

## 3. Items vs. content vs. messages

> "Items are the canonical persisted artifacts. Their type determines audience routing."
> — `docs/architecture/streaming.md:32`

Items + content is a coherent split, *but only because of streaming text*. An item is a persisted artifact ("the model said X"); content is the streaming-delta layer inside the item ("the model is currently saying X letter-by-letter"). If you stripped streaming, `content` would not exist as a separate concept — it would just be `item.text`.

That's defensible. The persisted-vs-streaming distinction is real engineering. The concern is the explosion of item types and the audience-routing logic on top.

**Item types in the registry** (`items.md:130`): `message`, `reasoning`, `block_tool_output`, `component`, `container`, `source`, `status`, `state_change`, `resource_change`, `error`, `step_error`, `block_output`, `router_decision`, `state_snapshot`, `block_debug`. Fifteen types.

**Audience routing.** Every item has visibility derived from `(type, agentType)` per `items.md:11`. The conceptual cost is that every block author has to think about three audiences (client, LLM history, devtool) every time they emit. The doc acknowledges this is essential — `items.md:264`:

> "LLM conversation history — history is assembled on-demand by filtering the item log for LLM audience types."

So the audience filter exists to avoid storing history separately. That's a genuine simplification (one log, multiple views) but it has costs:

- The visibility table (`items.md:38`) is the framework's single source of truth and you have to look it up to predict behavior.
- `agentType` propagation is subtle (`generator-identity.md` exists as a whole doc explaining when a generator's identity stamps onto items).
- Structural items "ignore agentType for visibility" except `trace` which "always forces both off." That's the kind of rule a compiler enforces, not a mental model.

**Could it be one uniform stream?**

In principle: yes, *if you accept that "visibility" becomes a per-emit decision rather than a function of type*. The current model trades flexibility for predictability. That's a fair trade — you pay one-time cognitive cost (learn the table) for "every item of type X behaves the same way."

The split that genuinely earns its complexity:
- `message`/`reasoning` (LLM-history-bearing).
- `component`/`container` (UI-only structured data).
- `status` (transient progress slot).
- `state_change`/`resource_change` (invalidation signals).
- `error`/`step_error` (failure markers).
- `block_output`/`router_decision`/`state_snapshot`/`block_debug` (devtool-only traces).

That's roughly five conceptual buckets, currently exposed as fifteen concrete types. Several of those concretions earn their existence (status as a single slot is genuinely different from message; container ownership is real). Several look like overgrowth — `block_debug` and `state_snapshot` could probably both be `block_output` variants distinguished by a metadata field.

**Verdict.** The item/content split is coherent and load-bearing. The 15-type registry is overgrown but each addition has a rationale. The audience-routing concept is necessary given the "one log, many views" decision; that decision itself is correct. Cut: collapse `block_debug` and `state_snapshot` into `block_output` with a `phase` discriminator; consider removing `router_decision` (a router could just emit a `block_output` with the route encoded). The `BlockValue` discriminated union (inline/ref/structure, `items.md:71`) is a sensible optimization but adds a meaningful layer of indirection for consumers.

---

## 4. Resources vs. client data vs. state

Three concepts that all hold data:

- **state**: scope-level fields you `patchState` on.
- **resources**: structured stores attached to a scope, accessed via `ctx.resources.<name>`.
- **clientData**: derived views, computed on read.

The pitch in `resources-and-client-data.md:1`:

> "Resources are concrete persisted data attached to a scope. Client data entries are derived views computed from state and resources."

**Where they're truly distinct:**

- `state` is a flat namespace per scope. Multiple unrelated blocks contribute keys; conflicts resolve by schema bubbling.
- `resources` carry identity. They have their own lifecycle, can be mutated independently, and have separate content storage. A `plan` resource and a `documents` resource don't compete for keys.
- `clientData` is a computation layer — pure functions of state + resources, exposed to clients deliberately.

That separation is real. You wouldn't want to encode resources as `state.plan` because then resource collections couldn't have content storage, separate CAS versioning, or the per-resource `client` config (`resources-and-client-data.md:362`).

**Where it's leaky:**

- A small piece of structured per-session data (e.g., "current mode") could be either `state.mode` or a `mode` resource. The doc gives no clear rule. In practice, "use state for primitives, resources for structured stores" is the convention but it's not stated.
- `clientData` as a separate concept is a privacy mechanism: "Raw state never reaches the client" (`overview.md:135`). That's only useful if you actually have state you don't want to leak. If everything in your state is client-visible anyway, `clientData` becomes busywork — you write `messageCount: (ctx) => ctx.state.messageCount` for every field.

**Is `clientData` solving a real privacy concern?**

Sometimes. Real cases: tokens, internal counters, intermediate computation. But the framework forces every flow to write a `clientData` map even when nothing is sensitive, and that's friction with low payoff. A simple `client: { fields: ['mode', 'messageCount'] }` whitelist would cover 80% of cases without requiring a function per field.

**Suggestion.**

- Keep `state` and `resources` as separate concepts — they earn it through different storage models and lifecycle.
- Replace `clientData` per-field-functions with a default "expose all state" with an opt-out (`hidden: ['internalToken']`) plus an optional `derived` field for genuine computed values. This matches what most developers want and removes the boilerplate.

**Verdict.** State vs. resources is justified. ClientData as currently designed is over-indexed on the privacy use case at the cost of ergonomics for the common case.

---

## 5. Resources vs. Resource Collections

Two separate docs (`resources-and-client-data.md` and `resource-collections.md`) for what amounts to the same data primitive with a different declaration shape.

- **Static resource**: declared by name. `defineResource({ stateSchema, scope: "session" })`.
- **Resource collection**: declared by pattern. `defineResourceCollection({ pattern: "files/**", stateSchema, maxInstances, eviction: "lru" })`.

Look at `resource-collections.md:65`:

> "At runtime, collection entries on scope resource registries... are `ResourceCollectionRef` instances."

A `ResourceCollectionRef` is essentially a `Map<key, ResourceRef>` with `create`, `get`, `getOrCreate`, `list`, `delete`. The "collection" abstraction adds: pattern matching, instance count caps, eviction policy.

**Could it be one concept?**

Yes — a single `defineResource({ ...stateSchema, instances?: { pattern, max, eviction } })` would cover both. Static resources are the degenerate case where `instances` is absent. The framework already treats them the same at the storage layer (`resource-collections.md:157`):

> "Collection instances are stored in the same flat `resources` map as static resources."

The separation forces consumers to learn two factory functions and two access patterns (`.state` vs. `.create()`/`.get()`). The implementations diverge enough that some unification cost exists, but the user-facing surface should be one thing.

**Verdict.** This is a clean candidate for collapse. One factory, one access pattern with a sensible degenerate case, one doc page.

---

## 6. Capabilities

`CLAUDE.md` heavily promotes capabilities. From the file:

> "Prefer capabilities over manual plumbing. Use `defineCapability` + `uses: [cap]` instead of manually spreading `tools`, `context`, `sessionResources` into blocks."

What does `defineCapability` actually do? From `packages/core/src/capability/types.ts:113`:

```
interface CapabilityConfig {
  name: TName;
  resources?: Record<string, DeclaredResourceEntry>;
  sessionStateSchema?: ...;
  requestStateSchema?: ...;
  userStateSchema?: ...;
  orgStateSchema?: ...;
  sequencerStateSchema?: ...;
  targetStateSchemas?: ...;
  uses?: ...;
  agentType?: ...;
  fns?: (ctx) => TFns;
  presets?: ...;
}
```

It's a bag of all the things a block can declare (resources, state schemas, targets, capability composition, helper functions, presets). When a block lists the capability in `uses`, the framework merges all those declarations into the block's effective config.

**Is this a real abstraction or a wrapper?**

Both. There are three real benefits:

1. **Diamond dependency dedup**. If two blocks both `use` a capability, the framework merges the duplicate registrations cleanly. `merge.ts` exists specifically for this. Without capabilities, the user would have to manually deduplicate.
2. **Helper fns scoped to a name**. `ctx.cap.<name>.<fn>` gives you a typed namespace for capability-specific helpers without polluting `ctx`.
3. **Presets**. `cap.presets({ tools: false })` lets a consumer opt out of parts of a capability without rewriting it.

But:

- For simple cases ("install this set of tools"), it adds a layer of indirection over passing an array.
- The schema is busy: 11 fields on `CapabilityConfig`. Half of them are state-schema fragments duplicating what blocks already accept directly.
- `agentType` filtering on capabilities (`types.ts:147`) — "attach the capability only when the block's agentType matches" — is a specific solution to a specific problem (large skill bodies in supervisor patterns) that lives at the capability layer because the block layer doesn't expose enough machinery.

**Verdict.** Capabilities are a real abstraction in patterns where diamond dependencies and helper functions matter (memory subsystems, identity capabilities). For most app code they're a heavier alternative to passing arrays. The framework should make it clear that capabilities are an advanced tool, not the recommended default — `CLAUDE.md`'s "prefer capabilities" framing is too strong. Recommend: keep the primitive, demote it from "primary recommendation" to "use when you have diamond dependencies or named helper fns."

---

## 7. Utility blocks vs. patterns vs. blocks

Three docs cover composition:
- `blocks.md` — the four kinds.
- `sequencer-dsl.md` — the DSL methods.
- `utility-blocks.md` — pre-built factories.

Plus `@flow-state-dev/patterns` (per `CLAUDE.md`'s package map: "Higher-level composition patterns").

**Where they overlap:**

- A utility block (`utility.summarizer({ name })`) is a block factory that returns a generator with a configured prompt. Conceptually identical to writing the generator yourself.
- A pattern (e.g., `planAndExecute`, `supervisor`, `blackboard`) is a function that returns a sequencer. Conceptually identical to writing the sequencer yourself.

The honest taxonomy:

- **Block factories** wrap one block kind (utility blocks fit here — `summarizer` returns a generator, `combiner` returns a handler).
- **Composition factories** wrap a sequencer (patterns fit here — `supervisor` returns a sequencer composing multiple blocks).
- **Blocks** are the primitive.

The framework has all three and calls them three different things. The user has to learn:

- Use `utility.X` for utilities (what's a utility?).
- Use `patterns.Y` for patterns (what's a pattern?).
- Use `handler` / `generator` / `sequencer` / `router` for raw composition.

**Suggestion.** Drop "utility blocks" as a concept. Re-export the ten utilities at the top level (`import { summarizer, combiner, ... } from "@flow-state-dev/core"`). Keep patterns as a separate package since they live outside core. Document them all together as "pre-built blocks" with no taxonomy distinction.

**Verdict.** "Utility blocks" is shelf space, not a concept. Patterns are real (compositions in a separate package), but there's no semantic difference between using `utility.summarizer` and using a pattern factory. Collapse to one concept: factory functions that return blocks.

---

## 8. Sequencer DSL: minimal or kitchen sink?

`sequencer-dsl.md` lists 21 methods. From `architecture-reference.md:29`:

> `then`, `thenIf`, `map`, `parallel`, `forEach`, `forEachBackground`, `doUntil`, `doWhile`, `loopBack`, `work`, `workIf`, `background`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`, `thenAll`, `thenAny`, `race`, `exitIf`

Let me cluster them:

**Sequential (essential)**
- `then(block)` — run a block.
- `map(fn)` — pure transform.

**Conditional (overgrown)**
- `thenIf` — run-or-skip.
- `branch` — multi-arm.
- `exitIf` — early exit.
- `tapIf` — conditional side effect.
- `workIf` — conditional background work.

**Parallel (overgrown)**
- `parallel` — named concurrent steps, returns object.
- `thenAll` — array concurrent steps, returns array.
- `forEach` — concurrent over input array.
- `forEachBackground` — fire-and-forget over input array.
- `race` — concurrent, first wins.
- `thenAny` — sequential, first wins.

**Loop**
- `doUntil`, `doWhile`, `loopBack` — three loop primitives, one of them named-step-based.

**Background (essential but redundant)**
- `work` — non-aborting side chain.
- `background` — alias for `work`.
- `waitForWork` — converge.

**Side effect**
- `tap` — block side effect.

**Error**
- `rescue` — typed recovery.

**Honest minimal set:**

You could build everything else from these:
1. `then(block)` — sequential.
2. `map(fn)` — transform.
3. `branch(condition, then?, else?)` — fold all five conditionals into one.
4. `parallel(spec)` — fold `parallel`/`thenAll`/`forEach` into one with an `each: input => array` form.
5. `race(blocks)` — fold `race`/`thenAny` into one (sequential vs. concurrent is a flag).
6. `loop(condition, block, { max })` — fold all three loops into one. `loopBack` is unnecessary if you compose properly.
7. `work(block)` — background.
8. `rescue(handlers)` — error recovery.
9. `tap(block)` — side effect.

Nine methods. The 21-method surface adds ergonomics (`thenIf` is `branch` without an else; `tapIf` is `branch` with one branch being `tap`) at the cost of API mass. Best-practice rule BP-015 explicitly tells contributors to "use conditional step variants instead of wrapper sequencers" — i.e., use the bigger DSL because the smaller one would be awkward. That's a sign the ergonomics matter, but it should not require *five* conditional variants.

**Verdict.** The DSL has grown into a kitchen sink. About half the methods are convenience wrappers over the others. The framework has paid for ergonomics with API surface mass. This is a tradeoff, not a bug — but the docs should be honest about which methods are core (about 9) and which are sugar (the other 12). Cut: `background` (alias for `work`), `loopBack` (composition can replace), `thenAny` (race with sequential flag).

---

## 9. Middleware vs. hooks vs. rescue vs. lifecycle

Error-handling and interception mechanisms in the framework:

1. **Middleware** (`middleware.md`) — around-pattern interception of `block.run`, three layers (global/flow/block), can short-circuit, transform output, observe.
2. **Lifecycle hooks** (`flows-and-actions.md:115`) — `onStarted`, `onCompleted`, `onErrored`, `onFinished`, `onStepErrored`. Past-tense, observation-only.
3. **Rescue** (`sequencer-dsl.md:327`) — typed error recovery inside a sequencer.
4. **Retry** (`execution-and-errors.md:90`) — per-block retry policy.
5. **Block-level `onCompleted`/`onErrored`** as observers on actions (`flows-and-actions.md:46`).
6. **Tools-level observers** — `tools.onToolStarted`, `tools.onToolCompleted`, `tools.onToolErrored` (`flows-and-actions.md:225`).
7. **Repair** for generator schema mismatch (`execution-and-errors.md:151`) — `auto`/`rescue`/`fail` modes.

That's seven mechanisms. Are they orthogonal?

- **Middleware** wraps execution. Can do anything observable.
- **Lifecycle hooks** observe at fixed points. Functionally a subset of middleware (they could all be implemented as middleware that doesn't call `next`). They exist as a separate concept because they're easier to declare and they're observation-only.
- **Rescue** transforms errors into success outputs. Could be middleware that catches and returns. Exists as a separate concept because it's per-segment in a sequencer, not per-block.
- **Retry** is a special case of middleware (try, catch, retry). Exists as config for ergonomics.
- **Tools-level observers** are middleware-shaped at a different granularity (one tool call vs. one block).
- **Repair** is generator-specific schema-error recovery.

**The model that would unify these:**

- **Middleware**: the around-pattern, applies to everything. Includes retry policy as built-in middleware.
- **Rescue**: stays as a sequencer concept (it's about sequencer-level error flow control).
- **Hooks**: collapse into "observe-only middleware" with an ergonomic shorthand. They're the same thing.
- **Repair**: stays as generator-specific (it operates inside the tool loop, not around it).

That's three concepts: middleware (with hooks as ergonomic sugar), rescue, repair. Currently the framework has seven that overlap.

**Verdict.** Middleware and hooks are doing the same job at different ergonomic tiers; the framework has both because hooks were conceptually older and middleware is newer. Rescue earns its place. Repair is a reasonable specialization. Suggestion: document hooks as "shorthand for observe-only middleware at known points" rather than as a separate mechanism.

---

## 10. Locked contracts

`overview.md:188`:

> "Block kinds are exactly: `handler`, `generator`, `sequencer`, `router`"
> "Stream model: item/content lifecycle (no part-envelope model)"
> "Stream cursor: `${requestId}:${sequence_number}`"
> "Generator provider: Vercel AI SDK in Phase 1"
> "Observational hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)"

Are these load-bearing or premature commitments?

- **Block kinds locked at four**: load-bearing in the sense that the type system depends on it. But the *content* of that lock is what I'd push back on (see §1). The lock makes it harder to consolidate.
- **Stream cursor format**: load-bearing. Wire format compatibility.
- **Item/content lifecycle (no part-envelope model)**: load-bearing. This is a deliberate rejection of an alternative streaming model.
- **Vercel AI SDK as generator provider**: a *Phase 1* lock. Reasonable. Locks shouldn't survive past their phase.
- **Past-tense hooks**: stylistic. Could change without breaking anything, but doing so would churn user code. Reasonable lock.
- **`userId` required**: see §1 — `requireUser: false` already exists as an escape (`authentication.md:73`), so the "locked" claim is overstated.

**The risk of locking too early.** A lock prevents simplification. Locking `block kinds = exactly four` at Phase 1 means the consolidation in §1 (collapse to two) requires breaking changes. If the lock had been "the runtime distinguishes blocks-that-run from compositions-that-orchestrate," consolidation would be a non-event.

**Verdict.** Several locks are wire/protocol concerns and load-bearing. Several are conceptual commitments that lock in design choices that may not deserve to be locked (block kinds in particular). A pre-1.0 framework should be more careful about which conceptual commitments it calls "locked."

---

## Three alternative architectures

### A. Minimal simplification (low-risk, mostly editorial)

Goal: trim the surface without breaking the conceptual model.

1. Demote "utility blocks" from a concept. Re-export factories at the top level.
2. Cut `loopBack`, `thenAny`, `background` from the sequencer DSL. Document the remaining 18 methods as 9 core + 9 sugar.
3. Document hooks as observe-only middleware sugar; do not change the API.
4. Replace per-field `clientData` functions with a default "expose state" + opt-out hidden list. Keep functions for derived fields.
5. Collapse `block_debug` and `state_snapshot` into `block_output` variants.
6. Rename "project" to "org" throughout (or vice versa). Pick one.
7. Update `CLAUDE.md` to demote capabilities from "prefer over manual plumbing" to "use when you have diamond dependencies or want a typed `ctx.cap.<name>` namespace."

Estimated impact: docs and a few exports. No conceptual breaks.

### B. Medium consolidation (one breaking pass)

Goal: meaningfully reduce concept count while preserving the runtime.

1. Collapse static resources and resource collections into one factory: `defineResource({ stateSchema, instances?: { pattern, max, eviction } })`. Static resources are the degenerate case. One doc page.
2. Drop `request` scope as a public concept. Move its uses into sequencer instance state. The runtime still has request bookkeeping internally.
3. Collapse the four-scope hierarchy to two public scopes: `session` and `identity` (where `identity = user + org with isolation flags`). Document `org` as a flag on identity, not a separate scope.
4. Replace the five conditional sequencer methods (`thenIf`, `branch`, `exitIf`, `tapIf`, `workIf`) with one `branch(condition, { then, else, exit, tap, work })` taking explicit modes. Sugar for common cases stays as documentation, not API.
5. Merge the seven error-handling mechanisms into three: middleware, rescue, repair. Hooks become ergonomic shorthand for observe-only middleware.
6. Cut `clientData` as a separate concept. Replace with `client: { expose: keyOf<state>[], derived: { ... } }` per scope.

Estimated impact: meaningful breaking changes, one migration. Conceptual surface roughly halves.

### C. Aggressive simplification (re-found the model)

Goal: rebuild around two primitives.

1. **Two block kinds**: `block` (atomic execution unit) and `compose` (composition tree node). A "generator" is a block whose config has `model`, `prompt`, `tools` — the runtime detects this and runs the tool loop. A "router" is a compose tree with one `branch` node.
2. **Two scopes**: `session` and `identity`. Drop request and org as separate scopes.
3. **One data primitive**: `resource`. Optional `instances` for collections. State fields become resources with primitive schemas if you want them visible to clients.
4. **Nine sequencer methods**: `then`, `map`, `branch`, `parallel`, `race`, `loop`, `work`, `rescue`, `tap`. Everything else is a userspace combinator.
5. **Three error mechanisms**: middleware (with hooks as sugar), rescue, repair.
6. **Item types reduced to ~8 conceptual buckets**: message, reasoning, component (covers container as a sub-kind), status, state-change, error, tool-output, trace (covers block_output, router_decision, state_snapshot, block_debug as variants).
7. **Capabilities removed.** Helper namespacing and diamond dedup are real concerns but solvable with module-level functions and identity-equality dedup at registration time without a new abstraction.

Estimated impact: full rewrite of the surface. Framework would be significantly smaller and more learnable. Migration would be substantial.

---

## Closing call

The framework has more concepts than it needs to do its job. Most of the excess is the natural result of incremental growth — every concept earned its way in by solving a real problem in front of someone at the time. The sum of those local decisions is a model that's harder to learn than it has to be.

The cheapest improvements are editorial (proposal A): document what's core, what's sugar, what's advanced, and stop pretending the surface is minimal when it isn't. The most valuable improvements are structural (proposal B): collapse the duplicate concepts, halve the scope count, normalize the error-handling story.

The "locked contracts" framing should be weakened on conceptual commitments and strengthened on wire-format commitments. Locking that there are exactly four block kinds is a conceptual commitment; locking the SSE cursor format is a wire commitment. They aren't the same kind of decision and shouldn't share a label.

Pick a level. Most of these wins compound — once you collapse static-and-collection resources, the case for collapsing `request` scope into sequencer state gets stronger because there's less surface for it to interact with.
