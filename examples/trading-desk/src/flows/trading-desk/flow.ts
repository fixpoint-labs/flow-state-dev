/**
 * The trading-desk flow.
 *
 * `analyze` is the main entry point. It seeds session state, runs two
 * stop-condition guards (unresolvable ticker, then post-Phase-1
 * all-errored), and finally chains the five phase pipelines. Each guard
 * patches `stoppedReason` + `stoppedMessage` on session state when it
 * trips, and the following `.exitIf` bails out before the next phase —
 * so a stop is a normal terminal state, not an exceptional condition.
 *
 * `setInstructions` persists the user's standing special instructions
 * (global + per-phase). Edits take effect on the next analyze run; the
 * running session's prompts are already built and untouched.
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
import { phase3Pipeline } from "./phase-3";
import { phase4Pipeline } from "./phase-4";
import { phase5Pipeline } from "./phase-5";
import { phase6Pipeline } from "./phase-6";
import { resolveTicker } from "./lib/ticker-resolver";
import {
  memoResources,
  memosCollection,
  phase2Contributions,
  type MemoStatus,
} from "./resources";
import { specialInstructionsStateSchema } from "./special-instructions";
import { specialInstructionsResource } from "./special-instructions-resource";
import { sessionStateSchema } from "./state";

export { sessionStateSchema, type SessionState } from "./state";
export { analyzeInputSchema, type AnalyzeInput } from "./flow-schema";

/**
 * Patches session state from action input and resets the memo-status
 * mirror so a re-run starts from a clean navigator.
 */
const seedSession = handler({
  name: "seed-session",
  inputSchema: analyzeInputSchema,
  outputSchema: analyzeInputSchema,
  sessionStateSchema,
  execute: async (input, ctx) => {
    // Freeze the per-run thesis at seed time so editing the form mid-run
    // can't affect the session that's already analyzing. A non-null
    // `userThesis` gates Phase 6; a sub-threshold (< 20 chars) thesis is
    // treated as no thesis — Phase 6 is skipped and a soft warning is
    // surfaced rather than halting.
    const rawThesis = input.userThesis?.trim() ?? "";
    const hasUsableThesis = rawThesis.length >= 20;
    const userThesis = hasUsableThesis ? rawThesis : null;
    const userThesisWarning =
      rawThesis.length > 0 && !hasUsableThesis
        ? "Thesis too short to audit (under 20 characters) — Phase 6 skipped."
        : null;

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
      userThesis,
      userThesisRationale: userThesis === null ? null : input.userThesisRationale,
      userThesisWarning,
    });
    return input;
  },
});

/**
 * Pre-flight ticker resolution. Probes the active data source for the
 * requested ticker; if it can't be resolved (missing fixture / all live
 * providers down), patches `stoppedReason: "unresolvable-ticker"` so the
 * following `.exitIf` bails before any model spend.
 */
const checkTickerResolvable = handler({
  name: "check-ticker-resolvable",
  inputSchema: analyzeInputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  execute: async (input, ctx) => {
    const result = await resolveTicker(input);
    if (!result.resolved) {
      await ctx.session.patchState({
        stoppedReason: "unresolvable-ticker",
        stoppedMessage:
          result.reason ?? `Could not resolve ticker ${input.ticker}.`,
        runComplete: true,
      });
    }
  },
});

/**
 * Post-Phase-1 data-quality check. If every analyst memo is in `error`,
 * patches `stoppedReason: "phase-1-no-data"` so the following `.exitIf`
 * bails before phases 2–5 synthesize on no data.
 */
export const checkPhase1HasData = handler({
  name: "check-phase-1-has-data",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const statuses = await Promise.all(
      Object.values(PHASE_1_MEMO_KEYS).map(async (m) => {
        const ref = await ctx.resources.memos.getOptional(m.collectionKey);
        return ref ? (ref.state).status : undefined;
      }),
    );
    const allErrored = statuses.every((status) => status === "error");
    if (allErrored) {
      await ctx.session.patchState({
        stoppedReason: "phase-1-no-data",
        stoppedMessage:
          `Every Phase 1 analyst failed for ${ctx.session.state.ticker}. ` +
          "Halting before synthesis — no usable upstream data.",
        runComplete: true,
      });
    }
  },
});

/**
 * Post-Phase-1 primary-analyst check. `fundamentals` and `companyProfile`
 * are the only non-substitutable analysts — the debate (Phase 2) and every
 * downstream phase reason from the company's identity and its financials, so
 * a missing one can't be papered over by the four other memos. If either
 * errored, patch `stoppedReason: "phase-1-missing-primary"` so the following
 * `.exitIf` halts before synthesis. This fires on the realistic partial
 * failure (one provider rate-limited) that `checkPhase1HasData`'s all-error
 * condition would miss.
 */
export const checkPhase1HasFundamentalsAndProfile = handler({
  name: "check-phase-1-has-fundamentals-and-profile",
  inputSchema: z.unknown(),
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (_input, ctx) => {
    const erroredAt = async (collectionKey: string) => {
      const ref = await ctx.resources.memos.getOptional(collectionKey);
      return ref ? (ref.state).status === "error" : false;
    };
    const fundamentalsErrored = await erroredAt(PHASE_1_MEMO_KEYS.fundamentals.collectionKey);
    const profileErrored = await erroredAt(PHASE_1_MEMO_KEYS.companyProfile.collectionKey);
    if (!fundamentalsErrored && !profileErrored) return;
    const which = [
      fundamentalsErrored && "fundamentals",
      profileErrored && "companyProfile",
    ]
      .filter(Boolean)
      .join(" + ");
    await ctx.session.patchState({
      stoppedReason: "phase-1-missing-primary",
      stoppedMessage:
        `Non-substitutable Phase 1 analyst failed (${which}) for ` +
        `${ctx.session.state.ticker}. Halting before synthesis.`,
      runComplete: true,
    });
  },
});

/**
 * The `analyze` pipeline. Three `.tap` + `.exitIf` pairs implement
 * defense-in-depth against degenerate inputs and upstream data failure (see
 * the `checkTickerResolvable` / `checkPhase1HasFundamentalsAndProfile` /
 * `checkPhase1HasData` doc comments). The primary-analyst guard runs before
 * the all-error backstop: a partial failure that loses a non-substitutable
 * analyst halts even when the other four succeeded.
 */
const analyzePipeline = sequencer({
  name: "trading-desk-analyze",
  inputSchema: analyzeInputSchema,
})
  .then(seedSession)
  .tap(checkTickerResolvable)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .then(phase1Pipeline)
  .tap(checkPhase1HasFundamentalsAndProfile)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .tap(checkPhase1HasData)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .then(phase2Pipeline)
  .then(phase3Pipeline)
  .then(phase4Pipeline)
  .then(phase5Pipeline)
  // Phase 6 — post-decision thesis audit. Only runs when the caller supplied
  // a usable thesis at seed time; otherwise the pipeline ends at the PM.
  .thenIf(
    (_v, ctx) => ctx.session.state.userThesis !== null,
    phase6Pipeline,
  );

/**
 * Persists the user's standing special instructions (global + per-phase) to
 * the user-scoped, flow-isolated `specialInstructionsResource`.
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
    analyze: { block: analyzePipeline },
    setInstructions: { block: setInstructions },
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
        "userThesis",
        "userThesisRationale",
        "userThesisWarning",
      ],
    },
  },

  resources: {
    memos: memosCollection,
    // Phase 2 transcript — shared by the round-robin, the consolidator
    // generators, and the `tradingDesk` capability's stance/debate presets.
    p2Contributions: phase2Contributions,
    // User-scoped, flow-isolated standing instructions. Declared here so
    // `resolveUserStorageKey` picks up `flowIsolation: true` for storage-key
    // derivation; the capability's `core` preset also declares it for
    // runtime context access.
    specialInstructions: specialInstructionsResource,
  },
});

const flow = tradingDeskFlow({ id: "default" });

export default flow;
