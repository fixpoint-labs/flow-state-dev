/**
 * LLM-judge rubrics (FIX-790) — the four qualitative dimensions code can't check.
 *
 * Rubric shape follows the research (spec §3): BINARY checklists where a
 * criterion is decidable, five-level ANCHORED grading (recorded on the scorer's
 * native 0–1 scale) where a quality is genuinely graded. Each dimension declares
 * its `criteria`, a `preamble` (anchors + evidence-first + length-neutrality
 * instructions folded into the judge input), a `needs` substrate predicate, and
 * an `input` selector that picks the blinded slice it grades.
 *
 * The judge reads a BLINDED bundle (`blinding.ts`) — never the raw run — and its
 * model is pinned distinct from the desk's generators (`judge.ts`).
 */
import { ALL_MEMO_KEYS } from "../flows/analysis/registry";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";
import {
  blindedMemo,
  blindedMemosByPrefix,
  type BlindedBundle,
} from "./blinding";

const PM_KEY = ALL_MEMO_KEYS.portfolioManager.collectionKey;
const TRADER_KEY = ALL_MEMO_KEYS.trader.collectionKey;
const RISK_ASSESS_KEY = ALL_MEMO_KEYS.riskAssessment.collectionKey;
const BULL_KEY = ALL_MEMO_KEYS.bull.collectionKey;
const BEAR_KEY = ALL_MEMO_KEYS.bear.collectionKey;
const RM_KEY = ALL_MEMO_KEYS.researchManager.collectionKey;
const SCENARIO_KEY = ALL_MEMO_KEYS.scenarioForecast.collectionKey;

/** One judge dimension. */
export type RubricDimension = {
  key: string;
  kind: "graded" | "checklist";
  /** The per-criterion grading targets (each becomes an analyzer finding). */
  criteria: string[];
  /** Instruction preamble prepended to the judge input: anchors + the
   *  evidence-first + length-neutrality discipline. */
  preamble: string;
  /** Substrate predicate — false → the dimension is `skipped` (not judged). */
  needs: (bundle: RunArtifactsBundle) => boolean;
  /** The blinded slice this dimension grades. */
  input: (blinded: BlindedBundle) => unknown;
};

// Shared instruction blocks. The finding schema emits `score` before
// `assessment` (a known limitation, spec §4.5), so the preamble must force
// per-criterion evidence-gathering BEFORE the number.
const GRADED_ANCHORS = [
  "Score each criterion on a 0–1 scale with these five anchors:",
  "  0.00 — the criterion completely fails (generic filler, unsupported claims, incoherent).",
  "  0.25 — mostly fails, with isolated exceptions.",
  "  0.50 — partially met; a mix of supported and unsupported.",
  "  0.75 — largely met, with minor gaps.",
  "  1.00 — fully met (specific, quantified, provenance-aware, coherent).",
].join("\n");

const CHECKLIST_ANCHORS =
  "Score each criterion 0 (the check FAILS) or 1 (the check PASSES). Do not use intermediate values.";

const DISCIPLINE = [
  "Before scoring a criterion, gather the concrete evidence for it from the artifact and put that evidence in the `evidence` field.",
  "Judge on substance, not length — a longer memo is not automatically better.",
].join("\n");

function preamble(anchors: string, extra?: string): string {
  return [anchors, DISCIPLINE, extra].filter(Boolean).join("\n");
}

export const RUBRICS: RubricDimension[] = [
  {
    key: "evidence-quality",
    kind: "graded",
    criteria: [
      "Claims are specific and quantified rather than generic filler.",
      "Numbers and factual claims are sourced or traceable to the data the analyst was given.",
      "The memo's stated confidence is consistent with its dataQuality flag (an 'unavailable' or 'partial' memo does not assert full-confidence conclusions).",
    ],
    preamble: preamble(
      GRADED_ANCHORS,
      "You are grading the Phase-1 ANALYST memos (fundamentals, sentiment, news, technical, etc.).",
    ),
    needs: (b) => b.memos.some((m) => m.key.startsWith("p1/") && m.state?.status === "published"),
    input: (blinded) => ({ analystMemos: blindedMemosByPrefix(blinded, "p1/") }),
  },
  {
    key: "debate-engagement",
    kind: "checklist",
    criteria: [
      "The bear rebuts at least one SPECIFIC bull claim, quoting or naming it (not a generic counter).",
      "The bull's strongest claim is addressed rather than strawmanned.",
      "The research manager's unresolvedDisagreements reflect points the transcript actually left unresolved.",
      "Neither side fabricates numbers that are absent from the analyst data memos.",
    ],
    preamble: preamble(
      CHECKLIST_ANCHORS,
      "You are grading the Phase-2 bull/bear DEBATE. The turn-by-turn transcript is the primary evidence — the consolidated memos can summarize away the very rebuttals you are checking for, so read the transcript.",
    ),
    // The transcript is the primary substrate; without it, judging from summaries
    // would mis-measure the very thing this dimension grades — skip instead.
    needs: (b) => b.p2Contributions != null,
    input: (blinded) => ({
      transcript: blinded.transcript,
      bull: blindedMemo(blinded, BULL_KEY),
      bear: blindedMemo(blinded, BEAR_KEY),
      researchManager: blindedMemo(blinded, RM_KEY),
    }),
  },
  {
    key: "pm-coherence",
    kind: "graded",
    criteria: [
      "The decision summary follows from the cited upstream memos (thesis, trade proposal, risk assessment).",
      "When the PM disagrees with the trader (agreesWithTrader is false), the disagreement is explicitly addressed.",
      "The acceptedAdjustments are traceable to specific risk memos rather than asserted.",
    ],
    preamble: preamble(
      GRADED_ANCHORS,
      "You are grading the Phase-5 PORTFOLIO MANAGER decision for internal coherence with its inputs.",
    ),
    needs: (b) => b.memos.some((m) => m.key === PM_KEY && m.state?.status === "published"),
    input: (blinded) => ({
      portfolioManager: blindedMemo(blinded, PM_KEY),
      trader: blindedMemo(blinded, TRADER_KEY),
      riskAssessment: blindedMemo(blinded, RISK_ASSESS_KEY),
    }),
  },
  {
    key: "confidence-calibration",
    kind: "graded",
    criteria: [
      "The stated decisionConfidence is proportionate to the evidence presented (scenario spread, evidenceBasis, acknowledged risks).",
      "The conviction LANGUAGE matches the strength of the evidence rather than overselling it.",
      "Uncertainty is acknowledged where the evidence is thin.",
    ],
    preamble: preamble(
      GRADED_ANCHORS,
      "You are grading EPISTEMIC CONGRUENCE: is stated conviction proportionate to the evidence? HEDGING LANGUAGE IS NEITHER REWARDED NOR PENALIZED — judge only whether the confidence matches the evidence, not how cautious the tone is.",
    ),
    needs: (b) => b.memos.some((m) => m.key === PM_KEY && m.state?.status === "published"),
    input: (blinded) => ({
      portfolioManager: blindedMemo(blinded, PM_KEY),
      scenarioForecast: blindedMemo(blinded, SCENARIO_KEY),
      valuationSpine: blinded.valuationSpine,
      rewardToRisk: blinded.rewardToRisk,
    }),
  },
];
