# Internal Execution Seams

Block middleware is not a public extension point. The engine keeps two
framework-internal ways to observe or wrap block execution — the
`InternalExecutionSeams` hooks and an internal middleware compose seam — but
neither is registerable by flow or block authors. App authors reach for
lifecycle hooks, `.tap()`, capabilities, or the trace system instead.

An "execution seam" here means a hook point the runtime exposes around block
dispatch that only framework code (not flow/block config) can populate.

**Prerequisites:** [Execution and Errors](./execution-and-errors.md).

## Why middleware is not public

A public middleware contract shipped early during Phase 1 with three
registration tiers (global, flow, block), a `filter`, short-circuit, and a
published doc — and zero consumers. Every problem it was meant to solve is
handled better elsewhere:

- **Timing / logging** → action lifecycle hooks (`onCompleted` / `onErrored`)
  or a structured `logger`.
- **Observability** → the first-class `block_trace` / `TraceStore` system.
- **Caching** → tool-layer modules keyed on the tool's typed schema, with no
  framework coupling.
- **Cross-cutting behavior** → capabilities, sequencer composition, `.tap()`.

Carrying an unconsumed public API is a third "how do I wrap a block?" answer
alongside those, so it was retracted. The interception *point* is cheap to keep
and is the real readiness asset for a future designed public contract.

## Internal execution seams

`InternalExecutionSeams` (`packages/engine/src/execution/internal/seams.ts`)
exposes optional hooks the runtime applies around block dispatch:

- `interceptBlockInput` / `interceptBlockOutput` — transform input/output.
- `interceptNormalizedError` — rewrite a normalized `FlowError`.
- `onGeneratorLifecycle` / `onActionLifecycle` — observe lifecycle stages.

These are set by engine-internal wiring only (e.g. the route handlers pass
`NOOP_INTERNAL_ROUTE_SEAMS` by default). They are not surfaced on any
author-facing option.

```ts
// Engine-internal only — not a public API.
const seams: InternalExecutionSeams = {
  interceptBlockOutput: (output, metadata) => {
    // observe or transform; return void to leave output unchanged
  }
};
```

## Internal middleware compose

The engine retains `composeMiddleware` (`packages/engine/src/middleware/`) and
the `executeBlock` wrapping point. A middleware stack is fed **only** through
`RuntimeConfig.middleware`, set by framework code constructing a `RuntimeConfig`
directly — there is no `middleware:` option on `defineFlow`, block builders, or
`createFlowApiRouter` (and `createRuntimeConfig` deliberately drops any flat
`middleware` field, so a stale `as any` router option cannot smuggle a stack
in). `runAction` forwards `runtimeConfig.middleware` to `executeBlock`, which
composes it around block execution and runs it on every retry attempt.

Why this coexists with `InternalExecutionSeams`: the seam hooks transform input
and output as separate single-purpose functions that always proceed to the
block. The compose seam is the only one that wraps the call as one unit —
`around`/short-circuit control flow (a middleware may skip `next()` and return
without running the block) plus a per-block `filter`. Keep the input/output
hooks for observation and transformation; the compose seam is for
around-execution control.

This seam is dormant: no production code feeds a non-empty stack today. It is
kept for framework-owned instrumentation (e.g. a future durability middleware).
Note the intended re-entry shape: when a real cross-cutting consumer appears
(most likely a token/cost-budget guardrail), expose it as a **single narrow
guardrail/interceptor capability** scoped to generators against this internal
seam — not a resurrected global/flow/block registration API.

## What app authors use instead

| Former middleware use case | Public alternative |
|----------------------------|--------------------|
| Timing / logging around blocks | Action `onCompleted` / `onErrored`, structured `logger` |
| Per-generator metrics | `block_trace` / `TraceStore` |
| Input/output transformation | `.tap()` on sequencers, handler logic |
| Auth / policy gating | HTTP-layer authentication |
| Rate limiting / short-circuit | Router branching, handler guards |
| Error reporting | `errorCapture` sink, `onErrored` hooks |

## Package placement

| Artifact | Location |
|----------|----------|
| `Middleware`, `MiddlewareFn`, `MiddlewareContext`, `BlockMiddlewareContext` | `packages/engine/src/middleware/types.ts` (engine-internal) |
| `composeMiddleware` | `packages/engine/src/middleware/compose.ts` (engine-internal) |
| `InternalExecutionSeams` | `packages/engine/src/execution/internal/seams.ts` |
| `RuntimeConfig.middleware` | `packages/engine/src/runtime-config.ts` |

Nothing middleware-related is exported from `@flow-state-dev/core`'s public
surface, and nothing is re-exported from the `@flow-state-dev/engine` package
root.

See also: [Execution and Errors](./execution-and-errors.md).
