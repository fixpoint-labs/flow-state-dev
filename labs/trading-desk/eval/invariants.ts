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
 * OWN pure libs (`modelImpliedRating`, `computeMandateGates`, `computeRewardToRisk`) —
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
import { computePolicyGate } from "../flows/analysis/lib/policy-gate";
import { computeRewardToRisk } from "../flows/analysis/lib/reward-to-risk";
import { DIVERGENCE_THRESHOLD } from "../flows/analysis/lib/triangulation";
import {
  modelImpliedRating,
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
  // The valuation spine is authoritative; the PM band is only a fallback for a
  // legacy run without a spine. A drifted PM mirror must never widen the band.
  const spineBand = spine != null ? { floor: spine.envelope.floor, ceiling: spine.envelope.ceiling } : null;
  const band = spineBand ?? pm?.ratingBand ?? null;
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

  // Recompute the complete envelope from the valuation inputs. Trusting the
  // stored implied rating here would let the implied rating and its band drift
  // together without the invariant noticing.
  if (spine == null) {
    c.skip(
      "rating-envelope/band-recompute",
      "hard",
      "valuation spine absent — cannot recompute the band",
    );
    return;
  }
  const recomputed = modelImpliedRating({
    expectedReturn: spine.expectedReturn,
    fairValue: spine.fairValue,
    setupScore: spine.setupScore,
    triangulation: spine.triangulation ?? undefined,
  });
  const envelopeFields = [
    "absoluteRating",
    "relativeRating",
    "implied",
    "floor",
    "ceiling",
  ] as const;
  const drift = envelopeFields.filter(
    (field) => recomputed[field] !== spine.envelope[field],
  );
  if (drift.length === 0) {
    c.hardPass(
      "rating-envelope/band-recompute",
      "stored rating envelope matches recomputation from the valuation inputs",
    );
  } else {
    c.hardFail(
      "rating-envelope/band-recompute",
      `stored rating envelope drifted in: ${drift.join(", ")}`,
      Object.fromEntries(envelopeFields.map((field) => [field, recomputed[field]])),
      Object.fromEntries(envelopeFields.map((field) => [field, spine.envelope[field]])),
    );
  }
}

// ── scenario/* ───────────────────────────────────────────────────────────
function checkScenarios(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const memo = published(memos.get(SCENARIO_KEY));
  const scenarios = memo?.scenarios ?? null;
  if (memo == null) {
    c.skip("scenario/count", "hard", "no scenario-forecaster memo (Phase 5a absent)");
    return;
  }
  if (scenarios == null) {
    c.hardFail(
      "scenario/count",
      "published scenario-forecaster memo has no scenario buckets",
      "3–5 scenarios",
      scenarios,
    );
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
    c.hardFail(
      "scenario/raw-sum",
      "published scenario memo has scenarios but no recorded probabilitySum",
      "number in [0.8, 1.2]",
      rawSum,
    );
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
  if (snapshot == null) {
    c.skip("reward-risk/snapshot-mirror", "hard", "no decision snapshot to compare");
    return;
  }
  if (snapshot.mandateVerdict == null) {
    if (
      snapshot.rewardToRiskLossAdjustedGlr != null ||
      snapshot.worstCaseReturnPct != null
    ) {
      c.hardFail(
        "reward-risk/snapshot-mirror",
        "mandate-blind decision snapshot has populated reward-to-risk mirrors",
        { rewardToRiskLossAdjustedGlr: null, worstCaseReturnPct: null },
        {
          rewardToRiskLossAdjustedGlr: snapshot.rewardToRiskLossAdjustedGlr,
          worstCaseReturnPct: snapshot.worstCaseReturnPct,
        },
      );
      return;
    }
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
  // Truly mandate-blind — no frozen dials or no reward-to-risk figure. The gate
  // itself is n/a, but its memo/snapshot mirrors must also be null; populated
  // mirrors would advertise a decision that the writer could not compute.
  if (mandate == null || rr == null) {
    const blindMirrors = {
      memoDecision: decision,
      snapshotMandateId: snapshot?.mandateId ?? null,
      snapshotMandateVerdict: snapshot?.mandateVerdict ?? null,
      snapshotRewardToRiskLossAdjustedGlr:
        snapshot?.rewardToRiskLossAdjustedGlr ?? null,
      snapshotWorstCaseReturnPct: snapshot?.worstCaseReturnPct ?? null,
      snapshotCapacityVetoed: snapshot?.capacityVetoed ?? null,
    };
    if (Object.values(blindMirrors).every((value) => value == null)) {
      c.hardPass(
        "mandate/blind-mirrors",
        "mandate-blind run leaves PM and snapshot mandate mirrors null",
      );
    } else {
      c.hardFail(
        "mandate/blind-mirrors",
        "mandate-blind run has populated PM or snapshot mandate mirrors",
        "all mandate mirrors null",
        blindMirrors,
      );
    }
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
  const expectedCapacityVeto = !gates.capacityCleared;
  if (
    decision.capacityVetoed === expectedCapacityVeto &&
    snapshot.capacityVetoed === expectedCapacityVeto
  ) {
    c.hardPass("mandate/capacity", `capacityVetoed ${expectedCapacityVeto} matches recomputation (snapshot + memo)`);
  } else {
    c.hardFail(
      "mandate/capacity",
      `capacity veto drift: recomputed ${expectedCapacityVeto}, memo ${decision.capacityVetoed}, snapshot ${snapshot.capacityVetoed}`,
    );
  }
  if (decision.cleared === gates.cleared) {
    c.hardPass("mandate/soft-gates", `cleared ${decision.cleared} matches recomputation`);
  } else {
    c.hardFail(
      "mandate/soft-gates",
      `cleared ${decision.cleared} disagrees with recomputed soft gates (${gates.cleared})`,
    );
  }

  const figureMismatches: string[] = [];
  const figurePairs: Array<[
    string,
    number | null,
    number | null,
  ]> = [
    ["lossAdjustedGlr", decision.lossAdjustedGlr, rr.lossAdjustedGlr],
    ["expectedValuePct", decision.expectedValuePct, rr.expectedValuePct],
    ["worstCaseReturnPct", decision.worstCaseReturnPct, rr.worstCaseReturnPct],
  ];
  for (const [field, memoValue, resourceValue] of figurePairs) {
    const matches =
      (memoValue == null && resourceValue == null) ||
      (typeof memoValue === "number" &&
        typeof resourceValue === "number" &&
        approx(memoValue, resourceValue));
    if (!matches) {
      figureMismatches.push(`${field} memo ${memoValue} vs resource ${resourceValue}`);
    }
  }
  if (decision.noDownside !== rr.noDownside) {
    figureMismatches.push(
      `noDownside memo ${decision.noDownside} vs resource ${rr.noDownside}`,
    );
  }
  if (decision.evidenceBasis !== rr.evidenceBasis) {
    figureMismatches.push(
      `evidenceBasis memo ${decision.evidenceBasis} vs resource ${rr.evidenceBasis}`,
    );
  }
  if (figureMismatches.length === 0) {
    c.hardPass(
      "mandate/reward-mirrors",
      "PM mandate decision reward-to-risk mirrors match the stored resource",
    );
  } else {
    c.hardFail(
      "mandate/reward-mirrors",
      `PM mandate reward-to-risk mirror drift: ${figureMismatches.join("; ")}`,
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

    // `sizeClamped` describes the FIX-752 mandate gate, which runs BEFORE the
    // household policy gate. A later policy cap/exclusion may reduce the final
    // portfolioFit target again, so validate the persisted pre-policy target when
    // present (legacy/no-policy runs fall back to the final target).
    if (decision.sizeClamped) {
      // The FIX-781 evidence gate runs AFTER both the mandate and policy gates, so
      // the final target may be lower than the mandate clamp. Prefer the post-policy
      // pre-cap target; else the post-mandate pre-evidence target (when a mandate but
      // no policy gate sits between); else the final target (legacy / no later gate).
      const mandateGatedTargetPct =
        pm?.policyDecision?.preGatePolicyTargetPct ??
        pm?.evidenceDecision?.preGateEvidenceTargetPct ??
        targetWeightPct;
      const applicableCap = !gates.capacityCleared
        ? mandate.capacityVetoCapPct
        : !gates.cleared && !override
          ? mandate.unclearedCapPct
          : null;
      if (applicableCap != null && approx(mandateGatedTargetPct, applicableCap)) {
        c.hardPass(
          "mandate/clamp-on-cap",
          `pre-policy mandate-clamped size ${mandateGatedTargetPct} equals the applicable cap ${applicableCap}`,
        );
      } else {
        c.hardFail(
          "mandate/clamp-on-cap",
          applicableCap == null
            ? `sizeClamped is true but recomputed gates require no mandate clamp`
            : `sizeClamped is true but pre-policy size ${mandateGatedTargetPct} does not equal the applicable cap ${applicableCap}`,
        );
      }
    }
  }
}

// ── decision-consistency/* ───────────────────────────────────────────────
function checkDecisionConsistency(bundle: RunArtifactsBundle, c: Checks, memos: MemoMap): void {
  const snapshot = bundle.decisionSnapshot;
  const pm = published(memos.get(PM_KEY));
  if (snapshot == null) {
    c.skip("decision-consistency/snapshot-pm", "hard", "no decision snapshot to cross-check");
    return;
  }
  if (pm == null) {
    c.hardFail(
      "decision-consistency/snapshot-pm",
      "decision snapshot exists but the PM memo is absent or not published",
      "published PM memo",
      memos.get(PM_KEY)?.status ?? "absent",
    );
    return;
  }

  const mismatches: string[] = [];
  // The snapshot's own identity must match the run it belongs to. Without this,
  // a drifted `ticker` / `asOfDate` passes (the decision-field mirrors still
  // agree), yet the scoreboard labels the record by `summary.ticker` while the
  // policy recompute keys off `snapshot.ticker` — so a decision for one name
  // could be scored and reported as another.
  if (snapshot.ticker !== bundle.summary.ticker) {
    mismatches.push(`ticker snapshot ${snapshot.ticker} vs run ${bundle.summary.ticker}`);
  }
  if (snapshot.asOfDate !== bundle.summary.date) {
    mismatches.push(`asOfDate snapshot ${snapshot.asOfDate} vs run ${bundle.summary.date}`);
  }
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
  const memoMandateId = pm.mandateDecision?.mandateId ?? null;
  if (snapshot.mandateId !== memoMandateId) {
    mismatches.push(`mandateId snapshot ${snapshot.mandateId} vs memo ${memoMandateId}`);
  }
  const policy = pm.policyDecision;
  const policyPairs: Array<[string, unknown, unknown]> = [
    ["mandatePresent", snapshot.mandatePresent, policy?.mandatePresent ?? false],
    ["policyVerdict", snapshot.policyVerdict, policy?.policyVerdict ?? null],
    ["positionCapClamped", snapshot.positionCapClamped, policy?.positionCapClamped ?? null],
    ["excluded", snapshot.excluded, policy?.excluded ?? null],
  ];
  for (const [field, snapshotValue, memoValue] of policyPairs) {
    if (snapshotValue !== memoValue) {
      mismatches.push(`${field} snapshot ${snapshotValue} vs memo ${memoValue}`);
    }
  }
  const snapshotPreGate = snapshot.preGatePolicyTargetPct;
  const memoPreGate = policy?.preGatePolicyTargetPct ?? null;
  const preGateMatches =
    (snapshotPreGate == null && memoPreGate == null) ||
    (typeof snapshotPreGate === "number" &&
      typeof memoPreGate === "number" &&
      approx(snapshotPreGate, memoPreGate));
  if (!preGateMatches) {
    mismatches.push(`preGatePolicyTargetPct snapshot ${snapshotPreGate} vs memo ${memoPreGate}`);
  }
  if (mismatches.length === 0) {
    c.hardPass("decision-consistency/snapshot-pm", "snapshot ↔ PM memo decision mirrors agree");
  } else {
    c.hardFail("decision-consistency/snapshot-pm", `snapshot/PM mirror drift: ${mismatches.join("; ")}`);
  }

  const frozenPolicy = bundle.portfolioMandate;
  const policyClaimed =
    policy != null ||
    snapshot.mandatePresent === true ||
    snapshot.policyVerdict != null ||
    snapshot.positionCapClamped != null ||
    snapshot.excluded != null ||
    snapshot.preGatePolicyTargetPct != null;
  if (frozenPolicy == null) {
    if (policyClaimed) {
      c.hardFail(
        "decision-consistency/policy-recompute",
        "policy decision mirrors exist without the frozen portfolio mandate needed to compute them",
      );
    } else {
      c.skip(
        "decision-consistency/policy-recompute",
        "hard",
        "no frozen portfolio mandate — policy gate not applicable",
      );
    }
  } else if (policy == null || pm.portfolioFit == null) {
    c.hardFail(
      "decision-consistency/policy-recompute",
      "frozen portfolio mandate exists but the PM policy decision or portfolio fit is missing",
    );
  } else {
    const recomputedPolicy = computePolicyGate({
      mandate: frozenPolicy,
      ticker: snapshot.ticker,
      targetWeightPct: policy.preGatePolicyTargetPct,
      householdWeightPct: bundle.householdTickerWeightPct,
    });
    const policyMismatches: string[] = [];
    const exactPolicyPairs: Array<[string, unknown, unknown]> = [
      ["memo.mandatePresent", policy.mandatePresent, true],
      ["memo.policyVerdict", policy.policyVerdict, recomputedPolicy.policyVerdict],
      ["memo.positionCapClamped", policy.positionCapClamped, recomputedPolicy.positionCapClamped],
      ["memo.excluded", policy.excluded, recomputedPolicy.excluded],
      ["memo.householdWeightKnown", policy.householdWeightKnown, recomputedPolicy.householdWeightKnown],
      ["snapshot.mandatePresent", snapshot.mandatePresent, true],
      ["snapshot.policyVerdict", snapshot.policyVerdict, recomputedPolicy.policyVerdict],
      ["snapshot.positionCapClamped", snapshot.positionCapClamped, recomputedPolicy.positionCapClamped],
      ["snapshot.excluded", snapshot.excluded, recomputedPolicy.excluded],
    ];
    for (const [field, storedValue, recomputedValue] of exactPolicyPairs) {
      if (storedValue !== recomputedValue) {
        policyMismatches.push(`${field} ${storedValue} vs recomputed ${recomputedValue}`);
      }
    }
    // The committed target is now the POST-evidence value (FIX-781): the evidence
    // gate runs after the policy gate. The policy recompute must therefore check the
    // POLICY output — the pre-evidence target (`evidenceDecision.preGateEvidenceTargetPct`),
    // falling back to the final target on a legacy / no-evidence-gate run — not the
    // final target, which the evidence gate may have clamped further.
    const policyOutputTarget =
      pm.evidenceDecision?.preGateEvidenceTargetPct ?? pm.portfolioFit.targetWeightPct;
    if (!approx(policyOutputTarget, recomputedPolicy.targetWeightPct)) {
      policyMismatches.push(
        `policy-output target ${policyOutputTarget} vs recomputed ${recomputedPolicy.targetWeightPct}`,
      );
    }
    // The summary target mirrors the committed (post-evidence) memo target.
    if (
      bundle.summary.targetWeightPct == null ||
      !approx(bundle.summary.targetWeightPct, pm.portfolioFit.targetWeightPct)
    ) {
      policyMismatches.push(
        `summary.targetWeightPct ${bundle.summary.targetWeightPct} vs memo ${pm.portfolioFit.targetWeightPct}`,
      );
    }
    if (policyMismatches.length === 0) {
      c.hardPass(
        "decision-consistency/policy-recompute",
        "policy mirrors and committed target match recomputation from frozen inputs",
      );
    } else {
      c.hardFail(
        "decision-consistency/policy-recompute",
        `policy gate drift: ${policyMismatches.join("; ")}`,
      );
    }
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
    c.hardFail(
      "decision-consistency/weight-delta",
      "completed run has a decision snapshot and published PM memo but no portfolio-fit block",
      "portfolioFit",
      fit,
    );
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

  // Fair-value availability and abstention honesty.
  const fair = spine.fairValue;
  const fairContradictions: string[] = [];
  if (fair.available === false) {
    // Every unavailable path keeps the actual fair value and margin null. A
    // selected justified-PE method may retain the computed multiple when the
    // trailing-earnings leg is missing; the other methods may not.
    if (fair.fairValue != null) fairContradictions.push("fairValue is non-null");
    if (fair.marginOfSafety != null) fairContradictions.push("marginOfSafety is non-null");
    if (fair.method !== "justified-pe" && fair.justifiedPE != null) {
      fairContradictions.push("justifiedPE is non-null");
    }
  } else {
    if (fair.method !== "justified-pe") fairContradictions.push(`method is ${fair.method}`);
    for (const field of ["justifiedPE", "fairValue", "marginOfSafety"] as const) {
      if (fair[field] == null) fairContradictions.push(`${field} is null`);
    }
  }
  if (fairContradictions.length === 0) {
    c.hardPass(
      "valuation/fair-value-abstention",
      fair.available ? "available fair value has its canonical populated shape" : "fair-value abstention shape is coherent",
    );
  } else {
    c.hardFail(
      "valuation/fair-value-abstention",
      `fair-value shape is contradictory: ${fairContradictions.join("; ")}`,
    );
  }

  // DCF abstention + terminal-value honesty (only when the DCF leg exists).
  const dcf = spine.dcf;
  if (dcf == null) {
    c.skip("valuation/dcf-abstention", "hard", "no DCF leg (pre-FIX-807 session or non-applicable)");
  } else {
    if (dcf.available === false) {
      const nonNullFields = [
        "intrinsicValue",
        "marginOfSafety",
        "discountRate",
        "stage1Growth",
        "terminalValueShare",
        "impliedGrowth",
        "expectationsGap",
        "reliability",
      ].filter((field) => dcf[field as keyof typeof dcf] != null);
      const contradictions: string[] = [];
      if (dcf.unavailableReason == null) contradictions.push("unavailableReason is null");
      if (dcf.method !== "none") contradictions.push(`method is ${dcf.method}`);
      if (dcf.reverseDcfStatus !== "unavailable") {
        contradictions.push(`reverseDcfStatus is ${dcf.reverseDcfStatus}`);
      }
      if (nonNullFields.length > 0) {
        contradictions.push(`non-null valuation fields: ${nonNullFields.join(", ")}`);
      }
      if (contradictions.length === 0) {
        c.hardPass(
          "valuation/dcf-abstention",
          `DCF unavailable with canonical abstention shape (${dcf.unavailableReason})`,
        );
      } else {
        c.hardFail(
          "valuation/dcf-abstention",
          `dcf.available is false but the abstention shape is contradictory: ${contradictions.join("; ")}`,
        );
      }
    } else {
      const requiredAvailableFields = [
        "intrinsicValue",
        "marginOfSafety",
        "discountRate",
        "stage1Growth",
        "terminalValueShare",
        "reliability",
      ] as const;
      const contradictions: string[] = [];
      if (dcf.method !== "dcf") contradictions.push(`method is ${dcf.method}`);
      if (dcf.reverseDcfStatus === "unavailable") {
        contradictions.push("reverseDcfStatus is unavailable");
      }
      if (dcf.unavailableReason != null) {
        contradictions.push(`unavailableReason is ${dcf.unavailableReason}`);
      }
      for (const field of requiredAvailableFields) {
        if (dcf[field] == null) contradictions.push(`${field} is null`);
      }
      if (contradictions.length === 0) {
        c.hardPass("valuation/dcf-abstention", "available DCF has its canonical populated shape");
      } else {
        c.hardFail(
          "valuation/dcf-abstention",
          `dcf.available is true but the available shape is contradictory: ${contradictions.join("; ")}`,
        );
      }
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
    const readings: Array<{ method: "justified-pe" | "dcf"; marginOfSafety: number }> = [];
    if (spine.fairValue.available && spine.fairValue.marginOfSafety != null) {
      readings.push({ method: "justified-pe", marginOfSafety: spine.fairValue.marginOfSafety });
    }
    if (dcf?.available && dcf.marginOfSafety != null) {
      readings.push({ method: "dcf", marginOfSafety: dcf.marginOfSafety });
    }
    const expectedMethods = readings.map((reading) => reading.method);
    const expectedSpread =
      readings.length === 2
        ? Math.abs(readings[0].marginOfSafety - readings[1].marginOfSafety)
        : null;
    const expectedMargin =
      readings.length === 0
        ? null
        : readings.reduce((sum, reading) => sum + reading.marginOfSafety, 0) /
          readings.length;
    const expectedDivergence =
      readings.length === 0
        ? "unavailable"
        : readings.length === 1
          ? "single-method"
          : expectedSpread! <= DIVERGENCE_THRESHOLD
            ? "convergent"
            : "divergent";
    const methodsMatch =
      tri.methodsUsed.length === expectedMethods.length &&
      tri.methodsUsed.every((method, index) => method === expectedMethods[index]);
    const spreadMatches =
      (tri.spread == null && expectedSpread == null) ||
      (tri.spread != null && expectedSpread != null && approx(tri.spread, expectedSpread));
    const marginMatches =
      (tri.marginOfSafety == null && expectedMargin == null) ||
      (tri.marginOfSafety != null &&
        expectedMargin != null &&
        approx(tri.marginOfSafety, expectedMargin));
    if (
      methodsMatch &&
      tri.divergence === expectedDivergence &&
      spreadMatches &&
      marginMatches
    ) {
      c.hardPass(
        "valuation/triangulation",
        `triangulation matches ${expectedMethods.length} available valuation method(s)`,
      );
    } else {
      c.hardFail(
        "valuation/triangulation",
        `triangulation drift: expected methods [${expectedMethods.join(", ")}], ${expectedDivergence}, margin ${expectedMargin}, spread ${expectedSpread}; stored methods [${tri.methodsUsed.join(", ")}], ${tri.divergence}, margin ${tri.marginOfSafety}, spread ${tri.spread}`,
      );
    }
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
