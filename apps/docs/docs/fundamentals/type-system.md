---
sidebar_position: 6
---

# Type System

Most TypeScript frameworks ask you to manage types alongside your code — writing interfaces, casting generics, wiring type parameters through layers. flow-state.dev takes a different approach: **you write a Zod schema, and the framework infers everything from it.** Input types, output types, state types, resource types, context types — all derived automatically, all the way through.

The goal is to minimize type gymnastics. Your code should be easy to read and reason about, not cluttered with manual type annotations.

## Schema in, types out

When you provide a schema to a block, the framework uses `z.infer<>` to extract TypeScript types and thread them through the entire API surface:

```ts
const processOrder = handler({
  name: "process-order",
  inputSchema: z.object({ orderId: z.string(), quantity: z.number() }),
  outputSchema: z.object({ total: z.number(), confirmed: z.boolean() }),
  sessionStateSchema: z.object({ orderCount: z.number().default(0) }),

  execute: async (input, ctx) => {
    // input is typed as { orderId: string; quantity: number }
    // ctx.session.state is typed as { orderCount: number }
    await ctx.session.incState({ orderCount: 1 });

    // Return type must match outputSchema — { total: number; confirmed: boolean }
    return { total: input.quantity * 9.99, confirmed: true };
  },
});
```

You didn't write a single type annotation. The Zod schemas are the single source of truth — they define the runtime validation AND the compile-time types. If you return the wrong shape from `execute`, TypeScript catches it. If you access a state field that doesn't exist, TypeScript catches it.

## Types flow through sequencers

The sequencer DSL tracks types through the chain. Each `.then()` captures the output schema of the current step and threads it as the input type of the next:

```ts
const pipeline = sequencer({ name: "pipeline" })
  .then(parseInput)        // output: { query: string, filters: Filter[] }
  .then(searchDocs)        // input: ↑ that type. output: SearchResult[]
  .then(rankResults)       // input: SearchResult[]. output: RankedResult[]
  .map((results) =>        // results is typed as RankedResult[]
    results.slice(0, 10)
  );
// pipeline output type: RankedResult[]
```

If `searchDocs` expects a different input shape than what `parseInput` produces, TypeScript flags it immediately. The fix is a connector — a one-line transform function between steps:

```ts
.then(
  (output) => ({ query: output.query, limit: 10 }),  // connector
  searchDocs
)
```

The connector's return type must match `searchDocs`'s input schema. TypeScript enforces this at compile time.

## Parallel steps produce typed objects

When you use `.parallel()`, the output is a typed object with a key for each named step:

```ts
const enriched = sequencer({ name: "enrich" })
  .then(parseQuery)
  .parallel({
    web: searchWeb,         // output: WebResult[]
    docs: searchDocs,       // output: DocResult[]
    memory: searchMemory,   // output: MemoryResult[]
  })
  // output type: { web: WebResult[], docs: DocResult[], memory: MemoryResult[] }
  .then((results) => {
    // results.web, results.docs, results.memory — all typed
    return merge(results.web, results.docs, results.memory);
  });
```

## State and resources are typed per-block

Each block declares only the state it needs, and the context is typed accordingly. A block that declares `sessionStateSchema` gets a `ctx.session.state` typed to exactly those fields — nothing more:

```ts
const analytics = handler({
  name: "analytics",
  sessionStateSchema: z.object({
    eventCount: z.number().default(0),
    lastEventAt: z.number().optional(),
  }),
  execute: async (_input, ctx) => {
    ctx.session.state.eventCount;    // number — typed
    ctx.session.state.lastEventAt;   // number | undefined — typed
    ctx.session.state.somethingElse; // TypeScript error — not in schema

    await ctx.session.patchState({ lastEventAt: Date.now() });
  },
});
```

The same applies to resources. Declare a resource schema and `ctx.session.resources` is typed with the correct handles:

```ts
const docReader = handler({
  name: "doc-reader",
  sessionResourceSchemas: z.object({
    documents: z.object({
      stateSchema: z.object({
        byId: z.record(z.object({ title: z.string(), content: z.string() })),
      }),
    }),
  }),
  execute: async (input, ctx) => {
    // ctx.session.resources.documents.state.byId — fully typed
    const doc = ctx.session.resources.documents.state.byId["doc-1"];
    return doc.content; // string
  },
});
```

## Capability-declared schemas

Capabilities can declare schemas alongside their resources and helpers. When a block lists a capability in `uses`, those schemas are reflected into the block's `ctx` types at factory time — no re-declaration on the block is needed.

The four axes: `sessionStateSchema`, `sessionResources` (resource handles), `targetStateSchemas`, and `sequencerStateSchema` (for sequencer presets). Each merges with anything the block itself declares; the block's own keys win on collision.

```ts
import { defineCapability, handler } from "@flow-state-dev/core";
import { z } from "zod";

const marketCapability = defineCapability({
  name: "market",
  sessionStateSchema: z.object({
    ticker: z.string(),
    lastPrice: z.number().nullable(),
  }),
});

const priceLogger = handler({
  name: "price-logger",
  uses: [marketCapability],
  execute: async (_input, ctx) => {
    // ctx.session.state.ticker — string
    // ctx.session.state.lastPrice — number | null
    // Both typed from the capability. No sessionStateSchema on this handler.
    const ticker = ctx.session.state.ticker;
  },
});
```

Two constraints to know. First, this is **direct-only**: if a capability internally `uses` another, the inner capability's schemas do not flow to the consuming block. Each layer exposes only what it declares directly. Second, **dynamic `uses` entries** (functions that return capability arrays at runtime) contribute nothing to types — only static `CapabilityRef` entries are reflected.

For the full discussion of capability type flow, see [Type inference from capability declarations](/docs/fundamentals/capabilities#type-inference-from-capability-declarations).

## Generators infer tool types

When you pass blocks as tools to a generator, the framework compiles their schemas into the model's tool format automatically. The tool's `inputSchema` becomes the function parameters the model sees, and the `outputSchema` types the result fed back into the conversation:

```ts
const search = handler({
  name: "search",
  inputSchema: z.object({ query: z.string(), limit: z.number().default(5) }),
  outputSchema: z.array(z.object({ title: z.string(), url: z.string() })),
  execute: async (input) => { /* ... */ },
});

const agent = generator({
  name: "agent",
  tools: [search], // schema is compiled to model tool format automatically
  // ...
});
```

No manual tool definition objects. No duplicating parameter schemas. The block IS the tool.

## Flow-level inference

At the flow level, `defineFlow` infers state types from scope configurations and makes them available to the `client` block:

```ts
const myFlow = defineFlow({
  kind: "my-app",
  session: {
    stateSchema: z.object({ mode: z.string(), count: z.number() }),
    resources: {
      docs: { stateSchema: z.object({ byId: z.record(docSchema) }) },
    },
    client: {
      derived: {
        summary: (ctx) => {
          // ctx.state — typed as { mode: string; count: number }
          // ctx.resources.docs.state.byId — typed as Record<string, Doc>
          return { mode: ctx.state.mode, docCount: Object.keys(ctx.resources.docs.state.byId).length };
        },
      },
    },
  },
  // ...
});
```

## What you don't have to write

Here's what the framework infers so you don't have to:

| You provide | Framework infers |
|-------------|-----------------|
| `inputSchema` | `execute(input)` parameter type |
| `outputSchema` | `execute()` return type |
| `sessionStateSchema` | `ctx.session.state` type |
| `userStateSchema` | `ctx.user.state` type |
| `sessionResourceSchemas` | `ctx.session.resources.*` handle types |
| `sessionResources` (with `defineResource`) | `BlockDefinition.declaredResources` + automatic flow merge |
| Block in `.then()` | Next step's input type |
| Block in `tools` | Model tool parameters and result type |
| Scope `stateSchema` in flow | `client.derived` compute function types |
| Capability `sessionStateSchema` (via `uses`) | `ctx.session.state` (merged with block's own) |
| Capability `sessionResources` (via `uses`) | `ctx.session.resources.*` (merged with block's own) |
| Capability `targetStateSchemas` (via `uses`) | `ctx.targets.*` (merged with block's own) |
| Capability `sequencerStateSchema` preset (via `uses`) | `ctx.sequencer.state` (merged with block's own) |

The pattern is always the same: **Zod schema in, TypeScript types out.** One source of truth. No drift between runtime validation and compile-time checking.

## Extracting types when you need them

In most cases you never need to think about types — you write schemas, and `execute` just works. But sometimes you need a block's inferred type outside of the block itself — maybe for a utility function, a shared interface, or a connector. The framework exports type helpers so you never have to manage types manually:

```ts
import { type BlockInput, type BlockOutput, type StateOf } from "@flow-state-dev/core";

const search = handler({
  name: "search",
  inputSchema: z.object({ query: z.string(), limit: z.number() }),
  outputSchema: z.array(z.object({ title: z.string(), url: z.string() })),
  sessionStateSchema: z.object({ searchCount: z.number().default(0) }),
  execute: async (input, ctx) => { /* ... */ },
});

// Extract types directly from the block — no duplication
type SearchInput = BlockInput<typeof search>;    // { query: string; limit: number }
type SearchOutput = BlockOutput<typeof search>;  // { title: string; url: string }[]
```

For state and resource schemas:

```ts
import { type StateOf, type ContextOf } from "@flow-state-dev/core";

const docResource = defineResource({
  stateSchema: z.object({
    byId: z.record(z.object({ title: z.string(), content: z.string() })),
  }),
});

type DocState = StateOf<typeof docResource>;  // { byId: Record<string, { title: string; content: string }> }
```

### Available type helpers

| Helper | Extracts |
|--------|----------|
| `BlockInput<typeof block>` | Inferred input type from `inputSchema` |
| `BlockOutput<typeof block>` | Inferred output type from `outputSchema` |
| `StateOf<T>` | State type from a schema, resource, or scope config |
| `ContextOf<T, Kind>` | Context handle type for a scope or resource |
| `ResourceContext<T>` | Resource context type |
| `BlockDefinition` | The block interface itself — return type of `handler()`, `generator()`, `sequencer()`, and `router()`. Use when an app-level factory needs to accept or return "any block" without restating the framework's generics. |
| `BlockKind` | `"handler" \| "generator" \| "sequencer" \| "router"` — the discriminant on `block.kind`. |
| `BlockContext` | The full block-context interface — what `ctx` resolves to inside `execute`. |
| `BlockResult<TOutput>` | The handler `execute` return-value union. |
| `SessionScopeHandle<TState>` | The shape of `ctx.session` — typed `state`, `patchState`, `setStateRecord`, etc. `UserScopeHandle`, `OrgScopeHandle`, and `RequestScopeHandle` are siblings for the other scopes. |
| `ScopeStateOps<TState>` | The state-mutation interface every scope handle exposes (`patchState`, `setState`, `incState`, `setStateRecord`, `deleteStateRecord`, `atomicState`). |
| `LooseBlockContext<TSessionState>` | Variance-friendly alias for `BlockContext` — typed on session, permissive on resources. Use for helper functions that take a block's `ctx` as a parameter. |

The `*Input` / `*Output` / `StateOf` helpers use `typeof` on your existing definitions — the block or resource is the single source of truth, and you derive types from it rather than maintaining them separately. The block-shape and scope-handle types are useful when *writing* factories: they let you type "any block" or "a ctx slice with a typed session" structurally, instead of falling back to `any` or hand-rolling `{ session: { patchState: ... } }` shapes.

### When to reach for `LooseBlockContext`

The full `BlockContext<...>` is invariant on its `TResources` parameter. That means a handler whose `ctx.resources` is inferred as the narrow `ResourceRegistry<{ memos: ... }>` (from `resources: memoResources` in the block config) **can't be assigned** to a parameter typed `BlockContext<unknown, MyState>` (whose default `ResourceRegistry<Record<string, AnyResourceRef>>` isn't a supertype of the narrow inferred form).

This bites whenever you pull `ctx` into a helper:

```ts
// Won't compile — variance trap on TResources
async function publishMemo(ctx: BlockContext<unknown, MySessionState>, ...) {}

handler({
  resources: { memos: memosCollection },
  execute: async (input, ctx) => {
    await publishMemo(ctx, ...); // Error: TResources mismatch
  },
});
```

`LooseBlockContext<TSessionState>` solves it by leaving `resources` permissive (`any`):

```ts
import type { LooseBlockContext } from "@flow-state-dev/core";

async function publishMemo(ctx: LooseBlockContext<MySessionState>, ...) {
  // ctx.session.state is typed Readonly<MySessionState>
  // ctx.resources is `any` — narrow at the call site if needed
}
```

Use `LooseBlockContext` when your helper only touches `ctx.session` (or doesn't care about resource typing). Use a hand-typed slice (`{ session: SessionScopeHandle<MySessionState>; resources: { memos: ... } }`) when the helper needs typed resources.

### Sharing config across handlers with `handler.withDefaults`

When a family of handlers shares config (same `sessionStateSchema`, same declared `resources`, same `outputSchema`), `handler.withDefaults` lets each handler omit the shared fields:

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const memoHandler = handler.withDefaults({
  sessionStateSchema,
  resources: { memos: memosCollection },
  outputSchema: z.void(),
});

export const commitBullMemo = memoHandler({
  name: "commit-memo-p2-bull",
  inputSchema: bullThesisSchema,
  execute: async (thesis, ctx) => {
    // ctx is typed from the defaults — session.state is MySessionState,
    // resources.memos is the typed collection ref.
    await ctx.resources.memos.get("p2/bull").patchState({ ... });
  },
});
```

Per-call overrides win — pass any defaulted field again to replace it (e.g. `outputSchema: z.object({...})` when one handler needs a non-void return).

Defaultable: `sessionStateSchema`, `userStateSchema`, `orgStateSchema`, `requestStateSchema`, `sequencerStateSchema`, `resources`, `outputSchema`, `uses`. Excluded: `name`, `inputSchema`, `execute`, `description` (those vary per block).

This is the framework's "scaffolding-only sharing" tool. For "body sharing" (the same execute body parameterized by identity), write a factory function. For "shared logic called from unique bodies," extract a helper function and use `LooseBlockContext` to type its `ctx` parameter.
