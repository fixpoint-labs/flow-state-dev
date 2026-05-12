/**
 * `setupPhase2Memos` — pre-creates the three Phase 2 memo resources in
 * `pending` status before the bull/bear loop starts. Mirrors the Phase 1
 * setup convention: navigator reads `session.memoStatus` to render the
 * three slots immediately, so all p2 memos appear before any turn runs.
 *
 * Reads ticker/date from session state because upstream input shape is
 * the parallel analyst aggregator's output, not the original action input.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";

export const setupPhase2Memos = handler({
  name: "setup-phase-2-memos",
  inputSchema: z.any(),
  outputSchema: z.any(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (input, ctx) => {
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    for (const [, mapping] of Object.entries(PHASE_2_MEMO_KEYS)) {
      const existing = ctx.resources.memos.getOptional(mapping.collectionKey);
      const initial = {
        status: "pending" as const,
        agentName: mapping.agentName,
        agentTeam: "research" as const,
        phaseId: "p2",
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
        stance: null,
        conviction: null,
        keyRisks: null,
        keyOpportunities: null,
        unresolvedDisagreements: null,
      };
      if (existing === undefined) {
        await ctx.resources.memos.create(mapping.collectionKey, initial);
      } else {
        await existing.patchState(initial);
      }
    }
    await ctx.session.patchState({
      activePhase: "phase-2",
      memoStatus: {
        ...(ctx.session.state.memoStatus as Record<string, unknown>),
        bull: "pending",
        bear: "pending",
        researchManager: "pending",
      },
    });
    return input;
  },
});
