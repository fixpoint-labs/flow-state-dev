/**
 * Valuation spine orchestrator — assembles the full spine from raw payloads
 * and exposes prompt formatters for capability injection.
 *
 * PERIOD COHERENCE IS AN INPUT CONTRACT, NOT A COMPUTATION (FIX-1113). When the
 * three statements cannot be placed at one period, every output that reads more
 * than one of them is withheld — the expected return, and therefore fair value,
 * the DCF, triangulation, the setup score and the RATING ENVELOPE, all of which
 * descend from it.
 *
 * WHY THE CHECK IS ON THE INPUTS AND NOT INSIDE `valuation.ts`. The expected
 * return takes all three statements, is computed FIRST, and does NOT pass
 * through `computeValuation` — so a guard placed there would withhold a multiple
 * and still publish a rating built on mixed periods. `valuation.ts` is not the
 * chokepoint for valuation; any future guard belonging to a SET OF INPUTS
 * (currency, staleness, restatement provenance) goes on the inputs for the same
 * reason.
 *
 * WITHHOLDING THE ENVELOPE IS FAIL-OPEN, AND THAT IS THE TRAP HERE. The envelope
 * only CLAMPS a rating the portfolio manager emits on its own as a required
 * field (`agents/portfolio-manager/writer.ts` — the clamp sits inside
 * `if (spine?.envelope)`). Withholding it removes the BOUND, not the rating: the
 * model's value publishes unconstrained. So "withhold more" is not automatically
 * "safer" — for this one output, absence is permission. `periodDisclosure` is
 * what carries the honesty instead, and the published rating is marked
 * unanchored from it. Check what the ABSENCE of a thing causes before withholding
 * it.
 *
 * AND THIS PARAGRAPH IS NOT THE MECHANISM. It named the trap and the call site
 * one directory over fell into a variant of it anyway: `capability.ts` guarded
 * the spine but not the envelope, so the withheld path threw a TypeError inside
 * `formatRatingEnvelope` instead of degrading — killing the very rating this
 * design exists to keep publishing. What actually holds the contract is
 * `test/valuation-spine-capability.spec.ts`, which runs the SHIPPED capability
 * preset against a withheld spine. Add a consumer of `envelope`, add an arm
 * there; do not rely on a reader having read this.
 */
import type { z } from "zod";
import type {
  balanceSheetSchema,
  cashflowSchema,
  fundamentalsSchema,
  incomeStatementSchema,
} from "../tools/schemas";
import { periodsMutuallyAgree } from "@/lib/providers/financial-period";
import { computeExpectedReturn, type ExpectedReturn } from "./expected-return";
import { computeFairValue, isFinancialSector, type FairValue } from "./fair-value";
import { computeDcfValue, type DcfValue } from "./dcf";
import { computeTriangulation, type Triangulation } from "./triangulation";
import { computeSetupScore, type SetupScore } from "./setup-score";
import { modelImpliedRating, type RatingEnvelope } from "./rating-engine";
import type { DerivedValuation } from "./valuation";

type Fundamentals = z.infer<typeof fundamentalsSchema>;
type BalanceSheet = z.infer<typeof balanceSheetSchema>;
type IncomeStatement = z.infer<typeof incomeStatementSchema>;
type Cashflow = z.infer<typeof cashflowSchema>;

/** Why the desk could not place the three statements at one period, and where
 *  each of them landed — the disclosure the report carries and the marker the
 *  run records. Null when the set IS coherent (the ordinary case). */
export type PeriodDisclosure = {
  reason: "settled-for-less-than-seen" | "periods-disagree" | "period-unstated";
  income: string | null;
  balance: string | null;
  cashflow: string | null;
  /** The newer period a resolution saw before settling for an older one.
   *  Populated only on `reason: "settled-for-less-than-seen"` — see
   *  `StatementSetVerdict.observedNewest`. */
  observedNewest?: string | null;
};

export interface ValuationSpine {
  ticker: string;
  asOf: string;
  /** Nullable from FIX-1113: withheld when the statements do not share a
   *  period. Every field below it descends from this one. */
  expectedReturn: ExpectedReturn | null;
  fairValue: FairValue | null;
  dcf: DcfValue | null;
  triangulation: Triangulation | null;
  setupScore: SetupScore | null;
  envelope: RatingEnvelope | null;
  valuationMethod: "ev-multiples" | "equity-multiples";
  evidenceBasis: "sufficient" | "thin";
  /** Non-null exactly when the cross-statement outputs above were withheld. */
  periodDisclosure: PeriodDisclosure | null;
}

export function buildValuationSpine(args: {
  ticker: string;
  asOf: string;
  fundamentals: Fundamentals;
  balanceSheet: BalanceSheet;
  incomeStatement: IncomeStatement;
  cashflow: Cashflow;
  sector: string | null;
  quantComposites: { piotroskiF?: number; altmanZone?: string } | null;
  factorRanks: { compositeFactorPercentile?: number } | null;
  // Nullable per field: a short history yields a real `sma50` with no `sma200`
  // and no `trend` (FIX-1063). Passed straight to `computeSetupScore`, which
  // treats a missing reading as no momentum component rather than a neutral
  // one — keep the two signatures in step.
  technicals: {
    trend?: string | null;
    sma50?: number | null;
    sma200?: number | null;
  } | null;
  valuation: DerivedValuation | null;
  /** Null when the statements share a period (the ordinary case). Non-null
   *  withholds every cross-statement output — see the file header. */
  periodDisclosure?: PeriodDisclosure | null;
}): ValuationSpine {
  const periodDisclosure = args.periodDisclosure ?? null;
  if (periodDisclosure != null) {
    // Withhold, and report the evidence as THIN. Leaving it `sufficient` while
    // the outputs it summarises were never computed is the same
    // signal-without-substance defect the honesty contract exists to stop — and
    // `thin` is what the always-on evidence gate reads to cap new exposure.
    return {
      ticker: args.ticker,
      asOf: args.asOf,
      expectedReturn: null,
      fairValue: null,
      dcf: null,
      triangulation: null,
      setupScore: null,
      envelope: null,
      valuationMethod: isFinancialSector(args.sector)
        ? "equity-multiples"
        : "ev-multiples",
      evidenceBasis: "thin",
      periodDisclosure,
    };
  }

  const er = computeExpectedReturn({
    fundamentals: args.fundamentals,
    incomeStatement: args.incomeStatement,
    cashflow: args.cashflow,
    balanceSheet: args.balanceSheet,
  });

  const fv = computeFairValue({
    fundamentals: args.fundamentals,
    incomeStatement: args.incomeStatement,
    expectedReturn: er,
    sector: args.sector,
  });

  const dcf = computeDcfValue({
    fundamentals: args.fundamentals,
    incomeStatement: args.incomeStatement,
    cashflow: args.cashflow,
    expectedReturn: er,
    valuation: args.valuation,
    sector: args.sector,
  });

  const triangulation = computeTriangulation({ fairValue: fv, dcf });

  const ss = computeSetupScore({
    expectedReturn: er,
    marginOfSafety: triangulation.marginOfSafety,
    quantComposites: args.quantComposites,
    factorRanks: args.factorRanks,
    technicals: args.technicals,
    valuation: args.valuation,
  });

  const envelope = modelImpliedRating({ expectedReturn: er, fairValue: fv, setupScore: ss, triangulation });

  const financial = isFinancialSector(args.sector);

  return {
    ticker: args.ticker,
    asOf: args.asOf,
    expectedReturn: er,
    fairValue: fv,
    dcf,
    triangulation,
    setupScore: ss,
    envelope,
    valuationMethod: financial ? "equity-multiples" : "ev-multiples",
    evidenceBasis: ss.evidenceBasis === "thin" || er.lowConfidence ? "thin" : "sufficient",
    periodDisclosure: null,
  };
}

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(1)}%` : "n/a";
}

function num(v: number | null, decimals = 1): string {
  return v != null ? v.toFixed(decimals) : "n/a";
}

/** Whole-percent (15%) for growth-rate fields. */
function gpct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : "n/a";
}

/** Signed percentage-points (+55pp) for the expectations gap. */
function pp(v: number | null): string {
  if (v == null) return "n/a";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(0)}pp`;
}

/**
 * Spine shape the formatters accept. `dcf` / `triangulation` are nullable here
 * (not on `ValuationSpine`) because the capability injects the PARSED resource
 * state, and a session persisted before FIX-807 re-parses with both = null. The
 * formatters must degrade to n/a on that legacy shape, never throw.
 */
type FormattableSpine = Omit<
  ValuationSpine,
  "dcf" | "triangulation" | "periodDisclosure"
> & {
  dcf: DcfValue | null;
  triangulation: Triangulation | null;
  periodDisclosure?: PeriodDisclosure | null;
};

/** The DCF intrinsic-value line — n/a-safe (null legacy block or abstention). */
function formatDcfLine(dcf: DcfValue | null): string {
  if (dcf == null) return "Intrinsic value (DCF): n/a";
  if (!dcf.available) {
    return `Intrinsic value (DCF): n/a (${dcf.unavailableReason ?? "unavailable"})`;
  }
  const tvFlag = dcf.reliability === "tv-dominated" ? ", ⚠ terminal-value-dominated" : "";
  return (
    `Intrinsic value (DCF): $${num(dcf.intrinsicValue)}B | ` +
    `DCF margin of safety: ${pct(dcf.marginOfSafety)} ` +
    `(discount ${gpct(dcf.discountRate)}, stage-1 growth ${gpct(dcf.stage1Growth)}, ` +
    `terminal-value share ${gpct(dcf.terminalValueShare)}${tvFlag})`
  );
}

/** The reverse-DCF clause, rendered per status. Empty when null or no reading. */
function formatReverseDcfClause(dcf: DcfValue | null): string {
  switch (dcf?.reverseDcfStatus) {
    case "solved":
      return (
        ` | reverse-DCF implies ${gpct(dcf.impliedGrowth)} vs ${gpct(dcf.stage1Growth)} ` +
        `fundamentals-supported → expectations gap ${pp(dcf.expectationsGap)}`
      );
    case "above-bracket":
      return " | reverse-DCF: market prices in >100% near-term FCF growth";
    case "below-terminal":
      return " | reverse-DCF: market implies sub-terminal growth";
    default:
      return "";
  }
}

/** The triangulation line — n/a-safe (null legacy block or unavailable). */
function formatTriangulationLine(spine: FormattableSpine): string {
  const t = spine.triangulation;
  if (t == null || t.divergence === "unavailable") return "Triangulation: n/a";
  return (
    `Triangulation: ${t.divergence} | consensus margin of safety: ${pct(t.marginOfSafety)}` +
    formatReverseDcfClause(spine.dcf)
  );
}

/**
 * The single WITHHELD sentence the portfolio manager (and every other
 * `valuationSpine`-capability reader) sees in place of the spine's numbers.
 *
 * SAME INVARIANT AS `formatPeriodMismatch` (`statement-set-period.ts`), same
 * reason it needs a real check rather than a reason-keyed string: on
 * `settled-for-less-than-seen`, `isCoherentStatementSet` returns as soon as
 * ONE statement's own resolution settled for less than it saw — before it
 * ever checks whether the three RETURNED periods (`pd.income/balance/
 * cashflow`) agree with each other. So this reason covers both uniform
 * staleness (all three genuinely agree) and a stale statement sitting
 * alongside peers that disagree with it or are themselves unstated.
 * `periodsMutuallyAgree` is what tells the two apart — imported from the same
 * module `formatPeriodMismatch` uses it from, so the two blocks cannot
 * disagree about what "these agree" means. Different AUDIENCE from that
 * block (this one has no raw statement data to reason about "within a single
 * statement", so it says nothing about that), but the same truth standard:
 * every clause here must hold for the periods printed beside it.
 */
function withheldReasonLine(pd: PeriodDisclosure): string {
  const named = `(income ${pd.income ?? "none"}, balance sheet ${pd.balance ?? "none"}, cash flow ${pd.cashflow ?? "none"})`;
  const withheldOutputs =
    "Every figure spanning two statements — expected return, fair value, the cash-flow model, " +
    "triangulation, the setup score and the rating envelope —";

  if (pd.reason === "period-unstated") {
    return (
      `WITHHELD: the desk CANNOT ESTABLISH that the three statements below describe the same ` +
      `fiscal period ${named} — at least one carries figures but states no period. ${withheldOutputs} ` +
      `is withheld, because a figure built across them could silently combine two different fiscal ` +
      `periods. Do NOT combine figures across these statements yourself.`
    );
  }

  if (pd.reason === "settled-for-less-than-seen") {
    const seen = pd.observedNewest ?? "a newer period";
    if (periodsMutuallyAgree(pd.income, pd.balance, pd.cashflow)) {
      return (
        `WITHHELD: the three statements below agree on a fiscal period ${named}, but the desk saw a ` +
        `more recent one (${seen}) and settled for this older one instead — the set is STALE, not in ` +
        `disagreement. ${withheldOutputs} is withheld because it would present a superseded figure as ` +
        `current, not because the periods conflict. Do NOT combine figures across these statements ` +
        `yourself.`
      );
    }
    return (
      `WITHHELD: at least one of the three statements below is STALE — the desk saw a more recent ` +
      `period (${seen}) while resolving it than it actually returned, and the three are NOT confirmed ` +
      `to all describe one shared fiscal period ${named}. ${withheldOutputs} is withheld. Do NOT ` +
      `combine figures across these statements yourself.`
    );
  }

  // `periods-disagree` only: a real, confirmed clash between at least two of
  // the three returned periods — "could not establish a single fiscal
  // period" and "rather than computed across periods" are both true here.
  return (
    `WITHHELD: the desk could not establish a single fiscal period across the three statements ` +
    `${named}. ${withheldOutputs} is withheld rather than computed across periods. Do NOT combine ` +
    `figures across these statements yourself.`
  );
}

export function formatValuationSpine(spine: FormattableSpine): string {
  const er = spine.expectedReturn;
  const fv = spine.fairValue;
  const ss = spine.setupScore;

  // The withheld shape (FIX-1113). Say WHY and name the dates — a spine that
  // rendered every line as "n/a" would read as a data outage rather than as the
  // desk declining to combine figures from different years.
  const pd = spine.periodDisclosure;
  if (pd != null || er == null || fv == null || ss == null) {
    return [
      `<valuationSpine ticker="${spine.ticker}" asOf="${spine.asOf}">`,
      pd != null ? withheldReasonLine(pd) : "WITHHELD: the valuation spine was not computed.",
      `Valuation method: ${spine.valuationMethod} | Evidence: ${spine.evidenceBasis}`,
      `</valuationSpine>`,
    ].join("\n");
  }

  const lines = [
    `<valuationSpine ticker="${spine.ticker}" asOf="${spine.asOf}">`,
    `Expected return: ${pct(er.expectedReturn)} (basis: ${er.basis}, yield: ${pct(er.shareholderYield)}, growth: ${pct(er.sustainableGrowth)})`,
    `Excess return vs ${pct(er.hurdle)} hurdle: ${pct(er.excessReturn)}`,
    `Fair value (${fv.method}): ${fv.fairValue != null ? "$" + num(fv.fairValue) + "B" : "n/a"} | Margin of safety: ${pct(fv.marginOfSafety)}`,
    formatDcfLine(spine.dcf),
    formatTriangulationLine(spine),
    `Setup score: ${ss.score ?? "n/a"}/100 (value: ${ss.value ?? "n/a"}, quality: ${ss.quality ?? "n/a"}, factor: ${ss.factor ?? "n/a"}, momentum: ${ss.momentum ?? "n/a"})`,
    `Valuation method: ${spine.valuationMethod} | Evidence: ${spine.evidenceBasis}`,
    er.lowConfidence ? "⚠ Low confidence: both FCF and earnings are non-positive." : "",
    `</valuationSpine>`,
  ].filter(Boolean);

  return lines.join("\n");
}

export function formatRatingEnvelope(envelope: RatingEnvelope): string {
  return [
    `<ratingEnvelope>`,
    `Absolute rating (return-anchored): ${envelope.absoluteRating}`,
    `Relative rating (score-anchored): ${envelope.relativeRating}`,
    `Model-implied combined: ${envelope.implied}`,
    `Permitted band: ${envelope.floor} .. ${envelope.ceiling}`,
    `Rationale: ${envelope.rationale}`,
    `To choose outside the band, set ratingOverrideReason to one sentence naming what the model misses; otherwise your rating is clamped to the band.`,
    `</ratingEnvelope>`,
  ].join("\n");
}
