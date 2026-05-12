/**
 * Phase 4 memo state-transition taps.
 *
 * Generic `markWritingP4` / `markErrorP4` factories (same shape as Phase 3's),
 * plus four commit handlers — one per memo. Each commit handler asserts
 * the resource ref exists (`get()` throws on miss): by commit time setup
 * and `markWritingP4` have created or patched the resource, and a missing
 * ref signals a real bug we want surfaced through the per-step rescue.
 *
 * `markErrorP4` returns a `text` field in addition to `status`. The
 * persona steps live inside the round-robin's `.then(agent).tap(record)`
 * frame, where `record-contribution` coerces the upstream output to a
 * string via `obj.text`. Returning a `text` placeholder on rescue means
 * subsequent personas see "(critique unavailable: …)" in the round-robin
 * transcript instead of `String(error)` noise.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  PHASE_4_MEMO_KEYS,
  type Phase4MemoShortName,
} from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";
import {
  neutralCritiqueOutputSchema,
  personaCritiqueOutputSchema,
  riskAssessmentOutputSchema,
  type NeutralCritiqueOutput,
  type PersonaCritiqueOutput,
  type RiskAssessmentOutput,
} from "./schemas";

const ERROR_OUTPUT_SCHEMA = z.object({
  status: z.literal("error"),
  text: z.string(),
});

/** Pre-mark a Phase 4 memo as `writing` and stamp `startedAt`. */
export function markWritingP4(shortName: Phase4MemoShortName) {
  const { collectionKey, agentName } = PHASE_4_MEMO_KEYS[shortName];
  return handler({
    name: `mark-writing-p4-${shortName}`,
    inputSchema: z.unknown(),
    outputSchema: z.void(),
    sessionStateSchema,
    resources: memoResources,
    execute: async (_input, ctx) => {
      const ref = ctx.resources.memos.getOptional(collectionKey);
      const startedAt = new Date().toISOString();
      const patch = {
        status: "writing" as const,
        startedAt,
        agentName,
      };
      if (ref !== undefined) {
        await ref.patchState(patch);
      } else {
        await ctx.resources.memos.create(collectionKey, {
          ...patch,
          agentTeam: "risk",
          phaseId: "p4",
          ticker: ctx.session.state.ticker,
          date: ctx.session.state.date,
          label: null,
          headline: null,
          rating: null,
          body: null,
          metrics: null,
          completedAt: null,
          errorMessage: null,
          stance: null,
          conviction: null,
          keyRisks: null,
          keyOpportunities: null,
          unresolvedDisagreements: null,
          direction: null,
          sizePct: null,
          stopPrice: null,
          targetPrice: null,
          holdingPeriod: null,
          invalidationCriteria: null,
          dependsOn: null,
          posture: null,
          raisedRisks: null,
          proposedAdjustments: null,
          dismissedRisks: null,
          criticalRisks: null,
          recommendedAdjustments: null,
          confidenceCalibration: null,
          calibrationRationale: null,
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", shortName, "writing");
      }
    },
  });
}

/** Mark a specific Phase 4 memo as `error` with the rescued error's message.
 *  Returns a `{ text }`-bearing object so the round-robin's record-contribution
 *  tap renders a graceful placeholder for the next persona. */
export function markErrorP4(shortName: Phase4MemoShortName) {
  const { collectionKey, agentName } = PHASE_4_MEMO_KEYS[shortName];
  return handler({
    name: `mark-error-p4-${shortName}`,
    inputSchema: z.object({ error: z.unknown() }).passthrough(),
    outputSchema: ERROR_OUTPUT_SCHEMA,
    sessionStateSchema,
    resources: memoResources,
    execute: async (input, ctx) => {
      const error = (input as { error?: unknown }).error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Phase 4 generator failed.";
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
      return {
        status: "error" as const,
        text: `(critique unavailable: ${agentName})`,
      };
    },
  });
}

function commonCommitPatch<T extends { label: string; headline: string; rating: string; metrics: Record<string, string>; body: unknown[] }>(
  critique: T,
) {
  return {
    status: "published" as const,
    label: critique.label,
    headline: critique.headline,
    rating: critique.rating,
    body: critique.body,
    metrics: critique.metrics,
    completedAt: new Date().toISOString(),
    errorMessage: null,
  };
}

/** Commit the aggressive persona's critique to `memos/p4/aggressive-risk`. */
export const commitAggressiveRiskMemo = handler({
  name: "commit-memo-p4-aggressive",
  inputSchema: personaCritiqueOutputSchema,
  outputSchema: personaCritiqueOutputSchema,
  sessionStateSchema,
  resources: memoResources,
  execute: async (critique: PersonaCritiqueOutput, ctx) => {
    const ref = ctx.resources.memos.get(
      PHASE_4_MEMO_KEYS.aggressive.collectionKey,
    );
    await ref.patchState({
      ...commonCommitPatch(critique),
      posture: critique.posture,
      raisedRisks: critique.raisedRisks,
      proposedAdjustments: critique.proposedAdjustments,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.aggressive !== "published") {
      await ctx.session.setStateRecord("memoStatus", "aggressive", "published");
    }
    return critique;
  },
});

/** Commit the conservative persona's critique to `memos/p4/conservative-risk`. */
export const commitConservativeRiskMemo = handler({
  name: "commit-memo-p4-conservative",
  inputSchema: personaCritiqueOutputSchema,
  outputSchema: personaCritiqueOutputSchema,
  sessionStateSchema,
  resources: memoResources,
  execute: async (critique: PersonaCritiqueOutput, ctx) => {
    const ref = ctx.resources.memos.get(
      PHASE_4_MEMO_KEYS.conservative.collectionKey,
    );
    await ref.patchState({
      ...commonCommitPatch(critique),
      posture: critique.posture,
      raisedRisks: critique.raisedRisks,
      proposedAdjustments: critique.proposedAdjustments,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.conservative !== "published") {
      await ctx.session.setStateRecord("memoStatus", "conservative", "published");
    }
    return critique;
  },
});

/** Commit the neutral persona's critique to `memos/p4/neutral-risk`.
 *  Same persona fields as aggressive/conservative plus `dismissedRisks`. */
export const commitNeutralRiskMemo = handler({
  name: "commit-memo-p4-neutral",
  inputSchema: neutralCritiqueOutputSchema,
  outputSchema: neutralCritiqueOutputSchema,
  sessionStateSchema,
  resources: memoResources,
  execute: async (critique: NeutralCritiqueOutput, ctx) => {
    const ref = ctx.resources.memos.get(PHASE_4_MEMO_KEYS.neutral.collectionKey);
    await ref.patchState({
      ...commonCommitPatch(critique),
      posture: critique.posture,
      raisedRisks: critique.raisedRisks,
      proposedAdjustments: critique.proposedAdjustments,
      dismissedRisks: critique.dismissedRisks,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.neutral !== "published") {
      await ctx.session.setStateRecord("memoStatus", "neutral", "published");
    }
    return critique;
  },
});

/** Commit the consolidated `RiskAssessment` to `memos/p4/risk-assessment`. */
export const commitRiskAssessmentMemo = handler({
  name: "commit-memo-p4-risk-assessment",
  inputSchema: riskAssessmentOutputSchema,
  outputSchema: z.void(),
  sessionStateSchema,
  resources: memoResources,
  execute: async (assessment: RiskAssessmentOutput, ctx) => {
    const ref = ctx.resources.memos.get(
      PHASE_4_MEMO_KEYS.riskAssessment.collectionKey,
    );
    await ref.patchState({
      ...commonCommitPatch(assessment),
      criticalRisks: assessment.criticalRisks,
      dismissedRisks: assessment.dismissedRisks,
      recommendedAdjustments: assessment.recommendedAdjustments,
      confidenceCalibration: assessment.confidenceCalibration,
      calibrationRationale: assessment.calibrationRationale,
    });
    const memoStatus = ctx.session.state.memoStatus;
    if (memoStatus.riskAssessment !== "published") {
      await ctx.session.setStateRecord(
        "memoStatus",
        "riskAssessment",
        "published",
      );
    }
  },
});
