/**
 * Pure hard-validation gate for a recovered financial candidate (FIX-898).
 *
 * A prospectus-derived candidate — whether transcribed deterministically or by
 * the bounded LLM extractor — may only update the financials spine if it clears
 * EVERY check here: right company (CIK), plausible period, SEC-hosted source,
 * an explicitly parsed scale, a complete valuation-critical set, USD, and (when
 * all three are present) an internally reconciled operating/capex/FCF triple.
 * Anything that fails is rejected with a reason string for the recovery audit —
 * fields then stay `unavailable`, never zero-filled or magnitude-guessed.
 *
 * Kept pure (no network): the recovery runtime resolves the expected CIK once
 * and passes it in, so the accept/reject table is fully unit-testable.
 */
import {
  candidateFreeCashFlowRaw,
  type CandidateScale,
  type FinancialCandidate,
} from "./financial-candidate";

/** Reconciliation tolerance on FCF ≈ operating − |capex| (raw USD): the larger
 *  of $1M absolute and 1% relative, so rounded prospectus tables reconcile
 *  deterministically instead of one implementation accepting what another
 *  rejects. */
const RECONCILE_TOL_ABS = 1_000_000;
const RECONCILE_TOL_REL = 0.01;

/** Reject a period end more than this many days AFTER the run date (future
 *  information) or this many years BEFORE it (decades-stale vs. a fresh IPO). */
const PERIOD_FUTURE_GRACE_DAYS = 45;
const PERIOD_STALE_MAX_YEARS = 5;

const ALLOWED_SCALES: CandidateScale[] = [1, 1_000, 1_000_000, 1_000_000_000];
const SEC_ARCHIVES_PREFIX = "https://www.sec.gov/Archives/";

export type CandidateValidationContext = {
  ticker: string;
  /** The zero-padded-or-numeric CIK resolved for `ticker` from SEC. */
  expectedCik: number;
  /** The run's as-of date (`YYYY-MM-DD`). */
  asOfDate: string;
  /** Conformed company name from a trusted source (submissions / profile), if
   *  known — a non-empty candidate name is required regardless. */
  expectedName?: string | null;
};

export type CandidateValidationResult = {
  ok: boolean;
  reasons: string[];
};

function daysBetween(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** Loose name agreement: share at least one 4+-char alphanumeric token. Guards
 *  against a recycled ticker whose CIK happens to match but whose filing names
 *  a different entity. */
function namesAgree(candidate: string, expected: string): boolean {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 4),
    );
  const a = tokens(candidate);
  const b = tokens(expected);
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/**
 * Validate a candidate for promotion. Returns `{ ok, reasons }`; when `ok` is
 * false, `reasons` holds every failed check (all checks run, so the audit
 * records the full picture, not just the first failure).
 */
export function validateFinancialCandidate(
  candidate: FinancialCandidate,
  ctx: CandidateValidationContext,
): CandidateValidationResult {
  const reasons: string[] = [];

  // 1. CIK identity — the candidate must be the SAME filer as the ticker.
  if (candidate.cik !== ctx.expectedCik) {
    reasons.push(
      `wrong-company: candidate CIK ${candidate.cik} != resolved CIK ${ctx.expectedCik} for ${ctx.ticker}`,
    );
  }

  // 2. Conformed name present, and (when an expected name is known) agrees.
  if (!candidate.companyName.trim()) {
    reasons.push("missing-company-name");
  } else if (
    ctx.expectedName &&
    ctx.expectedName.trim() &&
    !namesAgree(candidate.companyName, ctx.expectedName)
  ) {
    reasons.push(
      `name-mismatch: "${candidate.companyName}" vs "${ctx.expectedName}"`,
    );
  }

  // 3. Period end present, not future, not decades stale.
  if (!candidate.periodEnd || Number.isNaN(Date.parse(candidate.periodEnd))) {
    reasons.push("missing-or-unparseable-period-end");
  } else {
    const ahead = daysBetween(candidate.periodEnd, ctx.asOfDate);
    if (ahead > PERIOD_FUTURE_GRACE_DAYS) {
      reasons.push(`stale-future: period ${candidate.periodEnd} is after run date ${ctx.asOfDate}`);
    } else if (ahead < -PERIOD_STALE_MAX_YEARS * 365) {
      reasons.push(`stale: period ${candidate.periodEnd} is >${PERIOD_STALE_MAX_YEARS}y before ${ctx.asOfDate}`);
    }
  }

  // 4. Source authority — SEC Archives only in v1 (no open-web statements).
  if (!candidate.sourceUrl.startsWith(SEC_ARCHIVES_PREFIX)) {
    reasons.push(`non-sec-source: ${candidate.sourceUrl}`);
  }

  // 5. Scale explicitly parsed (never inferred from magnitude).
  if (!ALLOWED_SCALES.includes(candidate.scale)) {
    reasons.push(`ambiguous-scale: ${candidate.scale}`);
  }

  // 6. Currency — USD only in v1.
  if (candidate.currency.toUpperCase() !== "USD") {
    reasons.push(`non-usd-currency: ${candidate.currency}`);
  }

  // 7. Completeness — revenue + operatingIncome + (FCF or operating+capex).
  const fcf = candidateFreeCashFlowRaw(candidate);
  if (candidate.income.revenue == null) reasons.push("missing-revenue");
  if (candidate.income.operatingIncome == null) reasons.push("missing-operating-income");
  if (fcf == null) reasons.push("missing-free-cash-flow");

  // 8. Reconciliation — when all three are present, FCF ≈ operating − |capex|.
  const { operating, capitalExpenditure, freeCashFlow } = candidate.cashflow;
  if (operating != null && capitalExpenditure != null && freeCashFlow != null) {
    const computed = operating - Math.abs(capitalExpenditure);
    const tolerance = Math.max(
      RECONCILE_TOL_ABS,
      RECONCILE_TOL_REL * Math.max(Math.abs(freeCashFlow), Math.abs(computed)),
    );
    if (Math.abs(freeCashFlow - computed) > tolerance) {
      reasons.push(
        `unreconciled-fcf: stated ${freeCashFlow} vs operating−|capex| ${computed} (tol ${tolerance})`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}
