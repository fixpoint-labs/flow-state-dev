/**
 * What a Cursor run cost — an ESTIMATE, always, and absent rather than zero when
 * it cannot be derived.
 *
 * Three things must all be present, and any absence is `null`:
 *
 * - **A model id.** The run's own `system` message names the model that
 *   actually ran, and the block falls back to the one configured on
 *   `agent.model`. A run with neither has nothing to price against.
 * - **A row for it in core's table.** A model the table has not learned yet
 *   shows no cost until one patch release teaches it — which corrects every
 *   adapter at once, rather than each keeping its own prices. Cursor's model ids
 *   are spelled its own way (`claude-4.5-sonnet`, `composer-*`), and the table
 *   does not carry those spellings today, so most Cursor runs report no cost at
 *   all. That is the honest answer: see the README.
 * - **Usage on the wire.** No `usage` message and no cumulative figure from
 *   `run.wait()`, no tokens, no number.
 *
 * `basis` is therefore always `"estimated"`.
 *
 * **The SDK's own reported cost is deliberately not used**, and that is a
 * decision rather than an omission. `agent.getUsage()` returns dollars, but for
 * a local agent it returns them for the whole AGENT — every turn of the
 * conversation — and its per-turn entries are keyed by a usage UUID this package
 * has no way to correlate to the run it just observed. On a resumed agent that
 * total is not this run's cost, and the SDK documents the figure as eventually
 * consistent, so reading it the moment a run ends can report `0` for a run whose
 * billing has not landed. `0` reads as "this was free"; `null` reads as "nobody
 * knows", which is the truth.
 */
import { findModelEntry, modelPricingEstimator } from "@flow-state-dev/core";
import type { HarnessRunCost } from "@flow-state-dev/core/types";
import type { CursorRunUsage } from "./types";

/**
 * Price one run's usage, or return `null`.
 *
 * The presence decision and the arithmetic are deliberately split.
 * `modelPricingEstimator().estimate()` returns **0** for a model it cannot
 * price — the exact opposite of "absent, never zero" — so `findModelEntry` is
 * asked first whether a priced row exists at all, and the estimator is only used
 * once the answer is yes. Reimplementing the arithmetic here instead would fork
 * the cache-rate fallback away from every other caller of the table.
 *
 * The mapping into the estimator's vocabulary is where Cursor's usage semantics
 * live. The estimator wants a prompt total that INCLUDES the cached tokens and
 * subtracts them itself, so the three input counters are added back together
 * before it is called; and reasoning tokens are a subset of the output, so they
 * are not added again.
 *
 * **That `inputTokens` excludes the cached counters is inferred, not
 * confirmed.** The SDK documents only that `totalTokens` excludes
 * `reasoningTokens`; the reading here comes from the field naming, which mirrors
 * Anthropic's `input_tokens` / `cache_read_input_tokens` split. If it turns out
 * `inputTokens` is already inclusive, this over-counts the cached tokens once —
 * so the raw counters ride the handle's `cursorUsage` untouched, and a consumer
 * that needs the number to be exact can price them itself.
 */
export function estimateCursorCost(
  usage: CursorRunUsage | null,
  model: string | undefined,
): HarnessRunCost | null {
  if (usage === null || model === undefined || model === "") return null;
  const entry = findModelEntry(model);
  if (entry?.pricing === undefined) return null;

  const usd = modelPricingEstimator().estimate(
    {
      prompt: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      completion: usage.outputTokens,
      total: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheWriteTokens,
    },
    model,
  );
  return { usd, basis: "estimated" };
}
