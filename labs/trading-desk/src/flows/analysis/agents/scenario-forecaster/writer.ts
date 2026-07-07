/**
 * Scenario-forecaster commit handler (runs first in Phase 5).
 *
 *   - `commitScenarioForecastMemo` — normalizes the scenario probabilities,
 *     copies `horizon` from the trader memo, and publishes. Throws
 *     `probability-violation` when the raw probabilities sum outside
 *     [0.8, 1.2], caught by the pipeline's per-step rescue.
 *
 * The memo `writing`/`error` lifecycle is no longer built here — it comes from
 * the keyed `markWriting`/`markError` resolved by `defineMemoStep` from the
 * registry entry in `orchestration/stages.ts`.
 */
import { PHASE_3_MEMO_KEYS, PHASE_5_MEMO_KEYS } from "../../registry";
import { memoHandler, publishMemo } from "../_recipe/memo-writer";
import { scenarioForecastOutputSchema } from "./scenario-forecaster";

export const commitScenarioForecastMemo = memoHandler({
  name: "commit-memo-p5-scenario-forecast",
  inputSchema: scenarioForecastOutputSchema,
  execute: async (forecast, ctx) => {
    // Copy horizon from the trader memo's holdingPeriod.
    const traderMemo = await ctx.resources.memos.getOptional(
      PHASE_3_MEMO_KEYS.trader.collectionKey,
    );
    const traderState = traderMemo?.state as
      | { holdingPeriod?: string | null }
      | undefined;
    const horizon = traderState?.holdingPeriod ?? null;

    // Probability integrity: sum, validate band, normalize.
    const rawSum = forecast.scenarios.reduce((s, sc) => s + sc.probability, 0);
    if (rawSum < 0.8 || rawSum > 1.2) {
      throw new Error(
        `probability-violation: scenario probabilities sum to ${rawSum.toFixed(4)}, outside [0.8, 1.2]`,
      );
    }
    const normalizedScenarios = forecast.scenarios.map((sc) => ({
      ...sc,
      probability: sc.probability / rawSum,
    }));

    await publishMemo(
      ctx,
      PHASE_5_MEMO_KEYS.scenarioForecast.collectionKey,
      {
        label: forecast.label,
        headline: forecast.headline,
        rating: forecast.rating,
        body: forecast.body,
        metrics: forecast.metrics,
        scenarios: normalizedScenarios,
        distribution: forecast.distribution,
        probabilitySum: rawSum,
        horizon,
        evidenceBasis: forecast.evidenceBasis,
        // FIX-676 — pass through any URLs the forecaster fetched (null when none).
        citations: forecast.citations,
      },
    );
  },
});
