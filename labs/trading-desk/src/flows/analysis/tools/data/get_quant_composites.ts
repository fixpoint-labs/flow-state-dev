/**
 * Quant composites handler: fetches multi-period financial statements —
 * SEC EDGAR companyfacts first (authoritative, multi-period, no key), Yahoo
 * `fundamentals-timeseries` as the non-US-filer fallback — and computes Altman
 * Z'' and Piotroski F-Score. EDGAR supplies the working-capital and
 * retained-earnings inputs Altman X1/X2 need; both sources carry a prior
 * period for the change-based Piotroski criteria.
 */
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { loadFixture } from "../runtime/fixtures";
import { fetchEdgarFinancialsHistory } from "../providers/edgar";
import { fetchYahooFinancialsHistory } from "../providers/yahoo";
import type { FinancialPeriod } from "../providers/financials-history";
import { emptyPayload } from "../empty-payloads";
import { altmanZDoublePrime, piotroskiFScore, type StatementPeriod } from "./composite-math";
import { pickMode, toolInputSchemas, toolOutputSchemas, type ToolInput, type ToolOutput } from "../schemas";
import { quantDataResource } from "../../quant-data-resource";
import { writeSubjectSpine } from "../runtime/spine-write-through";
import { recordIfRecording } from "../runtime/resolve";

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
  // EDGAR first (authoritative US filings, multi-period, no key); Yahoo
  // timeseries backstops non-US filers and EDGAR outages; empty when both miss.
  let periods: FinancialPeriod[] = [];
  let source: "edgar" | "yahoo" = "edgar";
  try {
    periods = await getOrFetch("edgar-financials-history", { ticker: input.ticker }, () =>
      fetchEdgarFinancialsHistory(input.ticker),
    );
  } catch {
    try {
      source = "yahoo";
      periods = await getOrFetch("yahoo-financials-history", { ticker: input.ticker }, () =>
        fetchYahooFinancialsHistory(input.ticker),
      );
    } catch {
      return emptyPayload("get_quant_composites", input);
    }
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
    source,
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
  resources: { quantData: quantDataResource },
  // Write-through to the session quant spine (see get_fundamentals). The internal
  // edgar/yahoo financials-history fetches stay on the process cache.
  execute: async (input, ctx) => {
    const loadQuantComposites = async () => {
      if (pickMode(ctx) === "fixture") return loadFixture("get_quant_composites", input);
      try {
        return await fetchLive(input);
      } catch {
        return emptyPayload("get_quant_composites", input);
      }
    };
    const payload = await writeSubjectSpine({
      toSpine: input.ticker === (ctx.session.state as { ticker?: string }).ticker,
      resource: ctx.resources.quantData,
      field: "quantComposites",
      tool: "get_quant_composites",
      input,
      load: loadQuantComposites,
    });
    return recordIfRecording("get_quant_composites", input, ctx, payload);
  },
});
