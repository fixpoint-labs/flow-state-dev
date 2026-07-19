/**
 * Integration regression for IPO/prospectus critical-financials recovery on the
 * live statement chain (FIX-898) — the SPCX failure mode.
 *
 * A newly listed issuer has an HTTP-success but SPARSE companyfacts (null
 * revenue / operating income / FCF) and no Yahoo statements, yet audited
 * financials in its 424B4 prospectus. This drives the three statement tools
 * (in parallel, exactly as the fundamentals analyst fans them out) in LIVE mode
 * with the providers mocked to that shape, and asserts:
 *   1. The sparse companyfacts does NOT stick as terminal `source: "edgar"` —
 *      recovery runs and promotes the prospectus statements onto the spine,
 *      tagged `edgar-prospectus` in USD billions, with a `promoted` audit.
 *   2. The three parallel tools share ONE recovery attempt (single-flight).
 *   3. A `toSpine: false` peer probe never triggers subject recovery.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";

const spcxHtml = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require("node:path");
  return readFileSync(p.join(__dirname, "__fixtures__", "spcx-prospectus.html"), "utf8");
});

const stubs = vi.hoisted(() => ({
  resolveCik: vi.fn(async () => "0001750000"),
  fetchCandidates: vi.fn(),
  fetchHtml: vi.fn(),
}));

const sparse = (extra: Record<string, unknown>) => ({
  source: "edgar" as const,
  ticker: "SPCX",
  asOf: "2026-05-06",
  unit: "USD billions",
  ...extra,
});

// EDGAR companyfacts answers 200 but sparse (null criticals); Yahoo misses.
vi.mock("@/lib/providers/edgar", () => ({
  resolveCik: stubs.resolveCik,
  fetchEdgarIncomeStatement: vi.fn(async () =>
    sparse({ revenue: null, grossProfit: null, operatingIncome: null, netIncome: null, yoyRevenueGrowth: null })),
  fetchEdgarBalanceSheet: vi.fn(async () =>
    sparse({ totalAssets: null, totalLiabilities: null, totalEquity: null, cashAndEquivalents: null, totalDebt: null })),
  fetchEdgarCashflow: vi.fn(async () =>
    sparse({ operating: null, investing: null, financing: null, freeCashFlow: null })),
}));
vi.mock("@/lib/providers/yahoo", () => ({
  fetchYahooIncomeStatement: vi.fn(async () => { throw new Error("yahoo miss"); }),
  fetchYahooBalanceSheet: vi.fn(async () => { throw new Error("yahoo miss"); }),
  fetchYahooCashflow: vi.fn(async () => { throw new Error("yahoo miss"); }),
}));
vi.mock("@/lib/providers/edgar-registration", () => ({
  fetchRegistrationCandidates: stubs.fetchCandidates,
  fetchProspectusPrimaryHtml: stubs.fetchHtml,
}));

import { get_income_statement } from "../flows/analysis/tools/data/get_income_statement";
import { get_balance_sheet } from "../flows/analysis/tools/data/get_balance_sheet";
import { get_cashflow } from "../flows/analysis/tools/data/get_cashflow";
import { financialsDataResource } from "../flows/analysis/financials-data-resource";
import { _resetRecoveryInflight } from "../flows/analysis/tools/runtime/critical-financials-recovery";

const candidate424 = {
  form: "424B4",
  filingDate: "2026-02-10",
  accessionNumber: "000000000026000004",
  primaryDocument: "424b4.htm",
  url: "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm",
  cik: 1750000,
  companyName: "SpaceCo Exploration Inc.",
};

const fillStatements = sequencer({
  name: "fill-statements",
  inputSchema: z.object({ ticker: z.string(), date: z.string() }),
}).parallel({
  incomeStatement: get_income_statement,
  balanceSheet: get_balance_sheet,
  cashflow: get_cashflow,
});

const stateSchema = z.object({
  ticker: z.string(),
  date: z.string(),
  dataSource: z.enum(["fixture", "live", "record"]),
  costPreset: z.enum(["fast", "full"]),
});

const recoveryFlow = defineFlow({
  kind: "trading-desk-financials-recovery-test",
  actions: {
    fill: { block: fillStatements },
    fetchIncome: { block: get_income_statement },
  },
  session: { stateSchema },
  resources: { financialsData: financialsDataResource },
})({ id: "test" });

const baseState = {
  ticker: "SPCX",
  date: "2026-05-06",
  dataSource: "live" as const,
  costPreset: "fast" as const,
};

beforeEach(() => {
  _resetRecoveryInflight();
  stubs.resolveCik.mockResolvedValue("0001750000");
  stubs.fetchCandidates.mockReset().mockResolvedValue([candidate424]);
  stubs.fetchHtml.mockReset().mockResolvedValue(spcxHtml);
});

describe("critical-financials recovery on the live statement chain", () => {
  it("promotes prospectus statements onto the spine when companyfacts is sparse and Yahoo misses", async () => {
    const stores = createInMemoryStores();
    const sessionId = "recovery-promote";

    const result = await testFlow({
      flow: recoveryFlow,
      action: "fill",
      userId: "u",
      sessionId,
      stores,
      input: { ticker: "SPCX", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(result.error).toBeUndefined();

    const financials = (await stores.resourceState.getAll("session", sessionId))[
      "financialsData"
    ] as Record<string, any>;

    // Sparse companyfacts did NOT stick — the prospectus recovery promoted.
    expect(financials.incomeStatement.source).toBe("edgar-prospectus");
    expect(financials.incomeStatement.revenue).toBeCloseTo(8.5, 6);
    expect(financials.incomeStatement.operatingIncome).toBeCloseTo(1.2, 6);
    expect(financials.cashflow.source).toBe("edgar-prospectus");
    expect(financials.cashflow.freeCashFlow).toBeCloseTo(-1.5, 6);
    expect(financials.balanceSheet.cashAndEquivalents).toBeCloseTo(4.0, 6);
    expect(financials.balanceSheet.totalDebt).toBeCloseTo(1.0, 6);

    // The recovery runtime wrote the audit exactly once.
    expect(financials.recoveryAudit.outcome).toBe("promoted");
    expect(financials.recoveryAudit.recoveredSource).toBe("edgar-prospectus");

    // Single-flight: three parallel tools, ONE discovery + ONE prospectus fetch.
    expect(stubs.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(stubs.fetchHtml).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable for the balance sheet when the prospectus omits cash and debt", async () => {
    // Income + cashflow are disclosed (recovery promotes), but the balance table
    // is absent — the promoted `edgar-prospectus` balance sheet is critically
    // sparse and must read as honest `unavailable`, not authoritative.
    const noBalance = spcxHtml.replace(/<h2>Consolidated Balance Sheet Data[\s\S]*?<\/table>/i, "");
    stubs.fetchHtml.mockResolvedValue(noBalance);
    const stores = createInMemoryStores();
    const sessionId = "recovery-no-balance";

    const result = await testFlow({
      flow: recoveryFlow,
      action: "fill",
      userId: "u",
      sessionId,
      stores,
      input: { ticker: "SPCX", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(result.error).toBeUndefined();

    const financials = (await stores.resourceState.getAll("session", sessionId))[
      "financialsData"
    ] as Record<string, any>;
    // Income + cashflow recovered from the prospectus...
    expect(financials.incomeStatement.source).toBe("edgar-prospectus");
    expect(financials.cashflow.source).toBe("edgar-prospectus");
    // ...but the balance sheet (no cash/debt disclosed) is honestly unavailable.
    expect(financials.balanceSheet.source).toBe("unavailable");
    expect(financials.recoveryAudit.outcome).toBe("promoted");
  });

  it("returns honest unavailable (not a sparse edgar shell) when subject recovery finds nothing", async () => {
    stubs.fetchCandidates.mockResolvedValue([]); // no registration candidates
    const stores = createInMemoryStores();
    const sessionId = "recovery-honest-unavailable";

    const result = await testFlow({
      flow: recoveryFlow,
      action: "fetchIncome",
      userId: "u",
      sessionId,
      stores,
      input: { ticker: "SPCX", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(result.error).toBeUndefined();
    // Sparse companyfacts + Yahoo miss + failed recovery → the subject's income
    // is honestly `unavailable`, NOT a `source: "edgar"` shell that reads as
    // "the authoritative provider answered".
    expect((result.output as { source?: string }).source).toBe("unavailable");

    const financials = (await stores.resourceState.getAll("session", sessionId))[
      "financialsData"
    ] as Record<string, any>;
    expect(financials.incomeStatement.source).toBe("unavailable");
    expect(financials.recoveryAudit.outcome).toBe("no-candidates");
  });

  it("does not trigger subject recovery for a toSpine:false peer probe", async () => {
    const stores = createInMemoryStores();
    const sessionId = "recovery-peer";

    // Subject is SPCX; a probe for a DIFFERENT ticker must not run recovery
    // (toSpine is false) and must not write the subject spine.
    const result = await testFlow({
      flow: recoveryFlow,
      action: "fetchIncome",
      userId: "u",
      sessionId,
      stores,
      input: { ticker: "PEERX", date: "2026-05-06" },
      seed: { session: { state: baseState } },
    });
    expect(result.error).toBeUndefined();
    // No recovery ran (toSpine false): the peer gets the best-available shell —
    // NOT a promoted `edgar-prospectus` payload, and discovery was never called.
    const out = result.output as { source?: string; revenue?: number | null };
    expect(out.source).not.toBe("edgar-prospectus");
    expect(out.revenue ?? null).toBeNull();
    expect(stubs.fetchCandidates).not.toHaveBeenCalled();

    const financials = (await stores.resourceState.getAll("session", sessionId))[
      "financialsData"
    ] as Record<string, unknown> | undefined;
    expect(financials?.incomeStatement).toBeUndefined();
    expect(financials?.recoveryAudit).toBeUndefined();
  });
});
