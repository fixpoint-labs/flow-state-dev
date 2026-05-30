/**
 * Phase 5a memo-writing blocks.
 *
 *   - `markWritingP5a` / `markErrorP5a` — built via `defineMemoStateBlocks`.
 *   - `commitScenarioForecastMemo` — plain handler that normalizes
 *     probabilities, copies `horizon` from the trader memo, and publishes.
 *
 * Probability integrity: the writer sums the scenario probabilities. If
 * the raw sum is within [0.8, 1.2], each bucket is normalized to sum 1.0
 * and the raw sum is stored as `probabilitySum` for transparency. Outside
 * that band the writer throws `probability-violation`, caught by the
 * per-step `.rescue` — same shape as Phase 5's lineage-violation throw.
 */
import { PHASE_3_MEMO_KEYS, PHASE_5A_MEMO_KEYS } from "../agents";
import {
  defineMemoStateBlocks,
  memoHandler,
  publishMemo,
} from "../lib/memo-writer";
import { scenarioForecastOutputSchema } from "./scenario-forecaster";

export const {
  markWriting: markWritingP5a,
  markError: markErrorP5a,
} = defineMemoStateBlocks({
  phaseId: "p5a",
  agentTeam: "pm",
  keys: PHASE_5A_MEMO_KEYS,
  errorMessageFallback: "Phase 5a generator failed.",
});

export const commitScenarioForecastMemo = memoHandler({
  name: "commit-memo-p5a-scenario-forecast",
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
      "scenarioForecast",
      PHASE_5A_MEMO_KEYS.scenarioForecast.collectionKey,
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
      },
    );
  },
});
