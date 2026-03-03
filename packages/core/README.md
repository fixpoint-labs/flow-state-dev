# @flow-state-dev/core

**The building blocks. Define handlers, generators, sequencers, routers, and flows — all with end-to-end type safety.**

This is the foundation package. Every other package depends on it. It's isomorphic — runs in Node, the browser, edge runtimes, anywhere JavaScript runs.

## What you can build

```ts
import { defineFlow, generator, handler, sequencer, router } from "@flow-state-dev/core";
import { z } from "zod";
```

**A generator that calls an LLM with tools, history, and streaming:**

```ts
const agent = generator({
  name: "agent",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [readDoc, writeDoc],
  emit: { reasoning: true, messages: true },
});
```

**A handler that validates and transforms:**

```ts
const counter = handler({
  name: "counter",
  sessionStateSchema: z.object({ count: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: 1 });
    return input;
  },
});
```

**A sequencer that composes them into a pipeline with error recovery:**

```ts
const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .then(analyzeInput)
  .thenIf((result) => result.needsContext, enrichWithContext)
  .then(agent)
  .then(counter)
  .rescue([{ when: [ModelError], block: fallback }]);
```

**A router that dispatches to different pipelines at runtime:**

```ts
const dispatch = router({
  name: "mode-router",
  routes: [chatPipeline, planPipeline, reviewPipeline],
  execute: (input, ctx) => {
    const mode = ctx.session.state.mode;
    if (mode === "plan") return planPipeline;
    if (mode === "review") return reviewPipeline;
    return chatPipeline;
  },
});
```

**A flow that ties it all together:**

```ts
export default defineFlow({
  kind: "my-app",
  requireUser: true,
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: dispatch,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({ mode: z.string().default("chat"), count: z.number().default(0) }),
    resources: { artifacts: { stateSchema: artifactSchema, writable: true } },
    projections: {
      artifactsList: {
        client: true,
        compute: (ctx) => /* derive list from resource state */,
      },
    },
  },
})({ id: "default" });
```

## Exports

### Main (`@flow-state-dev/core`)

**Block builders:**
- `handler(config)` — Synchronous/async logic block
- `generator(config)` — LLM call with framework-managed tool loop, streaming, and structured output repair
- `sequencer(config)` — Fluent composition DSL (14 methods: `then`, `thenIf`, `parallel`, `forEach`, `doUntil`, `doWhile`, `map`, `tap`, `tapIf`, `rescue`, `branch`, `work`, `waitForWork`, `loopBack`)
- `router(config)` — Runtime block selection from declared routes

**Flow:**
- `defineFlow(definition)` — Create a flow type with actions, scopes, resources, and projections

**Resources and projections:**
- `defineResource(config)` — Portable resource definition (also usable for block-level resource declarations via `sessionResources`, `userResources`, `projectResources`)
- `defineProjection(config)` — Portable projection definition
- `resource(uri)` — Resource slot reference for generators
- `projection(uri)` — Projection slot reference
- `projectionText(uri)` — Text projection for LLM context
- `projectionData(uri)` — Structured data projection
- `projectionMessages(uri)` — Message-pair projection

Inline flow projections infer resource state types from scope `resources` automatically. For portable projections (`defineProjection`), provide `sessionResourceSchemas`, `userResourceSchemas`, or `projectResourceSchemas` (as Zod schemas, `defineResource(...)` values, or maps of either) when you need typed resource access inside `compute`.

**Type helpers:**
- `StateOf<T>` — Extract state type from schema or resource
- `ContextOf<T, Kind>` — Get context handle type for scope/resource
- `ResourceContext<T>` — Resource context type
- `BlockInput<T>` / `BlockOutput<T>` — Infer block I/O types

### Types (`@flow-state-dev/core/types`)

Block, flow, resource, scope, streaming, and model type definitions. Use this subpath for type-only imports.

### Items (`@flow-state-dev/core/items`)

Output item unions, content types, and stream event helpers. Item types: `message`, `reasoning`, `component`, `context`, `status`, `state_change`, `resource_change`, `block_output`, `error`, `step_error`.

## Key design decisions

**Partial state schemas.** Each block declares only the state fields it touches. A counter block doesn't need to know about a preferences block's state. This keeps blocks reusable and self-documenting about their dependencies.

**Silent by default.** Blocks emit nothing to the client unless they explicitly call `ctx.emitMessage()`, `ctx.emitComponent()`, or `ctx.emitStatus()`. Generators are the exception — they auto-emit messages and reasoning. This gives you precise control over what the user sees.

**Automatic resource collection.** Blocks declare their resource dependencies via `sessionResources`/`userResources`/`projectResources` using `defineResource()` values. Sequencers collect these from child blocks. `defineFlow` merges them into the flow's scope configs automatically — blocks bring their own resource requirements, just like partial state schemas. Flow-level declarations take priority.

**Typed target state declarations.** Handler, generator, and router blocks can declare `targetStateSchemas` with Zod schemas. Declared names type `ctx.targets.<name>` as `StateHandle<...> | undefined` for state coordination. Use `ctx.getBlockOutput(blockDef)` / `ctx.getBlockResult(blockDef)` for explicit output dependencies.

**Projections as data policy.** Projections are the *only* way to expose data to clients. Internal state, resources, and intermediate values stay server-side unless you deliberately project them. Security by architecture, not by convention.

## Dependencies

- `zod` ^3.24.1

## Scripts

```bash
pnpm --filter @flow-state-dev/core build
pnpm --filter @flow-state-dev/core typecheck
pnpm --filter @flow-state-dev/core test
```

## Architecture reference

- [Blocks](../../docs/architecture/blocks.md) — Deep dive into all four block kinds
- [Flows and Actions](../../docs/architecture/flows-and-actions.md) — defineFlow, actions, lifecycle hooks
- [Sequencer DSL](../../docs/architecture/sequencer-dsl.md) — Full method reference for the composition DSL
- [State and Scopes](../../docs/architecture/state-and-scopes.md) — Scoped state, atomic operations, CAS
- [Resources and Projections](../../docs/architecture/resources-and-projections.md) — Data containers and derived views
