/**
 * Valuation spine orchestrator — assembles the full spine from raw payloads
 * and exposes prompt formatters for capability injection.
 */
import type { z } from "zod";
import type {
  balanceSheetSchema,
  cashflowSchema,
  fundamentalsSchema,
  incomeStatementSchema,
} from "../tools/schemas";
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

export interface ValuationSpine {
  ticker: string;
  asOf: string;
  expectedReturn: ExpectedReturn;
  fairValue: FairValue;
  dcf: DcfValue;
  triangulation: Triangulation;
  setupScore: SetupScore;
  envelope: RatingEnvelope;
  valuationMethod: "ev-multiples" | "equity-multiples";
  evidenceBasis: "sufficient" | "thin";
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
  technicals: { trend?: string; sma50?: number; sma200?: number } | null;
  valuation: DerivedValuation | null;
}): ValuationSpine {
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
type FormattableSpine = Omit<ValuationSpine, "dcf" | "triangulation"> & {
  dcf: DcfValue | null;
  triangulation: Triangulation | null;
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

export function formatValuationSpine(spine: FormattableSpine): string {
  const er = spine.expectedReturn;
  const fv = spine.fairValue;
  const ss = spine.setupScore;

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
