/**
 * trading-desk flow — Phase 1.
 *
 * Wires the `analyze` action: seed session state, then run the four-analyst
 * fan-out. Each analyst is a sub-sequencer that pre-marks its memo as
 * `writing`, runs a generator with role-specific tools, and commits the
 * structured `Thesis` output to the resource collection.
 *
 * Session-scope client data is exposed via `client.expose` so navigator
 * status (`memoStatus`) reflects mid-stream `state_change` items in the
 * client's `useClientData` hook.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { phase1Pipeline } from "./blocks/analyst-phase";
import { phase2Pipeline } from "./phase-2";
import { phase2Contributions } from "./phase-2/round-robin";
import { phase3Pipeline } from "./phase-3";
import { memosCollection, type MemoStatus } from "./resources";
import { sessionStateSchema } from "./state";

export { sessionStateSchema, type SessionState } from "./state";

export const analyzeInputSchema = z.object({
  ticker: z.string().min(1).default("NVDA"),
  date: z.string().min(1).default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

/**
 * `seedSession` patches session state from action input and resets the
 * memo-status mirror so a re-run starts from a clean navigator.
 */
const seedSession = handler({
  name: "seed-session",
  inputSchema: analyzeInputSchema,
  outputSchema: analyzeInputSchema,
  sessionStateSchema,
  execute: async (input, ctx) => {
    await ctx.session.patchState({
      ticker: input.ticker,
      date: input.date,
      costPreset: input.costPreset,
      dataSource: input.dataSource,
      activePhase: "idle",
      // Cheap preset runs one bull/bear round; full preset runs two. Caller
      // input never sets this — the schema's `max(2)` enforces the ceiling.
      maxDebateRounds: input.costPreset === "full" ? 2 : 1,
      memoStatus: {} as Record<string, MemoStatus>,
    });
    return input;
  },
});

const analyzePipeline = sequencer({
  name: "trading-desk-analyze",
  inputSchema: analyzeInputSchema,
})
  .then(seedSession)
  .then(phase1Pipeline)
  .then(phase2Pipeline)
  .then(phase3Pipeline);

const tradingDeskFlow = defineFlow({
  kind: "trading-desk",
  requireUser: true,

  actions: {
    analyze: {
      block: analyzePipeline,
    },
  },

  session: {
    stateSchema: sessionStateSchema,
    client: {
      expose: [
        "ticker",
        "date",
        "costPreset",
        "dataSource",
        "activePhase",
        "maxDebateRounds",
        "memoStatus",
      ],
    },
  },

  resources: {
    memos: memosCollection,
    // Phase 2 transcript. Registered here so post-loop consolidation
    // generators can declare it on their own `resources:` slot.
    p2Contributions: phase2Contributions,
  },
});

const flow = tradingDeskFlow({ id: "default" });

export default flow;
