/**
 * `setupPhase1Memos` — pre-creates the four Phase 1 memo resources in
 * `pending` status before the parallel fan-out starts. The navigator reads
 * the session-state mirror to render the four slots immediately, so the
 * "all four memos appear before any generator runs" acceptance criterion
 * lands on the first emitted state-change item.
 *
 * Only the non-nullable scaffold (`status`, `agentName`, `agentTeam`,
 * `phaseId`, `ticker`, `date`) is supplied to `memoStateSchema.parse()` —
 * every nullable field is filled by Zod's `.default(null)`. On re-run
 * with existing memo state, `setState(initial)` replaces the memo
 * entirely so prior `body` / `headline` / etc. don't bleed through.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_1_MEMO_KEYS } from "../agents";
import { memoResources, memoStateSchema } from "../resources";
import { sessionStateSchema } from "../state";

const inputSchema = z.object({
  ticker: z.string(),
  date: z.string(),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
});

export const setupPhase1Memos = handler({
  name: "setup-phase-1-memos",
  inputSchema,
  outputSchema: inputSchema,
  sessionStateSchema,
  resources: memoResources,
  execute: async (input, ctx) => {
    for (const [, mapping] of Object.entries(PHASE_1_MEMO_KEYS)) {
      const initial = memoStateSchema.parse({
        status: "pending",
        agentName: mapping.agentName,
        agentTeam: "analyst",
        phaseId: "p1",
        ticker: input.ticker,
        date: input.date,
      });
      const existing = ctx.resources.memos.getOptional(mapping.collectionKey);
      if (existing === undefined) {
        await ctx.resources.memos.create(mapping.collectionKey, initial);
      } else {
        await existing.setState(initial);
      }
    }
    // Derive the memo-status seed from PHASE_1_MEMO_KEYS so adding a new
    // Phase 1 analyst doesn't require touching this file.
    const memoStatusSeed = Object.fromEntries(
      Object.keys(PHASE_1_MEMO_KEYS).map((shortName) => [shortName, "pending" as const]),
    );
    await ctx.session.patchState({
      activePhase: "phase-1",
      memoStatus: memoStatusSeed,
    });
    return input;
  },
});
