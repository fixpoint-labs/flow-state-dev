# Internal Execution Seams

**There is no block middleware.** A public middleware contract (global/flow/block tiers, `filter`, short-circuit) shipped early with zero consumers anywhere in `packages/`, `apps/` or `labs/`, and was retracted along with the internal composition seam it fed. This page records that decision so it isn't re-litigated.

- `middleware` is rejected, not ignored: passing it to `createFlowState`, `defineFlow` (definition or instance call) or a block factory **throws at construction**, which also catches JS callers and type-bypassing TS callers.
- Every use case has a better home: timing/logging → action `onCompleted`/`onErrored` or a `logger`; observability → `block_trace` / `TraceStore`; transformation → `.tap()` or handler logic; auth/policy → the HTTP layer; rate limiting/short-circuit → router branching or handler guards; error reporting → `errorCapture`; cross-cutting behaviour → capabilities. A third "how do I wrap a block?" answer would only compete with these.
- If a genuinely framework-owned around-execution need lands (likely candidates: durability checkpointing as a wrapper, a token/cost guardrail on generator calls), reintroduce it as **one narrow interceptor scoped to generators**, against a real first consumer. Not a resurrected registration API.

## What exists

`InternalExecutionSeams` (`packages/engine/src/execution/internal/seams.ts`): `interceptBlockInput`, `interceptBlockOutput`, `interceptNormalizedError`, `onGeneratorLifecycle`, `onActionLifecycle`. Populated only by engine-internal wiring (route handlers pass `NOOP_INTERNAL_ROUTE_SEAMS` by default); never surfaced on an author-facing option or on `core`'s or `engine`'s public exports.
