/**
 * What a Codex run cost — an ESTIMATE, always, and absent rather than zero when
 * it cannot be derived.
 *
 * Codex reports tokens and no price, so unlike the Claude Code adapter (whose
 * SDK gives a number) this package derives one from the framework's single
 * model price table. Three things must all be present, and any absence is
 * `null`:
 *
 * - **A configured model.** Codex's wire never names the model that ran (POC,
 *   confirmed on 0.152.1), so a run left on Codex's default has nothing to
 *   price against. The `thread.model` option is the only source.
 * - **A row for it in core's table.** A Codex model the table has not learned
 *   yet shows no cost until one patch release teaches it — which corrects every
 *   adapter at once, rather than each keeping its own prices.
 * - **Usage on the wire.** No `turn.completed`, no tokens, no number.
 *
 * `basis` is therefore always `"estimated"`: a report can never show a
 * precision the harness never gave.
 */
import { findModelEntry, modelPricingEstimator } from "@flow-state-dev/core";
import type { HarnessRunCost } from "@flow-state-dev/core/types";
import type { CodexRunUsage } from "./types";

/**
 * Price one run's usage, or return `null`.
 *
 * The presence decision and the arithmetic are deliberately split.
 * `modelPricingEstimator().estimate()` returns **0** for a model it cannot
 * price — the exact opposite of decision 3's "absent, never zero" — so
 * `findModelEntry` is asked first whether a priced row exists at all, and the
 * estimator is only used once the answer is yes. Reimplementing the arithmetic
 * here instead would fork the cache-rate fallback away from every other caller
 * of the table.
 *
 * The mapping into the estimator's vocabulary is where Codex's usage semantics
 * live: `input_tokens` INCLUDES the cached ones, so the regular prompt is the
 * difference (the estimator subtracts them the same way); cache WRITES are not
 * billed by OpenAI, so they are passed as zero and ride the handle's extension
 * raw for anyone who wants to price them differently; and reasoning tokens are
 * a subset of the output, so they are not added again.
 */
export function estimateCodexCost(
  usage: CodexRunUsage | null,
  model: string | undefined,
): HarnessRunCost | null {
  if (usage === null || model === undefined || model === "") return null;
  const entry = findModelEntry(model);
  if (entry?.pricing === undefined) return null;

  const usd = modelPricingEstimator().estimate(
    {
      prompt: usage.inputTokens,
      completion: usage.outputTokens,
      total: usage.inputTokens + usage.outputTokens,
      cacheReadTokens: usage.cachedInputTokens,
      cacheCreationTokens: 0,
    },
    model,
  );
  return { usd, basis: "estimated" };
}
