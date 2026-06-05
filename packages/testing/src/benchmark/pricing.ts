/**
 * Approximate per-model USD pricing for benchmark cost accounting.
 *
 * This is a deliberately tiny, self-contained table covering the cheap-paid
 * default models the benchmark harness uses. Prices are USD per 1M tokens and
 * are approximate — they exist only to keep a running cost estimate so the
 * `maxCostUsd` budget guard can trip. Unknown models estimate to 0 rather than
 * throwing, so an unpriced model never blocks a run.
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
