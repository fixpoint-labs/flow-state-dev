/**
 * Quant composites handler: fetches multi-period financial statements and
 * computes Altman Z'' and Piotroski F-Score.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../lib/cache";
import { loadFixture } from "../../lib/fixtures";
import { fetchYahooFinancialsHistory, type FinancialPeriod } from "../../providers/yahoo";
import { emptyPayload } from "./empty-payloads";
import { altmanZDoublePrime, piotroskiFScore, type StatementPeriod } from "./composite-math";
import {
  pickMode,
  toolInputSchemas,
  toolOutputSchemas,
  type ToolInput,
  type ToolOutput,
} from "./schemas";

function toStatementPeriod(fp: FinancialPeriod): StatementPeriod {
  return {
    totalAssets: fp.totalAssets,
    totalCurrentAssets: fp.totalCurrentAssets,
    totalCurrentLiabilities: fp.totalCurrentLiabilities,
    totalLiabilities: fp.totalLiabilities,
    retainedEarnings: fp.retainedEarnings,
    totalEquity: fp.totalEquity,
    totalRevenue: fp.totalRevenue,
    costOfRevenue: fp.costOfRevenue,
    grossProfit: fp.grossProfit,
    operatingIncome: fp.operatingIncome,
    netIncome: fp.netIncome,
    cfo: fp.cfo,
    capitalExpenditures: fp.capitalExpenditures,
    sharesOutstanding: null,
  };
}

async function fetchLive(
  input: ToolInput<"get_quant_composites">,
): Promise<ToolOutput<"get_quant_composites">> {
  let periods: FinancialPeriod[];
  try {
    periods = await getOrFetch("yahoo-financials-history", { ticker: input.ticker }, () =>
      fetchYahooFinancialsHistory(input.ticker),
    );
  } catch {
    return emptyPayload("get_quant_composites", input);
  }

  if (periods.length === 0) return emptyPayload("get_quant_composites", input);

  const current = toStatementPeriod(periods[0]);
  const prior = periods.length >= 2 ? toStatementPeriod(periods[1]) : null;

  const altman = altmanZDoublePrime(current);
  const piotroski = piotroskiFScore(current, prior);

  const coverageNotes: string[] = [];
  if (altman?.missingInputs.length) {
    coverageNotes.push(`Altman Z'' partial — missing: ${altman.missingInputs.join(", ")}.`);
  }
  if (altman == null) {
    coverageNotes.push("Altman Z'' could not be computed (insufficient core data).");
  }
  if (prior == null) {
    coverageNotes.push("Piotroski: prior-period data unavailable; change-based criteria are null.");
  }
  coverageNotes.push(
    `Piotroski: ${piotroski.computable} of 9 criteria computable, ${piotroski.score} passed.`,
  );

  return {
    source: "yahoo",
    ticker: input.ticker,
    asOf: periods[0].endDate || input.date,
    altmanZ: altman?.score ?? null,
    altmanZone: altman?.zone ?? null,
    altmanVariant: altman != null ? "Z''" : null,
    piotroskiF: piotroski.computable > 0 ? piotroski.score : null,
    piotroskiBreakdown: piotroski.breakdown,
    coverageNote: coverageNotes.join(" "),
  };
}

export const get_quant_composites = handler({
  name: "get_quant_composites",
  description:
    "Statistical composites: Altman Z'' (bankruptcy risk) and Piotroski " +
    "F-Score (financial strength) from quarterly statements.",
  inputSchema: toolInputSchemas.get_quant_composites,
  outputSchema: toolOutputSchemas.get_quant_composites,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_quant_composites", input);
    return getOrFetch("get_quant_composites", input, async () => {
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_quant_composites", input);
      }
    });
  },
});
