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

Config is per-copy and supplied at the mint, exactly like `id`, so it is normalized on the **mint** half of the factory path and not in the definition-derived half. A required field parsed at definition time would make every configured definition throw before its author could supply a bag. `FlowType` instead carries a `config` derived from one `safeParse({})` probe — the same value a bagless mint gets, so a blueprint and a mint never diverge — plus `requiresConfig`, a declaration-derived boolean beside `requiresOrg` that is true when that probe fails or its value does not satisfy a declaring block. The registry reads that boolean, and only that boolean, to refuse a definition handed over in place of an instance.

**The public block-context boundary is a shape, not an absence.** `BlockContext` does not carry the flow instance — reaching the action, task and internal maps would let a block step around the claim and dispatch gates built onto them. It carries `FlowContextView`, which names exactly one member of the instance: `config`. `FlowContextView<TConfig>` is defined once, in `types/block.ts`, and is what `BlockContext` declares; the four block builders reach the same shape through `InferFlowConfigFromSchema`, which turns a block's `flowConfigSchema` into the read type. The boundary type-test keeps negative assertions on `flow.actions`, `flow.task`, `flow.internal`, `flow.resources` and `flow.id` alongside a positive one on `flow.config`. The engine's own `ExecutionContext` still holds the whole instance; only the public type is narrowed.

**That narrowing is a compile-time contract, not runtime enforcement.** `createExecutionContext` builds one object carrying the whole `FlowInstance` under `flow`, so a block that casts (`(ctx as any).flow.actions`) reaches every member the view leaves out and nothing stops it. This is the accepted shape, not an oversight: a block author already owns the process their flow runs in, so the boundary is there to prevent the accident and the drift rather than the determined author. It is still a real guardrail — reaching past it takes a deliberate cast that shows up in review, and the type-test fails CI when the declared surface widens by accident — but it must not be cited as proof that a block *cannot* reach the action, task or internal maps.

**A block's requirement travels to the flow, not the other way.** `flowConfigSchema` on a block declares what it needs of any flow that installs it, collected off `defineFlow`'s `walkFlowGraph` closure (the same walk the dispatch-address check reads, tool edge included — a block reached only as a generator's static tool has no action root of its own) and carried as `requiredFlowConfig`, deduped by schema reference. That list is **build-time only** and is deliberately not a member of `FlowInstance`: it is derived from the definition, identical for every copy, and read nowhere once the mint has parsed the bag against it, so putting it on the instance would add a required property with no consumer to a published type. Both halves of the flow build read it from the normalized shape instead. Two refusals, at the two moments each is decidable: at definition time when a reachable block requires config and the flow declares no `configSchema` at all; at each mint when the parsed bag fails a block's schema. The mint check is a `safeParse` of the real value rather than a schema-to-schema comparison, which makes it exact — refinements, unions, nested objects and applied defaults included — at the cost of being **per copy rather than per definition**: a flow merely looser than a block needs is refused at the mint of every copy that omits the field, not where the two were written. No unsatisfied block ever executes.

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
| `userMessage` | Optional function extracting display text → emits a `MessageItem` (role: "user") as the first stream item |
| `onCompleted` | Block executed on terminal success |
| `onErrored` | Block executed on terminal failure |

**Key rules:**
- Actions are flow-level — not nested in session or scope configs
- Action input validation runs before any block execution
- `userMessage` is optional — omit it for system triggers or background tasks

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
10. Fire action + request completion/error hooks
11. Fire `request.onFinished`
12. Persist state and emit terminal stream status

Retry, continue and resume re-enter the instance recorded as the request's owner, and interrupted-request recovery groups entries by owner; the `:flowKind` path segment on those routes must equal it.

## Resources and Client Data

Resources are **concrete persisted data**. They are declared once in the flow-level `resources` map — each resource's own `scope` decides where it persists. Scope configs carry state and a `client` block; they do not carry resources.

A scope's state is private to the server by default. The `client` block declares the slice that crosses the boundary: `expose` passes top-level state fields through verbatim, and `derived` computes named projections from `{ state, resources }`. Both land under `clientData.<scope>.<name>` on the client.

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
    client: {
      expose: ["messageCount"],
      derived: {
        activePlan: (ctx) => ctx.resources.plan?.state.steps ?? [],
      },
    },
  },
});
```

**Key rules:**
- Resources are flow-level and flat — `session.resources` / `user.resources` / `org.resources` are gone
- State does not reach the client unless named in `expose` or `derived`
- `expose` and `derived` share one namespace per scope; colliding names throw at `defineFlow`
- Each `derived` compute function receives only its own scope's state and resources
- Generator context should use `contextFn()` for typed scope access
- Use `defineResource()` for portable resource reuse

### Automatic Resource Collection

Blocks declare resource dependencies via `resources` (using `defineResource()` values). When `defineFlow` is called, it collects `declaredResources` from all action blocks and merges them into the flow's `resources` map. Flow-level declarations take priority — blocks bring defaults, and the flow can override them:

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

