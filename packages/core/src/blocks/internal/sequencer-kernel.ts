// The sequencer dispatch kernel. Every sequencer DSL method that runs one child
// block — sequentially (`step`, `stepIf`), per branch (`branch`, `stepAny`,
// `race`, `parallel`, `stepAll`, `forEach`), or per loop iteration (`doUntil`,
// `doWhile`) — shares the same skeleton: apply the connector, stash the child's
// input descriptor, run the block at a caller-derived path, then resolve a `ref`
// descriptor pointing at the child's emitted trace. `runChild` is that skeleton.
// `runBackground` is the fire-and-forget analogue used by `work` / `workIf`.
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
  backgroundTaskCtx,
  dispatchWorkTask,
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
 */
export async function runChild(
  ctx: BlockContext,
  shape: ChildDispatch,
  path: string,
  input: unknown,
  inputHint: BlockValueInternal<unknown>
): Promise<RunChildResult> {
  const childInput = shape.connector ? await shape.connector(input, ctx) : input;
  stashInputHint(ctx, inputHint);
  const value = await executeBlock(shape.block, childInput, ctx, path);
  return { value, descriptor: refDescriptorForPath(ctx, path) };
}

/** Outcome of a background dispatch: the pass-through value (the sequencer's input is unchanged). */
export type RunBackgroundResult = {
  value: unknown;
};

/**
 * Dispatch one child block as fire-and-forget background work.
 *
 * Applies the connector, stashes the sequential input hint, runs the block in
 * the `"work"` phase under the background signal (so the task tree survives
 * transport teardown — FIX-663), and registers the in-flight promise with the
 * work pool via `dispatchWorkTask`. Returns the upstream value unchanged;
 * background dispatch never rewrites the running output descriptor.
 */
export async function runBackground(
  ctx: BlockContext,
  runtime: SequencerRuntimeState,
  shape: ChildDispatch,
  path: string,
  input: unknown,
  taskName: string
): Promise<RunBackgroundResult> {
  const childInput = shape.connector ? await shape.connector(input, ctx) : input;
  stashInputHint(ctx, sequentialInputHint(ctx, runtime));
  const { taskCtx, signalOverride } = backgroundTaskCtx(ctx);
  const rawPromise = executeBlock(shape.block, childInput, taskCtx, path, {
    phase: "work",
    signalOverride
  });
  dispatchWorkTask(ctx, runtime, taskName, rawPromise);
  return { value: input };
}
