# Flows and Actions

A **flow** is the top-level unit of composition. It ties together blocks, state schemas, resources, client data, and lifecycle hooks into a registerable, executable unit.

## Defining a Flow

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const chatFlow = defineFlow({
  kind: "hello-chat",
  requireUser: true,
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string().min(1) }),
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({ messageCount: z.number().default(0) }),
  },
});
```

### FlowType and FlowInstance

`defineFlow` returns a **FlowType** — a callable that produces **FlowInstance**s:

```ts
const chatFlowType = defineFlow({ kind: "hello-chat", ... });

// The singleton instance: id === kind
const flow = chatFlowType();

// A collection: several configured copies, each with its own id
const reviewType = defineFlow({ kind: "review", cardinality: "collection", ... });
const east = reviewType({ id: "review-east", resources: { rubric: eastRubric } });
```

Instances support merge-based overrides for action replacement/extension at creation time.

**Cardinality is declared on the definition, never on the instance.** `cardinality: "singleton"` (the default) means one instance whose id is its kind; the factory takes no id, or the kind spelled out, and anything else throws. `cardinality: "collection"` means as many instances as are registered, each with a required, explicit id. Both `FlowType` and `FlowInstance` carry `cardinality` as normalized metadata beside `kind` and `id`.

**Registration is by exact global id.** `FlowRegistry.get(id)` is the only lookup: a singleton by its kind, a collection member by its id, a collection's bare kind by nothing. Ids are unique across kinds; a duplicate, a singleton under a custom id, a collection instance without one, or a kind mixing the two cardinalities is a `FlowIdentityConflictError` at `register`. There is no first-registered fallback anywhere. A structural instance without `cardinality` (older code, test doubles) is admitted as a singleton only when its id is absent or equals its kind.

`evalFlow` / `testFlow` labels such as `id: "eval-run"` never pass through the registry; they run the definition directly and are not addresses.

**`FlowInstance.config` — the copy's create-time settings.** `configSchema` on the definition declares the shape; `config` on the factory call supplies the values. The factory closes the schema (so an undeclared key is an error, not a silently stripped one), parses the bag, checks it against every reachable block that declared a `flowConfigSchema`, and freezes the result. Normalized so it is never absent: a flow declaring no schema carries a frozen empty object. **Never persisted, never on the wire, and no part of any storage key** — the isolation coordinate stays `flow.id` alone, so two copies with identical bags never merge storage, and a durable request that resumes after a deploy runs on the new settings because there is no stored copy to reconcile. Frozen shallowly; a nested object inside the bag is not deep-frozen. **Closed shallowly too**: the top-level key set is exhaustive and an undeclared key there refuses by name, but a nested object schema is parsed on its own terms, so an undeclared key one level down is stripped rather than refused whenever the nested object's own declared keys are all optional or defaulted. When any nested key is required — the ordinary case — the parse fails and the copy still refuses, though the message names the missing key rather than the unknown one. A nested key can therefore go missing but never come out wrong. Closing the tree would mean rebuilding an author's schema node by node, which is a larger and riskier change than the one it prevents; a `catchall` is refused outright for the same reason it cannot be silently cleared.

Config is per-copy and supplied at the mint, exactly like `id`, so it is normalized on the **mint** half of the factory path and not in the definition-derived half. A required field parsed at definition time would make every configured definition throw before its author could supply a bag. `FlowType` instead carries a `config` derived from one `safeParse({})` probe — the same value a bagless mint gets, so a blueprint and a mint never diverge — plus `requiresConfig`, a declaration-derived boolean that is true when that probe fails or its value does not satisfy a declaring block. The registry reads that boolean, and only that boolean, to refuse a definition handed over in place of an instance.

**The public block-context boundary is a shape, not an absence.** `BlockContext` does not carry the flow instance — reaching the action, task and internal maps would let a block step around the claim and dispatch gates built onto them. It carries `FlowContextView`, which names exactly one member of the instance: `config`. `FlowContextView<TConfig>` is defined once, in `types/block.ts`, and is what `BlockContext` declares; the four block builders reach the same shape through `InferFlowConfigFromSchema`, which turns a block's `flowConfigSchema` into the read type. The boundary type-test keeps negative assertions on `flow.actions`, `flow.task`, `flow.internal`, `flow.resources` and `flow.id` alongside a positive one on `flow.config`. The engine's own `ExecutionContext` still holds the whole instance; only the public type is narrowed.

**That narrowing is a compile-time contract, not runtime enforcement.** `createExecutionContext` builds one object carrying the whole `FlowInstance` under `flow`, so a block that casts (`(ctx as any).flow.actions`) reaches every member the view leaves out and nothing stops it. This is the accepted shape, not an oversight: a block author already owns the process their flow runs in, so the boundary is there to prevent the accident and the drift rather than the determined author. It is still a real guardrail — reaching past it takes a deliberate cast that shows up in review, and the type-test fails CI when the declared surface widens by accident — but it must not be cited as proof that a block *cannot* reach the action, task or internal maps.

**A block's requirement travels to the flow, not the other way.** `flowConfigSchema` on a block declares what it needs of any flow that installs it, collected off the closure `walkBlockGraph` builds (the same walk the dispatch-address check reads, tool edge included — a block reached only as a generator's static tool has no action root of its own) and carried as `requiredFlowConfig`, deduped by schema reference. That list is **build-time only** and is deliberately not a member of `FlowInstance`: it is derived from the definition, identical for every copy, and read nowhere once the mint has parsed the bag against it, so putting it on the instance would add a required property with no consumer to a published type. Both halves of the flow build read it from the normalized shape instead. Two refusals, at the two moments each is decidable: at definition time when a reachable block requires config and the flow declares no `configSchema` at all; at each mint when the parsed bag fails a block's schema. The mint check is a `safeParse` of the real value rather than a schema-to-schema comparison, which makes it exact — refinements, unions, nested objects and applied defaults included — at the cost of being **per copy rather than per definition**: a flow merely looser than a block needs is refused at the mint of every copy that omits the field, not where the two were written. No unsatisfied block ever executes.

**A tool a function returns is checked at resolution, by the same walk.** A generator's `tools` slot may be a function, resolved per call against runtime values that do not exist when the flow is defined, so those blocks are invisible to the mint. `generator` therefore runs `walkBlockGraph` over what the function returned and checks the same requirement against the running copy's bag before the tool list reaches the model — descending through composition exactly as the mint does, so a requirement declared by a block *inside* a returned tool is refused whether the tool was declared statically or produced at run time. `walkBlockGraph` lives in `helpers/block-graph.ts` rather than in either caller because `defineFlow` imports `generator`, so neither can host what both need.

**Two blocks declaring contradictory requirements are caught at the mint too, and only there.** One block wanting `model: z.string()` while another wants `model: z.number()` is a graph that no bag can satisfy, and in principle that is knowable when the flow is defined. It is not reported there, for the same reason the looser-flow case is not: deciding whether two Zod schemas can ever agree is the schema-to-schema comparison this design rejected as not implementable to a promise-worthy standard. A definition-time check that fired only on the cases that *are* decidable would be worse than none, because it would read as a guarantee while missing the shapes — refinements, unions, transforms — that motivated the value-level parse in the first place. So both blocks are parsed against the same concrete bag at each mint, whichever the bag fails refuses by name, and `requiredFlowConfig` stays a list rather than a merge precisely so no silent reconciliation can happen.

## Actions

Actions are the **entry points** to a flow. Every request executes through a named action.

```ts
actions: {
  sendMessage: {
    block: chatSequencer,
    onCompleted: updateJournalBlock,
    onErrored: logErrorBlock,
    userMessage: (input) => input.message,
  },
}
```

| Field | Purpose |
|-------|---------|
| `block` | Root block to execute for this action |
| `inputSchema` | Optional override for action-level validation. Defaults to `block.inputSchema`. |
| `userMessage` | Optional function returning the display text, or `{ text, metadata }`, → emits a `MessageItem` (role: "user") as the first stream item; `metadata` lands on the item so a renderer can tell a machine-written echo (such as a task brief) from typed words |
| `onCompleted` | Block executed on terminal success |
| `onErrored` | Block executed on terminal failure |

**Key rules:**
- Actions are flow-level — not nested in session or scope configs
- Action input validation runs before any block execution
- `userMessage` is optional — omit it for system triggers or background tasks

### Bare-block entries

An entry that sets nothing beyond its block is the block itself: `actions: { chat, summarize }`. The same holds for `internal.actions`, `task.actions` and an instance's `actions` override. `defineFlow` turns each bare block into `{ block }` once, in `normalizeFlowConfig`, so every reader past it (the runtime, HTTP, MCP, the devtool) sees only the object form, and `NormalizedActions` gives the client the same input typing as `{ block }`. Webhook bindings and schedules have no bare form: each always carries `input` or `cron`.

The same normalize step resolves an action's (and a read's) `description` to `action.description ?? block.description`, so MCP's tool text and its definition-time check read one value. An action's own description still wins; set one when a public MCP tool needs wording the block's doesn't have.

### When to override `inputSchema`

`inputSchema` is optional because every block already carries its own. Override it when the action's public contract should diverge from the block's:

- **MCP exposure.** The action schema is the LLM-facing tool definition. Add richer `.describe()` annotations or stricter ranges than the block needs internally.
- **Boundary narrowing.** Block accepts a generic shape; the action enforces a narrower public contract (`z.string().min(1).max(1000)` over `z.string()`).
- **Documentation surface.** The action schema is the published contract. The block schema is the implementation contract. They can legitimately diverge.
- **Test escape hatches.** `inputSchema: z.unknown()` skips action-level validation while leaving the block's check intact.

Otherwise omit it — the block's schema is the source of truth, and the runtime falls back to it automatically.

## Scope Configuration

Flows configure state across four scopes. Resources live in a single flat `resources` map; each resource's intrinsic `scope` (`"session"` | `"user"` | `"org"`) routes storage.

```ts
defineFlow({
  kind: "my-flow",
  requireUser: true,
  actions: { /* ... */ },

  resources: { /* accessor → defineResource / defineResourceCollection */ },

  request: {
    stateSchema: z.object({ /* per-request state */ }),
    onStarted: requestStartedBlock,
    onCompleted: requestCompletedBlock,
    onErrored: requestErroredBlock,
    onFinished: requestFinishedBlock,
    onStepErrored: stepErrorBlock,
  },

  session: {
    stateSchema: z.object({ mode: z.enum(["plan", "edit"]).default("plan") }),
    client: { /* expose / derived views for the client */ },
  },

  user: {
    stateSchema: z.object({ /* per-user state */ }),
    client: { /* ... */ },
  },

  org: {
    stateSchema: z.object({ /* org-wide state */ }),
    client: { /* ... */ },
  },
});
```

## Lifecycle Hooks

Observational hooks fire at specific points in the request lifecycle:

| Hook | Fires When |
|------|------------|
| `onStarted` | Request begins (after session/context resolution) |
| `onCompleted` | Terminal success only |
| `onErrored` | Terminal failure only |
| `onFinished` | Always (success or failure) |
| `onStepErrored` | Non-terminal step/side-chain failure (for visibility) |

Hooks use **past tense** naming — this is canonical. Present-tense names are reserved for future pre-execution hooks (not Phase 1).

Hooks can be plain callbacks or blocks. If you pass a block, its `inputSchema` must accept the lifecycle event shape.

A block hook runs as its own block, on a top-level path beside the action's `root`: `observer[request.onStarted]`, `observer[action.onCompleted]`, and so on (`blockPathObserver`). It never shares the action block's instance id, so its trace is never read as a re-run of the action's block, which would drop the items the action's block emitted from the session's history.

## Request Execution Pipeline

When an action is invoked, the framework executes this sequence:

1. Resolve flow instance by exact id (the route's first segment) and action
2. Validate action input against `inputSchema`
3. Admit ownership: a named `sessionId` / `requestId` must be owned by the resolved instance (`resolveRecordOwner`), else `FlowInstanceBindingMismatchError` before any write; a record with no owner recorded resolves to the singleton of its kind or, for a collection kind, `migration-required`
4. Resolve or create session (ephemeral if no `sessionId`), stamping `flowId` (owner) and `flowKind` (definition) on new session and request records and on the active-request entry
5. Require user context (Phase 1 policy)
6. Create request scope and state
7. Emit user message item (if `userMessage` defined)
8. Fire `request.onStarted`
9. Execute action root block via `block.run(input, ctx)`
10. On success, fire action + request `onCompleted`, then persist the terminal record and emit the terminal stream status. On failure, persist and emit first, then fire action + request `onErrored`
11. Fire `request.onFinished`
12. Wait for `.sideChain()` work the hooks queued, then stamp the record's `finalizedAtMs` as its last write (see [Streaming](./streaming.md))

Steps 10–12 apply to a request that finishes. A run that calls `ctx.suspend()` ends as `suspended` instead: it fires no `onCompleted`, `onErrored` or `onFinished`, drains no terminal-hook work and writes no `finalizedAtMs`, because the id stays resumable. Session retention evicts only completed and interrupted requests, and never one parked on a gate that drives it again (pending, or resolved and owed a re-drive), so it keeps a suspended one.

Retry, continue and resume re-enter the instance recorded as the request's owner, and interrupted-request recovery groups entries by owner; the `:flowKind` path segment on those routes must equal it.

## Resources and Client Data

Resources are **concrete persisted data**. They are declared once in the flow-level `resources` map — each resource's own `scope` decides where it persists. Scope configs carry state and a `client` block; they do not carry resources.

A scope's state is private to the server by default. The `client` block declares the slice that crosses the boundary: `expose` passes top-level state fields through verbatim, under `clientData.<scope>.<name>` on the client. A value computed for a screen is a view ([Views](#views)).

```ts
defineFlow({
  kind: "my-flow",
  actions: { /* ... */ },

  resources: {
    plan: defineResource({
      scope: "session",
      stateSchema: z.object({ steps: z.array(z.string()).default([]) }),
      writable: true,
    }),
  },

  session: {
    stateSchema: sessionStateSchema,
    client: { expose: ["messageCount"] },
  },
});
```

**Key rules:**
- Resources are flow-level and flat — `session.resources` / `user.resources` / `org.resources` are gone
- State does not reach the client unless named in `expose`, or read by a view
- A scope's `client.derived` is removed: `defineFlow` refuses it, naming views
- Generator context should use `contextFn()` for typed scope access
- Use `defineResource()` for portable resource reuse

### Automatic Resource Collection

Blocks declare resource dependencies via `resources` (using `defineResource()` values). When `defineFlow` is called, it collects `declaredResources` from every block reachable from its action blocks, including blocks reached only through a generator's static `tools` array, and merges them into the flow's `resources` map. Tools returned by a function-valued `tools` slot are resolved per call and are not collected. The flow may repeat a block's accessor only with the same `defineResource()` reference; a different definition under that name is a build-time error, the same as two blocks disagreeing:

```ts
// Block declares its resource dependency
const planManager = handler({
  name: "plan-manager",
  resources: { plan: planResource },
  execute: async (input, ctx) => { /* ctx.resources.plan */ },
});

// defineFlow merges block-declared resources into flow.resources
const flow = defineFlow({
  kind: "my-app",
  actions: { manage: { block: planManager } },
  // flow.resources will include { plan: planResource }
  // even without declaring it here
});
```

See [Resources and Client Data](./resources-and-client-data.md) for the full collection and merge model.

## Views

A view is the one hook a screen uses to watch an answer the server computes ([FIX-2623](../../specs/issues/FIX-2623/SPEC.md); epic FIX-2618 O2). It is a block with a scope, declared with `defineView` and installed in a flow's `views`:

```ts
export const roster = defineView({
  scope: "user",                 // "session", or "user" / "org" with no session
  key: (row) => row.id,          // optional: the answer is a list, kept by key
  block: rosterBlock,            // must declare an outputSchema: ViewOutput<typeof roster>
});
defineFlow({ kind: "workforce-roster", views: { roster } });
```

`defineView` (`packages/core/src/flow/defineView.ts`) refuses a block with no output schema (or `z.any()` / `z.unknown()`), so `ViewOutput<typeof view>` is never `unknown`. `defineFlow` refuses a `views` entry `defineView` didn't make.

**How it runs.** Every view runs through the one view runner, `runView` (`packages/engine/src/execution/runView.ts`). It hands the run the read-only stores (below), so a view writes nothing and a write throws `read_only`. A user or org view runs with **no session**: the context's `noSession` mode loads, makes and stores none, installs no session resource, and puts a stand-in where `ctx.session` would be that throws `NoSessionError`; the run's request record and execution metadata name no session. A session view runs on a session that exists, under the action path's binding checks, and can't make one. **A view calls no model** (D2): the run's model resolver refuses, and a generator or an evaluator (which always holds a model, sometimes inline, called without the resolver) is refused before it starts, both with `ViewModelCallError`. A view's run ends like a request: its side chains drain and request-end hooks run.

**What it read.** The engine records each scope state and resource a view's blocks reach, where it builds their context: the scope state getters and the one `ctx.resources` registry every block's context shares, so a child block, a sequencer step or a capability's block is recorded like the view's own block (`packages/engine/src/context/view-reads.ts`). The handle a block gets back is the same object recorded or not, so recording never changes the run's branch. Nothing about a view's dependencies is declared (D1). Every read path records through one surface, `createViewDependencies` (`view-reads.ts`), which holds the topic rules: a read is heard on its scope's topic, a session read whose reach (its storage key, or a collection's prefix, rows not yet created included) touches any lineage-shared storage by the longest-prefix ownership rule also on the owner's user topic, and another session's read on that session's topic. `views-dependency-matrix.test.ts` runs each read path against each scope with another writer, and guards that the execution context hands the raw recorder to nothing else. The other read paths are recorded or refused: a `contentTemplateRef` resolved into another scope records every scope searched (found or not, since creating the template later changes the answer); in a session view, `ctx.session`'s items, metadata, window and journal record the session, and the request host's `sessions.read` / `sessions.history` record the session read; in a user or org view those refuse with `NoSessionError`; and `livenessOf`, which no topic covers, refuses in every view with `UnrecordedReadError` (`422 view_unrecorded_read`). The answer carries the bare topic of each scope it read (`{ scope: "session", id }`, `{ scope: "user" }`, `{ scope: "org" }`), deduped and sorted, so an unchanged set compares equal. No topic is added.

**Publishing.** Once any flow the host registers declares a view, every resource write publishes a change notice on its scope's topic, whichever flow writes it (`requestHost.hostHasViews`, wired from the registry). A view may read any resource, so a missed notice would leave its watcher stale; an extra one is allowed. A `sharedToLineage` session resource is one resource across a lineage, but a session notice reaches only the writer's session, so its write also publishes on the owner's user topic (every lineage member belongs to one user), from a run and from the resource routes alike, through one publish surface (`publishSessionResourceChange`, `bus/scope-changes.ts`). It decides sharing from the stored key's ownership, by the rule write routing uses (`sessionKeySharesLineage`), and takes the owner from the session record the writer loaded. A view that reads one records the user topic beside its session. No topic is added.

**How it is reached.** `POST /api/flows/:flowKind/views/:viewName` for a user or org view, and `POST /api/flows/:flowKind/:sessionId/views/:viewName` for a session view, each with `{ input }`, answering `200 { output, topics, hears }` (`packages/engine/src/routes/view-routes.ts`). The caller is resolved on the `:flowKind` path through the flow's own resolver, as an action is, never from the body, query or headers. A view addressed at the wrong scope answers `400`; a model call or a reach for a session answers `422` (`view_model_call`, `view_no_session`); a write `409 read_only`.

**Watching it.** A screen names a view with `viewRef<typeof view>(flow, name)` (`packages/client/src/view/view.ts`), a handle with the flow's address and the view's name and no block, typed by a type import. `client.view(ref, input, { sessionId? })` runs it once and resolves to `{ value, topics, keys? }`; a keyed view's answer carries its row keys in order. `useView(ref, input, options)` (`packages/react/src/hooks/useView.ts`) returns `{ value, stale }`. Both watch through `watchView` (`client/internal`), which is the client's live read with `topicsFromResult`: the answer names the topics, the live read listens to them, re-subscribes when they change and reads once after re-subscribing. It adds no loop. Watchers of the same view, session and input in one client share one live read and its answer (keyed per client in a `WeakMap`), a late watcher gets the current value at once, and the read stops with the last watcher. A keyed view's rows that didn't change keep their object identity across answers.

**Read-only stores.** A view's run sees the session, its resources and its user under the action path's binding checks; what differs is the stores it is handed. Its own request record, traces and checkpoints go to an in-memory registry dropped when the run ends, the first seed of a user or org record a fresh session lacks lands there too, and every other write throws `FlowError` with code `read_only`. Dispatch is refused the same way. "Stores nothing" holds by construction, and a store method added later is refused until it is named as a read verb: a new store read method needs a line in `READ_VERBS` (`packages/engine/src/execution/runView.ts`) before a view can call it.

**Answering for the rows that changed** (FIX-2625 D1). A notice may name the ids of what changed ([server-and-client.md](./server-and-client.md#change-notices)). When the notice that wakes a keyed view's watcher names ids and the watch holds a keyed answer, `watchView` passes it on the call (`client.view(ref, input, { changed })`, the body's `changed`), and every block of the run sees it as `ctx.view.changed`: the topic, the kind and the ids, never row keys, since only the view knows which rows an id touches. A view that does nothing with it answers whole, as before. One that narrows returns `ctx.view.partial(rows, { removed })`: the answer is flagged `partial`, its rows are placed by key over the rows held (a held key in place, a new one last), the removed keys dropped, and its topics added to the held ones, never narrowing what the screen hears. A partial answer never reorders rows, so a view answers whole wherever a change could move one or put a new one anywhere but last. In development and tests (`NODE_ENV`), the watch compares each placed partial answer with a whole run and, on a difference, logs the view's name and shows the whole run. The board's task-list view (`taskToolViews`) answers for a board notice's tasks and every row of their follow-up chains (each shows the chain's latest completed follow-up), and whole for a filtered list, an unknown task or another board. A collection's direct read (`useResource` at user or org scope) re-reads just the entries a notice names when it shows them all, and reads the collection otherwise.

**What a watcher hears** (FIX-2625). Beside its topics, an answer says what it hears under each (`hears`, a `ViewHearing` per topic, from the recorder's `hears()`): a state read hears `state` on a user or org topic and every kind but `resource` and `board` on a session topic; a resource read hears `resource` notices whose path falls at or under its storage root (its key, or a collection's static prefix). `watchView` reads again only on a notice one of them admits, through the client's one path rule (`mayHold`); a `resource` notice with no path and a `resync` always read, and an answer with no `hears` (a server from before it) reads on every notice under its topics. Topics stay bare scope topics, since a subscription narrowed to a resource matches a path exactly. A user-scope collection entry's notice names its collection's root, never its key, so the path rule runs on the user topic too. A task board read through its task collection is recorded by the collection itself (`recordBoardRead`, `core/internal`, the `BOARD_READ_SEAM` a view's run attaches) as heard on `board` notices on each entry's filer's session topic narrowed to the board, and its ledger's own resource read is not heard: the same place (`getOrCreateTaskCollection`) wires every write to the board notice naming its task (FIX-2625 D3; `orchestration/test/tasks/board-notice.test.ts` checks every write at the store). A ledger read any other way stays heard on its scope.

**The live read.** `watchView` rides the client's live read, `client.live(topics, { read, hear, paths, onValue })`, which runs a read again on the notices under `topics` that `hear` and `paths` let through: one read in flight and at most one waiting, a value reported only when it changed, and a failed read tried again on its own (1 s doubling to 30 s, `onStale` meanwhile). Where push can miss a change it reads on a timer (3 s by default). The live read is the one loop every watch in the framework and its apps runs on (`packages/client/src/live/`); a second coalescer anywhere else fails the `fsd/one-coalescer` lint. `client.subscribe` stays the lower-level call it rides.

**Reads are removed.** A flow's `reads` (FIX-2286), `ReadConfig`, `runRead`, the read route and `client.flow(kind).read` are gone; views replace them, as they replaced a scope's `client.derived` ([Resources and Client Data](./resources-and-client-data.md#client-data)). `defineFlow` refuses a `reads` key, naming views. The target model is [Reading, Writing and Installing](../internal/design/reading-writing-installing.md).

## Flow Discovery

Convention: `src/flows/**/flow.ts`

Each flow module exports one flow instance (or array of instances):

```ts
// src/flows/hello-chat/flow.ts
export default helloChatFlow();
```

## Route Shape

Server routes follow a canonical pattern:

```
POST /api/flows/:flowKind/actions/:action
POST /api/flows/:flowKind/:sessionId/actions/:action
POST /api/flows/:flowKind/views/:viewName
POST /api/flows/:flowKind/:sessionId/views/:viewName
GET  /api/flows/:flowKind/requests/:requestId/stream
```

`:flowKind` is the historical name of the segment; its value is the **instance id** (a singleton's kind, a collection member's own id). See [server-and-client](./server-and-client.md) for the current contract.

Typically mounted via a Next.js catch-all: `app/api/flows/[...path]/route.ts`

## Tools Configuration

Flow-level tool defaults and lifecycle observers:

```ts
defineFlow({
  // ...
  tools: {
    defaults: {
      timeoutMs: 30000,
      retry: { maxAttempts: 2 },
    },
    onToolStarted: (event, ctx) => { /* ... */ },
    onToolCompleted: (event, ctx) => { /* ... */ },
    onToolErrored: (event, ctx) => { /* ... */ },
  },
});
```

Generators still explicitly choose which tools are exposed per call — flow-level `tools` provides defaults and observability.

## Canonical Authority

This document is authoritative for flow and action contracts. For full type signatures, refer to the published types in `@flow-state-dev/core`.


### Token controls

- Flow-level: `tokenCounter` and `costEstimator` can be provided in `defineFlow`.
- Action-level: `tokenBudget` can be configured per action for request budget enforcement policies.

