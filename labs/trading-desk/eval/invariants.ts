/**
 * Deterministic invariant layer (FIX-790) — pure, total, zero model cost.
 *
 * `checkRun(bundle)` recomputes and cross-checks the recorded decision for
 * internal contradictions: a rating outside its allowed band, scenario
 * probabilities that don't cohere, a committed size that ignores the mandate
 * gates, snapshot/memo mirrors that disagree, dishonest valuation abstention,
 * malformed citations. Every check reports `{id, severity, status, expected?,
 * actual?, detail}` — never a pre-aggregated number.
 *
 * The layer asserts ONLY on the computed/derived records; all LLM-emitted prose
 * routes to the judge layer (a fixture replay still calls real generators, so
 * memo text is nondeterministic run-to-run — asserting on it would be
 * permanently red, spec §Key-Decisions-2). Recomputation checks reuse the desk's
 * OWN pure libs (`ratingBandFor`, `computeMandateGates`, `computeRewardToRisk`) —
 * they catch stored-record DRIFT and partial writes, not formula bugs.
 *
 * Total & never-throwing: missing substrate degrades a check to `skipped` with a
 * reason (BP-030/BP-035 second-path — an old session, a mandate-blind run, or a
 * `fast` preset must never turn a check into a false `fail`).
 */
import { ALL_MEMO_KEYS } from "../flows/analysis/registry";
import type { MemoState } from "../flows/analysis/resources";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";
import { computeMandateGates } from "../flows/analysis/lib/mandate-gates";
import { computeRewardToRisk } from "../flows/analysis/lib/reward-to-risk";
import {
  ratingBandFor,
  ratingIndex,
  type FinalRating,
} from "../flows/analysis/lib/rating-engine";
import type { CheckResult, InvariantReport } from "./types";

// ── Collection keys the checks reach for ─────────────────────────────────
const PM_KEY = ALL_MEMO_KEYS.portfolioManager.collectionKey;
const SCENARIO_KEY = ALL_MEMO_KEYS.scenarioForecast.collectionKey;
const TRADER_KEY = ALL_MEMO_KEYS.trader.collectionKey;
const THESIS_KEY = ALL_MEMO_KEYS.thesisAlignment.collectionKey;

/** Numeric compare with a tiny tolerance (records round-trip through JSON, so a
 *  recompute should match near-exactly; the epsilon guards double drift). */
function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

/** A push-based accumulator so each group appends without threading the array. */
class Checks {
  readonly results: CheckResult[] = [];
  hardPass(id: string, detail: string): void {
    this.results.push({ id, severity: "hard", status: "pass", detail });
  }
  hardFail(id: string, detail: string, expected?: unknown, actual?: unknown): void {
    this.results.push({ id, severity: "hard", status: "fail", detail, expected, actual });
  }
  softPass(id: string, detail: string): void {
    this.results.push({ id, severity: "soft", status: "pass", detail });
  }
  softFlag(id: string, detail: string, expected?: unknown, actual?: unknown): void {
    this.results.push({ id, severity: "soft", status: "flag", detail, expected, actual });
  }
  skip(id: string, severity: "hard" | "soft", detail: string): void {
    this.results.push({ id, severity, status: "skipped", detail });
  }
}

type MemoMap = Map<string, MemoState | null>;

function memoMap(bundle: RunArtifactsBundle): MemoMap {
  const map: MemoMap = new Map();
  for (const m of bundle.memos) map.set(m.key, m.state);
  return map;
}

/** A memo counts as present only when its body was published/errored — a null
 *  (never-created) scaffold reads as absent. */
function published(state: MemoState | null | undefined): MemoState | null {
  return state != null && state.status === "published" ? state : null;
}

// ── memo-completeness/* ──────────────────────────────────────────────────
function checkMemoCompleteness(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const status = bundle.summary.status;
  if (status === "error") {
    c.skip(
      "memo-completeness/expected-set",
      "hard",
      "run errored (no decision recorded) — memo completeness not asserted",
    );
    return;
  }

  // Expected set for a completed run: every memo, minus the lens pack on `fast`
  // and minus the Phase-6 audit when no thesis was supplied.
  const expected = Object.values(ALL_MEMO_KEYS).filter((entry) => {
    if (bundle.summary.costPreset === "fast" && entry.phaseId === "p2b") return false;
    if (entry.collectionKey === THESIS_KEY && !bundle.hasUserThesis) return false;
    return true;
  });

  if (status === "stopped") {
    // Pre-stop expectations only: a memo mid-write when the run stopped is a
    // contradiction, but a never-reached `pending` memo is expected.
    let writingViolations = 0;
    for (const m of bundle.memos) {
      if (m.state?.status === "writing") {
        c.hardFail(
          "memo-completeness/no-writing-on-stop",
          `memo ${m.key} left in "writing" on a stopped run`,
          "not writing",
          "writing",
        );
        writingViolations++;
      }
    }
    if (writingViolations === 0) {
      c.hardPass(
        "memo-completeness/no-writing-on-stop",
        "no memo left mid-write on the stopped run",
      );
    }
    return;
  }

  // Completed run: each expected memo published, or honestly errored with a message.
  let missing = 0;
  let erroredNoMessage = 0;
  for (const entry of expected) {
    const state = memos.get(entry.collectionKey) ?? null;
    if (state == null || state.status === "pending" || state.status === "writing") {
      c.hardFail(
        "memo-completeness/expected-published",
        `expected memo ${entry.collectionKey} is ${state?.status ?? "absent"} on a completed run`,
        "published | error",
        state?.status ?? "absent",
      );
      missing++;
      continue;
    }
    if (state.status === "error") {
      const msg = state.errorMessage ?? "";
      if (msg.trim().length === 0) {
        c.hardFail(
          "memo-completeness/errored-has-message",
          `errored memo ${entry.collectionKey} carries no error message (an honest error must say why)`,
        );
        erroredNoMessage++;
      }
    }
  }
  if (missing === 0) {
    c.hardPass(
      "memo-completeness/expected-published",
      `all ${expected.length} expected memos published or honestly errored`,
    );
  }
  if (erroredNoMessage === 0) {
    c.hardPass(
      "memo-completeness/errored-has-message",
      "every errored memo carries a non-empty error message",
    );
  }
}

// ── rating-envelope/* ────────────────────────────────────────────────────
function checkRatingEnvelope(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const snapshot = bundle.decisionSnapshot;
  const pm = published(memos.get(PM_KEY));
  const spine = bundle.valuationSpine;
  // The band to check against: the PM memo's mirror, or the spine envelope as a
  // fallback. Genuinely absent only when there is no decision and neither source.
  const spineBand = spine != null ? { floor: spine.envelope.floor, ceiling: spine.envelope.ceiling } : null;
  const band = pm?.ratingBand ?? spineBand;
  if (snapshot == null || pm == null || band == null) {
    c.skip(
      "rating-envelope/final-within-band",
      "hard",
      "no decision snapshot / no rating band or valuation spine to check against",
    );
    return;
  }
  // A run WITH a valuation spine must mirror its rating band onto the PM memo —
  // a dropped mirror is a regression, not missing substrate (we fall back to the
  // spine envelope so the envelope checks still run).
  if (pm.ratingBand == null && spine != null) {
    c.hardFail(
      "rating-envelope/pm-band-present",
      "PM memo dropped its rating band mirror on a run with a valuation spine",
    );
  }
  const finalRating = snapshot.finalRating as FinalRating;
  const floorIdx = ratingIndex(band.floor);
  const ceilingIdx = ratingIndex(band.ceiling);
  const finalIdx = ratingIndex(finalRating);
  const override = (pm.ratingOverrideReason ?? "").trim().length > 0;

  // Final rating within the band — unless a stated override lifted it out.
  if (finalIdx >= floorIdx && finalIdx <= ceilingIdx) {
    c.hardPass(
      "rating-envelope/final-within-band",
      `finalRating ${finalRating} within [${band.floor}, ${band.ceiling}]`,
    );
  } else if (override) {
    c.hardPass(
      "rating-envelope/final-within-band",
      `finalRating ${finalRating} outside band but a rating override reason is recorded`,
    );
  } else {
    c.hardFail(
      "rating-envelope/final-within-band",
      `finalRating ${finalRating} outside [${band.floor}, ${band.ceiling}] with no override reason`,
      `[${band.floor}, ${band.ceiling}]`,
      finalRating,
    );
  }

  // A clamp lands the rating on a band edge (the raw pre-clamp rating is never
  // persisted, so this is one-directional).
  if (pm.ratingClamped === true) {
    const onEdge = finalRating === band.floor || finalRating === band.ceiling;
    if (onEdge) {
      c.hardPass(
        "rating-envelope/clamp-implies-edge",
        `clamped rating ${finalRating} lands on a band edge`,
      );
    } else {
      c.hardFail(
        "rating-envelope/clamp-implies-edge",
        `ratingClamped is true but finalRating ${finalRating} is not a band edge`,
        `${band.floor} | ${band.ceiling}`,
        finalRating,
      );
    }
  }

  // Band recomputation from the spine's implied rating + evidence thinness.
  if (spine == null) {
    c.skip(
      "rating-envelope/band-recompute",
      "hard",
      "valuation spine absent — cannot recompute the band",
    );
    return;
  }
  const thin =
    spine.setupScore.evidenceBasis === "thin" || spine.expectedReturn.lowConfidence;
  const recomputed = ratingBandFor(spine.envelope.implied, thin);
  if (
    recomputed.floor === spine.envelope.floor &&
    recomputed.ceiling === spine.envelope.ceiling
  ) {
    c.hardPass(
      "rating-envelope/band-recompute",
      `band [${spine.envelope.floor}, ${spine.envelope.ceiling}] matches recomputation from implied ${spine.envelope.implied}`,
    );
  } else {
    c.hardFail(
      "rating-envelope/band-recompute",
      `stored band disagrees with recomputation from implied ${spine.envelope.implied} (thin=${thin})`,
      `[${recomputed.floor}, ${recomputed.ceiling}]`,
      `[${spine.envelope.floor}, ${spine.envelope.ceiling}]`,
    );
  }
}

// ── scenario/* ───────────────────────────────────────────────────────────
function checkScenarios(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const memo = published(memos.get(SCENARIO_KEY));
  const scenarios = memo?.scenarios ?? null;
  if (memo == null || scenarios == null) {
    c.skip("scenario/count", "hard", "no scenario-forecaster memo (Phase 5a absent)");
    return;
  }

  // 3–5 scenarios.
  if (scenarios.length >= 3 && scenarios.length <= 5) {
    c.hardPass("scenario/count", `${scenarios.length} scenarios (within 3–5)`);
  } else {
    c.hardFail("scenario/count", `${scenarios.length} scenarios outside 3–5`, "3–5", scenarios.length);
  }

  // Each probability ∈ [0, 1]; each expectedReturnPct is number-or-null.
  let probOutOfRange = 0;
  let badReturnType = 0;
  for (const s of scenarios) {
    if (!(typeof s.probability === "number" && s.probability >= 0 && s.probability <= 1)) {
      probOutOfRange++;
    }
    if (!(s.expectedReturnPct === null || typeof s.expectedReturnPct === "number")) {
      badReturnType++;
    }
  }
  if (probOutOfRange === 0) {
    c.hardPass("scenario/probability-range", "every scenario probability ∈ [0, 1]");
  } else {
    c.hardFail(
      "scenario/probability-range",
      `${probOutOfRange} scenario probabilities outside [0, 1]`,
    );
  }
  if (badReturnType === 0) {
    c.hardPass("scenario/return-type", "every expectedReturnPct is number-or-null");
  } else {
    c.hardFail(
      "scenario/return-type",
      `${badReturnType} scenario expectedReturnPct values are neither number nor null`,
    );
  }

  // Recomputed sum of the STORED (normalized) probabilities within [0.98, 1.02].
  const sum = scenarios.reduce((acc, s) => acc + (Number(s.probability) || 0), 0);
  if (sum >= 0.98 && sum <= 1.02) {
    c.hardPass("scenario/probability-sum", `stored probabilities sum to ${sum.toFixed(4)} (∈ [0.98, 1.02])`);
  } else {
    c.hardFail(
      "scenario/probability-sum",
      `stored probabilities sum to ${sum.toFixed(4)} outside [0.98, 1.02]`,
      "[0.98, 1.02]",
      sum,
    );
  }

  // The recorded raw pre-normalization sum — a SEPARATE looser check, never
  // equality with the recomputed sum.
  const rawSum = memo.probabilitySum;
  if (rawSum == null) {
    c.skip("scenario/raw-sum", "hard", "no recorded probabilitySum");
  } else if (rawSum >= 0.8 && rawSum <= 1.2) {
    c.hardPass("scenario/raw-sum", `recorded probabilitySum ${rawSum} (∈ [0.8, 1.2])`);
  } else {
    c.hardFail(
      "scenario/raw-sum",
      `recorded probabilitySum ${rawSum} outside [0.8, 1.2]`,
      "[0.8, 1.2]",
      rawSum,
    );
  }
}

// ── reward-risk/* ────────────────────────────────────────────────────────
function checkRewardToRisk(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const memo = published(memos.get(SCENARIO_KEY));
  const scenarios = memo?.scenarios ?? null;
  if (scenarios == null) {
    c.skip("reward-risk/recompute", "hard", "no scenario buckets to recompute from");
    return;
  }
  const usable = scenarios
    .filter((s) => s.expectedReturnPct != null)
    .map((s) => ({ probability: s.probability, expectedReturnPct: s.expectedReturnPct as number }));

  const stored = bundle.rewardToRisk;
  // Mirror the pipeline: no usable bucket → the resource is null (mandate-blind).
  if (usable.length === 0) {
    if (stored == null) {
      c.hardPass("reward-risk/recompute", "no usable buckets and reward-to-risk resource is null (consistent)");
    } else {
      c.hardFail(
        "reward-risk/recompute",
        "no usable scenario buckets but a reward-to-risk figure is stored",
        null,
        "non-null",
      );
    }
    return;
  }
  if (stored == null) {
    c.hardFail(
      "reward-risk/recompute",
      `${usable.length} usable buckets but the reward-to-risk resource is null`,
      "non-null",
      null,
    );
    return;
  }

  const lossAversion = bundle.riskMandate?.lossAversion ?? 1;
  const figure = computeRewardToRisk({ scenarios: usable, lossAversion });
  const numericKeys = [
    "expectedValuePct",
    "expectedGainPct",
    "expectedLossPct",
    "glr",
    "lossAdjustedGlr",
    "worstCaseReturnPct",
  ] as const;
  const mismatches: string[] = [];
  for (const key of numericKeys) {
    const a = figure[key];
    const b = stored[key];
    const bothNull = a == null && b == null;
    const bothNum = typeof a === "number" && typeof b === "number" && approx(a, b);
    if (!bothNull && !bothNum) mismatches.push(`${key}: recomputed ${a} vs stored ${b}`);
  }
  if (figure.noDownside !== stored.noDownside) {
    mismatches.push(`noDownside: recomputed ${figure.noDownside} vs stored ${stored.noDownside}`);
  }
  if (figure.evidenceBasis !== stored.evidenceBasis) {
    mismatches.push(`evidenceBasis: recomputed ${figure.evidenceBasis} vs stored ${stored.evidenceBasis}`);
  }
  if (stored.lossAversion !== lossAversion) {
    mismatches.push(`lossAversion: expected ${lossAversion} vs stored ${stored.lossAversion}`);
  }
  if (mismatches.length === 0) {
    c.hardPass("reward-risk/recompute", "stored reward-to-risk figure matches recomputation from the scenarios + mandate λ");
  } else {
    c.hardFail("reward-risk/recompute", `reward-to-risk drift: ${mismatches.join("; ")}`);
  }

  // Snapshot mirrors — gated on a mandate decision (they source from it, and stay
  // null on mandate-blind runs even though the resource is populated).
  const snapshot = bundle.decisionSnapshot;
  if (snapshot == null || snapshot.mandateVerdict == null) {
    c.skip("reward-risk/snapshot-mirror", "hard", "mandate-blind run — snapshot reward-to-risk mirrors stay null");
    return;
  }
  const glrOk =
    (snapshot.rewardToRiskLossAdjustedGlr == null && stored.lossAdjustedGlr == null) ||
    (typeof snapshot.rewardToRiskLossAdjustedGlr === "number" &&
      typeof stored.lossAdjustedGlr === "number" &&
      approx(snapshot.rewardToRiskLossAdjustedGlr, stored.lossAdjustedGlr));
  const wcOk =
    (snapshot.worstCaseReturnPct == null && stored.worstCaseReturnPct == null) ||
    (typeof snapshot.worstCaseReturnPct === "number" &&
      typeof stored.worstCaseReturnPct === "number" &&
      approx(snapshot.worstCaseReturnPct, stored.worstCaseReturnPct));
  if (glrOk && wcOk) {
    c.hardPass("reward-risk/snapshot-mirror", "snapshot reward-to-risk mirrors match the resource");
  } else {
    c.hardFail(
      "reward-risk/snapshot-mirror",
      `snapshot reward-to-risk mirrors disagree with the resource (glr ${snapshot.rewardToRiskLossAdjustedGlr}/${stored.lossAdjustedGlr}, worstCase ${snapshot.worstCaseReturnPct}/${stored.worstCaseReturnPct})`,
    );
  }
}

// ── mandate/* ────────────────────────────────────────────────────────────
function checkMandate(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const snapshot = bundle.decisionSnapshot;
  const pm = published(memos.get(PM_KEY));
  const decision = pm?.mandateDecision ?? null;
  const mandate = bundle.riskMandate;
  const rr = bundle.rewardToRisk;
  // Truly mandate-blind — no frozen dials or no reward-to-risk figure → the whole
  // group is n/a (the PM legitimately decides mandate-blind).
  if (mandate == null || rr == null) {
    c.skip("mandate/verdict", "hard", "mandate-blind run (no mandate / reward-to-risk substrate)");
    return;
  }
  // The run WAS mandate-aware (both dials and figure present), so the mandate
  // decision MUST be mirrored — a dropped mirror is a regression, not blindness.
  if (snapshot == null || decision == null || snapshot.mandateVerdict == null) {
    c.hardFail(
      "mandate/mirror-present",
      "run was mandate-aware (mandate + reward-to-risk present) but the mandate decision mirror is missing from the snapshot / PM memo",
    );
    return;
  }

  const override = (decision.overrideReason ?? "").trim().length > 0;
  const gates = computeMandateGates({
    mandate,
    rr,
    decisionConfidence: pm?.decisionConfidence ?? snapshot.decisionConfidence,
    override,
  });

  // Verdict + capacity match.
  if (decision.verdict === gates.verdict && snapshot.mandateVerdict === gates.verdict) {
    c.hardPass("mandate/verdict", `mandate verdict ${gates.verdict} matches recomputation (snapshot + memo)`);
  } else {
    c.hardFail(
      "mandate/verdict",
      `mandate verdict drift: recomputed ${gates.verdict}, memo ${decision.verdict}, snapshot ${snapshot.mandateVerdict}`,
    );
  }
  if (decision.capacityVetoed === !gates.capacityCleared) {
    c.hardPass("mandate/capacity", `capacityVetoed ${decision.capacityVetoed} matches recomputation`);
  } else {
    c.hardFail(
      "mandate/capacity",
      `capacityVetoed ${decision.capacityVetoed} disagrees with recomputed capacity (cleared=${gates.capacityCleared})`,
    );
  }

  // Dial sanity: the hard capacity cap must be the tighter one.
  if (mandate.capacityVetoCapPct <= mandate.unclearedCapPct) {
    c.hardPass("mandate/dial-sanity", "capacityVetoCapPct ≤ unclearedCapPct");
  } else {
    c.hardFail(
      "mandate/dial-sanity",
      `capacityVetoCapPct ${mandate.capacityVetoCapPct} > unclearedCapPct ${mandate.unclearedCapPct}`,
    );
  }

  // Committed size within the applicable cap; clamp implies landing on a cap.
  const targetWeightPct = pm?.portfolioFit?.targetWeightPct ?? null;
  if (targetWeightPct == null) {
    c.skip("mandate/size-cap", "hard", "no committed target weight to check against the caps");
  } else {
    let capOk = true;
    let capDetail = "committed size within the applicable mandate cap";
    if (decision.capacityVetoed && targetWeightPct > mandate.capacityVetoCapPct + 1e-6) {
      capOk = false;
      capDetail = `capacity-vetoed size ${targetWeightPct} exceeds capacityVetoCapPct ${mandate.capacityVetoCapPct}`;
    } else if (!gates.cleared && !override && targetWeightPct > mandate.unclearedCapPct + 1e-6) {
      capOk = false;
      capDetail = `uncleared (no override) size ${targetWeightPct} exceeds unclearedCapPct ${mandate.unclearedCapPct}`;
    }
    if (capOk) c.hardPass("mandate/size-cap", capDetail);
    else c.hardFail("mandate/size-cap", capDetail);

    // `sizeClamped` ⇒ the committed size equals the applicable cap (directional —
    // the raw pre-clamp target is never persisted).
    if (decision.sizeClamped) {
      const onCap =
        approx(targetWeightPct, mandate.capacityVetoCapPct) ||
        approx(targetWeightPct, mandate.unclearedCapPct);
      if (onCap) {
        c.hardPass("mandate/clamp-on-cap", `clamped size ${targetWeightPct} equals an applicable cap`);
      } else {
        c.hardFail(
          "mandate/clamp-on-cap",
          `sizeClamped is true but committed size ${targetWeightPct} equals neither cap (${mandate.capacityVetoCapPct} / ${mandate.unclearedCapPct})`,
        );
      }
    }
  }
}

// ── decision-consistency/* ───────────────────────────────────────────────
function checkDecisionConsistency(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const snapshot = bundle.decisionSnapshot;
  const pm = published(memos.get(PM_KEY));
  if (snapshot == null || pm == null) {
    c.skip("decision-consistency/snapshot-pm", "hard", "no decision snapshot / PM memo to cross-check");
    return;
  }

  const mismatches: string[] = [];
  if (snapshot.finalRating !== pm.finalRating) {
    mismatches.push(`finalRating snapshot ${snapshot.finalRating} vs memo ${pm.finalRating}`);
  }
  if (
    !(
      (snapshot.decisionConfidence == null && pm.decisionConfidence == null) ||
      (typeof snapshot.decisionConfidence === "number" &&
        typeof pm.decisionConfidence === "number" &&
        approx(snapshot.decisionConfidence, pm.decisionConfidence))
    )
  ) {
    mismatches.push(`decisionConfidence snapshot ${snapshot.decisionConfidence} vs memo ${pm.decisionConfidence}`);
  }
  const memoVerdict = pm.mandateDecision?.verdict ?? null;
  if (snapshot.mandateVerdict !== memoVerdict) {
    mismatches.push(`mandateVerdict snapshot ${snapshot.mandateVerdict} vs memo ${memoVerdict}`);
  }
  if (mismatches.length === 0) {
    c.hardPass("decision-consistency/snapshot-pm", "snapshot ↔ PM memo decision mirrors agree");
  } else {
    c.hardFail("decision-consistency/snapshot-pm", `snapshot/PM mirror drift: ${mismatches.join("; ")}`);
  }

  // Snapshot trade fields ↔ trader memo mirrors.
  const trader = published(memos.get(TRADER_KEY));
  if (trader == null) {
    c.skip("decision-consistency/snapshot-trader", "hard", "no trader memo to cross-check trade fields");
  } else {
    const tradeMismatches: string[] = [];
    if (snapshot.direction !== (trader.direction ?? null)) {
      tradeMismatches.push(`direction ${snapshot.direction} vs ${trader.direction}`);
    }
    const numPairs: Array<[string, number | null, number | null]> = [
      ["sizePct", snapshot.sizePct, trader.sizePct ?? null],
      ["stopPrice", snapshot.stopPrice, trader.stopPrice ?? null],
      ["targetPrice", snapshot.targetPrice, trader.targetPrice ?? null],
    ];
    for (const [name, a, b] of numPairs) {
      const ok = (a == null && b == null) || (typeof a === "number" && typeof b === "number" && approx(a, b));
      if (!ok) tradeMismatches.push(`${name} ${a} vs ${b}`);
    }
    if (snapshot.holdingPeriod !== (trader.holdingPeriod ?? null)) {
      tradeMismatches.push(`holdingPeriod ${snapshot.holdingPeriod} vs ${trader.holdingPeriod}`);
    }
    if (tradeMismatches.length === 0) {
      c.hardPass("decision-consistency/snapshot-trader", "snapshot ↔ trader memo trade mirrors agree");
    } else {
      c.hardFail("decision-consistency/snapshot-trader", `snapshot/trader mirror drift: ${tradeMismatches.join("; ")}`);
    }
  }

  // Echo: weightDeltaPct = targetWeightPct − currentWeightPct (±0.01).
  const fit = pm.portfolioFit;
  if (fit == null) {
    c.skip("decision-consistency/weight-delta", "hard", "no portfolio-fit block on the PM memo");
  } else {
    const expectedDelta = fit.targetWeightPct - fit.currentWeightPct;
    if (approx(fit.weightDeltaPct, expectedDelta, 0.01)) {
      c.hardPass("decision-consistency/weight-delta", `weightDeltaPct ${fit.weightDeltaPct} = target − current`);
    } else {
      c.hardFail(
        "decision-consistency/weight-delta",
        `weightDeltaPct ${fit.weightDeltaPct} ≠ target ${fit.targetWeightPct} − current ${fit.currentWeightPct}`,
        expectedDelta,
        fit.weightDeltaPct,
      );
    }
  }
}

// ── valuation/* ──────────────────────────────────────────────────────────
function checkValuation(bundle: RunArtifactsBundle, c: Checks): void {
  const spine = bundle.valuationSpine;
  if (spine == null) {
    c.skip("valuation/abstention-honesty", "hard", "no valuation spine on this run");
    return;
  }

  // Fair-value abstention honesty.
  if (spine.fairValue.method === "none") {
    if (spine.fairValue.available === false) {
      c.hardPass("valuation/fair-value-abstention", 'fairValue.method "none" ⇒ available false (honest abstention)');
    } else {
      c.hardFail(
        "valuation/fair-value-abstention",
        'fairValue.method is "none" but available is not false',
        false,
        spine.fairValue.available,
      );
    }
  } else {
    c.hardPass("valuation/fair-value-abstention", `fairValue.method ${spine.fairValue.method} (not abstaining)`);
  }

  // DCF abstention + terminal-value honesty (only when the DCF leg exists).
  const dcf = spine.dcf;
  if (dcf == null) {
    c.skip("valuation/dcf-abstention", "hard", "no DCF leg (pre-FIX-807 session or non-applicable)");
  } else {
    if (dcf.available === false) {
      if (dcf.unavailableReason != null) {
        c.hardPass("valuation/dcf-abstention", `DCF unavailable with a reason (${dcf.unavailableReason})`);
      } else {
        c.hardFail("valuation/dcf-abstention", "dcf.available is false but unavailableReason is null");
      }
    } else {
      c.hardPass("valuation/dcf-abstention", "DCF available");
    }

    // terminalValueShare > 0.85 ⇒ reliability "tv-dominated".
    if (dcf.terminalValueShare != null && dcf.terminalValueShare > 0.85) {
      if (dcf.reliability === "tv-dominated") {
        c.hardPass("valuation/tv-share-reliability", `terminalValueShare ${dcf.terminalValueShare} ⇒ tv-dominated`);
      } else {
        c.hardFail(
          "valuation/tv-share-reliability",
          `terminalValueShare ${dcf.terminalValueShare} > 0.85 but reliability is ${dcf.reliability}`,
          "tv-dominated",
          dcf.reliability,
        );
      }
    }

    // Soft flags (never gate the exit code).
    if (dcf.reliability === "tv-dominated") {
      c.softFlag("valuation/tv-dominated", "DCF is terminal-value dominated — treat the intrinsic value with caution");
    }
    if (dcf.expectationsGap != null && Math.abs(dcf.expectationsGap) > 0.5) {
      c.softFlag(
        "valuation/expectations-gap-wide",
        `DCF expectations gap ${dcf.expectationsGap} is wide (|gap| > 50%)`,
      );
    }
  }

  // Triangulation consistency.
  const tri = spine.triangulation;
  if (tri == null) {
    c.skip("valuation/triangulation", "hard", "no triangulation leg");
  } else {
    const n = tri.methodsUsed.length;
    let ok = true;
    let detail = `triangulation ${tri.divergence} consistent with ${n} method(s)`;
    if (tri.divergence === "unavailable" && n !== 0) {
      ok = false;
      detail = `divergence "unavailable" but ${n} methods used`;
    } else if (tri.divergence === "single-method" && n !== 1) {
      ok = false;
      detail = `divergence "single-method" but ${n} methods used`;
    } else if ((tri.divergence === "convergent" || tri.divergence === "divergent") && n !== 2) {
      ok = false;
      detail = `divergence "${tri.divergence}" expects 2 methods but ${n} used`;
    } else if ((tri.divergence === "convergent" || tri.divergence === "divergent") && tri.spread == null) {
      ok = false;
      detail = `divergence "${tri.divergence}" with two methods but spread is null`;
    }
    if (ok) c.hardPass("valuation/triangulation", detail);
    else c.hardFail("valuation/triangulation", detail);
  }
}

// ── citations/* ──────────────────────────────────────────────────────────
function checkCitations(bundle: RunArtifactsBundle, c: Checks): void {
  // Analyst memos (p1/*): published ⇒ dataQuality non-null.
  const analystMemos = bundle.memos.filter((m) => m.key.startsWith("p1/") && m.state?.status === "published");
  if (analystMemos.length === 0) {
    c.skip("citations/analyst-data-quality", "hard", "no published analyst memos");
  } else {
    const missing = analystMemos.filter((m) => m.state?.dataQuality == null);
    if (missing.length === 0) {
      c.hardPass("citations/analyst-data-quality", `all ${analystMemos.length} published analyst memos carry a dataQuality`);
    } else {
      c.hardFail(
        "citations/analyst-data-quality",
        `${missing.length} published analyst memos have a null dataQuality: ${missing.map((m) => m.key).join(", ")}`,
      );
    }
  }

  // Citation arrays well-formed where non-null (across every memo).
  const malformed: string[] = [];
  for (const m of bundle.memos) {
    const citations = m.state?.citations;
    if (citations == null) continue;
    for (const cit of citations) {
      const hasFields = typeof cit.url === "string" && typeof cit.title === "string" && cit.title.length > 0;
      let parseable = false;
      try {
        // eslint-disable-next-line no-new
        new URL(cit.url);
        parseable = true;
      } catch {
        parseable = false;
      }
      if (!hasFields || !parseable) malformed.push(`${m.key}: ${cit.url}`);
    }
  }
  if (malformed.length === 0) {
    c.hardPass("citations/well-formed", "every non-null citation has a title + a parseable URL");
  } else {
    c.hardFail("citations/well-formed", `${malformed.length} malformed citation(s): ${malformed.slice(0, 5).join("; ")}`);
  }

  // Phase-2 citation integrity — SOFT (records LLM tag quality, not a code bug).
  const integrity = bundle.citationIntegrity;
  if (integrity == null) {
    c.skip("citations/phase2-integrity", "soft", "no Phase-2 citation-integrity report");
  } else if (integrity.invalidTags.length === 0) {
    c.softPass("citations/phase2-integrity", "no invalid Phase-2 citation tags");
  } else {
    c.softFlag(
      "citations/phase2-integrity",
      `${integrity.invalidTags.length} Phase-2 citation tag(s) did not match verbatim`,
    );
  }
}

// ── null-honesty/* ───────────────────────────────────────────────────────
const DISHONEST_STRINGS = new Set(["NaN", "undefined", "null"]);

function checkNullHonesty(bundle: RunArtifactsBundle, c: Checks): void {
  const offenders: string[] = [];
  for (const m of bundle.memos) {
    const metrics = m.state?.metrics;
    if (metrics == null) continue;
    for (const [k, v] of Object.entries(metrics)) {
      if (typeof v === "string" && DISHONEST_STRINGS.has(v.trim())) {
        offenders.push(`${m.key}.${k}="${v}"`);
      }
    }
  }
  if (offenders.length === 0) {
    c.hardPass("null-honesty/metrics-strings", 'no "NaN"/"undefined"/"null" strings in any memo metrics');
  } else {
    c.hardFail(
      "null-honesty/metrics-strings",
      `${offenders.length} dishonest metric string(s): ${offenders.slice(0, 5).join(", ")}`,
    );
  }
}

/**
 * Run every deterministic invariant check over a stored run's bundle. Pure,
 * total, never throws — a group whose substrate is absent degrades to `skipped`.
 */
export function checkRun(bundle: RunArtifactsBundle): InvariantReport {
  const c = new Checks();
  const memos = memoMap(bundle);

  checkMemoCompleteness(bundle, c, memos);
  checkRatingEnvelope(bundle, c, memos);
  checkScenarios(bundle, c, memos);
  checkRewardToRisk(bundle, c, memos);
  checkMandate(bundle, c, memos);
  checkDecisionConsistency(bundle, c, memos);
  checkValuation(bundle, c);
  checkCitations(bundle, c);
  checkNullHonesty(bundle, c);

  const checks = c.results;
  const report: InvariantReport = {
    hard: {
      passed: checks.filter((r) => r.severity === "hard" && r.status === "pass").length,
      failed: checks.filter((r) => r.severity === "hard" && r.status === "fail").length,
    },
    soft: {
      passed: checks.filter((r) => r.severity === "soft" && r.status === "pass").length,
      flagged: checks.filter((r) => r.severity === "soft" && r.status === "flag").length,
    },
    skipped: checks.filter((r) => r.status === "skipped").length,
    checks,
  };
  return report;
}
