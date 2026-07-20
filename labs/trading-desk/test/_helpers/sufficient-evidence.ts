/**
 * Shared "sufficient evidence" resource seeds for the PM-commit tests.
 *
 * The FIX-781 evidence gate is always-on: it reads the valuation spine, the
 * reward-to-risk figure, and the primary financial payloads at commit and
 * fail-closes (→ `insufficient-evidence`, `initiate`/`add` → `hold`) when any is
 * absent or thin. A test that isolates a DIFFERENT gate (policy, mandate) must
 * therefore establish a sufficient evidence context so the evidence gate is a
 * pass-through. These are the minimal sufficient seeds.
 */
import { emptyPayload } from "../../flows/analysis/tools/empty-payloads";
import type { ValuationSpineState } from "../../flows/analysis/valuation-spine-resource";
import type { RewardToRiskState } from "../../flows/analysis/reward-to-risk-resource";
import type { FinancialsDataState } from "../../flows/analysis/financials-data-resource";

const ARGS = { ticker: "NVDA", date: "2026-05-06" } as const;

/** A spine with `evidenceBasis: "sufficient"` and `lowConfidence: false`. */
export const SUFFICIENT_SPINE: ValuationSpineState = {
  ticker: "NVDA",
  asOf: "2026-05-06",
  expectedReturn: {
    shareholderYield: 0.01,
    sustainableGrowth: 0.14,
    expectedReturn: 0.15,
    hurdle: 0.09,
    excessReturn: 0.06,
    basis: "fcf",
    lowConfidence: false,
  },
  fairValue: {
    justifiedPE: 30,
    fairValue: 150,
    marginOfSafety: 0.1,
    method: "justified-pe",
    available: true,
  },
  dcf: null,
  triangulation: null,
  setupScore: {
    score: 0.6,
    value: 0.5,
    quality: 0.7,
    factor: 0.6,
    momentum: 0.6,
    evidenceBasis: "sufficient",
  },
  envelope: {
    absoluteRating: "Buy",
    relativeRating: "Overweight",
    implied: "Overweight",
    floor: "Hold",
    ceiling: "Buy",
    rationale: "x",
  },
  valuationMethod: "ev-multiples",
  evidenceBasis: "sufficient",
};

/** A reward-to-risk figure with `evidenceBasis: "sufficient"`. */
export const SUFFICIENT_REWARD_TO_RISK: RewardToRiskState = {
  expectedValuePct: 8,
  expectedGainPct: 20,
  expectedLossPct: -10,
  glr: 2,
  lossAdjustedGlr: 2.1,
  worstCaseReturnPct: -12.4,
  noDownside: false,
  evidenceBasis: "sufficient",
  lossAversion: 1,
  mandateId: null,
};

/** All four primary financial payloads present + available (`source` ≠
 *  "unavailable") → `criticalDataThin` is false. Built from the schema-valid
 *  empty payloads with the `source` tag flipped to a fixture read. */
export function availableFinancials(): FinancialsDataState {
  return {
    fundamentals: { ...emptyPayload("get_fundamentals", ARGS), source: "fixture" },
    balanceSheet: { ...emptyPayload("get_balance_sheet", ARGS), source: "fixture" },
    incomeStatement: { ...emptyPayload("get_income_statement", ARGS), source: "fixture" },
    cashflow: { ...emptyPayload("get_cashflow", ARGS), source: "fixture" },
  };
}
