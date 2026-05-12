/**
 * `setupPhase4Memos` — pre-creates the four Phase 4 memo resources in
 * `pending` before any persona runs. Mirrors `setupPhase3Memos`: explicit
 * `null` for every nullable field on `memoStateSchema` (Zod defaults are
 * not applied at runtime writes), spreads existing `memoStatus` so prior
 * phases' entries survive, and flips `activePhase` to `"phase-4"`.
 *
 * On re-run with a prior session state, `patchState(initial)` resets every
 * field so each slot starts clean.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";

export const setupPhase4Memos = handler({
  name: "setup-phase-4-memos",
  inputSchema: z.any(),
  outputSchema: z.any(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (input, ctx) => {
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    const nextStatus: Record<string, "pending"> = {};
    for (const [shortName, mapping] of Object.entries(PHASE_4_MEMO_KEYS)) {
      const existing = ctx.resources.memos.getOptional(mapping.collectionKey);
      const initial = {
        status: "pending" as const,
        agentName: mapping.agentName,
        agentTeam: "risk" as const,
        phaseId: "p4",
        ticker,
        date,
        label: null,
        headline: null,
        rating: null,
        body: null,
        metrics: null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        // Phase 2 extension fields (null on P4 memos).
        stance: null,
        conviction: null,
        keyRisks: null,
        keyOpportunities: null,
        unresolvedDisagreements: null,
        // Phase 3 extension fields (null on P4 memos).
        direction: null,
        sizePct: null,
        stopPrice: null,
        targetPrice: null,
        holdingPeriod: null,
        invalidationCriteria: null,
        dependsOn: null,
        // Phase 4 extension fields (populated at commit time).
        posture: null,
        raisedRisks: null,
        proposedAdjustments: null,
        dismissedRisks: null,
        criticalRisks: null,
        recommendedAdjustments: null,
        confidenceCalibration: null,
        calibrationRationale: null,
      };
      if (existing === undefined) {
        await ctx.resources.memos.create(mapping.collectionKey, initial);
      } else {
        await existing.patchState(initial);
      }
      nextStatus[shortName] = "pending";
    }
    await ctx.session.patchState({
      activePhase: "phase-4",
      memoStatus: {
        ...ctx.session.state.memoStatus,
        ...nextStatus,
      },
    });
    return input;
  },
});
