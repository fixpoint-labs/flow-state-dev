/**
 * Token-cost estimation shared by the LLM-judge scorer and the benchmark engine.
 *
 * Lives at the eval layer (not under `benchmark/`) so `analyzerScorer` can report
 * the cost of a judge call without the benchmark engine importing the eval scorer
 * and the scorer importing the benchmark engine — i.e. no import cycle.
 *
 * Pricing is approximate and benchmark-scoped: it exists to keep a running cost
 * estimate so a `maxCostUsd` budget guard can trip. Unknown models estimate to 0
 * rather than throwing, so an unpriced model never blocks a run.
 */
import type { GeneratorModelUsage } from "@flow-state-dev/core/types";

/** USD-per-1M-token rates for a model family. */
interface ModelPrice {
  /** Input/prompt tokens, USD per 1M. */
  inputPer1M: number;
  /** Output/completion tokens, USD per 1M. */
  outputPer1M: number;
}

/**
 * Substring-keyed price table (most-specific first). The first entry whose key
 * is a substring of the model id wins. Approximate; benchmark-scoped.
 */
const PRICE_TABLE: Array<{ key: string; price: ModelPrice }> = [
  { key: "gpt-5.4-mini", price: { inputPer1M: 0.2, outputPer1M: 0.8 } },
  { key: "claude-haiku-4-5", price: { inputPer1M: 0.8, outputPer1M: 4.0 } },
  { key: "claude-haiku", price: { inputPer1M: 0.8, outputPer1M: 4.0 } }
];

/**
 * Estimates the USD cost of one generation from its token usage. Returns 0 for
 * unpriced models or when usage is absent — never throws.
 */
export function estimateCostUsd(
  modelId: string,
  usage: GeneratorModelUsage | undefined
): number {
  if (usage === undefined) {
    return 0;
  }

  const entry = PRICE_TABLE.find((row) => modelId.includes(row.key));
  if (entry === undefined) {
    return 0;
  }

  return (
    (usage.promptTokens / 1_000_000) * entry.price.inputPer1M +
    (usage.completionTokens / 1_000_000) * entry.price.outputPer1M
  );
}

/**
 * Best-effort cost estimate for a run: sums `modelUsage` across the emitted
 * `block_trace` items. Returns 0 when trace observability is off (no
 * `modelUsage` present), keeping cost a non-blocking estimate.
 */
export function sumCostFromItems(items: readonly unknown[]): number {
  let total = 0;
  for (const item of items) {
    const trace = item as {
      type?: string;
      modelUsage?: {
        model: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    };
    if (trace.type === "block_trace" && trace.modelUsage !== undefined) {
      total += estimateCostUsd(trace.modelUsage.model, trace.modelUsage);
    }
  }
  return total;
}
