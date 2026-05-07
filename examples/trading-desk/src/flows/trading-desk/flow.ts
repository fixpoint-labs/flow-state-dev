/**
 * trading-desk flow — Phase 1 (FIX-559)
 *
 * Phase 1 ships the foundation of the Trading Desk example: scaffolding,
 * data layer, status-bar disclaimer, two-pane streaming UI, and the first
 * LLM stage (parallel analyst fan-out).
 *
 * This module currently registers a no-op `analyze` action that seeds session
 * state from caller input. Phase 1's real work — the analyst sub-sequencer —
 * lands in Step 6 of the implementation sequence.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { memosCollection, memoStatusSchema, type MemoStatus } from "./resources";

export const analyzeInputSchema = z.object({
  ticker: z.string().min(1).default("NVDA"),
  date: z.string().min(1).default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

/**
 * Flow-level session state. `memoStatus` is a per-memo-key mirror of the
 * resource's `status` field — read mid-stream by the navigator so memos
 * transition `pending → writing → published` live. The mirror exists
 * because the current React substrate batches `useResourceCollection`
 * updates to request completion (see
 * `docs/internal/spikes/trading-desk-substrate.md`).
 */
export const sessionStateSchema = z.object({
  ticker: z.string().default("NVDA"),
  date: z.string().default("2026-05-06"),
  costPreset: z.enum(["fast", "full"]).default("fast"),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
  activePhase: z.enum(["idle", "phase-1"]).default("idle"),
  memoStatus: z.record(z.string(), memoStatusSchema).default({}),
});

export type SessionState = z.infer<typeof sessionStateSchema>;

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
      memoStatus: {} as Record<string, MemoStatus>,
    });
    return input;
  },
});

// Phase 1 sub-sequencer is stubbed for Step 3. Step 6 wires in the analyst
// sub-sequencer (.tap(setupPhase1Memos).parallel({...analysts})). Until then
// the action is a no-op past `seedSession` so the UI shell can be wired up
// without depending on LLM execution.
const analyzePipeline = sequencer({
  name: "trading-desk-analyze",
  inputSchema: analyzeInputSchema,
})
  .then(seedSession);

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
      derived: {
        ticker: (ctx) => String(ctx.state.ticker ?? "NVDA"),
        date: (ctx) => String(ctx.state.date ?? "2026-05-06"),
        costPreset: (ctx) =>
          (ctx.state.costPreset as "fast" | "full" | undefined) ?? "fast",
        dataSource: (ctx) =>
          (ctx.state.dataSource as "fixture" | "live" | undefined) ?? "fixture",
        activePhase: (ctx) =>
          (ctx.state.activePhase as "idle" | "phase-1" | undefined) ?? "idle",
        memoStatus: (ctx) =>
          (ctx.state.memoStatus as Record<string, MemoStatus> | undefined) ?? {},
      },
    },
  },

  resources: {
    memos: memosCollection,
  },
});

const flow = tradingDeskFlow({ id: "default" });

export default flow;
