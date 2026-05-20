/**
 * `setupPhase4Memos` — pre-creates the four Phase 4 memo resources in
 * `pending` before any persona runs.
 *
 * Mirrors `setupPhase3Memos`. Only the non-nullable scaffold (`status`,
 * `agentName`, `agentTeam`, `phaseId`, `ticker`, `date`) is supplied;
 * every nullable field on `memoStateSchema` is filled by Zod's
 * `.default(null)` when the framework parses the input. On re-run with
 * existing memo state, `setState(initial)` (after a local
 * `memoStateSchema.parse(...)` to get a fully-typed object) replaces the
 * memo entirely so prior `body` / `headline` / etc. don't bleed through.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { memoResources, memoStateSchema } from "../resources";
import { sessionStateSchema } from "../state";

export const setupPhase4Memos = handler({
  name: "setup-phase-4-memos",
  inputSchema: z.any(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const ticker = ctx.session.state.ticker as string;
    const date = ctx.session.state.date as string;
    const nextStatus: Record<string, "pending"> = {};
    for (const [shortName, mapping] of Object.entries(PHASE_4_MEMO_KEYS)) {
      const initial = memoStateSchema.parse({
        status: "pending",
        agentName: mapping.agentName,
        agentTeam: "risk",
        phaseId: "p4",
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
      activePhase: "phase-4",
      memoStatus: {
        ...ctx.session.state.memoStatus,
        ...nextStatus,
      },
    });
  },
});
