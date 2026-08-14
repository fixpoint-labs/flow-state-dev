// The sequencer dispatch kernel. Every sequencer DSL method that runs one child
// block — sequentially (`step`, `stepIf`), per branch (`branch`, `stepAny`,
// `race`, `parallel`, `stepAll`, `forEach`), or per loop iteration (`doUntil`,
// `doWhile`) — shares the same skeleton: apply the connector, stash the child's
// input descriptor, run the block at a caller-derived path, then resolve a `ref`
// descriptor pointing at the child's emitted trace. `runChild` is that skeleton.
// `runSideChain` is the fire-and-forget analogue used by `sideChain` / `sideChainIf`.
//
// The primitives wrap `executeBlock` and the hint/descriptor helpers that live
// in `sequencer.ts`; importing them back here forms a module cycle that is safe
// because every cross-reference is a hoisted function declaration (resolved
// during instantiation, before any module body runs).
//
// Bookkeeping note: `runChild` takes an explicit `inputHint` and does NOT mutate
// `runtime.lastChildPath` / `lastChildInputHint`. The caller owns that. This is
// deliberate — branch and multi-candidate dispatchers (`parallel`, `stepAll`,
// `forEach`, `stepAny`, `race`) capture one shared hint before fanning out and
// must not let a per-branch dispatch rewrite the running chain pointer (under
// concurrency that pointer would be nondeterministic; for `stepAny` a failed
// first candidate would corrupt the retry's input source).
import type {
  BlockContext,
  BlockDefinition,
  BlockOutputHint,
  ConnectorFn
} from "../../types/block";
import type { BlockValueInternal } from "../../items/types";
import type { SequencerRuntimeState } from "../sequencer-methods";
import {
  sideChainTaskCtx,
  composeSideChainSignal,
  dispatchSideChainTask,
  executeBlock,
  refDescriptorForPath,
  sequentialInputHint,
  stashInputHint
} from "../sequencer";

/** A resolved child to dispatch: a concrete block and an optional connector. */
export type ChildDispatch = {
  block: BlockDefinition<any, any>;
  connector?: ConnectorFn<any, any>;
};

/** Outcome of a single-child dispatch: the child's value and its `ref` (or `inline`) descriptor. */
export type RunChildResult = {
  value: unknown;
  descriptor: BlockOutputHint;
};

/**
 * Run one child block and resolve its output descriptor.
 *
 * Applies `shape.connector` to `input` (if present), stashes `inputHint` as the
 * child's input-source descriptor, executes the block at `path`, and returns the
 * child's value alongside a `ref` descriptor pointing at its emitted trace
 * (falling back to `inline` in unit-test contexts with no trace emitter).
 *
 * Does not touch `runtime` bookkeeping — see the file header.
 *
 * `extraSignal` (FIX-1005) runs the child — and its whole descendant tree —
 * under an **additional** abort signal, composed with the request's rather
 * than replacing it. Three assignments are needed and none is sufficient
 * alone:
 *
 * - the spread gives the child's own `ctx.signal` the composed signal (the
 *   only path that exists in a unit-test context);
 * - `signalOverride` carries it into the server-installed execution scope so
 *   every descendant's `ctx.signal` sees it too;
 * - `_requestSideChainSignal` carries it into the subtree's BACKGROUND
 *   dispatches, which read that field instead of `ctx.signal` and would
 *   otherwise drop the extra signal entirely (see
 *   {@link composeSideChainSignal}).
 *
 * The third is the one that is easy to miss, and it is where the un-cancelled
 * work is most expensive: `.sideChain()` generators keep calling models long after
 * the foreground steps have stopped.
 */
export async function runChild(
  ctx: BlockContext,
  shape: ChildDispatch,
  path: string,
  input: unknown,
  inputHint: BlockValueInternal<unknown>,
  extraSignal?: AbortSignal
): Promise<RunChildResult> {
  if (extraSignal === undefined) {
    const childInput = shape.connector ? await shape.connector(input, ctx) : input;
    stashInputHint(ctx, inputHint);
    const value = await executeBlock(shape.block, childInput, ctx, path);
    return { value, descriptor: refDescriptorForPath(ctx, path) };
  }
  const composed =
    ctx.signal === undefined ? extraSignal : AbortSignal.any([ctx.signal, extraSignal]);
  const background = composeSideChainSignal(ctx, extraSignal);
  // Set on the copy for the unit-test path (no execution scope: the child runs
  // on this very object), AND threaded as an override for the server path,
  // where `_withExecutionScope` is a closure bound to the original context and
  // cannot see a field written on a copy.
  const childCtx = { ...ctx, signal: composed } as BlockContext;
  if (background !== undefined) {
    (childCtx as { _requestSideChainSignal?: AbortSignal })._requestSideChainSignal =
      background;
  }
  // The connector runs under the composed context too. It is part of the step's
  // dispatch — the documented promise is that the step runs under either signal,
  // and a connector is not exempt from it. An async connector handed the
  // original context would keep running after the extra signal fired, or block
  // forever on a signal that was already aborted before the step began.
  //
  // The hint is stashed on `childCtx` rather than on `ctx` because that is the
  // context `executeBlock` reads and clears it from; stashing on the original
  // and copying it forward would leave a consumed hint behind for a later
  // sibling to pick up.
  const childInput = shape.connector ? await shape.connector(input, childCtx) : input;
  stashInputHint(childCtx, inputHint);
  const value = await executeBlock(shape.block, childInput, childCtx, path, {
    signalOverride: composed,
    ...(background !== undefined ? { sideChainSignalOverride: background } : {}),
  });
  return { value, descriptor: refDescriptorForPath(ctx, path) };
}

/** Outcome of a background dispatch: the pass-through value (the sequencer's input is unchanged). */
export type RunSideChainResult = {
  value: unknown;
};

/**
 * Dispatch one child block as fire-and-forget background work.
 *
 * Applies the connector, stashes the sequential input hint, runs the block in
 * the `"work"` phase under the background signal (so the task tree survives
 * transport teardown — FIX-663), and registers the in-flight promise with the
 * work pool via `dispatchSideChainTask`. Returns the upstream value unchanged;
 * background dispatch never rewrites the running output descriptor.
 */
export async function runSideChain(
  ctx: BlockContext,
  runtime: SequencerRuntimeState,
  shape: ChildDispatch,
  path: string,
  input: unknown,
  taskName: string
): Promise<RunSideChainResult> {
  const childInput = shape.connector ? await shape.connector(input, ctx) : input;
  stashInputHint(ctx, sequentialInputHint(ctx, runtime));
  const { taskCtx, signalOverride } = sideChainTaskCtx(ctx);
  const rawPromise = executeBlock(shape.block, childInput, taskCtx, path, {
    phase: "sideChain",
    signalOverride
  });
  dispatchSideChainTask(ctx, runtime, taskName, rawPromise);
  return { value: input };
}
