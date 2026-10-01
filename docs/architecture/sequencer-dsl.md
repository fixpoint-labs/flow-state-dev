# Sequencer DSL

The method reference is user-facing: [Control Flow Reference](../../apps/docs/docs/sequencers/control-flow.md), [Composing Blocks](../../apps/docs/docs/sequencers/composing-blocks.md), [Side Chains](../../apps/docs/docs/advanced/sequencer-side-chains.md), [Sequencer State](../../apps/docs/docs/advanced/sequencer-state.md). Trace value kinds per method are in [Blocks](./blocks.md#sequencer-trace-values). This page holds the semantics that aren't obvious from the signatures.

## Per-step options: `abortSignal` and `onSettled`

`.step()` / `.stepIf()` take a trailing bag. The sequencer owns these because it's what dispatches the step: a statically composed child can't be handed a signal that only exists at runtime, and no other seam carries one (`.sideChain()` takes none).

- **`abortSignal: (ctx) => AbortSignal | undefined`** is resolved per dispatch and **composed** with the request's signal, never substituted, so a step can't outlive a cancelled request. It reaches the whole descendant tree.
- **`onSettled(ctx, outcome)`** fires once on every exit with `"returned" | "threw" | "suspended"`, in a `finally` (it can't change the outcome). It's not called when nothing was dispatched (a skipped `stepIf`, or a child injected from the replay log).
  - **Suspension is why it exists.** `.rescue()` never runs for `SuspensionError`, and a suspended request doesn't abort its signal, so a step parked on `ctx.suspend()` passes no handler you can compose. Without the hook, whatever an earlier step started outlives the request.
  - **It fires before downstream steps**, so on `"returned"`/`"threw"` a recorder or `.rescue()` downstream usually still needs what you'd release. The normal shape is: release on `"suspended"`, let downstream release the rest.

## Identity in loops

Steps re-run by `loopBack` get a `loop[N]` path segment (as `doUntil`/`doWhile` bodies get `iter[N]`), so each iteration has distinct `blockInstanceId`s while the looping sequencer's own identity is stable. Generation 0 (first pass and after exit) has no segment, so non-looping paths are unchanged. `loopBack` is always bounded by `maxIterations`.

## Background work lifetime

`.sideChain()`, `.sideChainIf()` and `.forEachSideChain()` queue onto **one per-request pool**, not the dispatching sequencer, so inner sequencers never block on their own background work and `exitIf` leaves queued work running.

- Work queued before the terminal hooks is drained to quiescence before terminal status, on every terminal path; the SSE stream stays open until then.
- Work queued from `onFinished`/`onErrored` is drained after the final event, before the run counts as finished and before its id can be freed; the stream may already be closed.
- A suspended request reaches none of this ([Execution and Errors](./execution-and-errors.md#background-work-under-replay-locked)).
- As tasks settle the executor emits a `status` with `blocked: false` and `sideChainTasks: N`; clients use `blocked` to accept new input (`isFinishing`).
- **`.waitForSideChain()` drains by sequencer-instance scope**: only work *this* instance dispatched. It's the explicit barrier when a later step reads state a queued task mutates. `failOnError: true` is drain-then-throw.
- `forEachSideChain` passes its input through unchanged, isolates per-iteration failures, and defaults to `concurrency: 16`. A `sideChainIf` condition is evaluated once per execution with the full `BlockContext`; when falsy, its connector never runs.

## Resource collection

Every block-accepting method merges that block's `declaredResources` into the sequencer's, and nested sequencers bubble theirs up. Two different `defineResource()` references under one name throw at build; the same reference is fine.

## Output schema

Two schemas coexist: `config.outputSchema` (declared contract, optional) and `lastOutputSchema` (inferred from the tail as the chain builds). `inputSchema` defaults to the first block's.

- **One runtime gate.** `wrapWithOutputValidation` wraps `runSequencerOperations`, so the declared schema is checked once at the sequencer boundary, covering the natural tail, `exitIf` and `rescue` exits alike. Failure throws `SequencerOutputSchemaError` (non-retryable, rescuable). Success returns `result.data`, so `.transform()` output is what leaves. No declared schema → zero cost.
- **`.validate()` is a shallow build-time check** comparing declared vs inferred one level deep (zod kind, object keys, one level of value kinds, array element kind; reference equality short-circuits). It throws `SequencerSchemaMismatchError`. It is terminal (returns `void`), and it has blind spots:
  - no recursion into nested shapes, refinements, brands or union variants;
  - `.transform()`/`.refine()` surface as `ZodEffects`, so a wrapped schema vs a plain one reports a kind mismatch instead of comparing inner shapes;
  - `stepIf`'s false path and `branch`'s non-first branches can widen the real shape beyond `lastOutputSchema` (false pass);
  - `stepAny`, `race`, `stepAll` and `branch` erase `lastOutputSchema`, after which `.validate()` no-ops. The runtime gate still catches a real mismatch.
