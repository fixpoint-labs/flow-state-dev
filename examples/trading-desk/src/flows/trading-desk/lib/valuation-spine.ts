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
} from "../phase-1/tools/schemas";
import { computeExpectedReturn, type ExpectedReturn } from "./expected-return";
import { computeFairValue, isFinancialSector, type FairValue } from "./fair-value";
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

  const ss = computeSetupScore({
    expectedReturn: er,
    fairValue: fv,
    quantComposites: args.quantComposites,
    factorRanks: args.factorRanks,
    technicals: args.technicals,
    valuation: args.valuation,
  });

  const envelope = modelImpliedRating({ expectedReturn: er, fairValue: fv, setupScore: ss });

  const financial = isFinancialSector(args.sector);

  return {
    ticker: args.ticker,
    asOf: args.asOf,
    expectedReturn: er,
    fairValue: fv,
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

export function formatValuationSpine(spine: ValuationSpine): string {
  const er = spine.expectedReturn;
  const fv = spine.fairValue;
  const ss = spine.setupScore;

  const lines = [
    `<valuationSpine ticker="${spine.ticker}" asOf="${spine.asOf}">`,
    `Expected return: ${pct(er.expectedReturn)} (basis: ${er.basis}, yield: ${pct(er.shareholderYield)}, growth: ${pct(er.sustainableGrowth)})`,
    `Excess return vs ${pct(er.hurdle)} hurdle: ${pct(er.excessReturn)}`,
    `Fair value (${fv.method}): ${fv.fairValue != null ? "$" + num(fv.fairValue) + "B" : "n/a"} | Margin of safety: ${pct(fv.marginOfSafety)}`,
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
