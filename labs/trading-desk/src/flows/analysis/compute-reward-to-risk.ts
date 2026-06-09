/**
 * Post-forecast tap: derives the reward-to-risk figure from the committed
 * scenario buckets and the active mandate's loss-aversion, and stores it on the
 * `rewardToRiskResource` (FIX-752).
 *
 * Runs after the scenario forecaster (Phase 5a) and before the PM (Phase 5b),
 * mirroring `compute-spine.ts`'s deterministic `.tap` shape — no `block.run()`,
 * no model call, no network. Reads the scenario memo's normalized buckets; on no
 * usable bucket it leaves the resource null (the PM decides mandate-blind).
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_5_MEMO_KEYS } from "./registry";
import { memoResources } from "./resources";
import { computeRewardToRisk } from "./lib/reward-to-risk";
import { rewardToRiskResource } from "./reward-to-risk-resource";
import { sessionStateSchema } from "./state";

export const computeAndStoreRewardToRisk = handler({
  name: "compute-reward-to-risk",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: { ...memoResources, rewardToRisk: rewardToRiskResource },
  execute: async (_input, ctx) => {
    const memo = await ctx.resources.memos.getOptional(
      PHASE_5_MEMO_KEYS.scenarioForecast.collectionKey,
    );
    const scenarios = (memo?.state?.scenarios ?? []) as Array<{
      probability: number;
      expectedReturnPct: number | null;
    }>;
    // Only buckets with a numeric return feed the metric; a forecaster that
    // produced none (absent / errored memo, or all returns null) leaves the
    // resource null and the run gates mandate-blind.
    const usable = scenarios
      .filter((s) => s.expectedReturnPct != null)
      .map((s) => ({
        probability: s.probability,
        expectedReturnPct: s.expectedReturnPct as number,
      }));
    if (usable.length === 0) return;

    const mandate = ctx.session.state.riskMandate;
    const lossAversion = mandate?.lossAversion ?? 1;
    const figure = computeRewardToRisk({ scenarios: usable, lossAversion });

    await ctx.resources.rewardToRisk.patchState({
      ...figure,
      lossAversion,
      mandateId: mandate?.id ?? null,
    });
  },
});
