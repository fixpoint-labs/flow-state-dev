/**
 * `setupPhase5Memos` — pre-creates the portfolio-manager memo resource in
 * `pending` before the portfolio-manager generator runs. Mirrors
 * `setupPhase4Memos`.
 *
 * Only the non-nullable scaffold is supplied to `memoStateSchema.parse()` —
 * every nullable field is filled by Zod's `.default(null)`. On re-run
 * with existing memo state, `setState(initial)` replaces the memo
 * entirely so prior `body` / `headline` / etc. don't bleed through.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_5_MEMO_KEYS } from "../agents";
import { memoResources, memoStateSchema } from "../resources";
import { sessionStateSchema } from "../state";

export const setupPhase5Memos = handler({
  name: "setup-phase-5-memos",
  inputSchema: z.any(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    const nextStatus: Record<string, "pending"> = {};
    for (const [shortName, mapping] of Object.entries(PHASE_5_MEMO_KEYS)) {
      const initial = memoStateSchema.parse({
        status: "pending",
        agentName: mapping.agentName,
        agentTeam: "pm",
        phaseId: "p5",
        ticker,
        date,
      });
      const existing = ctx.resources.memos.getOptional(mapping.collectionKey);
      if (existing === undefined) {
        await ctx.resources.memos.create(mapping.collectionKey, initial);
      } else {
        await existing.setState(initial);
      }
      nextStatus[shortName] = "pending";
    }
    await ctx.session.patchState({
      activePhase: "phase-5",
      memoStatus: {
        ...ctx.session.state.memoStatus,
        ...nextStatus,
      },
    });
  },
});
