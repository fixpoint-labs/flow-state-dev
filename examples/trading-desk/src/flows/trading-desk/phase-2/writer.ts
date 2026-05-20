/**
 * Phase 2 memo state-transition taps.
 *
 * Three commit blocks — bull, bear, research manager — because each
 * generator emits a different output schema. Mark-writing / mark-error
 * are generic over `Phase2MemoShortName`. Like Phase 1, each block
 * dual-writes: resource state for body content and `session.memoStatus`
 * for live navigator status.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  PHASE_2_MEMO_KEYS,
  type Phase2MemoShortName,
} from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
  type BearThesisOutput,
  type BullThesisOutput,
  type InvestmentThesisOutput,
} from "./thesis-schemas";

/** Pre-mark a Phase 2 memo as `writing` and stamp `startedAt`. */
export function markWritingP2(shortName: Phase2MemoShortName) {
  const { collectionKey, agentName } = PHASE_2_MEMO_KEYS[shortName];
  return handler({
    name: `mark-writing-p2-${shortName}`,
    inputSchema: z.unknown(),
    outputSchema: z.void(),
    sessionStateSchema,
    resources: memoResources,
    execute: async (_input, ctx) => {
      const ref = ctx.resources.memos.getOptional(collectionKey);
      const startedAt = new Date().toISOString();
      if (ref !== undefined) {
        await ref.patchState({ status: "writing", startedAt, agentName });
      } else {
        // Framework parses against memoStateSchema and applies
        // `.default(null)` to every nullable field — only the scaffold
        // needs to be supplied here.
        await ctx.resources.memos.create(collectionKey, {
          status: "writing",
          startedAt,
          agentName,
          agentTeam: "research",
          phaseId: "p2",
          ticker: ctx.session.state.ticker,
          date: ctx.session.state.date,
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", shortName, "writing");
      }
    },
  });
}

/** Mark a specific Phase 2 memo as `error` with the rescued error's message. */
export function markErrorP2(shortName: Phase2MemoShortName) {
  const { collectionKey } = PHASE_2_MEMO_KEYS[shortName];
  return handler({
    name: `mark-error-p2-${shortName}`,
    inputSchema: z.object({ error: z.unknown() }).passthrough(),
    outputSchema: z.object({ status: z.literal("error") }),
    sessionStateSchema,
    resources: memoResources,
    execute: async (input, ctx) => {
      const error = (input as { error?: unknown }).error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Phase 2 generator failed.";
      const ref = ctx.resources.memos.getOptional(collectionKey);
      if (ref !== undefined) {
        await ref.patchState({
          status: "error",
          errorMessage: message,
          completedAt: new Date().toISOString(),
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "error") {
        await ctx.session.setStateRecord("memoStatus", shortName, "error");
      }
      return { status: "error" as const };
    },
  });
}

/** Commit a `BullThesis` to `memos/p2/bull` and flip status to `published`. */
export const commitBullMemo = handler({
  name: "commit-memo-p2-bull",
  inputSchema: bullThesisOutputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (thesis: BullThesisOutput, ctx) => {
    // Use `get()` (throws) rather than `getOptional()` — by commit time
    // setupPhase2Memos and markWritingP2 have both created/patched the
    // memo. A silent no-op here was masking a real bug where the resource
    // wasn't visible across handler boundaries; surfacing the error sends
    // the failure into the per-step rescue (BP-016 / FIX-561).
    const ref = ctx.resources.memos.get(PHASE_2_MEMO_KEYS.bull.collectionKey);
    const completedAt = new Date().toISOString();
    await ref.patchState({
      status: "published",
      label: thesis.label,
      headline: thesis.headline,
      rating: thesis.rating,
      body: thesis.body,
      metrics: thesis.metrics,
      completedAt,
      errorMessage: null,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.bull !== "published") {
      await ctx.session.setStateRecord("memoStatus", "bull", "published");
    }
  },
});

/** Commit a `BearThesis` to `memos/p2/bear` and flip status to `published`. */
export const commitBearMemo = handler({
  name: "commit-memo-p2-bear",
  inputSchema: bearThesisOutputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (thesis: BearThesisOutput, ctx) => {
    const ref = ctx.resources.memos.get(PHASE_2_MEMO_KEYS.bear.collectionKey);
    const completedAt = new Date().toISOString();
    await ref.patchState({
      status: "published",
      label: thesis.label,
      headline: thesis.headline,
      rating: thesis.rating,
      body: thesis.body,
      metrics: thesis.metrics,
      completedAt,
      errorMessage: null,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.bear !== "published") {
      await ctx.session.setStateRecord("memoStatus", "bear", "published");
    }
  },
});

/**
 * Commit the research manager's `InvestmentThesis`. Populates the five
 * extension fields in addition to the standard `Thesis` shape so Phase 3+
 * can read the debate's outcome directly off the memo.
 */
export const commitResearchManagerMemo = handler({
  name: "commit-memo-p2-research-manager",
  inputSchema: investmentThesisOutputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (thesis: InvestmentThesisOutput, ctx) => {
    const ref = ctx.resources.memos.get(
      PHASE_2_MEMO_KEYS.researchManager.collectionKey,
    );
    const completedAt = new Date().toISOString();
    await ref.patchState({
      status: "published",
      label: thesis.label,
      headline: thesis.headline,
      rating: thesis.rating,
      body: thesis.body,
      metrics: thesis.metrics,
      completedAt,
      errorMessage: null,
      stance: thesis.stance,
      conviction: thesis.convictionScore,
      keyRisks: thesis.keyRisks,
      keyOpportunities: thesis.keyOpportunities,
      unresolvedDisagreements: thesis.unresolvedDisagreements,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.researchManager !== "published") {
      await ctx.session.setStateRecord(
        "memoStatus",
        "researchManager",
        "published",
      );
    }
  },
});
