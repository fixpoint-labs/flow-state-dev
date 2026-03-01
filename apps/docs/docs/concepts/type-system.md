---
sidebar_position: 7
---

# Type System

Most TypeScript frameworks ask you to manage types alongside your code — writing interfaces, casting generics, wiring type parameters through layers. Flow State Dev takes a different approach: **you write a Zod schema, and the framework infers everything from it.** Input types, output types, state types, resource types, context types — all derived automatically, all the way through.

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
  execute: async (input, ctx) => {
    ctx.session.state.eventCount;    // number — typed
    ctx.session.state.lastEventAt;   // number | undefined — typed
    ctx.session.state.somethingElse; // TypeScript error — not in schema

    await ctx.session.patchState({ lastEventAt: Date.now() });
    return input;
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

At the flow level, `defineFlow` infers state types from scope configurations and makes them available to projections:

```ts
const myFlow = defineFlow({
  kind: "my-app",
  session: {
    stateSchema: z.object({ mode: z.string(), count: z.number() }),
    resources: {
      docs: { stateSchema: z.object({ byId: z.record(docSchema) }) },
    },
    projections: {
      summary: {
        client: true,
        compute: (ctx) => {
          // ctx.session.state — typed as { mode: string; count: number }
          // ctx.session.resources.docs.state.byId — typed as Record<string, Doc>
          return { mode: ctx.session.state.mode, docCount: Object.keys(ctx.session.resources.docs.state.byId).length };
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
| Block in `.then()` | Next step's input type |
| Block in `tools` | Model tool parameters and result type |
| Scope `stateSchema` in flow | Projection `compute(ctx)` types |

The pattern is always the same: **Zod schema in, TypeScript types out.** One source of truth. No drift between runtime validation and compile-time checking.
