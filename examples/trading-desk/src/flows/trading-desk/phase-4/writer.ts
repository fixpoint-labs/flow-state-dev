/**
 * Phase 4 memo state-transition taps.
 *
 * Factories — `markWritingP4`, `markErrorP4`, `commitPersonaMemo`,
 * `commitRiskAssessmentMemo` — share the same shape as Phase 3's writer:
 * each tap performs a dual write (resource patch + `session.memoStatus`
 * record). The three persona commits collapse into a single
 * `commitPersonaMemo(shortName)` factory because all three personas share
 * `personaCritiqueOutputSchema` — aggressive and conservative emit
 * `dismissedRisks: []` per their prompts, neutral populates it.
 * `riskAssessment` stays a one-off because its schema and extension
 * fields are unrelated to the persona shape.
 *
 * `markErrorP4` returns a `text` placeholder alongside `status: "error"`
 * so the rescue path's output is a non-empty value rather than `void`.
 * Downstream personas read prior critiques from the persona memos (which
 * `markErrorP4` flips to `error` with the captured `errorMessage`), not
 * from this output, so the placeholder is consumed only by tests.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { PHASE_4_MEMO_KEYS, type Phase4MemoShortName } from "../agents";
import { memoResources } from "../resources";
import { sessionStateSchema } from "../state";
import {
  personaCritiqueOutputSchema,
  riskAssessmentOutputSchema,
  type PersonaCritiqueOutput,
  type RiskAssessmentOutput,
} from "./schemas";

/** The three persona memos share a commit shape; `riskAssessment` does not. */
export type Phase4PersonaShortName = "aggressive" | "conservative" | "neutral";

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
      if (ref !== undefined) {
        await ref.patchState({ status: "writing", startedAt, agentName });
      } else {
        // Framework parses input against memoStateSchema and applies
        // `.default(null)` to every nullable field — only the scaffold
        // needs to be supplied here.
        await ctx.resources.memos.create(collectionKey, {
          status: "writing",
          startedAt,
          agentName,
          agentTeam: "risk",
          phaseId: "p4",
          ticker: ctx.session.state.ticker,
          date: ctx.session.state.date,
        });
      }
      if (ctx.session.state.memoStatus[shortName] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", shortName, "writing");
      }
    },
  });
}

/** Mark a specific Phase 4 memo as `error` with the rescued error's message.
 *  Returns a `{ status, text }` shape so the rescue path has a typed,
 *  non-empty output. The placeholder isn't consumed by downstream
 *  personas — they read prior critiques from the persona memos
 *  directly — but keeping a stable shape simplifies the test seam. */
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

function commonCommitPatch(critique: {
  label: string;
  headline: string;
  rating: string;
  metrics: Record<string, string>;
  body: unknown[];
}) {
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

/** Commit a persona's critique to its `memos/p4/{persona}-risk` memo. All
 *  three personas share `personaCritiqueOutputSchema` — the aggressive and
 *  conservative prompts emit `dismissedRisks: []`, neutral populates it.
 *  This uniformity is what lets the factory be one straight-line function
 *  instead of a schema-branching switch. */
export function commitPersonaMemo(shortName: Phase4PersonaShortName) {
  const { collectionKey } = PHASE_4_MEMO_KEYS[shortName];
  return handler({
    name: `commit-memo-p4-${shortName}`,
    inputSchema: personaCritiqueOutputSchema,
    outputSchema: z.void(),
    sessionStateSchema,
    resources: memoResources,
    execute: async (critique: PersonaCritiqueOutput, ctx) => {
      const ref = ctx.resources.memos.get(collectionKey);
      await ref.patchState({
        ...commonCommitPatch(critique),
        posture: critique.posture,
        raisedRisks: critique.raisedRisks,
        proposedAdjustments: critique.proposedAdjustments,
        dismissedRisks: critique.dismissedRisks,
      });
      if (ctx.session.state.memoStatus[shortName] !== "published") {
        await ctx.session.setStateRecord("memoStatus", shortName, "published");
      }
    },
  });
}

/** Commit the consolidated `RiskAssessment` to `memos/p4/risk-assessment`.
 *  Distinct from `commitPersonaMemo` because its output schema and
 *  extension fields (`criticalRisks`, `recommendedAdjustments`,
 *  `confidenceCalibration`, `calibrationRationale`) are unrelated to the
 *  persona shape. */
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
    if (ctx.session.state.memoStatus.riskAssessment !== "published") {
      await ctx.session.setStateRecord(
        "memoStatus",
        "riskAssessment",
        "published",
      );
    }
  },
});
