# Internal Execution Seams

Block execution has one framework-internal interception mechanism — the
`InternalExecutionSeams` hooks — and it is not registerable by flow or block
authors. There is no block-middleware system; that public contract was retracted
and the internal composition seam removed with it. App authors reach for
lifecycle hooks, `.tap()`, capabilities, or the trace system instead.

An "execution seam" here means a hook point the runtime exposes around block
dispatch that only framework code (not flow/block config) can populate.

**Prerequisites:** [Execution and Errors](./execution-and-errors.md).

## Removed `middleware` option

`middleware` is not a supported configuration property. Passing it to
`createFlowState(...)`, a `defineFlow(...)` definition or instance call, or a
block factory throws synchronously at construction time. This also protects
JavaScript callers and TypeScript callers that bypass static checking: the
property is rejected rather than ignored.

Move authentication and policy checks to the HTTP layer or explicit block
logic. For other former middleware use cases, use the public alternatives
listed below.

## Why there's no block middleware

A public middleware contract shipped early during Phase 1 with three
registration tiers (global, flow, block), a `filter`, short-circuit, and a
published doc — and zero consumers anywhere in `packages/`, `apps/`, or `labs/`.
Every problem it was meant to solve is handled better elsewhere:

- **Timing / logging** → action lifecycle hooks (`onCompleted` / `onErrored`)
  or a structured `logger`.
- **Observability** → the first-class `block_trace` / `TraceStore` system.
- **Caching** → tool-layer modules keyed on the tool's typed schema, with no
  framework coupling.
- **Cross-cutting behavior** → capabilities, sequencer composition, `.tap()`.

Carrying an unconsumed public API is a third "how do I wrap a block?" answer
alongside those, so it was retracted. The dormant internal composition seam it
fed had no consumer either, so it was removed too rather than kept as
speculative surface.

If a genuinely framework-owned, around-execution need lands later — the likely
candidates are durability checkpointing-as-a-wrapper or a token/cost-budget
guardrail on generator calls — reintroduce it as a **single narrow
guardrail/interceptor capability** scoped to generators, not a resurrected
global/flow/block registration API. That is a bounded, documented change against
a real first consumer.

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
| `InternalExecutionSeams` | `packages/engine/src/execution/internal/seams.ts` |

Nothing middleware-related exists on `@flow-state-dev/core`'s or
`@flow-state-dev/engine`'s public surface, and the engine no longer carries a
middleware composition seam internally.

See also: [Execution and Errors](./execution-and-errors.md).
