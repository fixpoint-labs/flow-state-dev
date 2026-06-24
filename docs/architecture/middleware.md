# Middleware

Middleware intercepts block execution. It uses an "around" pattern: each middleware wraps the next, with the innermost layer running the block itself. You can log, measure, transform output, enforce policies, or short-circuit execution entirely.

## Registration Layers

Three layers, composed outer-to-inner:

1. **Global** — registered at server startup via `createFlowApiRouter`. Wraps every block in every flow.
2. **Flow** — registered via `defineFlow`. Wraps every block in that flow.
3. **Block** — registered per-block in `BlockConfig`. Wraps only that block.

Global middleware runs first (outermost). Block middleware runs last (innermost, closest to execution).

```
Global → Flow → Block → execute()
```

## Writing Middleware

A middleware is an object with a `name`, an `execute` function, and an optional `filter`:

```ts
import type { Middleware } from "@flow-state-dev/core";

const timing: Middleware = {
  name: "timing",
  execute: async (ctx, next) => {
    const start = Date.now();
    const output = await next();
    console.log(`${ctx.block.name} took ${Date.now() - start}ms`);
    return output;
  },
};
```

The `execute` function receives a `MiddlewareContext` and a `next` function. Calling `next()` continues the chain. Its return value is the block output.

### MiddlewareContext

```ts
type MiddlewareContext = {
  block: { name: string; kind: BlockKind };
  input: unknown;
};
```

Server-side execution extends this with `ExecutionMetadata` and the full `ExecuteBlockContext`, but the core contract stays minimal so middleware can be defined against `@flow-state-dev/core` without a server dependency.

## Registering Middleware

### Global (server startup)

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";

const router = createFlowApiRouter({
  flows: [myFlow],
  middleware: [timing, authCheck],
});
```

### Flow-level

```ts
const myFlow = defineFlow({
  kind: "my-app",
  actions: { chat: { block: chatBlock } },
  middleware: [costTracking],
});
```

### Block-level

```ts
const myBlock = defineHandler({
  name: "my-block",
  middleware: [inputSanitizer],
  execute: async (input, ctx) => { /* ... */ },
});
```

## Filtering

A middleware can declare which blocks it applies to. Blocks that don't match the filter skip the middleware entirely.

```ts
const generatorOnly: Middleware = {
  name: "generator-metrics",
  filter: (block) => block.kind === "generator",
  execute: async (ctx, next) => {
    const output = await next();
    recordGeneratorMetrics(ctx.block.name, output);
    return output;
  },
};
```

The `filter` predicate receives `{ name, kind }` and returns a boolean. If `filter` is omitted, the middleware applies to all blocks.

## Output Transformation

Middleware can transform the block output before returning it:

```ts
const redact: Middleware = {
  name: "redact-pii",
  execute: async (ctx, next) => {
    const output = await next();
    return removePII(output);
  },
};
```

## Short-Circuiting

A middleware can skip execution by not calling `next()`:

```ts
const rateLimiter: Middleware = {
  name: "rate-limiter",
  execute: async (ctx, next) => {
    if (isOverLimit(ctx)) {
      return { error: "rate limited" };
    }
    return next();
  },
};
```

## Error Handling

Errors thrown by the block (or downstream middleware) propagate through the chain. Middleware can catch and handle them:

```ts
const errorBoundary: Middleware = {
  name: "error-boundary",
  execute: async (ctx, next) => {
    try {
      return await next();
    } catch (err) {
      reportError(err);
      throw err; // re-throw to let the framework handle it
    }
  },
};
```

## Guards

Calling `next()` more than once throws an error. This prevents accidental double-execution:

```
Error: Middleware "my-middleware" called next() multiple times
```

## Retry Interaction

Middleware runs on every retry attempt. If a block is retried 3 times, middleware wrapping that block executes 3 times. This is intentional — it lets middleware observe and act on each attempt independently.

## Composition Order

When all three layers are present, the execution order is:

```
global-before → flow-before → block-before → execute → block-after → flow-after → global-after
```

Within each layer, middleware runs in array order (first element is outermost).

## Package Placement

| Artifact | Package |
|----------|---------|
| `Middleware`, `MiddlewareFn`, `MiddlewareContext` types | `@flow-state-dev/core` |
| `composeMiddleware()`, `mergeMiddlewareStacks()` | `@flow-state-dev/engine` |

The types live in core so middleware definitions don't need a server dependency. Composition and execution are server-only.

## Canonical Authority

For full type signatures and composition logic, see `packages/core/src/types/middleware.ts` and `packages/engine/src/middleware/compose.ts`.
