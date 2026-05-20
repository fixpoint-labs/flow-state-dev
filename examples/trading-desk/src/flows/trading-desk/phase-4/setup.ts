/**
 * `setupPhase4Memos` — pre-creates the four Phase 4 memo resources in
 * `pending` before any persona runs. Mirrors `setupPhase3Memos`: every
 * nullable field comes from `blankMemoState` so the seed shape stays in
 * sync with the schema, spreads existing `memoStatus` so prior phases'
 * entries survive, and flips `activePhase` to `"phase-4"`.
 *
 * On re-run with a prior session state, `patchState(initial)` resets every
 * field so each slot starts clean.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { blankMemoState, memoResources } from "../resources";
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
      const initial = blankMemoState({
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
  },
});
