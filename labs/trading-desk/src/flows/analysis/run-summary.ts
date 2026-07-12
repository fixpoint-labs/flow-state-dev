/**
 * The headless run summary — a compact, machine-readable projection of one
 * finished (or stopped) `analyze` run.
 *
 * This is the headless sibling of the UI Summary (`components/summary/
 * aggregate.ts`): where that builds a render model for the browser, this builds
 * a stable JSON record an agent (or a `goals/` check) reads instead of the
 * browser. It records WHAT happened — final rating + clamps, target weight +
 * mandate gates, stop reason, per-memo status — and deliberately does NOT judge
 * whether the run was good — that is the eval suite's job (`src/eval/`; see
 * `docs/run-quality-eval.md`). The eval suite reads the deeper `runArtifacts`
 * bundle, not this compact summary.
 *
 * `buildRunSummary` is PURE (no IO, no clock): it maps already-read session
 * state, the decision-of-record snapshot (or null), and the memo list into the
 * summary. The clock-stamped `ranAt` and the run-level fields (`durationMs`,
 * `exitCode`, `error`, `capturePath`) are passed in, not derived here, so the
 * function stays unit-testable with fixed inputs. The `runSummary` flow action
 * reads the resources and calls this; a caller fills the run-level fields from
 * the `analyze` capture when it wants them (the action leaves them null).
 *
 * This is RESOURCE-STATE-adjacent (not a generator output), so `.nullable()` /
 * `.default()` are correct here — do NOT add it to `output-schemas-strict.spec.ts`.
 */
import { z } from "zod";
import { ratingSchema } from "./lib/rating-engine";
import type { DecisionSnapshotState } from "./decision-snapshot-resource";
import { ALL_MEMO_KEYS } from "./registry";
import type { MemoState, MemoStatus } from "./resources";
import type { SessionState } from "./state";

/** Run-level outcome: did the pipeline complete with a decision, stop cleanly at
 *  a guard, or fail to execute? `error` is what gets recorded when the `analyze`
 *  run itself failed (no decision was stored to read back); the action's
 *  projection of a stored run emits `completed`/`stopped`. */
export const runStatusSchema = z.enum(["completed", "stopped", "error"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

/** One memo's headless status line. */
export const runSummaryMemoSchema = z.object({
  /** Bare collection key, e.g. `p5/portfolio-manager`. */
  key: z.string(),
  /** The `AGENTS` identity backing this memo (e.g. `portfolioManager`). */
  agentName: z.string(),
  status: z.enum(["pending", "writing", "published", "error"]),
});
export type RunSummaryMemo = z.infer<typeof runSummaryMemoSchema>;

/** The machine-readable record of one headless `analyze` run. */
export const runSummaryStateSchema = z.object({
  // Identity (echoed from session state).
  ticker: z.string(),
  date: z.string(),
  costPreset: z.enum(["fast", "full"]),
  dataSource: z.enum(["fixture", "live", "record"]),
  mandateId: z.string().nullable().default(null),
  sessionId: z.string(),

  // Run-level. The action leaves these at their defaults; a caller fills them
  // from the analyze capture if it wants them (`capturePath` is the trace pointer).
  status: runStatusSchema,
  stopReason: z.string().nullable().default(null),
  stopMessage: z.string().nullable().default(null),
  durationMs: z.number().nullable().default(null),
  exitCode: z.number().nullable().default(null),
  error: z.string().nullable().default(null),
  capturePath: z.string().nullable().default(null),
  ranAt: z.string(),

  // Decision-of-record (null on stopped / errored runs).
  finalRating: ratingSchema.nullable().default(null),
  decisionConfidence: z.number().nullable().default(null),
  targetWeightPct: z.number().nullable().default(null),
  direction: z.enum(["long", "short", "flat"]).nullable().default(null),
  sizePct: z.number().nullable().default(null),
  stopPrice: z.number().nullable().default(null),
  targetPrice: z.number().nullable().default(null),
  holdingPeriod: z
    .enum(["days", "weeks", "months", "quarters"])
    .nullable()
    .default(null),
  decidedAt: z.string().nullable().default(null),

  // Mandate gates (null when mandate-blind / stopped).
  mandateVerdict: z.enum(["clears", "fails"]).nullable().default(null),
  capacityVetoed: z.boolean().nullable().default(null),
  rewardToRiskLossAdjustedGlr: z.number().nullable().default(null),
  worstCaseReturnPct: z.number().nullable().default(null),

  // Standing-thesis echo (FIX-760) — true when a durable per-position thesis was
  // injected into the decision tier on this run. The goal check's PASS signal.
  // Null on a stopped / errored run that never reached the PM.
  hasStandingThesis: z.boolean().nullable().default(null),

  // Per-memo status + an error rollup.
  memos: z.array(runSummaryMemoSchema),
  memoErrors: z.number(),
});
export type RunSummary = z.infer<typeof runSummaryStateSchema>;

/** A memo as read back from the collection: its bare key, the backing agent
 *  identity, and its current state (null when the scaffold was never created —
 *  e.g. a phase that never ran). */
export type RunSummaryMemoInput = {
  key: string;
  agentName: string;
  state: MemoState | null;
};

/** Inputs `buildRunSummary` projects. All are already-read snapshots; the
 *  function performs no IO. */
export type BuildRunSummaryInput = {
  sessionState: SessionState;
  decisionSnapshot: DecisionSnapshotState | null;
  memos: RunSummaryMemoInput[];
  sessionId: string;
  /** ISO timestamp, stamped by the caller (kept out of this pure function so it
   *  stays deterministic in tests). */
  ranAt: string;
};

/** A decision snapshot counts as present only when it carries a `finalRating`.
 *  An unwritten single resource can surface as `{}` rather than null (the
 *  `lib/format.ts` guard-on-a-required-field precedent), so a bare null check
 *  is not enough. Exported so `buildRunArtifacts` normalizes the snapshot the
 *  same way (`run-artifacts.ts`). */
export function hasDecision(
  snapshot: DecisionSnapshotState | null,
): snapshot is DecisionSnapshotState {
  return snapshot != null && typeof snapshot.finalRating === "string";
}

/**
 * Project a finished or stopped run into a `RunSummary`. Pure: no resource
 * reads, no clock. The status is derived from stored state — a guard stop wins
 * (`stopped`), else a present decision means `completed`, else `error` (a
 * defensive fallback a caller avoids by only reading back after a successful
 * analyze run).
 */
export function buildRunSummary(input: BuildRunSummaryInput): RunSummary {
  const { sessionState, decisionSnapshot, memos, sessionId, ranAt } = input;

  const stopReason = sessionState.stoppedReason ?? null;
  const decision = hasDecision(decisionSnapshot) ? decisionSnapshot : null;
  const status: RunStatus =
    stopReason !== null ? "stopped" : decision !== null ? "completed" : "error";

  const memoLines: RunSummaryMemo[] = memos.map((memo) => ({
    key: memo.key,
    agentName: memo.agentName,
    status: (memo.state?.status ?? "pending") as MemoStatus,
  }));
  const memoErrors = memoLines.filter((memo) => memo.status === "error").length;

  // The post-clamp target weight lives only on the PM memo's `portfolioFit`
  // mirror — read it from there, not the decision snapshot (which tracks the
  // trader's `sizePct`, a different figure).
  const pmMemo = memos.find(
    (memo) => memo.key === ALL_MEMO_KEYS.portfolioManager.collectionKey,
  );
  const targetWeightPct = pmMemo?.state?.portfolioFit?.targetWeightPct ?? null;

  return {
    ticker: sessionState.ticker,
    date: sessionState.date,
    costPreset: sessionState.costPreset,
    dataSource: sessionState.dataSource,
    mandateId: decision?.mandateId ?? sessionState.riskMandate?.id ?? null,
    sessionId,

    status,
    stopReason,
    stopMessage: sessionState.stoppedMessage ?? null,
    durationMs: null,
    exitCode: null,
    error: null,
    capturePath: null,
    ranAt,

    finalRating: decision?.finalRating ?? null,
    decisionConfidence: decision?.decisionConfidence ?? null,
    targetWeightPct,
    direction: decision?.direction ?? null,
    sizePct: decision?.sizePct ?? null,
    stopPrice: decision?.stopPrice ?? null,
    targetPrice: decision?.targetPrice ?? null,
    holdingPeriod: decision?.holdingPeriod ?? null,
    decidedAt: decision?.decidedAt ?? null,

    mandateVerdict: decision?.mandateVerdict ?? null,
    capacityVetoed: decision?.capacityVetoed ?? null,
    rewardToRiskLossAdjustedGlr: decision?.rewardToRiskLossAdjustedGlr ?? null,
    worstCaseReturnPct: decision?.worstCaseReturnPct ?? null,
    hasStandingThesis: decision?.hasStandingThesis ?? null,

    memos: memoLines,
    memoErrors,
  };
}
