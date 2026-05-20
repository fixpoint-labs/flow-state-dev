/**
 * `setupPhase3Memos` — pre-creates the trader memo resource in `pending`
 * before the trader generator runs. Mirrors `setupPhase2Memos`.
 *
 * Only the non-nullable scaffold is supplied to `memoStateSchema.parse()` —
 * every nullable field is filled by Zod's `.default(null)`. On re-run
 * with existing memo state, `setState(initial)` replaces the memo
 * entirely so prior `body` / `headline` / etc. don't bleed through.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_3_MEMO_KEYS } from "../agents";
import { memoResources, memoStateSchema } from "../resources";
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
      const initial = memoStateSchema.parse({
        status: "pending",
        agentName: mapping.agentName,
        agentTeam: "trade",
        phaseId: "p3",
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
      activePhase: "phase-3",
      memoStatus: {
        ...(ctx.session.state.memoStatus as Record<string, unknown>),
        trader: "pending",
      },
    });
    return input;
  },
});
