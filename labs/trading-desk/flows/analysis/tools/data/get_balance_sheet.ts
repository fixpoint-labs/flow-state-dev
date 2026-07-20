/**
 * Latest balance sheet (totals only). Live: SEC EDGAR companyfacts
 * (authoritative US filings) preferred, Yahoo `fundamentals-timeseries`
 * fallback. When both miss the subject's cash / debt — including a sparse
 * companyfacts for a newly listed issuer — a bounded IPO-prospectus recovery
 * runs and fills cash/debt when the prospectus discloses them (FIX-898).
 * Fixture: curated per-ticker JSON.
 */
import { handler } from "@flow-state-dev/core";
import { loadFixture } from "../runtime/fixtures";
import { fetchEdgarBalanceSheet } from "@/lib/providers/edgar";
import { fetchYahooBalanceSheet } from "@/lib/providers/yahoo";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";
import { financialsDataResource } from "../../financials-data-resource";
import { writeSubjectSpine } from "../runtime/spine-write-through";
import { loadStatementWithRecovery } from "../runtime/statement-recovery";
import type { RecoveryCtx } from "../runtime/critical-financials-recovery";
import { recordIfRecording } from "../runtime/resolve";

export const get_balance_sheet = handler({
  name: "get_balance_sheet",
  description: "Latest balance sheet for a ticker (totals only).",
  inputSchema: toolInputSchemas.get_balance_sheet,
  outputSchema: toolOutputSchemas.get_balance_sheet,
  resources: { financialsData: financialsDataResource },
  // Write-through to the session financials spine (see get_fundamentals).
  execute: async (input, ctx) => {
    const mode = pickMode(ctx);
    const toSpine = input.ticker === (ctx.session.state as { ticker?: string }).ticker;
    const loadBalanceSheet = async () => {
      if (mode === "fixture") return loadFixture("get_balance_sheet", input);
      return loadStatementWithRecovery({
        spec: { field: "balanceSheet", tool: "get_balance_sheet" },
        input,
        ctx: ctx as unknown as RecoveryCtx,
        toSpine,
        fetchEdgar: () => fetchEdgarBalanceSheet(input),
        fetchYahoo: () => fetchYahooBalanceSheet(input),
      });
    };
    const payload = await writeSubjectSpine({
      toSpine,
      resource: ctx.resources.financialsData,
      field: "balanceSheet",
      tool: "get_balance_sheet",
      input,
      load: loadBalanceSheet,
    });
    return recordIfRecording("get_balance_sheet", input, ctx, payload);
  },
});
