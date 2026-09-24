/**
 * Where an evaluator's usage and model identity land on its own
 * `block_trace` row.
 *
 * An evaluator reports both through `onGeneratorModelResult`. Whoever runs
 * it inside an execution scope (a sequencer step, a generator's tool call)
 * captures the payload and stashes it on the evaluator's scoped ctx, where
 * the `output` phase of `_withExecutionScope` reads it onto the row.
 */
import type { BlockContext } from "../../types/block";
import type { ModelIdentity } from "../../types/model";

/** Usage as the trace row records it. */
export type EvaluatorModelUsageMeta = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** The payload an evaluator reports through `onGeneratorModelResult`. */
type EvaluatorModelResultPayload = {
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  identity?: ModelIdentity;
};

/**
 * Stash an evaluator's usage and model identity on its scoped ctx, where the
 * `output` phase of `_withExecutionScope` reads them onto the block_trace row.
 * Runs on success and failure, so a failed evaluation that returned usage
 * still records it.
 */
export function stashEvaluatorModelResult(
  scopedCtx: BlockContext,
  usage: EvaluatorModelUsageMeta | undefined,
  identity: ModelIdentity | undefined
): void {
  if (usage !== undefined) {
    (scopedCtx as { _generatorModelUsage?: EvaluatorModelUsageMeta })._generatorModelUsage = usage;
  }
  if (identity !== undefined) {
    (scopedCtx as { _generatorModelIdentity?: ModelIdentity })._generatorModelIdentity = identity;
  }
}

/**
 * Run an evaluator with its model result captured onto `scopedCtx`, on
 * success and failure. The payload is not forwarded to the enclosing hook:
 * inside a generator's tool call that hook is the generator's own capture,
 * and the evaluator's model must not overwrite the generator's on its row.
 */
export async function runEvaluatorCapturingModelResult<T>(
  scopedCtx: BlockContext,
  run: (execCtx: BlockContext) => Promise<T>
): Promise<T> {
  let usage: EvaluatorModelUsageMeta | undefined;
  let identity: ModelIdentity | undefined;
  const execCtx = {
    ...scopedCtx,
    _runtimeHooks: {
      ...scopedCtx._runtimeHooks,
      onGeneratorModelResult: (payload: EvaluatorModelResultPayload) => {
        if (payload.identity !== undefined) identity = payload.identity;
        if (payload.usage !== undefined) {
          usage = {
            model: payload.model,
            promptTokens: payload.usage.promptTokens,
            completionTokens: payload.usage.completionTokens,
            totalTokens: payload.usage.totalTokens,
          };
        }
      },
    },
  } as BlockContext;
  try {
    return await run(execCtx);
  } finally {
    stashEvaluatorModelResult(scopedCtx, usage, identity);
  }
}
