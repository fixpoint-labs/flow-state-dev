/**
 * `setupPhase2Memos` — pre-creates the three Phase 2 memo resources in
 * `pending` status before the bull/bear loop starts. Mirrors the Phase 1
 * setup convention: navigator reads `session.memoStatus` to render the
 * three slots immediately, so all p2 memos appear before any turn runs.
 *
 * Only the non-nullable scaffold is supplied to `memoStateSchema.parse()` —
 * every nullable field is filled by Zod's `.default(null)`. On re-run
 * with existing memo state, `setState(initial)` replaces the memo
 * entirely so prior `body` / `headline` / etc. don't bleed through.
 *
 * Reads ticker/date from session state because upstream input shape is
 * the parallel analyst aggregator's output, not the original action input.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { memoResources, memoStateSchema } from "../resources";
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
      const initial = memoStateSchema.parse({
        status: "pending",
        agentName: mapping.agentName,
        agentTeam: "research",
        phaseId: "p2",
        ticker,
        date,
      });
      const existing = ctx.resources.memos.getOptional(mapping.collectionKey);
      if (existing === undefined) {
        await ctx.resources.memos.create(mapping.collectionKey, initial);
      } else {
        await existing.setState(initial);
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
