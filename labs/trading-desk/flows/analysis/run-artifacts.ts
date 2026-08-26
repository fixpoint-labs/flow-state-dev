/**
 * The headless run-artifacts bundle — the full scored-artifact projection of one
 * finished (or stopped) `analyze` run, the read seam the eval suite (FIX-790)
 * scores against.
 *
 * This is the deeper sibling of `run-summary.ts`: where `RunSummary` is the
 * compact decision projection, `RunArtifactsBundle` carries everything the
 * deterministic invariant layer recomputes against and everything the LLM-judge
 * layer reads — the valuation spine, the reward-to-risk figure, lens
 * convergence, the decision snapshot, the frozen risk mandate, the Phase-2
 * debate transcript, the frozen durable-policy inputs, and every memo body.
 * `buildRunArtifacts` is PURE (no IO, no clock) exactly like `buildRunSummary`;
 * the `runArtifacts` action
 * (`orchestration/run-artifacts-action.ts`) reads the resources and calls this.
 *
 * Kept a leaf (schema + type + pure builder, no `@flow-state-dev/core` handler
 * or Node-only resource imports) so `eval/` and its offline tests can
 * import `RunArtifactsBundle` and the schema without pulling the flow runtime.
 *
 * This is RESOURCE-STATE-adjacent (a projection of resource state, not a
 * generator output), so `.nullable()` / `.default()` are correct here — do NOT
 * add it to `output-schemas-strict.spec.ts` (the `run-summary.ts` precedent).
 */
import { roundRobinContributionsStateSchema } from "@flow-state-dev/patterns/round-robin";
import type { RoundRobinContributionsState } from "@flow-state-dev/patterns/round-robin";
import { z } from "zod";
import {
  portfolioMandateSchema,
  type PortfolioMandate,
} from "../../domain/portfolio/schema/portfolio-mandate-schema";
import {
  decisionSnapshotStateSchema,
  type DecisionSnapshotState,
} from "./decision-snapshot-resource";
import { lensConvergenceStateSchema } from "./agents/lenses/lens-convergence-resource";
import type { LensConvergenceState } from "./agents/lenses/lens-convergence-resource";
import { riskMandateSchema } from "./lib/risk-mandate";
import type { RiskMandate } from "./lib/risk-mandate";
import {
  citationIntegritySchema,
  memoStateSchema,
  type CitationIntegrity,
  type MemoState,
} from "./resources";
import {
  buildRunSummary,
  hasDecision,
  runSummaryStateSchema,
  type RunSummaryMemoInput,
} from "./run-summary";
import type { SessionState } from "./state";
import { isPreDataHonestyFix } from "./data-honesty-contract";
import {
  rewardToRiskStateSchema,
  type RewardToRiskState,
} from "./reward-to-risk-resource";
import {
  valuationSpineStateSchema,
  type ValuationSpineState,
} from "./valuation-spine-resource";

/** One memo in the bundle: its bare collection key and full stored body (null
 *  when the memo was never created — the `fast` preset omits `p2b/*`, a
 *  no-thesis run omits `p6`). Mirrors `runSummaryAction`'s getOptional-miss
 *  handling so completeness checks tell absent from malformed. */
export const runArtifactsMemoSchema = z.object({
  key: z.string(),
  state: memoStateSchema.nullable(),
});
export type RunArtifactsMemo = z.infer<typeof runArtifactsMemoSchema>;

/** The full scored-artifact bundle for one session — the substrate the eval
 *  suite's deterministic and judge layers both read. Every nullable field is
 *  `null` when its resource was never written (stopped run, mandate-blind run,
 *  fast preset, no thesis, or a legacy session predating the field), never a
 *  partial `{}` — so a completeness check can tell absent from malformed. */
export const runArtifactsStateSchema = z.object({
  // The compact decision projection, built verbatim by `buildRunSummary`.
  summary: runSummaryStateSchema,
  // The valuation spine (null pre-Phase-1 / on failure).
  valuationSpine: valuationSpineStateSchema.nullable().default(null),
  // The scenario-derived reward-to-risk figure (null when no usable buckets).
  rewardToRisk: rewardToRiskStateSchema.nullable().default(null),
  // Deterministic lens convergence (null on `fast` — the pack is skipped).
  lensConvergence: lensConvergenceStateSchema.nullable().default(null),
  // The durable decision-of-record (null on a stopped / errored run).
  decisionSnapshot: decisionSnapshotStateSchema.nullable().default(null),
  // The frozen mandate dials from session state (null on a mandate-blind run).
  riskMandate: riskMandateSchema.nullable().default(null),
  // The frozen durable household policy and analyzed ticker's household weight
  // used by the PM policy gate. Together they let evals recompute that gate.
  portfolioMandate: portfolioMandateSchema.nullable().default(null),
  householdTickerWeightPct: z.number().nullable().default(null),
  // Phase-2 citation-integrity report (null when no tagged contributions).
  citationIntegrity: citationIntegritySchema.nullable().default(null),
  // `state.userThesis !== null` — makes the p6 completeness check deterministic
  // (a completeness check can't otherwise tell a valid no-thesis run from a run
  // that silently dropped the thesis-alignment memo).
  hasUserThesis: z.boolean(),
  // True when this run predates the data-honesty contract (FIX-1063) and its
  // figures may therefore contain values nobody measured. Defaults TRUE, so a
  // bundle read from a legacy session — or one where the field never wrote —
  // is treated as unverified rather than silently vouched for.
  preDataHonestyFix: z.boolean().default(true),
  // Phase-2 round-robin turn transcript. `null` when Phase 2 never produced a
  // turn (the debate-engagement judge needs the raw turns, not just the
  // consolidated bull/bear/RM memos) — never `{entries: []}` (see `buildRunArtifacts`).
  p2Contributions: roundRobinContributionsStateSchema.nullable().default(null),
  // Full memo bodies (state null when the memo was never created).
  memos: z.array(runArtifactsMemoSchema),
});
export type RunArtifactsBundle = z.infer<typeof runArtifactsStateSchema>;

/** Inputs `buildRunArtifacts` projects. All are already-read snapshots (the
 *  action performs the resource reads); the function performs no IO and no
 *  clock read. The three session-state-sourced fields (`riskMandate`,
 *  `citationIntegrity`, `hasUserThesis`) are derived from `sessionState` here,
 *  not passed separately. */
export type BuildRunArtifactsInput = {
  sessionState: SessionState;
  decisionSnapshot: DecisionSnapshotState | null;
  memos: RunSummaryMemoInput[];
  valuationSpine: ValuationSpineState | null;
  rewardToRisk: RewardToRiskState | null;
  lensConvergence: LensConvergenceState | null;
  p2Contributions: RoundRobinContributionsState | null;
  sessionId: string;
  /** ISO timestamp, stamped by the caller (kept out of this pure function so it
   *  stays deterministic in tests). Forwarded to `buildRunSummary`. */
  ranAt: string;
};

/** A valuation spine counts as present only when it carries its `ticker`
 *  identity — an unwritten single resource can surface as `{}` (the
 *  `run-summary.ts` `hasDecision` precedent). */
function hasSpine(
  spine: ValuationSpineState | null,
): spine is ValuationSpineState {
  return spine != null && typeof spine.ticker === "string";
}

/** A reward-to-risk figure counts as present only when it carries its
 *  `evidenceBasis` enum (always set on a real write; absent on a `{}` read). */
function hasRewardToRisk(
  rr: RewardToRiskState | null,
): rr is RewardToRiskState {
  return rr != null && typeof rr.evidenceBasis === "string";
}

/** Lens convergence counts as present only when it carries its `classification`
 *  bucket (absent on a `{}` read). */
function hasConvergence(
  lc: LensConvergenceState | null,
): lc is LensConvergenceState {
  return lc != null && typeof lc.classification === "string";
}

/** A Phase-2 transcript counts as present only when it holds at least one turn.
 *  A never-written contributions resource surfaces as `{}` and parses to
 *  `{entries: []}` (the schema defaults `entries`), so a bare null check would
 *  mistake "no Phase-2 substrate" for "a real but empty debate". Absent → null,
 *  never `{entries: []}` (spec §4.3). */
function hasTranscript(
  p2: RoundRobinContributionsState | null,
): p2 is RoundRobinContributionsState {
  return p2 != null && Array.isArray(p2.entries) && p2.entries.length > 0;
}

/**
 * Project a finished or stopped run into a `RunArtifactsBundle`. Pure: no
 * resource reads, no clock. Each nullable field is normalized so a
 * never-written resource is `null` (never a partial `{}` or empty transcript) —
 * so the deterministic completeness checks tell absent from malformed.
 */
export function buildRunArtifacts(
  input: BuildRunArtifactsInput,
): RunArtifactsBundle {
  const {
    sessionState,
    decisionSnapshot,
    memos,
    valuationSpine,
    rewardToRisk,
    lensConvergence,
    p2Contributions,
    sessionId,
    ranAt,
  } = input;

  const summary = buildRunSummary({
    sessionState,
    decisionSnapshot,
    memos,
    sessionId,
    ranAt,
  });

  return {
    summary,
    valuationSpine: hasSpine(valuationSpine) ? valuationSpine : null,
    rewardToRisk: hasRewardToRisk(rewardToRisk) ? rewardToRisk : null,
    lensConvergence: hasConvergence(lensConvergence) ? lensConvergence : null,
    decisionSnapshot: hasDecision(decisionSnapshot) ? decisionSnapshot : null,
    // Session-state-sourced fields (frozen dials + the thesis presence flag).
    riskMandate: (sessionState.riskMandate as RiskMandate | null) ?? null,
    portfolioMandate:
      (sessionState.portfolioMandate as PortfolioMandate | null) ?? null,
    householdTickerWeightPct: sessionState.householdTickerWeightPct ?? null,
    citationIntegrity:
      (sessionState.citationIntegrity as CitationIntegrity | null) ?? null,
    // `!= null` (not `!== null`) so an absent field on a partial / legacy
    // session reads as "no thesis" rather than truthy-undefined (BP-030).
    hasUserThesis: sessionState.userThesis != null,
    // Whether this run's stored figures predate the data-honesty contract
    // (FIX-1063). Derived through the SAME predicate the Summary marker uses,
    // so a scored artifact bundle and a rendered report can never disagree
    // about whether a run is PRE-FIX. Absent stamp → pre-fix.
    //
    // `false` means "not known to predate the corrections", NOT "trustworthy":
    // the contract version covers the surfaces named in
    // `data-honesty-contract.ts`, not every figure in the bundle. A judge or
    // scorer reading this must not treat it as a quality signal.
    preDataHonestyFix: isPreDataHonestyFix(sessionState.dataHonestyContractVersion),
    p2Contributions: hasTranscript(p2Contributions) ? p2Contributions : null,
    memos: memos.map((memo) => ({
      key: memo.key,
      state: (memo.state as MemoState | null) ?? null,
    })),
  };
}
