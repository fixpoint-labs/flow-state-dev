/**
 * Trailing income statement. Live: SEC EDGAR companyfacts (authoritative US
 * filings) preferred, Yahoo `fundamentals-timeseries` fallback (Yahoo also
 * supplies YoY revenue growth from its two latest annual periods; EDGAR
 * leaves YoY null). When both miss the valuation-critical fields for the
 * subject — including an HTTP-success companyfacts with null revenue/operating
 * income for a newly listed issuer — a bounded IPO-prospectus recovery runs
 * (FIX-898). Fixture: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../runtime/fixtures";
import { fetchEdgarIncomeStatement } from "@/lib/providers/edgar";
import { fetchYahooIncomeStatement } from "@/lib/providers/yahoo";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import { financialsDataResource } from "../../financials-data-resource";
import { writeSubjectSpine } from "../runtime/spine-write-through";
import { loadStatementWithRecovery } from "../runtime/statement-recovery";
import type { RecoveryCtx } from "../runtime/critical-financials-recovery";
import { recordIfRecording } from "../runtime/resolve";

export const get_income_statement = handler({
  name: "get_income_statement",
  description: "Trailing income statement for a ticker.",
  inputSchema: toolInputSchemas.get_income_statement,
  outputSchema: toolOutputSchemas.get_income_statement,
  resources: { financialsData: financialsDataResource },
  // Write-through to the session financials spine (see get_fundamentals).
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    const toSpine = input.ticker === (ctx.session.state as { ticker?: string }).ticker;
    const loadIncomeStatement = async () => {
      if (mode === "fixture") return loadFixture("get_income_statement", input);
      return loadStatementWithRecovery({
        spec: { field: "incomeStatement", tool: "get_income_statement" },
        input,
        ctx: ctx as unknown as RecoveryCtx,
        toSpine,
        fetchEdgar: () => fetchEdgarIncomeStatement(input),
        fetchYahoo: () => fetchYahooIncomeStatement(input),
      });
    };
    const payload = await writeSubjectSpine({
      toSpine,
      resource: ctx.resources.financialsData,
      field: "incomeStatement",
      tool: "get_income_statement",
      input,
      load: loadIncomeStatement,
    });
    return recordIfRecording("get_income_statement", input, ctx, payload);
  },
});
