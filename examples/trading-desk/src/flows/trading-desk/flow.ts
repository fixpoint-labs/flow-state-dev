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
import { PHASE_1_MEMO_KEYS } from "./agents";
import { analyzeInputSchema } from "./flow-schema";
import { phase1Pipeline } from "./phase-1";
import { phase2Pipeline } from "./phase-2";
import { phase2Contributions } from "./phase-2/round-robin";
import { phase3Pipeline } from "./phase-3";
import { phase4Pipeline } from "./phase-4";
import { phase5Pipeline } from "./phase-5";
import { memosCollection, type MemoStatus } from "./resources";
import { resolveTicker } from "./services/ticker-resolver";
import { specialInstructionsStateSchema } from "./special-instructions";
import { specialInstructionsResource } from "./special-instructions-resource";
import { sessionStateSchema } from "./state";

export { sessionStateSchema, type SessionState } from "./state";
export { analyzeInputSchema, type AnalyzeInput } from "./flow-schema";

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
      runComplete: false,
      // Reset terminal stop state from any prior run on this session key
      // so the navigator doesn't render a stale "stopped" banner.
      stoppedReason: null,
      stoppedMessage: null,
    });
    return input;
  },
});

// Two `.tap` + `.exitIf` pairs implement defense-in-depth against
// unresolvable tickers (FIX-605):
//
//   1. Pre-flight ticker resolution probes the active data source. If the
//      ticker can't be resolved (missing fixture / all live providers down),
//      the tap patches `stoppedReason: "unresolvable-ticker"` and the
//      following `.exitIf` bails before any model spend.
//   2. Post-Phase-1 data-quality check: if every analyst memo is in `error`,
//      the tap patches `stoppedReason: "phase-1-no-data"` and `.exitIf`
//      bails before phases 2–5 synthesize on no data.
//
// The rescue + typed-error scaffolding from the first FIX-605 cut is gone:
// the stop is a normal terminal state, not an exceptional condition, so
// patching state + exiting is the right shape.
const analyzePipeline = sequencer({
  name: "trading-desk-analyze",
  inputSchema: analyzeInputSchema,
})
  .then(seedSession)
  .tap(async (input, ctx) => {
    const result = await resolveTicker(input);
    if (!result.resolved) {
      await ctx.session.patchState({
        stoppedReason: "unresolvable-ticker",
        stoppedMessage:
          result.reason ?? `Could not resolve ticker ${input.ticker}.`,
        runComplete: true,
      });
    }
  })
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .then(phase1Pipeline)
  .tap(async (_v, ctx) => {
    // `.tap` doesn't carry a typed resources slot — go through `any` so
    // `getOptional` is callable. The `memos` collection is declared by
    // `phase1Pipeline` upstream, so it's present at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memos = (ctx.resources as any).memos;
    const allErrored = Object.values(PHASE_1_MEMO_KEYS).every(
      (m) => memos.getOptional(m.collectionKey)?.state.status === "error",
    );
    if (allErrored) {
      await ctx.session.patchState({
        stoppedReason: "phase-1-no-data",
        stoppedMessage:
          `Every Phase 1 analyst failed for ${ctx.session.state.ticker}. ` +
          "Halting before synthesis — no usable upstream data.",
        runComplete: true,
      });
    }
  })
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .then(phase2Pipeline)
  .then(phase3Pipeline)
  .then(phase4Pipeline)
  .then(phase5Pipeline);

/**
 * Persists the user's standing special instructions (global + per-phase) to
 * the user-scoped, flow-isolated `specialInstructionsResource`. Edits take
 * effect on the next analyze run — the running session's prompts are already
 * built and untouched.
 */
const setInstructions = handler({
  name: "set-instructions",
  inputSchema: specialInstructionsStateSchema,
  outputSchema: z.void(),
  resources: { specialInstructions: specialInstructionsResource },
  execute: async (input, ctx) => {
    await ctx.resources.specialInstructions.patchState(input);
  },
});

const tradingDeskFlow = defineFlow({
  kind: "trading-desk",
  requireUser: true,

  actions: {
    analyze: {
      block: analyzePipeline,
    },
    setInstructions: {
      block: setInstructions,
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
        "runComplete",
        "stoppedReason",
        "stoppedMessage",
      ],
    },
  },

  resources: {
    memos: memosCollection,
    // Phase 2 transcript. Registered here so post-loop consolidation
    // generators can declare it on their own `resources:` slot.
    p2Contributions: phase2Contributions,
    // User-scoped, flow-isolated standing instructions (FIX-603).
    // Declared here so `resolveUserStorageKey` picks up `flowIsolation: true`
    // for storage-key derivation; the capability's `core` preset also
    // declares it for runtime context access.
    specialInstructions: specialInstructionsResource,
  },
});

const flow = tradingDeskFlow({ id: "default" });

export default flow;
