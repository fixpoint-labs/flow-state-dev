/**
 * `setupPhase3Memos` — pre-creates the trader memo resource in `pending`
 * before the trader generator runs. Mirrors `setupPhase2Memos`: explicit
 * `null` for every nullable field on `memoStateSchema` (Zod defaults are
 * not applied at runtime writes), spreads existing `memoStatus` so prior
 * phases' entries survive, and flips `activePhase` to `"phase-3"`.
 *
 * On re-run with a prior session state, `patchState(initial)` resets every
 * field so the slot starts clean.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_3_MEMO_KEYS } from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";

export const setupPhase3Memos = handler({
  name: "setup-phase-3-memos",
  inputSchema: z.any(),
  outputSchema: z.any(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (input, ctx) => {
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    for (const [, mapping] of Object.entries(PHASE_3_MEMO_KEYS)) {
      const existing = ctx.resources.memos.getOptional(mapping.collectionKey);
      const initial = {
        status: "pending" as const,
        agentName: mapping.agentName,
        agentTeam: "trade" as const,
        phaseId: "p3",
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
        // Phase 2 extension fields (left null on P3 memos).
        stance: null,
        conviction: null,
        keyRisks: null,
        keyOpportunities: null,
        unresolvedDisagreements: null,
        // Phase 3 extension fields (populated at commit time).
        direction: null,
        sizePct: null,
        stopPrice: null,
        targetPrice: null,
        holdingPeriod: null,
        invalidationCriteria: null,
        dependsOn: null,
      };
      if (existing === undefined) {
        await ctx.resources.memos.create(mapping.collectionKey, initial);
      } else {
        await existing.patchState(initial);
      }
    }
    await ctx.session.patchState({
      activePhase: "phase-3",
      memoStatus: {
        ...(ctx.session.state.memoStatus as Record<string, unknown>),
        trader: "pending",
      },
    });
    return input;
  },
});
